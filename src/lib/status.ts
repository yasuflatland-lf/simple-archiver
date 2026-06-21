/**
 * The single bridge between a finished task's outcome (the projection of the
 * backend's terminal TaskStatus, surfaced as the JobSummaryDto arrays
 * (`succeeded`/`cancelled`/`failed`)) and its user-facing presentation: a
 * unified label, the visual status-token classes, and a text icon (so status
 * is never communicated by color alone).
 *
 * Owning this in one place keeps the vocabulary consistent across the Ledger
 * and the per-row task list, and keeps the domain-state → visual-token mapping
 * in exactly one location.
 */
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import { formatBytes } from "@/lib/format";

// The three members MUST stay in sync with the keys of the backend `JobSummaryDto`
// (`succeeded` | `cancelled` | `failed`) and the `TaskStatusDto` wire union.
// Ledger/TaskList pass these as string literals, so a renamed or added DTO bucket
// would silently leave this union stale.
export type TaskOutcome = "succeeded" | "cancelled" | "failed";

export interface StatusVisual {
  /** User-facing label. The domain terminal state `Completed` is tallied as a
   *  job-level `succeeded`, shown here as "Succeeded". */
  label: string;
  /** Tailwind classes wiring the status color tokens (subtle bg + foreground). */
  className: string;
  /**
   * Text glyph paired with the label so meaning is not color-only; must be a
   * non-empty string (accessibility guarantee: status is never communicated by
   * color alone).
   */
  icon: string;
}

const STATUS_VISUALS: Record<TaskOutcome, StatusVisual> = {
  succeeded: {
    label: "Succeeded",
    className: "bg-status-success-subtle text-status-success-foreground",
    icon: "✓",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-status-warning-subtle text-status-warning-foreground",
    icon: "⚠",
  },
  failed: {
    label: "Failed",
    className: "bg-status-danger-subtle text-status-danger-foreground",
    icon: "✗",
  },
};

/** Resolve the presentation for a task outcome. */
export function statusVisual(outcome: TaskOutcome): StatusVisual {
  return STATUS_VISUALS[outcome];
}

/**
 * The resolved outcome of a single task once a job has finished.
 *
 * It widens the three terminal `TaskOutcome` buckets with two non-bucket
 * states that only exist at the per-row level: `done` (a summary is present but
 * the id is in no bucket) and `pending` (no summary yet — the job has not
 * finished). The `failed` variant carries the verbatim backend reason.
 */
export type TaskOutcomeResult =
  | { kind: "succeeded" }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string }
  | { kind: "done" } // id not found in any summary bucket
  | { kind: "pending" }; // no summary yet (job not finished)

/**
 * Resolve a finished task's outcome from the JobSummaryDto by membership-
 * testing `taskId` against the succeeded/cancelled/failed buckets. Pure: no
 * React/Tauri. `pending` = no summary; `done` = summary present but id in no
 * bucket. This is the single owner of the summary → outcome rule, reused by the
 * per-row task list and the run-summary panel.
 */
export function taskOutcomeFor(
  taskId: number,
  summary: JobSummaryDto | null,
): TaskOutcomeResult {
  if (summary === null) return { kind: "pending" };
  if (summary.succeeded.includes(taskId)) return { kind: "succeeded" };
  if (summary.cancelled.includes(taskId)) return { kind: "cancelled" };
  const failedEntry = summary.failed.find((f) => f.taskId === taskId);
  if (failedEntry !== undefined) {
    return { kind: "failed", reason: failedEntry.reason };
  }
  return { kind: "done" };
}

/**
 * Compute the text display status for a single task at position `index`.
 *
 * Priority:
 * 1. running=true  → bytes from perTask[index], else "Processing". NOTE: when a
 *    per-task entry exists this returns a "<done> / <total> <unit>" string, but
 *    the row renders the live progress bar (not text) whenever an entry exists,
 *    so that bytes string is only displayed in the transient window where
 *    `running` is true yet this row's per-task entry has not arrived — i.e. in
 *    practice only the "Processing" fallback of this branch is ever shown.
 * 2. summary≠null  → maps row `index` → taskId via taskIdByIndex[index], then
 *    membership-tests that id against summary.succeeded / summary.cancelled /
 *    summary.failed. This relies on the positional-alignment invariant:
 *    taskIdByIndex is index-aligned with draft.items (position 0 in
 *    taskIdByIndex corresponds to position 0 in draft.items, etc.).
 * 3. default        → "Waiting"
 *
 * Pure: no React/Tauri. Lives here so the per-row task list selects a flat
 * status string rather than the progress/summary/taskIdByIndex collections.
 */
export function computeStatus(
  index: number,
  running: boolean,
  progress: ProgressEvent | null,
  summary: JobSummaryDto | null,
  taskIdByIndex: number[],
): string {
  if (running) {
    const entry = progress?.perTask[index];
    if (entry !== undefined) {
      return formatBytes(entry.bytesDone, entry.bytesTotal);
    }
    return "Processing";
  }

  if (summary !== null) {
    const taskId = taskIdByIndex[index];
    if (taskId === undefined) {
      return "Done";
    }
    // Delegate the summary → outcome rule to the shared taskOutcomeFor helper so
    // the membership-testing lives in exactly one place; this branch only maps
    // the resolved outcome back to its rendered string.
    const outcome = taskOutcomeFor(taskId, summary);
    switch (outcome.kind) {
      case "succeeded":
        return statusVisual("succeeded").label;
      case "cancelled":
        return statusVisual("cancelled").label;
      case "failed":
        return `${statusVisual("failed").label}: ${outcome.reason}`;
      default:
        // `done` (id in no bucket) and `pending` (no summary) — neither is
        // reachable here (summary is non-null and taskId is defined), but both
        // map to the same "Done" string the original linear scan produced.
        return "Done";
    }
  }

  return "Waiting";
}
