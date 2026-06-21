import { outputNameForTask, statusVisual } from "@/lib/status";
import { useJobStore } from "@/store/jobStore";

/**
 * RunSummary is the completion panel shown after a job finishes. It is a pure
 * projection of the backend JobSummaryDto: counts are array lengths (never
 * recomputed on the client) and failure reasons come verbatim from the summary.
 * Renders nothing until a summary exists.
 */
export function RunSummary() {
  const summary = useJobStore((s) => s.summary);
  const previewNames = useJobStore((s) => s.previewNames);
  const taskIdByIndex = useJobStore((s) => s.taskIdByIndex);

  if (summary === null) return null;

  const counts = [
    { visual: statusVisual("succeeded"), n: summary.succeeded.length },
    { visual: statusVisual("cancelled"), n: summary.cancelled.length },
    { visual: statusVisual("failed"), n: summary.failed.length },
  ];

  // <output> carries an implicit ARIA role of "status" (and implicit aria-live),
  // so the panel is announced to assistive tech and tests resolve it via
  // getByRole("status"); keep this an <output> when refactoring.
  return (
    <output
      aria-live="polite"
      aria-label="Run summary"
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 text-sm"
    >
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Run summary
      </h2>

      <div className="flex flex-wrap gap-2">
        {counts.map(({ visual, n }) => (
          <span
            key={visual.label}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium ${visual.className}`}
          >
            <span aria-hidden="true">{visual.icon}</span>
            {visual.label} {n}
          </span>
        ))}
      </div>

      {summary.failed.length > 0 && (
        <details open className="flex flex-col gap-1">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Errors
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {summary.failed.map((f) => (
              <li
                key={f.taskId}
                className="font-mono text-status-danger-foreground"
              >
                {outputNameForTask(f.taskId, previewNames, taskIdByIndex)} —{" "}
                {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </output>
  );
}
