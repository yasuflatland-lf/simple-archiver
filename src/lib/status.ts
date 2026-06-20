/**
 * The single bridge between a finished task's outcome (the projection of the
 * backend's terminal TaskStatus, surfaced as the JobSummaryDto arrays
 * (`succeeded`/`cancelled`/`failed`)) and its user-facing presentation: a
 * unified label, the visual status-token classes, and a text icon (so status
 * is never communicated by color alone).
 *
 * Owning this in one place keeps the vocabulary consistent across the summary
 * panel and the per-row task list, and keeps the domain-state → visual-token
 * mapping in exactly one location.
 */
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";

// The three members MUST stay in sync with the keys of the backend `JobSummaryDto`
// (`succeeded` | `cancelled` | `failed`). RunSummary/TaskList pass these as string
// literals, so a renamed or added DTO bucket would silently leave this union stale.
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
