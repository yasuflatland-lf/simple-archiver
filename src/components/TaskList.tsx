import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import { Progress } from "@/components/ui/progress";
import { formatEta, progressPercent } from "@/lib/format";
import { statusVisual } from "@/lib/status";
import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Shared class strings
// ---------------------------------------------------------------------------

// Base styling shared by every kind badge; the per-kind colors are appended.
const KIND_BADGE_BASE =
  "inline-block rounded px-1.5 py-0.5 text-xs font-medium";
const KIND_BADGE_COLORS = {
  folder: "bg-category-folder-subtle text-category-folder-foreground",
  rar: "bg-category-archive-subtle text-category-archive-foreground",
} as const;

// Styling shared by both reorder buttons (Move up / Move down).
const REORDER_BUTTON_CLASS =
  "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the last path segment of a filesystem path, handling both forward-
 * slash (POSIX) and backslash (Windows) separators.
 */
function basename(path: string): string {
  const segments = path.split(/[/\\]/);
  // Filter empties in case of trailing slashes, then take the last segment.
  const nonEmpty = segments.filter((s) => s.length > 0);
  return nonEmpty[nonEmpty.length - 1] ?? path;
}

/**
 * Compute the display status for a single task at position `index`.
 *
 * Priority:
 * 1. running=true  → bytes from perTask[index] or "Processing"
 * 2. summary≠null  → maps row `index` → taskId via taskIdByIndex[index], then
 *    membership-tests that id against summary.succeeded / summary.cancelled /
 *    summary.failed. This relies on the positional-alignment invariant:
 *    taskIdByIndex is index-aligned with draft.items (position 0 in
 *    taskIdByIndex corresponds to position 0 in draft.items, etc.).
 * 3. default        → "Waiting"
 */
function computeStatus(
  index: number,
  running: boolean,
  progress: ProgressEvent | null,
  summary: JobSummaryDto | null,
  taskIdByIndex: number[],
): string {
  if (running) {
    const entry = progress?.perTask[index];
    if (entry !== undefined) {
      return `${entry.bytesDone} / ${entry.bytesTotal} bytes`;
    }
    return "Processing";
  }

  if (summary !== null) {
    const taskId = taskIdByIndex[index];
    if (taskId === undefined) {
      return "Done";
    }
    if (summary.succeeded.includes(taskId)) {
      return statusVisual("succeeded").label;
    }
    if (summary.cancelled.includes(taskId)) {
      return statusVisual("cancelled").label;
    }
    const failedEntry = summary.failed.find((f) => f.taskId === taskId);
    if (failedEntry !== undefined) {
      return `${statusVisual("failed").label}: ${failedEntry.reason}`;
    }
    return "Done";
  }

  return "Waiting";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * TaskList renders the current draft items with their sequence numbers, kind
 * badges, source basenames, preview output names, status, and reorder buttons.
 */
export function TaskList() {
  const items = useJobStore((s) => s.draft.items);
  const previewNames = useJobStore((s) => s.previewNames);
  const running = useJobStore((s) => s.running);
  const progress = useJobStore((s) => s.progress);
  const summary = useJobStore((s) => s.summary);
  const taskIdByIndex = useJobStore((s) => s.taskIdByIndex);
  const reorder = useJobStore((s) => s.reorder);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No items yet — add files or folders to begin.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-3 w-8">#</th>
            <th className="pb-2 pr-3">Kind</th>
            <th className="pb-2 pr-3">Source</th>
            <th className="pb-2 pr-3">Output</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2">Reorder</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const status = computeStatus(
              i,
              running,
              progress,
              summary,
              taskIdByIndex,
            );
            // While running, a live entry replaces the text status with a bar.
            const liveEntry = running ? progress?.perTask[i] : undefined;
            const outputName = previewNames[i] ?? "";
            const isFirst = i === 0;
            const isLast = i === items.length - 1;

            return (
              <tr
                // rows are a positional, backend-ordered list with no per-row local state;
                // item paths may legitimately duplicate, so index keys are correct here.
                // oxlint-disable-next-line react/no-array-index-key
                key={i}
                className="border-b border-border/50 hover:bg-muted/30 transition-colors"
              >
                {/* Sequence number */}
                <td className="py-2 pr-3 text-muted-foreground font-mono">
                  {i + 1}
                </td>

                {/* Kind badge */}
                <td className="py-2 pr-3">
                  <span
                    className={`${KIND_BADGE_BASE} ${KIND_BADGE_COLORS[item.kind]}`}
                  >
                    {item.kind}
                  </span>
                </td>

                {/* Source basename */}
                <td className="py-2 pr-3 font-mono text-foreground">
                  {basename(item.path)}
                </td>

                {/* Output preview name */}
                <td
                  data-testid={`output-cell-${i}`}
                  className="py-2 pr-3 font-mono text-muted-foreground"
                >
                  {outputName}
                </td>

                {/* Status: live bar + ETA while running, else text status */}
                <td className="py-2 pr-3 text-muted-foreground">
                  {liveEntry ? (
                    <div className="flex min-w-[8rem] flex-col gap-1">
                      <Progress
                        value={progressPercent(
                          liveEntry.bytesDone,
                          liveEntry.bytesTotal,
                        )}
                      />
                      <span className="text-xs">
                        {formatEta(liveEntry.etaMs)}
                      </span>
                    </div>
                  ) : (
                    status
                  )}
                </td>

                {/* Reorder buttons */}
                <td className="py-2">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={isFirst}
                      onClick={() => reorder(i, i - 1)}
                      className={REORDER_BUTTON_CLASS}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={isLast}
                      onClick={() => reorder(i, i + 1)}
                      className={REORDER_BUTTON_CLASS}
                    >
                      ▼
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
