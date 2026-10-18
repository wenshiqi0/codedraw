# Producing a coherent asset set

Use this workflow for related icons, sprite atlases, or art integrated into an
existing game. The caller supplies art direction; the outer observer carries
it into the briefs and verifies the results against it.
An SVG/PNG pair and a completed receipt establish a delivered candidate, not
the quality of a whole game's art.

## Establish the visual baseline

For an existing game, inspect the scene and actual destination sizes before
writing production briefs. For a new project, use the caller's intended scene
and display specification. Record object scale, camera angle, backgrounds, and
nearby UI when applicable. Atlas resolution alone does not determine how assets look in the game.
An inventory icon can use a different framing from a world sprite, but that
difference should be deliberate within the same art direction.

Resolve the required inputs in [SKILL.md](../SKILL.md#required-input-caller-supplied-art-direction)
from the caller's references or written specification. If those leave a material
style choice unresolved, return the specific missing input to the caller before
drawing. Existing assets supply a style baseline only when the caller identifies
them as the intended reference; a rejected batch is not automatically the target.
A production sample tests the supplied direction. Explicitly requested style
exploration instead follows the proposal workflow in `SKILL.md`; label those
samples as proposals until the caller establishes the production direction.
A production brief does not authorize CodeDraw to choose another direction.
Human approval is required only when the
user asks for it; the observer can iterate within the authorized brief.

Start with a small sample spanning the difficult relationships: for example, a
character beside a furnishing and a floor tile, with an inventory item displayed
at its intended size. Prefer this over filling large independent atlases before
the visual direction has been tested. A set of individually recognizable objects
does not establish coherent proportions, perspective, or material treatment.

Inspect the sample enlarged for construction defects and at the actual display
size for its overall look. When the baseline is poor, revise the underlying
shapes, proportions, and drawing method. More decorative detail or more parallel
workers does not by itself resolve a weak baseline. If the allotted rounds cannot
establish a satisfactory baseline, report the limitation before expanding the set.

## Carry the same rules into every task

After the sample meets the caller's brief, preserve its source, preview, and
the supplied art direction under the target project's `.codedraw/`. Record the
source of that direction and give the baseline a version so later
reviews can identify what they compared against. This is an observer-managed
record. `exec --style` snapshots and hashes the supplied JSON, adjacent bible,
and declared reference PNGs for each task; the observer still maintains the
cross-task baseline and its reusable drawing source.

Turn the decisions that matter into concrete values and reusable TypeScript:

| Decision | Examples of an enforceable drawing convention |
|---|---|
| Palette | Named hex colors and shared material shade ramps |
| Coordinates | Logical unit, integer grid, export scale, and final display scale |
| Edges | Outline thickness, corner/curve treatment, and antialiasing choice |
| Form | Camera angle, visible top/side faces, body proportions, and footprint |
| Light | Common light direction, shadow shape, and highlight treatment |
| Detail | Smallest visible feature and intended contrast against the scene |

Implement conventions from the supplied style; pixel art is one possible mode.
For pixel art, integer logical coordinates and a deliberate final scaling policy
matter more than labeling arbitrary SVG geometry "pixel art." For example,
rounding `x * exportScale` can still create subpixel-grid details when `x` is
fractional. Avoid mixing native smooth circles with stepped pixel shapes unless
the baseline intentionally demonstrates that treatment.

Use [production inputs](production-inputs.md) to pass a project lock and attach
reference PNGs to the fresh Pi context. The snapshots are reused across revisions;
a plain path in a text brief does not attach its pixels. The runtime has no
shared-library import option. It copies the previous round's own drawing source
and SVG; unrelated task files and repository context do not reach the artist.

The observer should inspect references itself. `--style` injects the lock data
and bible; include any additional resolved drawing rules and the relevant
TypeScript helpers from the accepted sample in every production brief.
Have the artist retain those definitions inside its self-contained `draw.ts`;
do not require imports from a mutable external style file. Record which baseline
the brief carries, then check that its important conventions survived generation.
Snapshots preserve the input, not the artist's compliance: check generated code
and pixels against the baseline.

Only split production after this baseline exists. Choose batches small enough
to compare and revise coherently. When a baseline changes, identify which earlier
assets need another comparison instead of silently mixing versions.

## Compare the set before accepting it

Open the exact receipt-referenced candidate and a comparison view containing
both accepted reference assets and new candidates. Use a game screenshot or a
comparison sheet at representative display sizes and backgrounds. For pixel art,
use the game's actual sampling behavior; a smooth enlarged preview can conceal
or introduce inconsistencies. Keep any generated comparison programs in
`.codedraw/`, written in TypeScript and executed with Bun.

`codedraw sheet` provides this comparison from a JSON image list with an explicit
display scale and medium per row. Inspect its PNG and row metadata, then pass
its directory to `accept --comparison` to retain the sheet and its hashes with
the accepted candidate. The automatic `display.png` contains only the candidate;
it does not replace comparison against an established baseline or a running scene.

Evaluate the relationships: character-to-furniture scale, perspective, edge
thickness, pixel density, lighting, palette, material shading, and scene/UI fit.
UI and world art need compatible visual hierarchy; they need not use identical
rendering techniques. Missing cells, clipping, and transparent margins are
technical defects to fix, but fixing them does not complete aesthetic review.

Give feedback relative to a visible baseline: "The shelf uses smooth one-pixel
highlights while the reference character has stepped four-pixel edges; use the
same logical grid and shade ramp." Preserve only the parts that actually meet
the brief. Do not freeze unsatisfactory artwork merely because it took many
calls to produce or because all atlas cells are now present.

The review should identify the baseline, exact candidate, comparison image,
display sizes, observed matches, and unresolved differences. Keep acceptance
pending when a required comparison has not been viewed. A task accepted in
isolation does not establish successful integration; report scene review as
pending until it has happened. The runtime's `accept` command verifies artifact
integrity and stores text; it cannot attest that these visual checks occurred.
