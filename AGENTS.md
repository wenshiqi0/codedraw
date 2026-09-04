# CodeDraw development

- Use TypeScript and Bun for runtime implementation, subprocesses, generated
  drawing programs, and development commands. Keep executable implementation
  under `runtime/`, following Codeflow's `runtime/bin`, `runtime/cli`, and
  `runtime/lib` organization.
- `runtime/bin` contains thin shell launchers that execute Bun. Pi also runs
  under Bun using the project-pinned dependency. Do not add a Python or Node
  execution path.
- Drawing source is `draw.ts`; Bun executes it to produce SVG, then renders PNG.
  The outer observer owns visual acceptance; a renderer pass is only technical
  evidence.
- Keep tests in `tests/` as TypeScript with `bun:test`. Run `bun run typecheck`
  and `bun test` for changes; use `bun run test:pi` when the Pi boundary changes.
  The Pi smoke uses a local model stub and is not a model-quality evaluation.
- Keep generated task artifacts under `.codedraw/`. Preserve earlier rounds and
  their receipts. `SKILL.md` and `references/architecture.md` describe the public
  workflow and must match the runtime.
