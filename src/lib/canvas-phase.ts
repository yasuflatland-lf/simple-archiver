/**
 * The phase the right canvas renders, derived purely from store-shaped state.
 * The canvas "morphs" through these phases across the job lifecycle:
 *   empty   → no items queued yet (the drop zone),
 *   queued  → items waiting, no run started (the task list),
 *   running → a job is in flight (overall progress + the task list),
 *   results → a finished job's summary is present.
 */
export type CanvasPhase = "empty" | "queued" | "running" | "results";

/**
 * Compute the canvas phase from the draft/job state. Precedence is
 * running > results > queued > empty: an in-flight run always wins, then a
 * finished summary, then a non-empty queue, falling back to the empty state.
 */
export function canvasPhase(s: {
  itemCount: number;
  running: boolean;
  hasSummary: boolean;
}): CanvasPhase {
  if (s.running) return "running";
  if (s.hasSummary) return "results";
  if (s.itemCount > 0) return "queued";
  return "empty";
}
