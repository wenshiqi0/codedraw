import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROJECT = resolve(import.meta.dir, '..');
const enabled = process.env.CODEDRAW_TEST_PI === '1';

/** Actual bundled Pi and Bun execute against a local SSE stub. No remote model call. */
(enabled ? test : test.skip)('real Pi → Bun drawing → rendering → candidate → explicit acceptance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codedraw-pi-smoke-'));
  const agentDir = join(root, 'agent');
  const taskDir = join(root, 'task');
  mkdirSync(agentDir);
  const source = `if (typeof Bun === 'undefined' || !Bun.version) throw new Error('Drawing runtime must be Bun');\nimport { writeFileSync } from 'node:fs';\nconst color: string = '#e53935';\nwriteFileSync('asset.svg', \`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="12" y="12" width="40" height="40" fill="\${color}"/></svg>\`);\n`;
  const provider = 'codedraw-loopback-test';
  const model = 'deterministic-drawing-stub';
  const requests: Array<{ model: string; stream: boolean; roles: string[]; tools: string[] }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== '/v1/chat/completions' || request.method !== 'POST') {
        return new Response('Unexpected local endpoint', { status: 404 });
      }
      const input = await request.json() as {
        model: string; stream: boolean;
        messages: Array<{ role: string }>;
        tools: Array<{ function: { name: string } }>;
      };
      requests.push({ model: input.model, stream: input.stream,
        roles: input.messages.map(message => message.role),
        tools: input.tools.map(tool => tool.function.name) });
      const number = requests.length;
      if (number > 2) return new Response('Stub permits exactly two requests', { status: 500 });
      const base = { id: `chatcmpl-codedraw-${number}`, object: 'chat.completion.chunk', created: 1700000000, model };
      const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => ({
        ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
      });
      const events = number === 1 ? [
        chunk({ role: 'assistant', content: null }),
        chunk({ tool_calls: [{ index: 0, id: 'call_drawing_1', type: 'function',
          function: { name: 'write', arguments: JSON.stringify({ path: 'draw.ts', content: source }) } }] }),
        chunk({}, 'tool_calls', { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200,
          prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 7 } }),
      ] : [
        chunk({ role: 'assistant', content: 'Local deterministic stub wrote draw.ts. Outer rendering and acceptance remain required.' }),
        chunk({}, 'stop', { prompt_tokens: 150, completion_tokens: 30, total_tokens: 180,
          prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 3 } }),
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  });
  const env: Record<string, string> = {};
  for (const name of ['PATH', 'LANG', 'TMPDIR']) if (process.env[name]) env[name] = process.env[name]!;
  Object.assign(env, {
    PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_TELEMETRY: '0',
    PI_BIN: join(PROJECT, 'runtime/bin/pi'),
  });
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({ providers: { [provider]: {
    baseUrl: `http://127.0.0.1:${server.port}/v1`, api: 'openai-completions', apiKey: 'local-stub-no-secret',
    models: [{ id: model, name: 'Deterministic local test stub', reasoning: false, input: ['text'],
      contextWindow: 128000, maxTokens: 8192,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  } } }, null, 2));
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ retry: { enabled: false }, quietStartup: true }));
  const brief = join(root, 'brief.txt');
  const review = join(root, 'review.txt');
  writeFileSync(brief, 'Create a red square with a transparent margin on a 64 by 64 canvas using draw.ts.');
  writeFileSync(review, 'Deterministic integration fixture acceptance after PNG and render metadata checks; this is a protocol test, not model aesthetic evaluation.');
  async function run(args: string[]) {
    const proc = Bun.spawn([process.execPath, join(PROJECT, 'runtime/cli/run.ts'), ...args], {
      cwd: PROJECT, env, stdout: 'pipe', stderr: 'pipe',
    });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 30_000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
      ]);
      expect({ code, diagnostics: code === 0 ? '' : stdout + stderr }).toEqual({ code: 0, diagnostics: '' });
      return JSON.parse(stdout);
    } finally { clearTimeout(timer); }
  }
  try {
    const candidate = await run(['exec', brief, '--output', taskDir, '--model', `${provider}/${model}`, '--timeout', '10']);
    expect(candidate.status).toBe('awaiting_review');
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.model === model && request.stream)).toBe(true);
    expect(requests[0]!.tools).toEqual(['read', 'write', 'edit', 'bash']);
    expect(requests[1]!.roles).toContain('tool');
    expect(readFileSync(join(taskDir, 'rounds/001/work/draw.ts'), 'utf8')).toBe(source);
    expect(candidate.usage).toEqual({ calls: 2, input: 210, output: 110,
      cacheRead: 60, cacheWrite: 0, reasoning: 10, total: 380 });
    const report = JSON.parse(readFileSync(join(taskDir, 'rounds/001/render.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'technical_pass', visualAcceptance: 'not_assessed', width: 64, height: 64 });
    expect(report.visiblePixels).toBeGreaterThan(0);
    expect(report.transparentPixels).toBeGreaterThan(0);
    expect(readFileSync(join(taskDir, 'rounds/001/preview.png')).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(existsSync(join(taskDir, 'receipt.json'))).toBe(false);
    const completed = await run(['accept', taskDir, '--review', review]);
    expect(completed.status).toBe('completed');
    expect(JSON.parse(readFileSync(join(taskDir, 'receipt.json'), 'utf8')).status).toBe('completed');
    expect(requests).toHaveLength(2);
  } finally {
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
