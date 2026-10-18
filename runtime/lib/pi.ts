import { resolve } from "node:path";
import { Failure, isRecord, type Usage } from "./types.ts";

const MAX_EVENT_CHARS = 2 * 1024 * 1024;

function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function usageForMessage(message: Record<string, unknown>): Usage {
  const raw = isRecord(message.usage) ? message.usage : {};
  const input = nonnegative(raw.input) ?? 0;
  const output = nonnegative(raw.output) ?? 0;
  const cacheRead = nonnegative(raw.cacheRead) ?? 0;
  const cacheWrite = nonnegative(raw.cacheWrite) ?? 0;
  return {
    calls: 1, input, output, cacheRead, cacheWrite,
    reasoning: nonnegative(raw.reasoning ?? raw.reasoningTokens),
    // Reasoning is generally already included in output; Pi's total is authoritative.
    total: nonnegative(raw.totalTokens) ?? input + output + cacheRead + cacheWrite,
  };
}

interface ProcessHandle {
  pid: number;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

function stopProcess(child: ProcessHandle): void {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* It has already exited. */ }
  }
}

async function beforeDeadline<T>(child: ProcessHandle, deadline: number, phase: string, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interruptHandler = (): void => {};
  const interrupted = new Promise<never>((_, reject) => {
    interruptHandler = () => {
      stopProcess(child);
      reject(new Failure("interrupted", phase));
    };
    process.on("SIGINT", interruptHandler);
    process.on("SIGTERM", interruptHandler);
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stopProcess(child);
      reject(new Failure("timeout", phase));
    }, Math.max(0, deadline - performance.now()));
  });
  try {
    return await Promise.race([work(), timeout, interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    process.off("SIGINT", interruptHandler);
    process.off("SIGTERM", interruptHandler);
    stopProcess(child);
    await child.exited;
  }
}

export async function runQuiet(command: string[], cwd: string, deadline: number, phase: string): Promise<void> {
  let child;
  try {
    child = Bun.spawn({ cmd: command, cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
  } catch {
    throw new Failure("executable_unavailable", phase);
  }
  await beforeDeadline(child, deadline, phase, async () => {
    const code = await child.exited;
    if (code !== 0) throw new Failure("nonzero_exit", phase, code);
  });
}

export interface PiOptions {
  cwd: string;
  systemPrompt: string;
  prompt: string;
  model: string | null;
  deadline: number;
  references?: string[];
  onUsage(usage: Usage): void;
}

export async function runPi(options: PiOptions): Promise<void> {
  const executable = process.env.PI_BIN || resolve(import.meta.dir, "../bin/pi");
  const command = [
    executable, "-p", "--mode", "json", "--no-session", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files", "--tools", "read,write,edit,bash",
    "--append-system-prompt", options.systemPrompt,
  ];
  if (options.model) command.push("--model", options.model);
  const referenceCount = options.references?.length ?? 0;
  if (referenceCount) command.push("--extension", resolve(import.meta.dir, "pi-reference-guard.ts"));
  for (const reference of options.references ?? []) command.push(`@${reference}`);
  command.push(options.prompt);
  let child;
  try {
    child = Bun.spawn({ cmd: command, cwd: options.cwd, stdin: "ignore", stdout: "pipe", stderr: "ignore", detached: true,
      env: { ...process.env, CODEDRAW_REFERENCE_COUNT: String(referenceCount) } });
  } catch {
    throw new Failure("executable_unavailable", "pi");
  }
  await beforeDeadline(child, options.deadline, "pi", async () => {
    let modelError = false;
    let referenceReady = referenceCount === 0;
    let pending = "";
    let discarding = false;
    const decoder = new TextDecoder();
    const reader = child.stdout.getReader();
    const consume = (line: string): void => {
      let event: unknown;
      try { event = JSON.parse(line); } catch { return; }
      if (!isRecord(event)) return;
      if (event.type === "codedraw_reference_check") referenceReady = event.ready === true;
      if (event.type === "error") modelError = true;
      const message = event.message;
      if (event.type === "message_end" && isRecord(message) && message.role === "assistant") {
        if (message.stopReason === "error" || message.stopReason === "aborted" || message.errorMessage) modelError = true;
        options.onUsage(usageForMessage(message));
      }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const fragments = decoder.decode(value, { stream: true }).split("\n");
        for (let index = 0; index < fragments.length; index++) {
          if (!discarding) {
            pending += fragments[index] ?? "";
            if (pending.length > MAX_EVENT_CHARS) { pending = ""; discarding = true; }
          }
          if (index < fragments.length - 1) {
            if (!discarding) consume(pending);
            pending = "";
            discarding = false;
          }
        }
      }
      pending += decoder.decode();
      if (pending && !discarding) consume(pending);
    } finally {
      reader.releaseLock();
    }
    const code = await child.exited;
    if (!referenceReady) throw new Failure("reference_images_unavailable", "pi", code);
    if (modelError) throw new Failure("model_error", "pi", code);
    if (code !== 0) throw new Failure("nonzero_exit", "pi", code);
  });
}
