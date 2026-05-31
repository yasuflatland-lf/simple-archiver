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
  zip: "bg-category-archive-subtle text-category-archive-foreground",
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
 * Compute the text display status for a single task at position `index`.
 *
 * Priority:
 * 1. running=true  → bytes from perTask[index], else "Processing". NOTE: when a
 *    per-task entry exists this returns a "<done> / <total> bytes" string, but
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
 * source basename, preview output name, status, and reorder buttons).
 *
 * Per-row isolation: the `useShallow` selector returns ONLY top-level scalars
 * (strings/numbers/booleans) plus the store-stable `reorder` action — never a
 * nested object or whole-collection reference. This matters because the store's
 * `applyProgress` rebuilds the `progress` object (and every `perTask` entry)
 * into fresh references on every tick. Selecting those objects would make
 * `useShallow`'s top-level shallow compare see a changed reference for every row
 * on every tick, re-rendering the entire list. By flattening the item to
 * `path`/`kind`, the live entry to `liveBytesDone`/`liveBytesTotal`/`liveEtaMs`
 * (+`hasLive`), and the text status to a precomputed `status` string, the
 * selected slice compares equal by value when this row's own data is unchanged,
 * so a tick that does not touch this row's bytes/status causes no re-render.
 */
function TaskRowImpl({ index }: TaskRowProps) {
  const row = useJobStore(
    useShallow((s) => {
      const item = s.draft.items[index];
      // While running, this row's own per-task entry drives the live bar.
      // Narrow it to scalars so a tick that does not change this row's bytes
      // leaves the slice value-equal.
      const live = s.running ? (s.progress?.perTask[index] ?? null) : null;
      return {
        // Flatten the row's own item to scalars. `exists` preserves the
        // undefined-item guard without returning the item object itself.
        exists: item !== undefined,
        path: item?.path ?? "",
        kind: item?.kind ?? "folder",
        previewName: s.previewNames[index] ?? "",
        running: s.running,
        hasLive: live !== null,
        liveBytesDone: live?.bytesDone ?? null,
        liveBytesTotal: live?.bytesTotal ?? null,
        liveEtaMs: live?.etaMs ?? null,
        isFirst: index === 0,
        isLast: index === s.draft.items.length - 1,
        // The action reference is stable across renders, so it is safe to
        // return directly for shallow comparison.
        reorder: s.reorder,
        // Compute the text status here so the selector exposes a flat string
        // rather than the progress/summary/taskIdByIndex collections.
        status: computeStatus(
          index,
          s.running,
          s.progress,
          s.summary,
          s.taskIdByIndex,
        ),
      };
    }),
  );

  if (!row.exists) return null;

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      {/* Sequence number */}
      <td className="py-2 pr-3 text-muted-foreground font-mono">{index + 1}</td>

      {/* Kind badge */}
      <td className="py-2 pr-3">
        <span className={`${KIND_BADGE_BASE} ${KIND_BADGE_COLORS[row.kind]}`}>
          {row.kind}
        </span>
      </td>

      {/* Source basename */}
      <td className="py-2 pr-3 font-mono text-foreground">
        {basename(row.path)}
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
        {row.hasLive ? (
          <div className="flex min-w-[8rem] flex-col gap-1">
            <Progress
              value={progressPercent(
                row.liveBytesDone ?? 0,
                row.liveBytesTotal ?? 0,
              )}
            />
            <span className="text-xs">
              {formatBytes(row.liveBytesDone ?? 0, row.liveBytesTotal ?? 0)} ·
              ETA {formatEta(row.liveEtaMs)}
            </span>
          </div>
        ) : (
          row.status
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
