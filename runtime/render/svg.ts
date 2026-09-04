import { constants, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';


export interface RenderReport {
  status: 'technical_pass';
  visualAcceptance: 'not_assessed';
  width: number;
  height: number;
  visiblePixels: number;
  transparentPixels: number;
  sourceSha256: string;
  pngSha256: string;
}

interface SourceData {
  source: string;
  bytes: Buffer;
  stat: Stats;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_777_216;
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line',
  'polyline', 'polygon', 'linearGradient', 'radialGradient', 'stop',
  'clipPath', 'mask', 'pattern', 'use', 'symbol', 'title', 'desc',
]);

function fail(message: string): never {
  throw new Error(message);
}

function checkDimensions(width: number | undefined, height: number | undefined): void {
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail('SVG width and height must be positive finite numbers');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    fail('SVG canvas exceeds the 4096px or 16777216-pixel limit');
  }
}

function dimension(value: string | undefined, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(value.trim())) {
    fail('SVG dimensions must be numeric pixels; percentage and physical units are unsupported');
  }
  return Number(value.trim().replace(/px$/i, ''));
}

function validateSvg(source: string): void {
  if (!source.trim()) fail('SVG source is empty');
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(source) || /&(?:#|[A-Za-z])/.test(source)) {
    fail('SVG declarations and entity references are unsupported');
  }
  const markup = source.replace(/<!--[\s\S]*?-->/g, '');
  if (/<\?(?!xml(?:\s|\?>))/i.test(markup) || /<!/.test(markup)) {
    fail('SVG processing instructions and embedded declarations are unsupported');
  }
  const root = markup.match(/^\uFEFF?\s*(?:<\?xml\s+[\s\S]*?\?>\s*)?<svg\b((?:"[^"]*"|'[^']*'|[^'">])*)>/);
  if (!root) fail('Invalid SVG: expected an unprefixed svg root element');

  for (const match of markup.matchAll(/<\/?\s*([A-Za-z_][\w:.-]*)/g)) {
    if (!ALLOWED_ELEMENTS.has(match[1]!)) {
      fail(`Unsupported SVG element: ${match[1]}; convert text to paths`);
    }
  }
  if (/\bon[a-z]+\s*=/i.test(markup) || /@import\b/i.test(markup)) {
    fail('SVG scripts, event handlers, and CSS imports are unsupported');
  }
  for (const match of markup.matchAll(/\b(?:[\w.-]+:)?href\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    if (!/^#[A-Za-z_][\w:.-]*$/.test(match[2]!.trim())) {
      fail('SVG references must be local fragment identifiers');
    }
  }
  for (const match of markup.matchAll(/\burl\s*\(([^)]*)\)/gi)) {
    const reference = match[1]!.trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!/^#[A-Za-z_][\w:.-]*$/.test(reference)) {
      fail('SVG URL references must be local fragment identifiers');
    }
  }
  // CSS escapes can obscure resource references; this intentionally supports a
  // small, self-contained SVG subset rather than a browser's full CSS grammar.
  if (/\\/.test(markup)) fail('SVG CSS escape sequences are unsupported');

  const attributes = new Map<string, string>();
  for (const match of root[1]!.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(match[1]!, (match[2] ?? match[3])!);
  }
  let viewBox: number[] | undefined;
  if (attributes.has('viewBox')) {
    viewBox = attributes.get('viewBox')!.trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2]! <= 0 || viewBox[3]! <= 0) {
      fail('SVG viewBox must have four finite numbers and positive dimensions');
    }
  }
  checkDimensions(
    dimension(attributes.get('width'), viewBox?.[2]),
    dimension(attributes.get('height'), viewBox?.[3]),
  );
}

async function readSource(inputPath: string): Promise<SourceData> {
  const before = await fs.lstat(inputPath);
  if (before.isSymbolicLink() || !before.isFile()) fail('SVG source must be a regular, non-symlink file');
  const handle = await fs.open(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail('SVG source must be a regular file');
    if (stat.size === 0) fail('SVG source is empty');
    if (stat.size > MAX_SOURCE_BYTES) fail('SVG source exceeds the 2 MiB limit');
    const buffer = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_SOURCE_BYTES) fail('SVG source exceeds the 2 MiB limit');
    const bytes = buffer.subarray(0, length);
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('SVG source must be valid UTF-8');
    }
    return { source, bytes, stat };
  } finally {
    await handle.close();
  }
}

async function validateOutputs(inputPath: string, outputPaths: readonly string[], inputStat: Stats): Promise<void> {
  const sourcePath = await fs.realpath(inputPath);
  const seen = new Set([sourcePath]);
  for (const output of outputPaths) {
    const parent = await fs.realpath(path.dirname(output));
    const canonical = path.join(parent, path.basename(output));
    if (seen.has(canonical)) fail('Input, PNG, and report paths must be distinct');
    seen.add(canonical);
    let stat: Stats | undefined;
    try {
      stat = await fs.lstat(output);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) fail('Output paths must be regular files, not symlinks');
    if (stat && stat.dev === inputStat.dev && stat.ino === inputStat.ino) {
      fail('Output paths must not overwrite the SVG source');
    }
  }
}

async function writeOutputs(pngPath: string, png: Buffer, reportPath: string, report: RenderReport): Promise<void> {
  const entries = [
    { target: pngPath, data: png },
    { target: reportPath, data: `${JSON.stringify(report, null, 2)}\n` },
  ].map((entry) => ({
    ...entry,
    temporary: path.join(path.dirname(entry.target), `.${path.basename(entry.target)}.${randomUUID()}.tmp`),
    backup: path.join(path.dirname(entry.target), `.${path.basename(entry.target)}.${randomUUID()}.bak`),
    backedUp: false,
    committed: false,
  }));
  try {
    for (const entry of entries) await fs.writeFile(entry.temporary, entry.data, { flag: 'wx' });
    for (const entry of entries) {
      try {
        await fs.rename(entry.target, entry.backup);
        entry.backedUp = true;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await fs.rename(entry.temporary, entry.target);
      entry.committed = true;
    }
  } catch (error) {
    for (const entry of entries.toReversed()) {
      if (entry.committed) await fs.rm(entry.target, { force: true });
      if (entry.backedUp) await fs.rename(entry.backup, entry.target);
    }
    throw error;
  } finally {
    for (const entry of entries) {
      await fs.rm(entry.temporary, { force: true });
      // Keep a backup if rollback itself failed instead of deleting user data.
      if (entries.every((item) => item.committed)) await fs.rm(entry.backup, { force: true });
    }
  }
}

/** Render an SVG and emit technical evidence; visual acceptance belongs to the outer loop. */
export async function renderSvg(inputPath: string, pngPath: string, reportPath: string): Promise<RenderReport> {
  if (![inputPath, pngPath, reportPath].every((value) => typeof value === 'string' && value.length > 0)) {
    fail('Expected SVG source, PNG output, and JSON report paths');
  }
  const input = path.resolve(inputPath);
  const output = path.resolve(pngPath);
  const reportOutput = path.resolve(reportPath);
  const { source, bytes, stat } = await readSource(input);
  await validateOutputs(input, [output, reportOutput], stat);
  validateSvg(source);
  let renderer: Resvg;
  try {
    renderer = new Resvg(source, { font: { loadSystemFonts: false }, logLevel: 'off' });
  } catch {
    fail('Invalid SVG: renderer could not parse the source');
  }
  checkDimensions(renderer.width, renderer.height);
  const rendered = renderer.render();
  const { width, height, pixels } = rendered;
  checkDimensions(width, height);
  let visiblePixels = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index]! > 0) visiblePixels += 1;
  }
  if (visiblePixels === 0) fail('SVG renders an empty canvas with no non-transparent pixels');
  const png = rendered.asPng();
  const report: RenderReport = {
    status: 'technical_pass',
    visualAcceptance: 'not_assessed',
    width,
    height,
    visiblePixels,
    transparentPixels: width * height - visiblePixels,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    pngSha256: createHash('sha256').update(png).digest('hex'),
  };
  await writeOutputs(output, png, reportOutput, report);
  return report;
}
