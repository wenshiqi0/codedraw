import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  addUsage, CommandError, emptyUsage, Failure, isRecord, now,
  type Artifact, type EventMetadata, type Task, type TaskEvent,
} from "./types.ts";

export function ensureDirectory(path: string): void {
  try {
    if (!lstatSync(path).isDirectory()) throw new Error();
  } catch {
    throw new CommandError("Required path must be a real directory, not a symbolic link.");
  }
}

export function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw new Failure("unsafe_or_unreadable_file");
  }
}

export function safePath(root: string, relative: string): string {
  if (isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Failure("unsafe_artifact_path");
  }
  ensureDirectory(root);
  const parts = relative.split(sep);
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    ensureDirectory(current);
  }
  return join(root, relative);
}

export function readRegular(path: string, nonempty = true): Buffer {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw new Failure(isRecord(error) && error.code === "ENOENT" ? "missing_file" : "unsafe_or_unreadable_file");
  }
  let data: Buffer;
  try {
    if (!fstatSync(descriptor).isFile()) throw new Failure("unsafe_or_unreadable_file");
    data = readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (nonempty && data.length === 0) throw new Failure("empty_file");
  return data;
}

export function atomicBytes(path: string, content: string | Uint8Array): void {
  ensureDirectory(dirname(path));
  if (pathExists(path) && lstatSync(path).isSymbolicLink()) throw new Failure("unsafe_or_unreadable_file");
  const temporary = join(dirname(path), `.codedraw-${randomUUID()}`);
  try {
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function atomicJson(path: string, value: unknown): void {
  atomicBytes(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function artifactRecord(root: string, relative: string): Artifact {
  const data = readRegular(safePath(root, relative));
  return { path: relative, sha256: digest(data), bytes: data.length };
}

export function eventRows(root: string): TaskEvent[] {
  const raw = readRegular(join(root, "events.jsonl"), false).toString("utf8");
  // An observer may read while the owner appends; only expose complete records.
  const complete = raw.slice(0, raw.lastIndexOf("\n") + 1);
  let rows: unknown[];
  try {
    rows = complete.split("\n").filter((line) => line.trim()).map((line): unknown => JSON.parse(line));
  } catch {
    throw new CommandError("Invalid task event log.");
  }
  if (rows.some((row, index) => !isRecord(row) || row.seq !== index + 1)) {
    throw new CommandError("Invalid task event sequence.");
  }
  return rows as TaskEvent[];
}

export function emit(root: string, type: TaskEvent["type"], metadata: EventMetadata = {}): void {
  const event: TaskEvent = { seq: eventRows(root).length + 1, at: now(), type, ...metadata };
  const descriptor = openSync(join(root, "events.jsonl"), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Failure("unsafe_or_unreadable_file");
    writeFileSync(descriptor, `${JSON.stringify(event)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function loadTask(root: string): Task {
  ensureDirectory(root);
  let value: unknown;
  try {
    value = JSON.parse(readRegular(join(root, "task.json")).toString("utf8"));
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new CommandError("Invalid task state.");
  }
  if (!isRecord(value) || value.schema_version !== 1 || !Number.isInteger(value.current_round)
      || typeof value.current_round !== "number" || value.current_round < 1 || !Array.isArray(value.rounds)
      || value.rounds.length !== value.current_round || !isRecord(value.usage)) {
    throw new CommandError("Unsupported or invalid task state.");
  }
  return value as unknown as Task;
}

export function persist(root: string, task: Task): void {
  task.updated_at = now();
  task.usage = task.rounds.reduce((total, round) => addUsage(total, round.usage), emptyUsage());
  atomicJson(join(root, "task.json"), task);
}

export function textInput(path: string): string {
  const data = readRegular(resolve(path));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new CommandError("Input must be UTF-8 text.");
  }
  if (!text.trim()) throw new CommandError("Input text must not be blank.");
  return text;
}

export async function withTaskLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  ensureDirectory(root);
  const directory = join(root, ".exclusive");
  const ownerPath = join(directory, "owner.json");
  const token = randomUUID();
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw new CommandError("Cannot acquire task lock.");
    let owner: unknown;
    try {
      ensureDirectory(directory);
      owner = JSON.parse(readRegular(ownerPath).toString("utf8"));
    } catch {
      throw new CommandError("Task is active or its lock owner is unknown; concurrent modification is refused.");
    }
    if (isRecord(owner) && typeof owner.pid === "number" && Number.isInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
      } catch (signalError) {
        if (isRecord(signalError) && signalError.code === "ESRCH") {
          throw new CommandError("Stale task lock: its owner has exited. Verify no worker is active before removing .exclusive.");
        }
      }
    }
    throw new CommandError("Task is active; concurrent modification is refused.");
  }
  try {
    atomicJson(ownerPath, { pid: process.pid, token });
    return await action();
  } finally {
    // Never remove a lock that another process has replaced.
    try {
      const owner: unknown = JSON.parse(readRegular(ownerPath).toString("utf8"));
      if (isRecord(owner) && owner.token === token) {
        unlinkSync(ownerPath);
        rmdirSync(directory);
      }
    } catch {
      // An uncertain lock remains visible for explicit recovery.
    }
  }
}
