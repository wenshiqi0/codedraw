# Style inputs and display-size comparisons

Read this when a caller supplies a project style lock, target PNGs, or related
assets that must be compared at actual display sizes. Direction still comes
from the caller; the runtime fixes and carries that input, while the observer
checks the drawing and its integration.

## Fixed inputs for every round

```bash
<skill-root>/runtime/bin/codedraw exec <brief.md> \
  --output <new-task-dir> \
  --style <project-style-dir>/style.json --asset-id interface.tag
```

`--style` reads `schema_version: 1`, a nonempty `style_id`, `medium: smooth|pixel`,
and `reference_frames`. It retains the entire JSON, including palette, density,
projection, lighting and generation prefix data. An adjacent `bible.md`, when
present, is retained too. Each declared frame needs a relative PNG `file`, `role`
and lowercase `sha256`; missing or mismatched inputs stop before a model call.
This is input validation for CodeDraw, not a full validation of the HA schema.
The project's own style checker remains authoritative.

`--asset-id` selects a display scale from `sheet` using the first matching
lexically sorted key, matching HA's `BTreeMap` order. `*` is the wildcard.
Alternatively pass `--style <file> --display-scale <n>` when no asset rule exists.
An explicit scale or medium that conflicts with a selected lock rule is rejected.
The style's `generation.model` describes upstream art provenance; it does not
override the caller's Pi model.

For a standalone asset, without a project lock:

```bash
<skill-root>/runtime/bin/codedraw exec <brief.md> \
  --output <new-task-dir> --reference <target.png> \
  --display-scale 0.5 --medium smooth
```

Repeat `--reference` to attach more PNGs. At most eight references, including
lock frames, are accepted; each is at most 16 MiB and 4096 px per dimension.
JSON and bible text are each limited to 128 KiB. Supply an image-capable Pi
model. A built-in input guard checks Pi's selected model and processed image
count before the provider call; unsupported or lost image input fails as
`reference_images_unavailable` without silently switching model or discarding
references. Other discovered extensions stay disabled.

Inputs are copied into `inputs/` and recorded in a SHA-bound `manifest.json`,
including the original brief. Every round receives the same text and image
snapshots. Removing the original files does not affect revisions. Changing a
snapshot blocks revision and acceptance; start a new task for changed direction.
Reusable drawing functions still belong in the brief so `draw.ts` stays
self-contained. Image references must not become embedded raster content in SVG.

The observer views target images before drawing. A lock with no target frames
does not prove that a project has supplied its visual baseline. If the project's
production rules require target frames, obtain them before expanding a batch.

## Display preview and comparison sheet

When a display scale is set, each round produces `display.png` and `display.json`
alongside the original preview. These sample the delivered PNG, over a checkerboard
and a near-black ground, and are bound into the candidate receipt. They do not
rerender the SVG to conceal raster defects. Pixel sampling uses nearest at whole
multiples of at least 1; smooth sampling uses an area filter with premultiplied
alpha so hidden RGB does not tint reduced edges. Scale is at most 16. The observer
must view these images at 1:1 screen pixels to judge the documented display sizes.

For a set, write a comparison spec (paths resolve relative to this JSON file):

```json
{
  "schema_version": 1,
  "images": [
    {"label": "accepted tag", "file": "baseline/preview.png", "scale": 0.5, "medium": "smooth"},
    {"label": "new tag", "file": "task/rounds/001/preview.png", "scale": 0.5, "medium": "smooth"}
  ]
}
```

```bash
<skill-root>/runtime/bin/codedraw sheet <spec.json> --output <new-sheet-dir>
```

The sheet has one row per input, in order, with checkerboard on the left and dark
ground on the right. `sheet.json` names each row and records its source SHA,
original and display dimensions, scale, sampling medium and positions. Up to 16
rows fit in a 4096 × 4096 sheet; split larger comparisons without changing scale.
For multiple display sizes, list the same PNG in several rows with distinct scales.
The sheet is a deterministic raster comparison, not a GPU/mipmap simulation or
an export atlas. Preserve atlas spacing and tile seams in the production recipe.

Open the sheet and compare silhouette, edge treatment, palette, material,
lighting and density against the accepted baseline. Give visual feedback using
row identity and visible differences. If it passes, name that comparison and the
observed matches in review text, then bind the evidence:

```bash
<skill-root>/runtime/bin/codedraw accept <task-dir> \
  --review <review.md> --comparison <sheet-dir>
```

`--comparison` verifies the sheet PNG hash and requires at least two rows,
including the exact current candidate. A task with a locked display plan must
also have a candidate row at that scale and medium. It copies the sheet and JSON
into the round and records their hashes in the final receipt. It cannot verify
that the other row is an appropriate accepted reference, that an observer viewed
the image, or that scene integration passes. Those decisions remain with the
observer. A single-asset task can still use ordinary `accept --review`.

## HA integration and source boundary

This workflow was checked against HA main commit
`34335159754294f874f00775d98e1eb18ffd61bc`,
[RFC 0118 §6–§7](https://github.com/wenshiqi0/haunted-ascent/blob/34335159754294f874f00775d98e1eb18ffd61bc/docs/rfc/0118-art-quality.md)
and its CodeDraw improvement list in §6.4. Re-read the current application lock
and RFC before each production batch; this source snapshot does not make HA's
specific visual style a CodeDraw default.

For HA, use the head compiled by `cargo xtask art brief --app NAME`, and carry
the application's actual colour hex values and reusable helpers into the brief.
Source art uses neutral light and true alpha; runtime lighting, fog, shadows and
text remain separate. UI assets are normally exported at 2× logical display size;
pixel assets follow their own grid and nearest/integer scale. Smooth atlas power
of two dimensions, gutters, colour dilation and seamless tiling belong to recipes.

View `cargo xtask art sheet` at the project's sampling settings and the running
frame against its target via `cargo xtask art frame`; complete `art check` and
the application checklist before installation. CodeDraw's sheet and receipt do
not replace those gates. Respect HA's rule to put review sheets, captures and
candidate recipe outputs outside its checkout; CodeDraw can use an external
`.codedraw/` task root for that workflow. Retain formal source/provenance according
to the application recipe. No HA files are installed by these commands.
