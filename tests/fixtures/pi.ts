#!/usr/bin/env bun
/** Protocol fixture: fake model events, real drawing source executed by Bun. */
import { existsSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE ?? 'success';
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
check(args.includes('-p') && args.includes('json'), 'Pi print JSON flags missing');
check(args.includes('--no-session') && args.includes('--no-context-files'), 'Pi isolation flags missing');
check(args[args.indexOf('--tools') + 1] === 'read,write,edit,bash', 'Unexpected tool allowlist');
if (process.env.EXPECT_MODEL) {
  check(args[args.indexOf('--model') + 1] === process.env.EXPECT_MODEL, 'Explicit model not forwarded');
} else {
  check(!args.includes('--model'), 'Unexpected model override');
}
check(existsSync(args[args.indexOf('--append-system-prompt') + 1]!), 'System prompt file missing');
if (process.env.EXPECT_STYLE_ID) {
  check(args.at(-1)?.includes(process.env.EXPECT_STYLE_ID), 'Style snapshot not injected');
  check(args.at(-1)?.includes('Frozen paper #c8bfa8'), 'Style bible not injected');
}
if (process.env.EXPECT_REFERENCE_SHA) {
  const references = args.filter(arg => arg.startsWith('@'));
  check(references.length === 1, 'Expected exactly one image attachment');
  check(createHash('sha256').update(readFileSync(references[0]!.slice(1))).digest('hex') === process.env.EXPECT_REFERENCE_SHA,
    'Reference bytes did not reach Pi');
}
const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
if (args.some(arg => arg.startsWith('@'))) emit({ type: 'codedraw_reference_check', ready: true });
if (mode === 'timeout') {
  emit({ type: 'agent_start' });
  if (process.env.FAKE_STARTED_MARKER) {
    const markerPath = process.env.FAKE_STARTED_MARKER;
    writeFileSync(`${markerPath}.tmp`, JSON.stringify({ pid: process.pid, cwd: process.cwd(), phase: 'pi' }));
    renameSync(`${markerPath}.tmp`, markerPath);
  }
  await Bun.sleep(10_000);
}
if (mode === 'nonzero') {
  process.stderr.write('SENSITIVE_STDERR_SENTINEL\n');
  process.exit(7);
}
if (mode === 'error') emit({ type: 'error', error: 'SENSITIVE_ERROR_SENTINEL' });
if (mode === 'revision') {
  check(readFileSync('draw.ts', 'utf8').includes('// original source'), 'Previous source not copied');
  check(args.at(-1)?.includes('Please use blue'), 'Feedback not passed to Pi');
  check(existsSync('asset.svg'), 'Previous SVG not copied');
}
const marker = mode === 'revision' ? '// revised source' : '// original source';
const color = mode === 'revision' ? '#2468ff' : '#e53935';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="12" y="12" width="40" height="40" fill="${color}"/></svg>`;
let source = `${marker}\nif (typeof Bun === 'undefined' || !Bun.version) throw new Error('Drawing runtime must be Bun');\nimport { writeFileSync } from 'node:fs';\nconst svg: string = ${JSON.stringify(svg)};\nwriteFileSync('asset.svg', svg);\n`;
if (mode === 'source_nonzero') source = 'process.exit(8);\n';
if (mode === 'missing_svg') source = '// Intentionally produces no SVG.\n';
if (mode === 'empty_svg') source = "import { writeFileSync } from 'node:fs'; writeFileSync('asset.svg', '');\n";
if (mode === 'render_nonzero') source = "import { writeFileSync } from 'node:fs'; writeFileSync('asset.svg', '<svg broken');\n";
if (mode === 'symlink_svg') source = `import { symlinkSync } from 'node:fs'; symlinkSync(${JSON.stringify(process.env.FAKE_OUTSIDE)}, 'asset.svg');\n`;
if (mode !== 'missing') {
  if (mode === 'symlink') symlinkSync(process.env.FAKE_OUTSIDE!, 'draw.ts');
  else writeFileSync('draw.ts', mode === 'empty' ? '' : source);
}
emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'SENSITIVE_THINKING_SENTINEL' } });
emit({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'SENSITIVE_TOOL_ARGS_SENTINEL' } });
const message = {
  role: 'assistant',
  content: [{ type: 'thinking', thinking: 'SENSITIVE_TRANSCRIPT_SENTINEL' }],
  usage: {
    input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 123,
    ...(mode === 'reasoning' ? { reasoning: 7 } : {}),
    cost: { total: 999 },
  },
  stopReason: mode === 'model_error' ? 'error' : 'stop',
};
emit({ type: 'message_start', message });
emit({ type: 'message_end', message: { role: 'toolResult', usage: { totalTokens: 777 } } });
emit({ type: 'message_end', message });
emit({ type: 'turn_end', message });
emit({ type: 'agent_end', messages: [message] });
emit({ type: 'agent_settled' });
