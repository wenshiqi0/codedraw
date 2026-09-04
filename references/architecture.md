# Runtime and observation contract

## Layout and execution

CodeDraw follows Codeflow's `runtime/bin → runtime/cli → runtime/lib` structure.
All runtime implementation and generated drawing programs use TypeScript and
run directly in Bun. There is no build step or separate Node/Python runtime.

```text
runtime/
  bin/codedraw              shell entrypoint → Bun CLI
  bin/pi                    pinned Pi CLI → Bun
  cli/run.ts                exec / status / events / usage / revise / accept
  cli/render.ts             SVG → PNG command
  cli/demo.ts               deterministic offline example
  lib/                      task state, artifacts, processes, events, usage
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
and path are stored in `task.json`.

State writes use temporary files and atomic renames. Mutations hold an exclusive
`.exclusive/` directory with an owner record. Concurrent or stale ownership is
rejected. The initial runtime has no crash replay: investigate the owner and
remaining subprocesses before recovering an interrupted task. Read-only
`status`, `events`, and `usage` do not need the mutation lock.

## Pi and observation boundary

The runtime starts Pi in JSON print mode with a fresh ephemeral session each
round. Skill/extension/prompt/context discovery is disabled for the artist.
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
