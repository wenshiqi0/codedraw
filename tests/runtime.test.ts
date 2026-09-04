import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROJECT = resolve(import.meta.dir, '..');
const CLI = join(PROJECT, 'runtime/cli/run.ts');
const PI = join(import.meta.dir, 'fixtures/pi.ts');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

let root: string;
let task: string;
let brief: string;
let feedback: string;
let review: string;
let extraEnv: Record<string, string>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codedraw-runtime-test-'));
  task = join(root, 'task');
  brief = join(root, 'brief.txt');
  feedback = join(root, 'feedback.txt');
  review = join(root, 'review.txt');
  writeFileSync(brief, 'Draw a simple red square.');
  writeFileSync(feedback, 'Please use blue.');
  writeFileSync(review, 'Protocol fixture acceptance: preview is the expected rendered square.');
  extraEnv = {};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function cli(args: string[], mode = 'success', code = 0) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: PROJECT,
    env: { ...process.env, PI_BIN: PI, FAKE_MODE: mode, ...extraEnv },
    stdout: 'pipe', stderr: 'pipe',
  });
  const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    expect({ exitCode, diagnostics: exitCode === code ? '' : stdout + stderr }).toEqual({ exitCode: code, diagnostics: '' });
    return { stdout, stderr };
  } finally { clearTimeout(timer); }
}
const start = (extra: string[] = [], mode = 'success', code = 0) => cli(['exec', brief, '--output', task, ...extra], mode, code);
const state = () => readJson(join(task, 'task.json'));
const receipt = (round = 1) => readJson(join(task, `rounds/${String(round).padStart(3, '0')}/receipt.json`));
const roundPath = (relative: string, round = 1) => join(task, `rounds/${String(round).padStart(3, '0')}`, relative);

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}

describe('Bun drawing runtime protocol', () => {
  test('rendered candidate requires explicit acceptance and keeps bound receipts immutable', async () => {
    await start();
    expect(state().status).toBe('awaiting_review');
    expect(existsSync(join(task, 'receipt.json'))).toBe(false);
    const candidate = receipt();
    const candidateBytes = readFileSync(roundPath('receipt.json'));
    expect(Object.keys(candidate.artifacts).sort()).toEqual(['asset', 'preview', 'render', 'source']);
    for (const artifact of Object.values(candidate.artifacts) as Array<{path: string; sha256: string}>) {
      expect(hash(readFileSync(join(task, artifact.path)))).toBe(artifact.sha256);
    }
    expect(readFileSync(roundPath('preview.png')).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(readJson(roundPath('render.json')).status).toBe('technical_pass');
    expect(readJson(roundPath('render.json')).visualAcceptance).toBe('not_assessed');
    await cli(['accept', task, '--review', review]);
    expect(state().status).toBe('completed');
    expect(state().rounds[0].review.path).toBe('rounds/001/review.txt');
    const final = readJson(join(task, 'receipt.json'));
    expect(final.status).toBe('completed');
    expect(final.task_id).toBe(state().id);
    expect(final.artifacts).toEqual(candidate.artifacts);
    expect(final.candidate_receipt.sha256).toBe(hash(candidateBytes));
    expect(state().final_receipt.sha256).toBe(hash(readFileSync(join(task, 'receipt.json'))));
    expect(readFileSync(roundPath('receipt.json'))).toEqual(candidateBytes);
    await cli(['accept', task, '--review', review], 'success', 2);
  });

  test('revision copies previous source and SVG, preserves candidates, and enforces the round limit', async () => {
    await start(['--max-rounds', '2']);
    const previous = readFileSync(roundPath('receipt.json'));
    const original = readFileSync(roundPath('work/draw.ts'));
    await cli(['revise', task, '--feedback', feedback], 'revision');
    expect(state().current_round).toBe(2);
    expect(readFileSync(roundPath('receipt.json'))).toEqual(previous);
    expect(readFileSync(roundPath('work/draw.ts'))).toEqual(original);
    expect(readFileSync(roundPath('work/draw.ts', 2), 'utf8')).toContain('// revised source');
    await cli(['revise', task, '--feedback', feedback], 'success', 2);
    expect(state().current_round).toBe(2);
    expect(existsSync(join(task, 'rounds/003'))).toBe(false);
  });

  test('timeout fails the Pi round and prevents acceptance', async () => {
    await start(['--timeout', '0.15'], 'timeout', 1);
    expect(receipt().failure).toEqual({ code: 'timeout', phase: 'pi' });
    expect(state().status).toBe('failed');
    await cli(['accept', task, '--review', review], 'success', 2);
  });

  test('SIGINT interrupts Pi, records failure, releases the task lock, and reaps the child', async () => {
    const startedMarker = join(root, 'pi-started.json');
    const proc = Bun.spawn([process.execPath, CLI, 'exec', brief, '--output', task, '--timeout', '30'], {
      cwd: PROJECT,
      env: { ...process.env, PI_BIN: PI, FAKE_MODE: 'timeout', FAKE_STARTED_MARKER: startedMarker },
      stdout: 'pipe', stderr: 'pipe',
    });
    const completed = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    let childPid: number | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const alive = (pid: number) => {
      try { process.kill(pid, 0); return true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
      }
    };
    async function waitFor(predicate: () => boolean, description: string, timeout = 3000) {
      const deadline = Date.now() + timeout;
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await Bun.sleep(20);
      }
    }
    try {
      await waitFor(() => existsSync(startedMarker), 'Pi fixture startup');
      const marker = readJson(startedMarker);
      childPid = marker.pid;
      expect(Number.isInteger(childPid) && childPid! > 0).toBe(true);
      expect(marker.phase).toBe('pi');
      expect(state().status).toBe('drawing');
      expect(state().rounds[0].status).toBe('drawing');
      expect(alive(childPid!)).toBe(true);
      proc.kill('SIGINT');
      const [, , exitCode] = await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          deadlineTimer = setTimeout(() => reject(new Error('CLI did not exit after SIGINT')), 3000);
        }),
      ]);
      expect(exitCode).not.toBe(0);
      expect(state().status).toBe('failed');
      expect(receipt().failure).toMatchObject({ code: 'interrupted', phase: 'pi' });
      expect(existsSync(join(task, '.exclusive'))).toBe(false);
      await waitFor(() => !alive(childPid!), 'Pi fixture child to exit');
      expect(alive(childPid!)).toBe(false);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (proc.exitCode === null) { proc.kill('SIGKILL'); await proc.exited; }
      if (childPid !== undefined && alive(childPid)) process.kill(childPid, 'SIGKILL');
      await completed;
    }
  }, 10_000);

  test.each([
    ['nonzero', 'nonzero_exit', 'pi'], ['error', 'model_error', 'pi'],
    ['model_error', 'model_error', 'pi'], ['source_nonzero', 'nonzero_exit', 'source'],
    ['render_nonzero', 'nonzero_exit', 'render'],
  ])('%s never becomes reviewable', async (mode, code, phase) => {
    const result = await start([], mode, 1);
    expect(state().status).toBe('failed');
    expect(receipt().failure).toMatchObject({ code, phase });
    expect(result.stdout + result.stderr + walk(task).filter(path => !path.endsWith('.png')).map(path => readFileSync(path, 'utf8')).join('')).not.toContain('SENSITIVE_');
  });

  test.each(['missing', 'empty', 'missing_svg', 'empty_svg', 'symlink', 'symlink_svg'])('%s output is rejected', async mode => {
    const outside = join(root, 'outside.ts');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>';
    const executionMarker = join(root, 'outside-executed.txt');
    writeFileSync(outside, mode === 'symlink'
      ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(executionMarker)}, 'executed'); writeFileSync('asset.svg', ${JSON.stringify(svg)});`
      : svg);
    extraEnv.FAKE_OUTSIDE = outside;
    await start([], mode, 1);
    expect(state().status).toBe('failed');
    expect(receipt()).not.toHaveProperty('artifacts');
    expect(existsSync(executionMarker)).toBe(false);
  });

  test.each(['work/draw.ts', 'work/asset.svg', 'preview.png', 'render.json', 'receipt.json'])('acceptance rechecks %s hash', async relative => {
    await start();
    const path = roundPath(relative);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('changed')]));
    await cli(['accept', task, '--review', review], 'success', 2);
    expect(state().status).toBe('awaiting_review');
    expect(existsSync(join(task, 'receipt.json'))).toBe(false);
  });

  test('acceptance rejects a symlink even when its target has identical bytes', async () => {
    await start();
    const source = roundPath('work/draw.ts');
    const outside = join(root, 'same.ts');
    writeFileSync(outside, readFileSync(source));
    unlinkSync(source);
    symlinkSync(outside, source);
    await cli(['accept', task, '--review', review], 'success', 2);
    expect(state().status).toBe('awaiting_review');
  });

  test('usage counts only assistant message_end and preserves unavailable reasoning and provider total', async () => {
    await start();
    const expected = { calls: 1, input: 10, output: 20, cacheRead: 30, cacheWrite: 40, reasoning: null, total: 123 };
    expect(state().usage).toEqual(expected);
    expect(JSON.parse((await cli(['usage', task])).stdout).usage).toEqual(expected);
    await cli(['revise', task, '--feedback', feedback]);
    expect(state().usage).toEqual({ calls: 2, input: 20, output: 40, cacheRead: 60, cacheWrite: 80, reasoning: null, total: 246 });
  });

  test('reported reasoning is retained without being added to total', async () => {
    await start([], 'reasoning');
    expect(state().usage.reasoning).toBe(7);
    expect(state().usage.total).toBe(123);
  });

  test('events are incremental metadata and do not persist model transcript or tool arguments', async () => {
    const result = await start();
    const rows = (await cli(['events', task])).stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(row => row.seq)).toEqual(rows.map((_, index) => index + 1));
    const remaining = (await cli(['events', task, '--since', '2'])).stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(remaining).toEqual(rows.slice(2));
    const files = walk(task);
    const persisted = files.filter(path => !path.endsWith('.png')).map(path => readFileSync(path, 'utf8')).join('\n');
    expect(persisted + result.stdout + result.stderr).not.toContain('SENSITIVE_');
    expect(files.some(path => path.includes('transcript'))).toBe(false);
  });

  test('existing output is refused without mutation', async () => {
    await start();
    const before = readFileSync(join(task, 'task.json'));
    await start([], 'success', 2);
    expect(readFileSync(join(task, 'task.json'))).toEqual(before);
  });

  test('exclusive lock rejects concurrent mutation while status stays readable', async () => {
    await start();
    const lock = join(task, '.exclusive');
    mkdirSync(lock);
    try {
      await cli(['revise', task, '--feedback', feedback], 'success', 2);
      await cli(['accept', task, '--review', review], 'success', 2);
      expect(JSON.parse((await cli(['status', task])).stdout).status).toBe('awaiting_review');
      expect(existsSync(lock)).toBe(true);
    } finally { rmSync(lock, { recursive: true, force: true }); }
  });

  test('explicit provider/model is forwarded unchanged', async () => {
    extraEnv.EXPECT_MODEL = 'provider/model';
    await start(['--model', 'provider/model']);
    expect(state().model).toBe('provider/model');
  });

  test('failed rounds may be revised without overwriting failure evidence', async () => {
    await start([], 'missing', 1);
    await cli(['revise', task, '--feedback', feedback]);
    expect(state().status).toBe('awaiting_review');
    expect(receipt().status).toBe('failed');
    expect(receipt(2).status).toBe('awaiting_review');
  });
});
