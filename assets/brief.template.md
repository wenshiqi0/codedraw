# CodeDraw drawing brief

The caller fills this brief from its requirements or existing art specification.
Plain-language requests with equivalent information also work. Refer to existing
rules instead of making the user restate them. Mark an irrelevant rule as not
applicable and explain why; do not invent missing art direction to complete a form.

## Assets and destination

- Subjects and variants:
- Intended scene or interface:
- Export canvas / atlas layout:
- Actual display sizes and scaling behavior:
- Background / transparency:

## Caller-supplied art direction

- Authority: supplied reference image(s), accepted asset(s), or written visual specification:
- Source and version; reference precedence if there are several:
- Project style lock, asset ID, and target frame roles, when applicable:
- Palette and material treatment:
- Perspective, proportions, and relative object scale:
- Edge / outline treatment; logical grid if pixel art:
- Lighting, shadows, and allowed shading effects:
- Detail density at the actual display size:
- Unwanted visual deviations:

## Acceptance and shared baseline

- Observable requirements to check against the authority:
- For a set, representative sample and shared baseline to reuse:
- Target scene or comparison view used to judge the set:
- Accepted baseline PNGs and their display scales for a comparison sheet:
- Text-safe areas, atlas gutters, neutral lighting, or tile seams required by the project:
- Remaining information needed from the caller before drawing:

## Observer's handoff to the artist

- Include the concrete rules resolved from the caller's inputs above.
- Include relevant reusable TypeScript constants/helpers from the established
  baseline directly in this text brief; retain them inside self-contained draw.ts.
- Attach reference PNGs using --reference, or use --style to snapshot the lock,
  adjacent bible, and SHA-checked target images. A path in this text alone is not
  an attachment. The selected Pi model must support images.
- Supply --asset-id with the lock, or an explicit --display-scale and --medium,
  to produce an actual-size display sheet. Use codedraw sheet to compare against
  accepted assets and bind it with accept --comparison after viewing it.
- Deliver self-contained draw.ts executed with Bun, SVG, and PNG preview.
