import { PNG } from "pngjs";
import { CommandError } from "./types.ts";

export type Medium = "smooth" | "pixel";
export interface Pixels { width: number; height: number; data: Buffer }

export function decodePng(bytes: Buffer): Pixels {
  // Check dimensions before the decoder allocates the expanded image.
  if (bytes.length > 16 * 1024 * 1024 || bytes.length < 24
      || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new CommandError("Expected a PNG of at most 16 MiB.");
  }
  checkSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  try { return PNG.sync.read(bytes); }
  catch { throw new CommandError("Invalid PNG image."); }
}

export function checkSize(width: number, height: number): void {
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096)) {
    throw new CommandError("Image and comparison dimensions must be integers from 1 to 4096.");
  }
}

export function checkScale(scale: number, medium: Medium): void {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) {
    throw new CommandError("Display scale must be greater than zero and at most 16.");
  }
  if (medium === "pixel" && !Number.isInteger(scale)) {
    throw new CommandError("Pixel art requires a whole-number display scale of at least 1.");
  }
}

/** Sample the delivered raster, not a fresh vector rendering which can hide defects. */
export function resample(input: Pixels, scale: number, medium: Medium): Pixels {
  checkScale(scale, medium);
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));
  checkSize(width, height);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const target = (y * width + x) * 4;
    if (medium === "pixel") {
      const source = (Math.floor(y * input.height / height) * input.width + Math.floor(x * input.width / width)) * 4;
      input.data.copy(data, target, source, source + 4);
      continue;
    }
    // Area filter with premultiplied alpha, like a mip-filtered reduction.
    const x0 = x * input.width / width, x1 = (x + 1) * input.width / width;
    const y0 = y * input.height / height, y1 = (y + 1) * input.height / height;
    const rgba = [0, 0, 0, 0];
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
      for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
        const weight = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
        const source = (sy * input.width + sx) * 4;
        const alpha = input.data[source + 3]! / 255;
        for (let c = 0; c < 3; c++) rgba[c]! += input.data[source + c]! * alpha * weight;
        rgba[3]! += alpha * weight;
      }
    }
    for (let c = 0; c < 3; c++) data[target + c] = rgba[3]! ? Math.round(rgba[c]! / rgba[3]!) : 0;
    data[target + 3] = Math.round(rgba[3]! / ((x1 - x0) * (y1 - y0)) * 255);
  }
  return { width, height, data };
}

export function encodePng(image: Pixels): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = image.data;
  return PNG.sync.write(png);
}
