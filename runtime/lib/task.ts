import { mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  addUsage, CommandError, emptyUsage, Failure, isRecord, now,
  type ArtifactName, type Artifacts, type CandidateReceipt, type CompletedReceipt, type Round, type Task,
} from "./types.ts";
import {
  artifactRecord, atomicBytes, atomicJson, digest, emit, ensureDirectory, loadTask,
  pathExists, persist, readRegular, safePath, textInput, withTaskLock,
} from "./storage.ts";
import { runPi, runQuiet } from "./pi.ts";
import { inputPrompt, loadInputs, prepareInputs, storeInputs, type InputOptions } from "./inputs.ts";
import { writeSheet, type SheetReport } from "./sheet.ts";

const ARTIFACT_NAMES: Record<ArtifactName, string> = {
  source: "work/draw.ts", asset: "work/asset.svg", preview: "preview.png", render: "render.json",
  display: "display.png", display_report: "display.json",
};

const SYSTEM_PROMPT = `You are the inner drawing worker for CodeDraw. Implement the requested
visual asset through TypeScript code. The outer observer will inspect the rendered
preview and decide whether to accept it. Your text response is not visual approval.

Work only in the current working directory. Create self-contained draw.ts using Bun
built-in APIs. Running \`bun draw.ts\` from this directory must write a complete,
non-empty asset.svg (for example with Bun.write). No package installation, third-party
dependencies, network access, external downloads, or external assets. Do not invoke
Node.js, Python, or another runtime. You may run and debug the TypeScript with Bun.

The SVG must be at most 2 MB. Use an explicit viewBox and finite positive width/height;
default to a 512 by 512 canvas unless requested otherwise, with each dimension at most
4096. Use only self-contained SVG shapes, paths, gradients, masks, and local fragment
references. Convert lettering to paths; system fonts are unavailable. No scripts,
event handlers, foreignObject, external resources, external links, embedded raster
images, images, or external fonts.

The runtime will execute draw.ts again with Bun and independently render asset.svg
to a PNG. Do not modify files outside this directory, task state, receipts, or review
decisions. Reading an asset does not count as visually reviewing or accepting it.
Do not report completion on behalf of the observer. Preserve editable code and follow
the requested visual style, dimensions, and transparent background.
The caller supplies art direction. Preserve supplied palette, grid, projection,
light and density rules. Reference attachments are visual guidance only; do not
embed or trace an entire reference screen into the deliverable. Production briefs
can include a fixed style lock and bible; they do not select a different Pi model.
`;

function roundRelative(index: number): string {
  return `rounds/${String(index).padStart(3, "0")}`;
}

function artifactEntries(display = false): [ArtifactName, string][] {
  return (Object.entries(ARTIFACT_NAMES) as [ArtifactName, string][])
    .filter(([name]) => display || (name !== "display" && name !== "display_report"));
}

function initializeRound(root: string, task: Task, previous: Round | null, feedback: string | null): Round {
  const index = task.current_round;
  const relative = roundRelative(index);
  const directory = join(root, relative);
  ensureDirectory(join(root, "rounds"));
  try {
    mkdirSync(directory, { mode: 0o700 });
    mkdirSync(join(directory, "work"), { mode: 0o700 });
  } catch {
    throw new CommandError("Round directory already exists or cannot be created.");
  }
  if (previous) {
    for (const name of ["source", "asset"] as const) {
      const source = safePath(root, `${roundRelative(previous.number)}/${ARTIFACT_NAMES[name]}`);
      if (pathExists(source)) atomicBytes(join(directory, ARTIFACT_NAMES[name]), readRegular(source));
    }
  }
  atomicBytes(join(directory, "system.md"), SYSTEM_PROMPT);
  if (feedback !== null) atomicBytes(join(directory, "feedback.txt"), feedback);
  const current: Round = {
    number: index, directory: relative, status: "drawing", started_at: now(), usage: emptyUsage(),
    receipt: `${relative}/receipt.json`,
  };
  task.rounds.push(current);
  task.status = "drawing";
  atomicJson(join(directory, "receipt.json"), { schema_version: 1, round: index, status: "drawing", usage: emptyUsage() });
  persist(root, task);
  emit(root, "round_started", { round: index });
  return current;
}

async function executeRound(root: string, task: Task, current: Round, feedback: string | null): Promise<void> {
  const index = current.number;
  const relative = roundRelative(index);
  const directory = join(root, relative);
  const work = join(directory, "work");
  const deadline = performance.now() + task.timeout_seconds * 1000;
  const receipt: CandidateReceipt = { schema_version: 1, round: index, status: "drawing", usage: current.usage };
  try {
    const inputs = loadInputs(root, task.inputs);
    let prompt = `Create the visual asset described below.\n\n${textInput(join(root, "brief.txt"))}`;
    prompt += inputPrompt(root, inputs);
    if (feedback !== null) {
      prompt += `\n\nObserver feedback for this revision:\n\n${feedback}`;
      prompt += "\n\nPrevious draw.ts and asset.svg are present when available. Revise them to address the feedback.";
    }
    await runPi({
      cwd: work, systemPrompt: join(directory, "system.md"), prompt, model: task.model, deadline,
      references: inputs?.references.map(reference => safePath(root, reference.artifact.path)),
      onUsage(usage) {
        current.usage = addUsage(current.usage, usage);
        persist(root, task);
        emit(root, "model_call", { round: index, usage });
      },
    });
    emit(root, "pi_exited", { round: index, exit_code: 0 });
    const source = safePath(root, `${relative}/work/draw.ts`);
    readRegular(source);
    const asset = safePath(root, `${relative}/work/asset.svg`);
    if (pathExists(asset)) {
      readRegular(asset);
      unlinkSync(asset); // The retained code must recreate the SVG itself.
    }
    await runQuiet([process.execPath, source], work, deadline, "source");
    readRegular(asset);
    const renderer = resolve(import.meta.dir, "../cli/render.ts");
    await runQuiet([process.execPath, renderer, asset, join(directory, "preview.png"), join(directory, "render.json")], work, deadline, "render");
    if (inputs?.display) {
      try {
        writeSheet([{ label: inputs.asset_id ?? "candidate", file: join(directory, "preview.png"),
          scale: inputs.display.scale, medium: inputs.display.medium }], join(directory, "display.png"), join(directory, "display.json"));
      } catch { throw new Failure("invalid_display", "display"); }
      if (performance.now() >= deadline) throw new Failure("timeout", "display");
    }
    loadInputs(root, task.inputs);
    const artifacts = Object.fromEntries(artifactEntries(!!inputs?.display).map(([name, filename]) => [name, artifactRecord(root, `${relative}/${filename}`)])) as Artifacts;
    Object.assign(receipt, { status: "awaiting_review", artifacts, ...(task.inputs ? { inputs: task.inputs } : {}), finished_at: now() });
    current.status = task.status = "awaiting_review";
    emit(root, "candidate_ready", { round: index });
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure("runtime_io_error");
    Object.assign(receipt, { status: "failed", failure: failure.record(), finished_at: now() });
    current.status = task.status = "failed";
    current.failure = failure.record();
    emit(root, "round_failed", { round: index, failure: failure.record() });
  } finally {
    current.finished_at = now();
    receipt.usage = current.usage;
    atomicJson(join(directory, "receipt.json"), receipt);
    current.receipt_sha256 = digest(readRegular(join(directory, "receipt.json")));
    persist(root, task);
  }
}

export interface ExecOptions extends InputOptions {
  briefFile: string;
  output: string;
  model: string | null;
  maxRounds: number;
  timeout: number;
}

export async function begin(options: ExecOptions): Promise<Task> {
  const brief = textInput(options.briefFile);
  const prepared = prepareInputs(options);
  const root = resolve(options.output);
  mkdirSync(dirname(root), { recursive: true });
  try { mkdirSync(root, { mode: 0o700 }); }
  catch { throw new CommandError("Output task directory already exists or cannot be created; choose a new directory."); }
  return withTaskLock(root, async () => {
    mkdirSync(join(root, "rounds"), { mode: 0o700 });
    atomicBytes(join(root, "brief.txt"), brief);
    atomicBytes(join(root, "events.jsonl"), "");
    const task: Task = {
      schema_version: 1, id: randomUUID().replaceAll("-", ""), created_at: now(), updated_at: now(),
      status: "drawing", brief: "brief.txt", model: options.model, max_rounds: options.maxRounds,
      timeout_seconds: options.timeout, current_round: 1, rounds: [], usage: emptyUsage(),
      ...(prepared ? { inputs: storeInputs(root, prepared) } : {}),
    };
    const current = initializeRound(root, task, null, null);
    await executeRound(root, task, current, null);
    return task;
  });
}

export async function revise(taskDirectory: string, feedbackFile: string): Promise<Task> {
  const feedback = textInput(feedbackFile);
  const root = resolve(taskDirectory);
  return withTaskLock(root, async () => {
    const task = loadTask(root);
    if (task.status !== "awaiting_review" && task.status !== "failed") throw new CommandError("Only a finished, unaccepted round can be revised.");
    if (task.current_round >= task.max_rounds) throw new CommandError("Maximum rounds reached; create a new task to continue.");
    loadInputs(root, task.inputs);
    const previous = task.rounds.at(-1);
    if (!previous) throw new CommandError("Invalid task round.");
    for (const name of ["source", "asset"] as const) {
      const path = safePath(root, `${roundRelative(previous.number)}/${ARTIFACT_NAMES[name]}`);
      if (pathExists(path)) readRegular(path);
    }
    task.current_round++;
    const current = initializeRound(root, task, previous, feedback);
    await executeRound(root, task, current, feedback);
    return task;
  });
}

export async function accept(taskDirectory: string, reviewFile: string, comparisonDirectory?: string): Promise<Task> {
  const review = textInput(reviewFile);
  const root = resolve(taskDirectory);
  return withTaskLock(root, async () => {
    const task = loadTask(root);
    if (task.status !== "awaiting_review") throw new CommandError("Only an awaiting_review task can be accepted.");
    const index = task.current_round;
    const current = task.rounds.at(-1);
    if (!current) throw new CommandError("Invalid task round.");
    const relative = roundRelative(index);
    const raw = readRegular(safePath(root, `${relative}/receipt.json`));
    if (digest(raw) !== current.receipt_sha256) throw new CommandError("Receipt integrity check failed; acceptance refused.");
    let value: unknown;
    try { value = JSON.parse(raw.toString("utf8")); }
    catch { throw new CommandError("Invalid receipt; acceptance refused."); }
    if (!isRecord(value) || value.status !== "awaiting_review" || value.round !== index || !isRecord(value.artifacts)) {
      throw new CommandError("Receipt is not a reviewable candidate.");
    }
    const inputs = loadInputs(root, task.inputs);
    if (task.inputs && (!isRecord(value.inputs) || value.inputs.sha256 !== task.inputs.sha256
        || value.inputs.path !== task.inputs.path || value.inputs.bytes !== task.inputs.bytes)) {
      throw new CommandError("Candidate input integrity check failed; acceptance refused.");
    }
    const artifacts: Artifacts = {} as Artifacts;
    for (const [name, filename] of artifactEntries(!!inputs?.display)) {
      const expected = value.artifacts[name];
      const actual = artifactRecord(root, `${relative}/${filename}`);
      if (!isRecord(expected) || expected.path !== actual.path || expected.sha256 !== actual.sha256 || expected.bytes !== actual.bytes) {
        throw new CommandError("Artifact integrity check failed; acceptance refused.");
      }
      artifacts[name] = actual;
    }
    let comparison: CompletedReceipt["comparison"];
    if (comparisonDirectory) {
      const comparisonRoot = resolve(comparisonDirectory);
      ensureDirectory(comparisonRoot);
      const reportBytes = readRegular(join(comparisonRoot, "sheet.json"));
      const imageBytes = readRegular(join(comparisonRoot, "sheet.png"));
      let report: SheetReport;
      try { report = JSON.parse(reportBytes.toString("utf8")); }
      catch { throw new CommandError("Invalid comparison sheet report."); }
      if (report.schema_version !== 1 || report.png_sha256 !== digest(imageBytes) || !Array.isArray(report.rows)
          || report.rows.length < 2 || !report.rows.some(row => row.source_sha256 === artifacts.preview.sha256)) {
        throw new CommandError("Comparison must contain this exact candidate and a reference, with an intact sheet PNG.");
      }
      if (inputs?.display && !report.rows.some(row => row.source_sha256 === artifacts.preview.sha256
          && row.scale === inputs.display!.scale && row.medium === inputs.display!.medium)) {
        throw new CommandError("Comparison candidate must use the task's locked display scale and medium.");
      }
      atomicBytes(join(root, `${relative}/comparison.png`), imageBytes);
      atomicBytes(join(root, `${relative}/comparison.json`), reportBytes);
      comparison = { image: artifactRecord(root, `${relative}/comparison.png`), report: artifactRecord(root, `${relative}/comparison.json`) };
    }
    const reviewPath = `${relative}/review.txt`;
    atomicBytes(join(root, reviewPath), review);
    task.status = current.status = "completed";
    current.accepted_at = task.completed_at = now();
    current.review = artifactRecord(root, reviewPath);
    const finalReceipt: CompletedReceipt = {
      schema_version: 1, status: "completed", task_id: task.id, round: index, accepted_at: task.completed_at,
      artifacts, review: current.review, usage: task.usage,
      candidate_receipt: artifactRecord(root, `${relative}/receipt.json`),
      ...(task.inputs ? { inputs: task.inputs } : {}), ...(comparison ? { comparison } : {}),
    };
    atomicJson(join(root, "receipt.json"), finalReceipt);
    task.final_receipt = artifactRecord(root, "receipt.json");
    persist(root, task);
    emit(root, "accepted", { round: index });
    return task;
  });
}
