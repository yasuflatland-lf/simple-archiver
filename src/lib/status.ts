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
