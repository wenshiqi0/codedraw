---
name: codedraw
description: Create editable visual assets by writing and running drawing code with a Pi runtime, then inspecting rendered previews in an outer loop. Use for code-drawn icons, game props, sprites, and procedural vector illustrations, or when the user invokes CodeDraw.
---

# CodeDraw

You are the outer observer. Translate the user's visual request into a brief,
let the inner Pi artist write drawing code, inspect the rendered image, and
return specific visual feedback until the asset meets the brief. The initial
backend is TypeScript → SVG → PNG, executed by Bun. Deliver all three so the
asset stays editable.

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

1. Write a brief file with the subject, intended use, canvas dimensions,
   background/transparency, style, palette, and visible acceptance criteria.
   Preserve explicit requirements. Infer ordinary design details; if dimensions
   are unspecified, start with a 512 × 512 transparent canvas. The renderer
   supports up to 4096 pixels per dimension and self-contained vector shapes.
   [assets/brief.example.md](assets/brief.example.md) is an example, not a fixed
   art direction.
2. Start one task:

   ```bash
   <skill-root>/runtime/bin/codedraw exec <brief-file> \
     --output <new-task-directory> --max-rounds 3 --timeout 300
   ```

   `exec` runs one Pi round and returns. For a long-running command, retain its
   execution session and poll with bounded waits; inspect `status` or `events`
   from another command when needed. Silence alone does not imply a failure.
3. Read the receipt and render metadata, and **open the actual `preview.png`
   with an image-viewing tool**. Judge the requested dimensions, transparency,
   silhouette, composition, palette, small-size legibility, and clipping as
   relevant to the brief. `awaiting_review` means an image rendered, not that it
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
   preview and explains how it meets the brief, then run:

   ```bash
   <skill-root>/runtime/bin/codedraw accept <task-directory> \
     --review <review-file>
   ```

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
