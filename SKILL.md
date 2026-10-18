---
name: codedraw
description: Create editable visual assets by writing and running drawing code with a Pi runtime, then inspecting rendered previews in an outer loop. Use for code-drawn icons, game props, sprites, and procedural vector illustrations, or when the user invokes CodeDraw.
---

# CodeDraw

You are the outer observer. Translate the caller's visual requirements into a brief,
let the inner Pi artist write drawing code, inspect the rendered image, and
return specific visual feedback until the asset meets the brief. The initial
backend is TypeScript → SVG → PNG, executed by Bun. Deliver all three so the
asset stays editable.

Use CodeDraw for precise or reusable geometry: icons, map symbols, stamps, tags,
borders, masks, and procedural texture layers. A painted-realism brief may need
an image-generation tool for its semantic artwork; do not replace its direction
with simplified vector art just because this renderer can produce it.

## Required input: caller-supplied art direction

For production drawing, the caller supplies the art direction. The caller may be the user, Codeflow,
or another host agent carrying the user's requirements. CodeDraw implements
and checks that direction; neither observer nor artist chooses a replacement.

Before `exec`, resolve these inputs from the request and caller-provided context:

| Input | What the caller needs to provide |
|---|---|
| Asset and use | Subjects, target scene or interface, export dimensions, actual display sizes, and background |
| Style authority | A supplied reference image, accepted asset baseline, or concrete written visual specification; identify precedence if several conflict |
| Visual rules | Relevant palette/material treatment, perspective/proportions, edges, lighting, and detail density; for pixel art, logical grid and scaling policy |
| Acceptance | Observable matches and unwanted deviations, plus the shared baseline for related assets |

Use [assets/brief.template.md](assets/brief.template.md) to collect missing input;
the caller need not use that exact format. An existing reference or project
specification can supply the rules without asking the user to repeat them.
Extract observable rules from those sources and carry them into the brief.
Ask the caller about unresolved choices or conflicting references in one concise
request. If a named reference is inaccessible, report that missing input instead
of guessing what it looks like. Do not start production drawing while the style
authority or material visual rules are missing. "Beautiful," "polished," or
"cohesive" alone are not a style specification.
Do not silently borrow the example's style or invent a palette or camera angle.

If the caller explicitly requests style exploration, produce labeled proposals
within that scope. Have the caller establish the production direction before
expanding a proposal into a full asset set.

The CLI validates explicit style/reference/display inputs, not the completeness
of a plain-text brief. The observer must still check this contract before Pi.
For project style locks or image references, read
[references/production-inputs.md](references/production-inputs.md). `exec --style`
snapshots the lock, adjacent bible, and SHA-checked reference PNGs, attaches the
images to Pi, and carries the same inputs into every revision. Without this
option, include the resolved drawing conventions explicitly in the brief.

## Setup

Resolve `<skill-root>` to the directory containing this file. Commands work
from any project; put task outputs in that project's
`.codedraw/`, not inside the installed skill. Runs on macOS/Linux with Bun
1.3.14+. Pi 0.84.2 is a pinned project dependency and runs under Bun too.

Install dependencies with `bun install --cwd <skill-root> --frozen-lockfile`.
Use the user's selected Pi model with `--model <provider>/<model>`; otherwise
inherit their Pi configuration. Credentials stay in Pi's existing configuration
or environment. Do not copy keys or provider configuration from Codeflow.

## Draw and observe

For a related set of assets, sprite atlas, or existing game's art refresh, read
[references/asset-sets.md](references/asset-sets.md) first. Establish a visual
baseline on a small representative sample before expanding production. Carry
the same concrete drawing rules and reusable TypeScript into subsequent briefs;
judge candidates together at their intended display sizes. Parallel tasks do not
share art direction automatically.

1. Write a brief file with the subject, intended use, canvas dimensions,
   background/transparency, style, palette, and visible acceptance criteria.
   Preserve the supplied art direction and acceptance criteria. Fill in execution
   details only when they do not change those visual requirements. The renderer
   supports up to 4096 pixels per dimension and self-contained vector shapes.
   [assets/brief.example.md](assets/brief.example.md) is an example, not a fixed
   art direction.
2. Start one task:

   ```bash
   <skill-root>/runtime/bin/codedraw exec <brief-file> \
     --output <new-task-directory> --max-rounds 3 --timeout 300
   ```

   For a locked asset, add `--style <style.json> --asset-id <asset-id>` to resolve
   its display scale from the lock's `sheet` rules. For an independent asset use
   `--reference <target.png>` and, when known, `--display-scale <n>` with
   `--medium smooth|pixel`. References require an image-capable Pi model.

   `exec` runs one Pi round and returns. For a long-running command, retain its
   execution session and poll with bounded waits; inspect `status` or `events`
   from another command when needed. Silence alone does not imply a failure.
3. Read the receipt and render metadata, and **open the actual `preview.png`
   with an image-viewing tool**. Judge the requested dimensions, transparency,
   silhouette, composition, palette, small-size legibility, and clipping as
   relevant to the brief. When present, open the receipt-bound `display.png`
   too: it samples the delivered raster at the actual display scale over a
   checkerboard and a near-black background. For related assets, compare against the accepted
   sample and inspect them together in context. A complete atlas with recognizable
   cells can still fail its visual brief. `awaiting_review` means an image rendered, not that it
   passed visual review. A textual model claim or a PNG hash cannot replace
   seeing the image. If image viewing is unavailable, retain this state and
   report that visual review is pending.
4. If changes are needed, write a feedback file describing the observed problem
   and desired change, then run:

   ```bash
   <skill-root>/runtime/bin/codedraw revise <task-directory> \
     --feedback <feedback-file>
   ```

   Inspect the new preview. Revisions retain previous rounds and start a fresh
   Pi context with the original brief, last source, and latest feedback. The
   outer observer carries forward any still-unresolved feedback. Normal visual
   revisions are part of the drawing request; no additional user confirmation
   is needed. Stop when accepted, when the round limit is reached, or when a
   runtime/model failure prevents useful progress. Report technical failures
   before deciding whether another attempt is warranted.
5. After viewing a satisfactory preview, write a review file that identifies the
   preview and explains how it meets the brief. For a set, record the visual
   baseline and the comparison sheet or scene actually viewed, including display
   sizes and any remaining deviations. Do not replace that comparison with
   generic claims such as "cohesive" or "production-ready." Then run:

   ```bash
   <skill-root>/runtime/bin/codedraw accept <task-directory> \
     --review <review-file>
   ```

   For a set, build a comparison with `codedraw sheet <spec.json> --output <new-dir>`
   containing the current candidate and the accepted baseline at their respective
   display sizes. View it, then add `--comparison <sheet-dir>` to `accept` to bind
   that evidence to the final receipt. The runtime checks that the exact candidate
   is present at its locked scale; the observer judges whether the baseline and
   visible matches are appropriate. See the production-input reference for the spec.

   This is the observer's decision; it does not necessarily require a human
   approval step. `accept` verifies that the source, SVG, PNG, and render metadata
   still match the round receipt before completing the task.

## Observation and delivery

```bash
<skill-root>/runtime/bin/codedraw status <task-directory>
<skill-root>/runtime/bin/codedraw events <task-directory> --since 0
<skill-root>/runtime/bin/codedraw usage <task-directory>
```

Use the last returned event's `seq` as the next `--since` cursor; retain the
previous cursor if no rows are returned. Read bounded event metadata,
receipts, previews, and usage; do not mine Pi transcripts or hidden reasoning.
In progress and final reports, label usage by task: calls, input, output,
cache-read, reasoning, and total tokens. Missing reasoning is unavailable, not
zero. These counts cover the inner Pi runtime only; outer observer usage is
not available from this CLI.

Show the final PNG and link the drawing source, SVG, and final `receipt.json`. Say
whether the task is completed, waiting for visual review, or failed. Do not
claim model-generated validation when only the offline demo was exercised.

Read [references/architecture.md](references/architecture.md) when extending the
runtime, changing artifact contracts, or diagnosing state/usage behavior.
`bun run --cwd <skill-root> demo` validates the renderer with a deterministic
code-drawn sample and makes no model calls. All executable implementation lives
under `runtime/`; extend it in TypeScript and execute it with Bun.
