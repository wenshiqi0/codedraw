# Runtime and observation contract

## Layout and execution

CodeDraw follows Codeflow's `runtime/bin → runtime/cli → runtime/lib` structure.
All runtime implementation and generated drawing programs use TypeScript and
run directly in Bun. There is no build step or separate Node/Python runtime.

```text
runtime/
  bin/codedraw              shell entrypoint → Bun CLI
  bin/pi                    pinned Pi CLI → Bun
  cli/run.ts                exec / sheet / status / events / usage / revise / accept
  cli/render.ts             SVG → PNG command
  cli/demo.ts               deterministic offline example
  lib/                      task state, artifacts, processes, events, usage
    inputs.ts               style/bible/reference snapshots and prompt injection
    images.ts, sheet.ts      raster sampling and display-size comparison evidence
    pi-reference-guard.ts    selected-model/image-count check before provider calls
  render/svg.ts             typed renderer and technical checks
  templates/draw.example.ts editable example drawing program
tests/                      bun:test suites and fixtures
```

`runtime/bin/codedraw` resolves the installed skill relative to its own path;
task outputs belong to the invoking project. It also works through the skill
directory symlink. `runtime/bin/pi` starts the repository's pinned Pi dependency
with Bun. Installing an unrelated global Pi is unnecessary.

```text
User brief
    │
Outer observer (the model using SKILL.md)
    │ exec / revise                          ▲ PNG + receipt + usage
    ▼                                        │
Bun task runtime → Pi under Bun → draw.ts     │
    └── Bun executes draw.ts → asset.svg → resvg → preview.png
    ▲
    └── accept after viewing preview → completed receipt
```

The outer loop is an agent workflow. One command runs one generation round.
Pi writes drawing code; CodeDraw re-executes it and renders independently.
The observer evaluates pixels against the brief and decides whether to request
another round. The runtime itself does not make a visual judgment.

The caller supplies art direction; the observer checks the required input in
`SKILL.md` before invoking Pi. The CLI does not validate that text-level contract.
For related assets, the observer follows [the asset-set workflow](asset-sets.md):
test the supplied direction on a representative sample, include shared drawing conventions
and TypeScript in each text brief, and compare candidates together at intended
display sizes. Optional production inputs are described in
[production-inputs.md](production-inputs.md): `--style` snapshots the JSON lock,
adjacent bible and SHA-checked reference PNGs; `--reference` attaches standalone
PNGs. Display scale comes from a selected asset's `sheet` rule or an explicit
option. Input integrity is checked on each revision and acceptance. The observer
still manages the baseline across tasks; a task receipt does not prove set-wide
consistency.

The source comparison used Codeflow commit
`2c04565aae5187638150e581e311c05a8ec604fc`, particularly `runtime/bin/codeflow`,
`runtime/bin/pi`, `runtime/cli/run.ts`, and the usage ledger. CodeDraw retains
the process boundary, task evidence, and observer workflow without requiring
Codeflow's Goal DAG or Worker coordination.

## Drawing contract

- Each round has a separate `rounds/NNN/work/` directory.
- `draw.ts` is a self-contained TypeScript module. `bun draw.ts` writes
  `asset.svg` in its working directory using Bun or compatible built-in APIs.
  Geometry, colors, spacing, and any seed belong in source. No package installs
  or third-party imports are needed for the drawing program.
- SVG uses explicit pixel width/height and a matching viewBox. Shapes, paths,
  gradients, masks, and local fragments form the initial backend. Convert
  lettering to paths. Keep source below 2 MiB and each dimension at most 4096.
- CodeDraw removes any earlier SVG and re-executes the retained `draw.ts`, then
  invokes `runtime/cli/render.ts` using the current Bun executable. The renderer
  checks parseability, dimensions, visible pixels, and self-containment.
  Its `render.json` describes technical observations, not aesthetic acceptance.
- Each candidate receipt binds `draw.ts`, `asset.svg`, `preview.png`, and
  `render.json` to SHA-256 hashes. A revision copies source into a new round;
  the previous candidate evidence remains intact.
- With production inputs, `task.inputs` and each candidate/final receipt bind
  `inputs/manifest.json`; that manifest binds the brief and copied style, bible
  and reference files. These are additive optional fields; ordinary text tasks
  keep their existing artifact set. An externally changed direction needs a new task.
- With a display plan, `display.png` and `display.json` are also candidate
  artifacts, sampled from the delivered raster using nearest for pixel art or
  premultiplied-alpha area filtering for smooth art. Sheets are limited to 4096
  pixels per dimension. This does not validate GPU mipmap upload or scene fit.
- `sheet` takes a JSON image list with a display scale and medium per row and
  writes `sheet.png` / `sheet.json`. `accept --comparison` checks that the exact
  current candidate appears beside a reference, at its locked scale when set,
  and retains copies and hashes in `CompletedReceipt.comparison`. Source image
  hashes and row positions preserve what the comparison showed.

## State and acceptance

| State | Meaning | Next action |
|---|---|---|
| `drawing` | Pi, source execution, or renderer is running | Observe process and events |
| `awaiting_review` | Rendered candidate is ready | Open PNG, then revise or accept |
| `failed` | Generation or execution failed | Inspect failure category; report or explicitly revise |
| `completed` | Observer accepted intact artifacts | Deliver source, SVG, PNG, and receipt |

`max-rounds` defaults to 3 and bounds revisions. `timeout` defaults to 300 seconds
for the whole generation/execution/render round. Neither is a monetary budget.
The runtime does not select a fallback model. A successful process exit alone
never completes a task.

`accept` preserves the candidate receipt, verifies all artifact hashes, saves
the observer's review, and writes the final task-level `receipt.json`. Its hash
and path are stored in `task.json`. It requires nonempty review text but does not
verify image-viewing actions or the substance of the observer's visual judgment.
Production input and display hashes are checked as well. Comparison evidence is
optional at the CLI boundary; the asset-set workflow requires the observer to
provide it for a set. It is not a runtime aesthetic verdict or installation gate.

State writes use temporary files and atomic renames. Mutations hold an exclusive
`.exclusive/` directory with an owner record. Concurrent or stale ownership is
rejected. The initial runtime has no crash replay: investigate the owner and
remaining subprocesses before recovering an interrupted task. Read-only
`status`, `events`, and `usage` do not need the mutation lock.

## Pi and observation boundary

The runtime starts Pi in JSON print mode with a fresh ephemeral session each
round. Skill/extension/prompt/context discovery is disabled for the artist.
When references are supplied, the runtime explicitly loads its own small input
guard. It checks the selected model's image capability and the processed image
count before allowing a provider call, then emits a bounded readiness record.
Pi deliberately continues after a thrown extension error, so rejection uses its
`handled` input action. A missing/negative guard record fails the round with
`reference_images_unavailable`; there is no text-only fallback. References are
passed as Pi `@file` arguments each round. Pi may resize them according to its
image processing settings; the manifest hashes the original supplied PNGs.
Pi's read/write/edit/bash tools remain available for writing and debugging the
TypeScript drawing. `--model <provider>/<model>` overrides only this task;
without it, Pi uses the user's own configuration. Credentials remain in Pi's
configuration or environment and are not copied from Codeflow.

The work directory and prompt define scope; they are not an OS sandbox.
Pi tools and generated code execute with the invoking user's permissions.

Raw messages are parsed in memory and discarded. Persisted events contain
bounded metadata, not tool arguments, transcript text, or thinking text.
Usage counts assistant `message_end`, not replayed messages in `agent_end`.
The provider's `totalTokens` is authoritative. Reasoning can overlap output;
missing reasoning stays null. Outer observer usage is outside this ledger.

`PI_BIN` can replace the artist executable for integration fixtures. Launcher
`CODEDRAW_BUN_BIN` can select a Bun executable by path. They are executable
paths, not shell command strings. Generated drawing and renderer processes use
the running Bun executable (`process.execPath`).

## Verification

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run demo
bun run test:pi
```

`bun test` covers actual rendering and task/receipt behavior with fixture Pi
responses. `test:pi` starts the real pinned Pi under Bun against an isolated
local SSE stub, verifying tool calls and protocol integration without a remote
model. These checks do not evaluate autonomous model drawing quality.

Sources: [Bun TypeScript](https://bun.sh/docs/runtime/typescript),
[Bun subprocesses](https://bun.sh/docs/runtime/child-process),
[Pi CLI documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent),
and [resvg-js](https://github.com/thx/resvg-js). `bun.lock` pins all dependencies;
the current integration uses Bun 1.3.14, Pi 0.84.2, and resvg-js 2.6.2.
