/**
 * The single source of truth for "can the user run a job yet?", derived purely
 * from draft state (queued item count + chosen output directory). The backend
 * still owns the real validation; this is only the UI's pre-run readiness gate.
 *
 * Owning the state machine here keeps the readiness chip and the
 * disabled-Run reason — both rendered by RunControls — from drifting apart:
 * both read the same `Readiness` value and map it to their own presentation.
 * The ordered checks (items first, then destination) are encoded once, in
 * `readinessFor`.
 */

import { isValidOutputDir } from "./output-dir-default";

/**
 * What the user still needs to do before a run is possible. `"ready"` is the
 * only state in which Run is enabled.
 */
export type Readiness = "add-files" | "choose-destination" | "ready";

/**
 * Compute readiness from the draft. Item count is checked before the output
 * directory, so an empty queue always reports `"add-files"` first.
 */
export function readinessFor(
  itemCount: number,
  outputDir: string | null,
): Readiness {
  if (itemCount === 0) return "add-files";
  if (!isValidOutputDir(outputDir)) return "choose-destination";
  return "ready";
}

/**
 * Human-readable reason Run is unavailable, shown on hover and to assistive
 * technology. Empty string when ready (Run is enabled, so there is no reason).
 */
const RUN_UNAVAILABLE_REASON: Record<Readiness, string> = {
  "add-files": "Add at least one item",
  "choose-destination": "Choose an output directory",
  ready: "",
};

export function runUnavailableReason(readiness: Readiness): string {
  return RUN_UNAVAILABLE_REASON[readiness];
}
