#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { accept, begin, revise } from "../lib/task.ts";
import { ensureDirectory, eventRows, loadTask } from "../lib/storage.ts";
import { CommandError, Failure, type Task } from "../lib/types.ts";
import { createSheet } from "../lib/sheet.ts";

const HELP = `CodeDraw: TypeScript drawing with a Bun/Pi worker and outer visual review.

  bun runtime/cli/run.ts exec <brief-file> --output <new-task-dir> [--model provider/id] [--max-rounds 3] [--timeout 300]
    [--style style.json] [--asset-id ID | --display-scale N] [--medium smooth|pixel] [--reference PNG]...
  bun runtime/cli/run.ts sheet <spec.json> --output <new-sheet-dir>
  bun runtime/cli/run.ts status <task-dir>
  bun runtime/cli/run.ts events <task-dir> [--since 0]
  bun runtime/cli/run.ts usage <task-dir>
  bun runtime/cli/run.ts revise <task-dir> --feedback <file>
  bun runtime/cli/run.ts accept <task-dir> --review <file> [--comparison <sheet-dir>]

Events are NDJSON; --since returns events with seq greater than the supplied cursor.
Only accept completes a task after the outer observer has inspected its preview.
`;

function positive(value: string, integer: boolean, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) {
    throw new CommandError(`${label} must be a positive ${integer ? "integer" : "number"}.`);
  }
  return number;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new CommandError(`${label} is required.`);
  return value;
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  try {
    if (args.length === 0 || args.includes("--help") || args[0] === "help") {
      console.log(HELP);
      return 0;
    }
    const [command, ...remaining] = args;
    const { values, positionals } = parseArgs({
      args: remaining, allowPositionals: true, strict: true,
      options: {
        output: { type: "string" }, model: { type: "string" }, "max-rounds": { type: "string" },
        timeout: { type: "string" }, since: { type: "string" }, feedback: { type: "string" }, review: { type: "string" },
        style: { type: "string" }, "asset-id": { type: "string" }, "display-scale": { type: "string" },
        medium: { type: "string" }, reference: { type: "string", multiple: true }, comparison: { type: "string" },
      },
    });
    if (positionals.length !== 1) throw new CommandError("Exactly one input file or task directory is required.");
    const input = required(positionals[0], "Input");
    const productionOptions = [values.style, values["asset-id"], values["display-scale"], values.medium, values.reference];
    if (command !== "exec" && productionOptions.some(value => value !== undefined)) throw new CommandError("Production inputs are fixed at exec; create a new task to change direction.");
    if (command !== "accept" && values.comparison) throw new CommandError("--comparison is only valid with accept.");
    if (values.medium && values.medium !== "smooth" && values.medium !== "pixel") throw new CommandError("--medium must be smooth or pixel.");
    if (command === "sheet") {
      console.log(JSON.stringify(createSheet(input, required(values.output, "--output")), null, 2));
      return 0;
    }
    let task: Task;
    if (command === "exec") {
      task = await begin({
        briefFile: input, output: required(values.output, "--output"), model: values.model ?? null,
        maxRounds: positive(values["max-rounds"] ?? "3", true, "--max-rounds"),
        timeout: positive(values.timeout ?? "300", false, "--timeout"),
        styleFile: values.style, assetId: values["asset-id"], references: values.reference,
        displayScale: values["display-scale"] === undefined ? undefined : positive(values["display-scale"], false, "--display-scale"),
        medium: values.medium as "smooth" | "pixel" | undefined,
      });
    } else if (command === "revise") {
      task = await revise(input, required(values.feedback, "--feedback"));
    } else if (command === "accept") {
      task = await accept(input, required(values.review, "--review"), values.comparison);
    } else if (command === "events") {
      const root = resolve(input);
      ensureDirectory(root);
      const since = Number(values.since ?? "0");
      if (!Number.isInteger(since) || since < 0) throw new CommandError("Event cursor must be a nonnegative integer.");
      for (const event of eventRows(root)) if (event.seq > since) console.log(JSON.stringify(event));
      return 0;
    } else if (command === "status" || command === "usage") {
      task = loadTask(resolve(input));
      if (command === "usage") {
        console.log(JSON.stringify({ task_id: task.id, rounds: task.rounds.map((round) => ({ round: round.number, usage: round.usage })), usage: task.usage }, null, 2));
        return 0;
      }
    } else {
      throw new CommandError("Unknown command. Run with --help for usage.");
    }
    console.log(JSON.stringify(task, null, 2));
    return (command === "exec" || command === "revise") && task.status === "failed" ? 1 : 0;
  } catch (error) {
    const detail = error instanceof Failure ? error.record() : error instanceof CommandError ? error.message : "Invalid task state or runtime input.";
    console.error(JSON.stringify({ error: detail }));
    return 2;
  }
}

if (import.meta.main) process.exitCode = await main();
