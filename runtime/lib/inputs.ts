import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkScale, decodePng, type Medium } from "./images.ts";
import { artifactRecord, atomicBytes, atomicJson, digest, pathExists, readRegular, safePath, textInput } from "./storage.ts";
import { CommandError, isRecord, type Artifact } from "./types.ts";

export interface InputOptions {
  styleFile?: string;
  references?: string[];
  assetId?: string;
  displayScale?: number;
  medium?: Medium;
}
interface Snapshot { path: string; source: string; bytes: Buffer }
interface Reference { role: string; artifact: Artifact }
export interface DrawingInputs {
  schema_version: 1;
  files: Array<{ source: string; artifact: Artifact }>;
  style?: Artifact;
  bible?: Artifact;
  asset_id?: string;
  references: Reference[];
  display?: { scale: number; medium: Medium };
}
export interface PreparedInputs {
  snapshots: Snapshot[];
  referenceRoles: string[];
  hasStyle: boolean;
  hasBible: boolean;
  assetId?: string;
  display?: DrawingInputs["display"];
}

const referencePath = (index: number) => `inputs/reference-${String(index + 1).padStart(3, "0")}.png`;
const globMatches = (pattern: string, id: string) => new RegExp(`^${pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(id);

export function prepareInputs(options: InputOptions): PreparedInputs | null {
  if (!options.styleFile && !options.references?.length && options.displayScale === undefined && !options.assetId && !options.medium) return null;
  if (options.assetId && !options.styleFile) throw new CommandError("--asset-id requires --style.");
  const snapshots: Snapshot[] = [];
  const referenceRoles: string[] = [];
  let style: Record<string, unknown> | undefined;
  let hasBible = false;
  let scale = options.displayScale;
  let medium = options.medium ?? "smooth";
  const addReference = (file: string, role: string, expected?: string) => {
    if (referenceRoles.length >= 8) throw new CommandError("At most 8 reference PNGs can be attached.");
    const bytes = readRegular(file);
    decodePng(bytes);
    if (expected !== undefined && digest(bytes) !== expected) throw new CommandError(`Reference SHA-256 mismatch: ${role}.`);
    snapshots.push({ path: referencePath(referenceRoles.length), source: resolve(file), bytes });
    referenceRoles.push(role);
  };
  if (options.styleFile) {
    const file = resolve(options.styleFile);
    const text = textInput(file);
    if (Buffer.byteLength(text) > 128 * 1024) throw new CommandError("Style JSON exceeds 128 KiB.");
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new CommandError("Invalid style JSON."); }
    if (!isRecord(value) || value.schema_version !== 1 || typeof value.style_id !== "string" || !value.style_id.trim()
        || (value.medium !== "smooth" && value.medium !== "pixel")) {
      throw new CommandError("Style needs schema_version 1, style_id, and medium (smooth or pixel).");
    }
    style = value;
    medium = value.medium;
    if (options.medium && options.medium !== medium) throw new CommandError("--medium conflicts with the style lock.");
    snapshots.push({ path: "inputs/style.json", source: file, bytes: Buffer.from(text) });
    const bible = join(dirname(file), "bible.md");
    if (pathExists(bible)) {
      const text = textInput(bible);
      if (Buffer.byteLength(text) > 128 * 1024) throw new CommandError("Style bible exceeds 128 KiB.");
      snapshots.push({ path: "inputs/bible.md", source: bible, bytes: Buffer.from(text) });
      hasBible = true;
    }
    if (!Array.isArray(value.reference_frames)) throw new CommandError("Style reference_frames must be an array.");
    for (const frame of value.reference_frames) {
      if (!isRecord(frame) || typeof frame.file !== "string" || typeof frame.role !== "string"
          || typeof frame.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(frame.sha256)) {
        throw new CommandError("Each style reference needs a relative PNG file, role, and lowercase SHA-256.");
      }
      addReference(safePath(dirname(file), frame.file), frame.role, frame.sha256);
    }
    if (options.assetId) {
      if (!isRecord(value.sheet)) throw new CommandError("Style has no sheet display scales.");
      // HA stores these in a BTreeMap and uses the first matching key.
      const match = Object.keys(value.sheet).sort().find(pattern => globMatches(pattern, options.assetId!));
      const lockedScale = match === undefined ? undefined : value.sheet[match];
      if (typeof lockedScale !== "number") throw new CommandError("Asset ID has no numeric sheet scale in the style lock.");
      if (scale !== undefined && scale !== lockedScale) throw new CommandError("--display-scale conflicts with the style sheet scale.");
      scale = lockedScale;
    }
    if (scale === undefined) throw new CommandError("--style requires --asset-id or --display-scale for an actual-size preview.");
  }
  for (const [index, file] of (options.references ?? []).entries()) addReference(resolve(file), `caller-${index + 1}`);
  if (scale !== undefined) checkScale(scale, medium);
  if (options.medium && scale === undefined) throw new CommandError("--medium requires a display scale.");
  return { snapshots, referenceRoles, hasStyle: style !== undefined, hasBible,
    ...(options.assetId ? { assetId: options.assetId } : {}),
    ...(scale === undefined ? {} : { display: { scale, medium } }) };
}

export function storeInputs(root: string, prepared: PreparedInputs): Artifact {
  mkdirSync(join(root, "inputs"), { mode: 0o700 });
  const files = [{ source: "caller brief", artifact: artifactRecord(root, "brief.txt") }];
  for (const snapshot of prepared.snapshots) {
    atomicBytes(join(root, snapshot.path), snapshot.bytes);
    files.push({ source: snapshot.source, artifact: artifactRecord(root, snapshot.path) });
  }
  const inputs: DrawingInputs = { schema_version: 1, files,
    references: prepared.referenceRoles.map((role, index) => ({ role, artifact: artifactRecord(root, referencePath(index)) })),
    ...(prepared.hasStyle ? { style: artifactRecord(root, "inputs/style.json") } : {}),
    ...(prepared.hasBible ? { bible: artifactRecord(root, "inputs/bible.md") } : {}),
    ...(prepared.assetId ? { asset_id: prepared.assetId } : {}),
    ...(prepared.display ? { display: prepared.display } : {}) };
  atomicJson(join(root, "inputs/manifest.json"), inputs);
  return artifactRecord(root, "inputs/manifest.json");
}

export function loadInputs(root: string, artifact?: Artifact): DrawingInputs | null {
  if (!artifact) return null;
  const verify = (expected: Artifact) => {
    const actual = artifactRecord(root, expected.path);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new CommandError("Drawing input integrity check failed; create a new task to change direction.");
    }
  };
  verify(artifact);
  const value = JSON.parse(textInput(safePath(root, artifact.path))) as DrawingInputs;
  for (const file of value.files) verify(file.artifact);
  return value;
}

export function inputPrompt(root: string, inputs: DrawingInputs | null): string {
  if (!inputs) return "";
  let prompt = "\n\n## Supplied production direction\nThese snapshots stay fixed across revisions. Follow the caller's direction; do not invent a replacement style.\n";
  if (inputs.style) {
    const style = JSON.parse(textInput(safePath(root, inputs.style.path)));
    prompt += `\nRetain relevant drawing constants in self-contained draw.ts. Style data (not a model-selection setting):\nconst CODEDRAW_STYLE = ${JSON.stringify(style, null, 2)} as const;\n`;
  }
  if (inputs.bible) prompt += `\nStyle bible:\n${textInput(safePath(root, inputs.bible.path))}\n`;
  if (inputs.asset_id) prompt += `\nAsset ID: ${inputs.asset_id}.\n`;
  if (inputs.display) prompt += `\nThe delivered PNG is displayed at ${inputs.display.scale}x, using ${inputs.display.medium === "pixel" ? "nearest sampling on a whole-number grid" : "smooth sampling"}. Judge detail at this size.\n`;
  if (inputs.references.length) prompt += `\nAttached reference images, in order: ${inputs.references.map(reference => reference.role).join(", ")}. Use these for visual direction, not as raster content inside the SVG.\n`;
  return prompt;
}
