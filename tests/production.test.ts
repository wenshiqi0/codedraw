import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodePng, encodePng, resample } from "../runtime/lib/images.ts";
import { digest } from "../runtime/lib/storage.ts";
import { prepareInputs } from "../runtime/lib/inputs.ts";

const PROJECT = resolve(import.meta.dir, "..");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
let root: string, styleFile: string, referenceFile: string, task: string, brief: string, env: Record<string, string>;
let reference: Buffer;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codedraw-production-"));
  referenceFile = join(root, "reference with spaces.png");
  reference = encodePng({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 255) });
  writeFileSync(referenceFile, reference);
  styleFile = join(root, "style.json");
  writeFileSync(styleFile, JSON.stringify({ schema_version: 1, style_id: "paper-test-v1", medium: "smooth", canvas: [1280, 720],
    reference_frames: [{ file: "reference with spaces.png", role: "inventory", sha256: digest(reference) }],
    generation: { projection: "flat", light: "neutral", forbid: ["baked text"], model: "not-the-pi-model" },
    palette: { paper: "#c8bfa8", ink: "#29251f" }, sheet: { "interface.*": 0.5 } }));
  writeFileSync(join(root, "bible.md"), "Frozen paper #c8bfa8; keep text safe areas clear.");
  task = join(root, "task");
  brief = join(root, "brief.txt");
  writeFileSync(brief, "Draw a 64x64 paper tag; no text, neutral light, transparent margin.");
  env = { ...process.env, PI_BIN: join(PROJECT, "tests/fixtures/pi.ts"), FAKE_MODE: "success" };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function cli(args: string[], expected = 0) {
  const proc = Bun.spawn([process.execPath, join(PROJECT, "runtime/cli/run.ts"), ...args], { cwd: PROJECT, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 15000);
  try {
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ code, diagnostics: code === expected ? "" : out + err }).toEqual({ code: expected, diagnostics: "" });
    return out + err;
  } finally { clearTimeout(timer); }
}
const start = (extra: string[] = [], code = 0) => cli(["exec", brief, "--output", task, "--style", styleFile, "--asset-id", "interface.tag", ...extra], code);
const round = (file: string, index = "001") => join(task, "rounds", index, file);

test("style, bible, image bytes and display scale are pinned and reused after originals disappear", async () => {
  env.EXPECT_STYLE_ID = "paper-test-v1";
  env.EXPECT_REFERENCE_SHA = digest(reference);
  await start();
  const state = json(join(task, "task.json"));
  const manifest = json(join(task, state.inputs.path));
  expect(manifest.display).toEqual({ scale: 0.5, medium: "smooth" });
  expect(manifest.references[0].role).toBe("inventory");
  const report = json(round("display.json"));
  expect(report.rows[0]).toMatchObject({ display_width: 32, display_height: 32, scale: 0.5 });
  const receipt = json(round("receipt.json"));
  expect(receipt.inputs).toEqual(state.inputs);
  expect(receipt.artifacts.display.sha256).toBe(digest(readFileSync(round("display.png"))));
  const first = readFileSync(round("receipt.json"));
  rmSync(styleFile); rmSync(referenceFile); rmSync(join(root, "bible.md"));
  const feedback = join(root, "feedback.txt");
  writeFileSync(feedback, "Please use blue.");
  env.FAKE_MODE = "revision";
  await cli(["revise", task, "--feedback", feedback]);
  expect(json(round("display.json", "002")).rows[0].display_width).toBe(32);
  expect(readFileSync(round("receipt.json"))).toEqual(first);
});

test.each(["style.json", "bible.md", "reference-001.png", "manifest.json"])("changed production input %s blocks revision and acceptance", async file => {
  await start();
  const target = join(task, "inputs", file);
  writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("changed")]));
  const review = join(root, "review.txt");
  writeFileSync(review, "Reviewed.");
  await cli(["accept", task, "--review", review], 2);
  await cli(["revise", task, "--feedback", review], 2);
  expect(json(join(task, "task.json")).current_round).toBe(1);
  expect(existsSync(join(task, "receipt.json"))).toBe(false);
});

test("style SHA mismatch and conflicting display options fail before starting a task", async () => {
  writeFileSync(referenceFile, encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 128) }));
  expect(await start([], 2)).toContain("SHA-256 mismatch");
  expect(existsSync(task)).toBe(false);
  writeFileSync(referenceFile, reference);
  expect(await start(["--display-scale", "1"], 2)).toContain("conflicts");
  expect(await start(["--medium", "pixel"], 2)).toContain("conflicts");
  expect(existsSync(task)).toBe(false);
});

test("standalone PNG attachments and integer pixel display do not require a project lock", async () => {
  env.EXPECT_REFERENCE_SHA = digest(reference);
  await cli(["exec", brief, "--output", task, "--reference", referenceFile, "--display-scale", "2", "--medium", "pixel"]);
  expect(json(round("display.json")).rows[0]).toMatchObject({ display_width: 128, medium: "pixel" });
});

test.each(["display.png", "display.json"])("display evidence %s cannot change before acceptance", async file => {
  await start();
  writeFileSync(round(file), Buffer.concat([readFileSync(round(file)), Buffer.from("changed")]));
  const review = join(root, "review.txt"); writeFileSync(review, "Reviewed.");
  await cli(["accept", task, "--review", review], 2);
  expect(json(join(task, "task.json")).status).toBe("awaiting_review");
});

test("pixel display uses nearest at whole multiples and matches HA's sorted wildcard priority", () => {
  const style = json(styleFile);
  style.medium = "pixel";
  style.sheet = { "texture.*": 2, "*": 3 };
  writeFileSync(styleFile, JSON.stringify(style));
  expect(prepareInputs({ styleFile, assetId: "texture.hero" })?.display).toEqual({ scale: 3, medium: "pixel" });
  expect(() => prepareInputs({ displayScale: 0.5, medium: "pixel" })).toThrow("whole-number");
  const pixels = { width: 2, height: 1, data: Buffer.from([200, 10, 20, 255, 30, 40, 50, 128]) };
  const shown = resample(pixels, 2, "pixel");
  expect(shown.width).toBe(4);
  expect(shown.data.subarray(0, 8)).toEqual(Buffer.from([200, 10, 20, 255, 200, 10, 20, 255]));
  expect(shown.data.subarray(8, 16)).toEqual(Buffer.from([30, 40, 50, 128, 30, 40, 50, 128]));
});

test("smooth reductions ignore hidden RGB and preserve partial alpha", () => {
  const shown = resample({ width: 2, height: 2, data: Buffer.from([
    255, 0, 0, 0, 0, 80, 160, 255, 255, 0, 0, 0, 0, 80, 160, 255,
  ]) }, 0.5, "smooth");
  expect([...shown.data]).toEqual([0, 80, 160, 128]);
});

test("comparison sheets use actual raster sizes; acceptance binds candidate plus reference evidence", async () => {
  await start();
  const spec = join(root, "sheet-spec.json"), sheet = join(root, "comparison");
  writeFileSync(spec, JSON.stringify({ schema_version: 1, images: [
    { label: "accepted tag", file: referenceFile, scale: 1, medium: "smooth" },
    { label: "new tag", file: round("preview.png"), scale: 0.5, medium: "smooth" },
  ] }));
  await cli(["sheet", spec, "--output", sheet]);
  const report = json(join(sheet, "sheet.json"));
  expect(report.rows.map((row: { display_width: number }) => row.display_width)).toEqual([8, 32]);
  const png = decodePng(readFileSync(join(sheet, "sheet.png")));
  expect(png.width).toBe(report.width);
  expect(digest(readFileSync(join(sheet, "sheet.png")))).toBe(report.png_sha256);
  const review = join(root, "review.txt"); writeFileSync(review, "Viewed comparison rows at 8px and 32px, fixture protocol only.");
  await cli(["accept", task, "--review", review, "--comparison", sheet]);
  const final = json(join(task, "receipt.json"));
  expect(final.comparison.image.sha256).toBe(report.png_sha256);
  expect(readFileSync(join(task, final.comparison.image.path))).toEqual(readFileSync(join(sheet, "sheet.png")));
});

test("an unrelated comparison cannot be attached as acceptance evidence", async () => {
  await start();
  const spec = join(root, "sheet-spec.json"), sheet = join(root, "unrelated");
  writeFileSync(spec, JSON.stringify({ schema_version: 1, images: [1, 2].map(index => ({ label: `old ${index}`, file: referenceFile, scale: 1, medium: "smooth" })) }));
  await cli(["sheet", spec, "--output", sheet]);
  const review = join(root, "review.txt"); writeFileSync(review, "Reviewed.");
  expect(await cli(["accept", task, "--review", review, "--comparison", sheet], 2)).toContain("exact candidate");
  expect(json(join(task, "task.json")).status).toBe("awaiting_review");
});
