import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderSvg } from '../runtime/render/svg.ts';

const script = fileURLToPath(new URL('../runtime/cli/render.ts', import.meta.url));
const svg = (body: string, attributes = 'width="16" height="16"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;

const temporaryDirectories = new Set<string>();
afterEach(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

async function fixture(source: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codedraw-render-'));
  temporaryDirectories.add(directory);
  const input = path.join(directory, 'asset.svg');
  const png = path.join(directory, 'preview.png');
  const report = path.join(directory, 'render.json');
  await fs.writeFile(input, source);
  return { directory, input, png, report };
}

async function rejectsWithoutArtifacts(source: string, pattern: RegExp): Promise<void> {
  const files = await fixture(source);
  await assert.rejects(renderSvg(files.input, files.png, files.report), pattern);
  await assert.rejects(fs.access(files.png), { code: 'ENOENT' });
  await assert.rejects(fs.access(files.report), { code: 'ENOENT' });
}

test('renders a real PNG with hashes and technical-only evidence', async () => {
  const source = svg('<rect width="16" height="16" fill="#12aaff"/>');
  const files = await fixture(source);
  const result = await renderSvg(files.input, files.png, files.report);
  const png = await fs.readFile(files.png);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 16);
  assert.equal(result.width, 16);
  assert.equal(result.height, 16);
  assert.equal(result.visiblePixels, 256);
  assert.equal(result.transparentPixels, 0);
  assert.equal(result.visualAcceptance, 'not_assessed');
  assert.equal(result.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(result.pngSha256, createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(JSON.parse(await fs.readFile(files.report, 'utf8')), result);
});

test('retains the transparent background', async () => {
  const files = await fixture(svg('<rect x="4" y="4" width="8" height="8" fill="red"/>'));
  const result = await renderSvg(files.input, files.png, files.report);
  assert.equal(result.visiblePixels, 64);
  assert.equal(result.transparentPixels, 192);
});

test('supports paths and local gradient references with a viewBox', async () => {
  const files = await fixture(svg(
    '<defs><linearGradient id="ink"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs>' +
    '<path d="M0 0H16V16H0Z" fill="url(#ink)"/>',
    'viewBox="0 0 16 16"',
  ));
  const result = await renderSvg(files.input, files.png, files.report);
  assert.equal(result.visiblePixels, 256);
});

test('rejects blank source and empty or fully transparent canvases', async () => {
  for (const source of ['', '   ', svg(''), svg('<rect width="16" height="16" opacity="0"/>')]) {
    await rejectsWithoutArtifacts(source, /empty canvas|source is empty/);
  }
});

test('rejects nonpositive, oversized, and ambiguous canvas dimensions', async () => {
  for (const attributes of [
    'width="0" height="16"', 'width="-1" height="16"',
    'width="4097" height="16"', 'width="16" height="4097"',
    'width="100000" height="100000"', 'width="100%" height="16"',
    'viewBox="0 0 5000 5000"', '',
  ]) {
    await rejectsWithoutArtifacts(svg('<rect width="16" height="16"/>', attributes), /dimension|width|canvas/);
  }
});

test('rejects malformed SVG', async () => {
  for (const source of [
    'not an SVG', '<svg width="16" height="16"><rect></svg>',
    '<svg width="16" height="16"><path d="M0 0"/></g>',
  ]) {
    await rejectsWithoutArtifacts(source, /Invalid SVG/);
  }
});

test('rejects external resources, scripts, browser content, entities, and text', async () => {
  for (const source of [
    svg('<image href="https://example.com/image.png"/>'),
    svg('<use href="https://example.com/asset.svg#shape"/>'),
    svg('<use href="file:///etc/passwd"/>'),
    svg('<use href="data:image/svg+xml;base64,PHN2Zz4="/>'),
    svg('<path d="M0 0H16V16Z" fill="url(https://example.com/paint.svg#ink)"/>'),
    svg('<style>@import "https://example.com/style.css";</style>'),
    svg('<script>alert(1)</script>'),
    svg('<rect width="16" height="16" onclick="alert(1)"/>'),
    svg('<foreignObject width="16" height="16"/>'),
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + svg(''),
    svg('<use href="&#104;ttps://example.com/asset.svg#shape"/>'),
    svg('<text x="0" y="12">Hello</text>'),
  ]) {
    await rejectsWithoutArtifacts(source, /Unsupported|unsupported|references/);
  }
});

test('rejects a source over 2 MiB', async () => {
  await rejectsWithoutArtifacts(svg(`<!--${'x'.repeat(2 * 1024 * 1024)}-->`), /2 MiB/);
});

test('rejects a symlink source and output aliases of the input', async () => {
  const source = svg('<rect width="16" height="16"/>');
  const files = await fixture(source);
  const alias = path.join(files.directory, 'alias.svg');
  await fs.symlink(files.input, alias);
  await assert.rejects(renderSvg(alias, files.png, files.report), /non-symlink/);
  await assert.rejects(renderSvg(files.input, files.input, files.report), /distinct/);
  await assert.rejects(renderSvg(files.input, files.png, files.input), /distinct/);
  await assert.rejects(renderSvg(files.input, alias, files.report), /symlink/);
  const hardlink = path.join(files.directory, 'hardlink.svg');
  await fs.link(files.input, hardlink);
  await assert.rejects(renderSvg(files.input, hardlink, files.report), /overwrite/);
  assert.equal(await fs.readFile(files.input, 'utf8'), source);
});

test('requires distinct output paths and preserves an earlier valid result after failed validation', async () => {
  const files = await fixture(svg('<rect width="16" height="16"/>'));
  await assert.rejects(renderSvg(files.input, files.png, files.png), /distinct/);
  await renderSvg(files.input, files.png, files.report);
  const before = await fs.readFile(files.png);
  const report = await fs.readFile(files.report);
  await fs.writeFile(files.input, svg(''));
  await assert.rejects(renderSvg(files.input, files.png, files.report), /empty canvas/);
  assert.deepEqual(await fs.readFile(files.png), before);
  assert.deepEqual(await fs.readFile(files.report), report);
});

test('CLI accepts three positional paths and exits nonzero with a short error', async () => {
  const files = await fixture(svg('<circle cx="8" cy="8" r="4"/>'));
  const success = Bun.spawnSync({
    cmd: [process.execPath, script, files.input, files.png, files.report],
    stdout: 'pipe', stderr: 'pipe',
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.stderr.toString(), '');
  assert.equal(JSON.parse(success.stdout.toString()).width, 16);
  const failure = Bun.spawnSync({ cmd: [process.execPath, script], stdout: 'pipe', stderr: 'pipe' });
  assert.equal(failure.exitCode, 1);
  assert.match(failure.stderr.toString(), /^render: Usage:/);
  assert.ok(failure.stderr.length < 300);
});
