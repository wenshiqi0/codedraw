import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeSync } from "node:fs";

/** Explicitly loaded only for reference tasks; discovered extensions remain disabled. */
export default function referenceGuard(pi: ExtensionAPI): void {
  pi.on("input", (event, context) => {
    const expected = Number(process.env.CODEDRAW_REFERENCE_COUNT);
    const ready = expected > 0 && event.images?.length === expected && context.model?.input.includes("image") === true;
    // Pi routes ordinary stdout to stderr in print mode. This is our small
    // protocol record, so write directly to the JSON stream's descriptor.
    writeSync(1, `${JSON.stringify({ type: "codedraw_reference_check", ready })}\n`);
    // A thrown extension error would be logged and ignored by Pi. Handling the
    // input stops before the provider call; the parent records the failure.
    return { action: ready ? "continue" : "handled" };
  });
}
