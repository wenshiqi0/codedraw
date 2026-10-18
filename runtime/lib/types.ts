export type TaskStatus = "drawing" | "awaiting_review" | "failed" | "completed";

export interface Usage {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number | null;
  total: number;
}

export interface Artifact {
  path: string;
  sha256: string;
  bytes: number;
}

export type ArtifactName = "source" | "asset" | "preview" | "render" | "display" | "display_report";
export type Artifacts = Record<"source" | "asset" | "preview" | "render", Artifact>
  & Partial<Record<"display" | "display_report", Artifact>>;

export interface FailureRecord {
  code: string;
  phase: string;
  exit_code?: number;
}

export interface Round {
  number: number;
  directory: string;
  status: TaskStatus;
  started_at: string;
  finished_at?: string;
  usage: Usage;
  receipt: string;
  receipt_sha256?: string;
  failure?: FailureRecord;
  accepted_at?: string;
  review?: Artifact;
}

export interface Task {
  schema_version: 1;
  id: string;
  created_at: string;
  updated_at: string;
  status: TaskStatus;
  brief: string;
  model: string | null;
  max_rounds: number;
  timeout_seconds: number;
  current_round: number;
  rounds: Round[];
  usage: Usage;
  completed_at?: string;
  final_receipt?: Artifact;
  inputs?: Artifact;
}

export interface CandidateReceipt {
  schema_version: 1;
  round: number;
  status: Exclude<TaskStatus, "completed">;
  usage: Usage;
  artifacts?: Artifacts;
  inputs?: Artifact;
  failure?: FailureRecord;
  finished_at?: string;
}

export interface CompletedReceipt {
  schema_version: 1;
  status: "completed";
  task_id: string;
  round: number;
  accepted_at: string;
  artifacts: Artifacts;
  review: Artifact;
  usage: Usage;
  candidate_receipt: Artifact;
  inputs?: Artifact;
  comparison?: { image: Artifact; report: Artifact };
}

export interface EventMetadata {
  round?: number;
  usage?: Usage;
  failure?: FailureRecord;
  exit_code?: number;
}

export interface TaskEvent extends EventMetadata {
  seq: number;
  at: string;
  type: "round_started" | "model_call" | "pi_exited" | "candidate_ready" | "round_failed" | "accepted";
}

export class Failure extends Error {
  constructor(readonly code: string, readonly phase = "runtime", readonly exitCode?: number) {
    super(code);
    this.name = "Failure";
  }

  record(): FailureRecord {
    return { code: this.code, phase: this.phase, ...(this.exitCode === undefined ? {} : { exit_code: this.exitCode }) };
  }
}

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function now(): string {
  return new Date().toISOString();
}

export function emptyUsage(): Usage {
  return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, total: 0 };
}

export function addUsage(left: Usage, right: Usage): Usage {
  const reasoning = !left.calls ? right.reasoning : !right.calls ? left.reasoning
    : left.reasoning === null || right.reasoning === null ? null : left.reasoning + right.reasoning;
  return {
    calls: left.calls + right.calls,
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning,
    total: left.total + right.total,
  };
}
