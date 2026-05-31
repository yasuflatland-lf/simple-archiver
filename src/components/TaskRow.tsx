import { memo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatEta, progressPercent } from "@/lib/format";
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

interface TaskRowProps {
  index: number;
}

/**
 * TaskRow renders a single draft item's row (sequence number, kind badge,
 * source basename, preview output name, status, and reorder buttons). Each row
 * selects only its own slice from the store via `useShallow`, so a high-
 * frequency progress tick only re-renders the rows whose bytes actually
 * changed rather than the whole list.
 */
function TaskRowImpl({ index }: TaskRowProps) {
  const row = useJobStore(
    useShallow((s) => ({
      item: s.draft.items[index],
      previewName: s.previewNames[index] ?? "",
      running: s.running,
      // While running, the live per-task entry replaces the text status with
      // a bar. Selecting only this row's entry keeps each row independent.
      live: s.running ? (s.progress?.perTask[index] ?? null) : null,
      isFirst: index === 0,
      isLast: index === s.draft.items.length - 1,
      reorder: s.reorder,
      // Text status (Waiting / Processing / summary outcome) is computed from
      // the slices below; pulled in here so the row recomputes when they change.
      progress: s.progress,
      summary: s.summary,
      taskIdByIndex: s.taskIdByIndex,
    })),
  );

  if (row.item === undefined) return null;

  const status = computeStatus(
    index,
    row.running,
    row.progress,
    row.summary,
    row.taskIdByIndex,
  );

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      {/* Sequence number */}
      <td className="py-2 pr-3 text-muted-foreground font-mono">{index + 1}</td>

      {/* Kind badge */}
      <td className="py-2 pr-3">
        <span
          className={`${KIND_BADGE_BASE} ${KIND_BADGE_COLORS[row.item.kind]}`}
        >
          {row.item.kind}
        </span>
      </td>

      {/* Source basename */}
      <td className="py-2 pr-3 font-mono text-foreground">
        {basename(row.item.path)}
      </td>

      {/* Output preview name */}
      <td
        data-testid={`output-cell-${index}`}
        className="py-2 pr-3 font-mono text-muted-foreground"
      >
        {row.previewName}
      </td>

      {/* Status: live bar + ETA while running, else text status */}
      <td className="py-2 pr-3 text-muted-foreground">
        {row.live ? (
          <div className="flex min-w-[8rem] flex-col gap-1">
            <Progress
              value={progressPercent(row.live.bytesDone, row.live.bytesTotal)}
            />
            <span className="text-xs">
              {formatBytes(row.live.bytesDone, row.live.bytesTotal)} · ETA{" "}
              {formatEta(row.live.etaMs)}
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
            disabled={row.isFirst || row.running}
            onClick={() => row.reorder(index, index - 1)}
            className={REORDER_BUTTON_CLASS}
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={row.isLast || row.running}
            onClick={() => row.reorder(index, index + 1)}
            className={REORDER_BUTTON_CLASS}
          >
            ▼
          </button>
        </div>
      </td>
    </tr>
  );
}

export const TaskRow = memo(TaskRowImpl);
