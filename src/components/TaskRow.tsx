import { GripVertical, Trash2 } from "lucide-react";
import { memo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { SourceKind } from "@/bindings/SourceKind";
import { useReorderRow } from "@/components/reorder-dnd";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatEta, progressPercent } from "@/lib/format";
import { basename } from "@/lib/path";
import { computeStatus } from "@/lib/status";
import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Shared class strings
// ---------------------------------------------------------------------------

// Base styling shared by every kind badge; the per-kind colors are appended.
const KIND_BADGE_BASE =
  "inline-block rounded px-1.5 py-0.5 text-xs font-medium";
const KIND_BADGE_COLORS: Record<SourceKind, string> = {
  folder: "bg-category-folder-subtle text-category-folder-foreground",
  rar: "bg-category-archive-subtle text-category-archive-foreground",
  zip: "bg-category-archive-subtle text-category-archive-foreground",
};

// Styling shared by both reorder buttons (Move up / Move down).
const REORDER_BUTTON_CLASS =
  "rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

// The delete button reuses REORDER_BUTTON_CLASS for size/weight parity with its
// column mates, but its danger color appears only on hover so a resting row
// stays calm. The extra left margin sets it apart from "Move down" to reduce
// mis-clicks.
const DELETE_BUTTON_CLASS = `${REORDER_BUTTON_CLASS} ml-1.5 hover:text-status-danger-foreground`;

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
        // Same stability guarantee as `reorder`, safe for the shallow compare.
        removeItem: s.removeItem,
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

  // Drag-and-drop reorder wiring. The dragged/drop-target flags re-render this
  // row during an active drag only; a drag never overlaps a running job, so
  // this does not interact with the per-tick render isolation above.
  const dnd = useReorderRow(index);

  if (!row.exists) return null;

  // Build the live label as one string so JSX whitespace folding / prettier
  // reflow cannot strip the right-align padding spaces formatBytes emits.
  const liveLabel = `${formatBytes(row.liveBytesDone ?? 0, row.liveBytesTotal ?? 0)} · ETA ${formatEta(row.liveEtaMs)}`;

  // Drag affordances: dim the row being dragged; draw a 2px insertion line on the
  // edge where the row would land. A box-shadow (not a real element) avoids table
  // layout shift. The grab cursor lives on the grip; the whole-row drag cursor is
  // added in the row-body task.
  const rowClassName = [
    "border-b border-border/50 transition-colors",
    dnd.isDragging ? "opacity-40" : "hover:bg-muted/30",
    dnd.dropEdge === "top" && "shadow-[inset_0_2px_0_0_var(--color-primary)]",
    dnd.dropEdge === "bottom" &&
      "shadow-[inset_0_-2px_0_0_var(--color-primary)]",
    // Suppress text selection across the list while any row is being dragged.
    dnd.isDraggingAny && "select-none",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr
      {...dnd.rowProps}
      data-dragging={dnd.isDragging || undefined}
      data-drop-edge={dnd.dropEdge ?? undefined}
      className={rowClassName}
    >
      {/* Drag column: the grip is the explicit reorder signifier. Pointer-based (not
          HTML5) so it survives Tauri's webview drag-drop handler; keyboard users
          reorder with the up/down buttons, so the grip stays aria-hidden. `touch-none`
          keeps a touch drag from scrolling the list; `select-none` keeps the press
          from starting a text selection (mirrors PaneSeparator). */}
      <td className="py-2 pl-1">
        <span
          {...dnd.handleProps}
          data-testid={`reorder-handle-${index}`}
          data-reorder-handle
          data-disabled={!dnd.enabled || undefined}
          aria-hidden
          className={`flex items-center justify-center touch-none select-none transition-colors ${
            dnd.enabled
              ? "cursor-grab active:cursor-grabbing text-muted-foreground/70 hover:text-foreground"
              : "cursor-not-allowed text-muted-foreground/40"
          }`}
        >
          <GripVertical className="size-4 shrink-0" />
        </span>
      </td>

      {/* Sequence number */}
      <td className="py-2 pr-3 text-muted-foreground font-mono">{index + 1}</td>

      {/* Kind badge */}
      <td className="py-2 pr-3">
        <span className={`${KIND_BADGE_BASE} ${KIND_BADGE_COLORS[row.kind]}`}>
          {row.kind}
        </span>
      </td>

      {/* Source basename — break long names so they wrap within the column's
          fixed width instead of forcing it wider. */}
      <td className="py-2 pr-3 font-mono text-foreground break-words">
        {basename(row.path)}
      </td>

      {/* Output preview name */}
      <td
        data-testid={`output-cell-${index}`}
        className="py-2 pr-3 font-mono text-muted-foreground break-words"
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
            {/* Monospace + whitespace-pre give every glyph (including the
                right-align padding spaces from formatBytes) a constant width,
                so the line does not jitter per tick as done grows. */}
            <span className="text-xs font-mono whitespace-pre">
              {liveLabel}
            </span>
          </div>
        ) : (
          row.status
        )}
      </td>

      {/* Actions: keyboard-accessible up/down buttons + delete */}
      <td className="py-2">
        <div className="flex items-center gap-1">
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
          {/* Delete: removes this single row. Disabled while running because
              dropping a row mid-run would desync the positional progress
              arrays. Enabled even when it is the only remaining row. */}
          <button
            type="button"
            aria-label={`Remove ${basename(row.path)} from queue`}
            disabled={row.running}
            onClick={() => row.removeItem(index)}
            className={DELETE_BUTTON_CLASS}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export const TaskRow = memo(TaskRowImpl);
