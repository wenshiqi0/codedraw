import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkScale, checkSize, decodePng, encodePng, resample, type Medium, type Pixels } from "./images.ts";
import { atomicBytes, atomicJson, digest, readRegular, textInput } from "./storage.ts";
import { CommandError, isRecord } from "./types.ts";

export interface SheetImage { label: string; file: string; scale: number; medium: Medium }
export interface SheetRow extends SheetImage {
  source_sha256: string; source_width: number; source_height: number;
  display_width: number; display_height: number;
  checker: [number, number]; dark: [number, number];
}
export interface SheetReport {
  schema_version: 1; visualAcceptance: "not_assessed";
  sampling: "nearest for pixel; premultiplied-alpha area filter for smooth";
  width: number; height: number; png_sha256: string; rows: SheetRow[];
}

export function sheetImages(value: unknown, base: string): SheetImage[] {
  if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.images)
      || value.images.length < 1 || value.images.length > 16) {
    throw new CommandError("Sheet spec needs schema_version 1 and 1 to 16 images.");
  }
  return value.images.map(row => {
    if (!isRecord(row) || typeof row.label !== "string" || !row.label.trim()
        || typeof row.file !== "string" || !row.file || typeof row.scale !== "number"
        || (row.medium !== "smooth" && row.medium !== "pixel")) {
      throw new CommandError("Each sheet image needs label, PNG file, scale, and medium (smooth or pixel).");
    }
    checkScale(row.scale, row.medium);
    return { label: row.label, file: resolve(base, row.file), scale: row.scale, medium: row.medium };
  });
}

/** Two grounds at the actual display size. Row identity/coordinates live in the JSON. */
export function writeSheet(images: SheetImage[], pngPath: string, reportPath: string): SheetReport {
  if (!images.length || images.length > 16) throw new CommandError("A sheet needs 1 to 16 images.");
  let sourcePixels = 0, displayPixels = 0;
  const inputs = images.map(image => {
    const bytes = readRegular(image.file);
    const original = decodePng(bytes);
    sourcePixels += original.width * original.height;
    displayPixels += Math.max(1, Math.round(original.width * image.scale)) * Math.max(1, Math.round(original.height * image.scale));
    if (sourcePixels > 16_777_216 || displayPixels > 16_777_216) {
      throw new CommandError("Sheet inputs or display rows exceed 16777216 pixels; split the comparison.");
    }
    return { image, original, shown: resample(original, image.scale, image.medium), sha: digest(bytes) };
  });
  const pad = 16;
  const maxWidth = Math.max(...inputs.map(input => input.shown.width));
  const width = maxWidth * 2 + pad * 3;
  const height = inputs.reduce((total, input) => total + input.shown.height + pad, pad);
  checkSize(width, height);
  const canvas: Pixels = { width, height, data: Buffer.alloc(width * height * 4) };
  const split = maxWidth + pad * 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const grey = x >= split ? 10 : ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 115 : 155);
    canvas.data.fill(grey, at, at + 3);
    canvas.data[at + 3] = 255;
  }
  const rows: SheetRow[] = [];
  let top = pad;
  for (const { image, original, shown, sha } of inputs) {
    for (const left of [pad, split]) {
      for (let y = 0; y < shown.height; y++) for (let x = 0; x < shown.width; x++) {
        const src = (y * shown.width + x) * 4, dest = ((top + y) * width + left + x) * 4;
        const alpha = shown.data[src + 3]! / 255;
        for (let c = 0; c < 3; c++) canvas.data[dest + c] = Math.round(shown.data[src + c]! * alpha + canvas.data[dest + c]! * (1 - alpha));
      }
    }
    rows.push({ ...image, source_sha256: sha, source_width: original.width, source_height: original.height,
      display_width: shown.width, display_height: shown.height, checker: [pad, top], dark: [split, top] });
    top += shown.height + pad;
  }
  const png = encodePng(canvas);
  const report: SheetReport = { schema_version: 1, visualAcceptance: "not_assessed",
    sampling: "nearest for pixel; premultiplied-alpha area filter for smooth", width, height, png_sha256: digest(png), rows };
  atomicBytes(pngPath, png);
  atomicJson(reportPath, report);
  return report;
}

export function createSheet(specFile: string, output: string): SheetReport {
  let value: unknown;
  try { value = JSON.parse(textInput(specFile)); }
  catch (error) { if (error instanceof CommandError) throw error; throw new CommandError("Invalid sheet JSON."); }
  const images = sheetImages(value, dirname(resolve(specFile)));
  const root = resolve(output);
  mkdirSync(dirname(root), { recursive: true });
  try { mkdirSync(root, { mode: 0o700 }); }
  catch { throw new CommandError("Sheet output already exists or cannot be created; choose a new directory."); }
  return writeSheet(images, join(root, "sheet.png"), join(root, "sheet.json"));
}
