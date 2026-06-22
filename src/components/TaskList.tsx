import { useCallback, useRef, type KeyboardEvent } from "react";

import { ColumnResizeHandle } from "@/components/ColumnResizeHandle";
import {
  ReorderAnimationProvider,
  useReorderAnimation,
} from "@/components/reorder-animation";
import { ReorderDndProvider } from "@/components/reorder-dnd";
import { TASK_COLUMNS } from "@/components/task-columns";
import { TaskRow } from "@/components/TaskRow";
import { useColumnResize } from "@/hooks/useColumnResize";
import { useQueueReorderKeys } from "@/hooks/useQueueReorderKeys";
import { useQueueSelectionKeys } from "@/hooks/useQueueSelectionKeys";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * TaskList renders the table chrome (header row and the empty-state fallback)
 * and delegates each draft item to a memoized {@link TaskRow}. Per-row reads of
 * progress/summary live in the rows, so a high-frequency progress tick only
 * re-renders the rows whose bytes actually changed.
 */
export function TaskList() {
  // Only the item count drives the chrome (header + which rows exist); the rows
  // themselves read everything else they need directly from the store.
  const items = useJobStore((s) => s.draft.items);
  // Column widths are owned here so the hook state survives the empty-state
  // toggle below (the hook must run before any early return).
  const { widths, draggingKey, getSeparatorProps } = useColumnResize();
  // Queue-scoped keyboard shortcuts (select all / delete / clear). Stable across
  // renders, so it is safe to call before the early return below.
  const onSelectionKeys = useQueueSelectionKeys();
  // The table ref lets the reorder animation measure rows; the hook owns the
  // FLIP slide and exposes the animated reorder both reorder paths route through.
  const tableRef = useRef<HTMLTableElement>(null);
  const { animatedReorder, justMovedIndex, liveMessage } =
    useReorderAnimation(tableRef);
  // Arrow keys move the single selected row, routing through the same animated
  // reorder so the slide/settle/announce match drag and the buttons.
  const onReorderKeys = useQueueReorderKeys(animatedReorder);
  // One handler for the grid: the two hooks own disjoint keys (arrows vs
  // select-all/delete/clear), so the order is immaterial.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      onReorderKeys(event);
      onSelectionKeys(event);
    },
    [onReorderKeys, onSelectionKeys],
  );

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No items yet — add files or folders to begin.
      </p>
    );
  }

  // Fixed layout honors the per-column widths exactly; sizing the table to their
  // sum keeps each column predictable and lets the wrapper scroll horizontally
  // when the user widens a column past the canvas.
  const totalWidth = TASK_COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);

  return (
    <ReorderAnimationProvider
      animatedReorder={animatedReorder}
      justMovedIndex={justMovedIndex}
    >
      <ReorderDndProvider>
        {/* The selectable queue: role="grid" + aria-multiselectable + per-row
          aria-selected is the ARIA pattern for row selection, and makes this an
          interactive element so tabIndex/onKeyDown are valid. tabIndex makes it
          focusable — clicking a non-focusable row focuses this nearest focusable
          ancestor — which scopes the shortcuts here so they never hijack Cmd+A /
          Delete inside text inputs. The role lives on this wrapper (not the
          <table>) so the table keeps its native semantics. */}
        <div
          className="overflow-x-auto outline-none"
          role="grid"
          aria-label="Queue rows"
          aria-multiselectable
          aria-keyshortcuts="Control+A Meta+A Delete Backspace"
          tabIndex={0}
          data-testid="queue-region"
          onKeyDown={onKeyDown}
        >
          <table
            ref={tableRef}
            className="text-sm"
            style={{ tableLayout: "fixed", width: totalWidth }}
          >
            <colgroup>
              {TASK_COLUMNS.map((c) => (
                <col key={c.key} style={{ width: widths[c.key] }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {TASK_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={cn("pb-2 pr-3", c.resizable && "relative")}
                  >
                    {c.label}
                    {c.resizable && (
                      <ColumnResizeHandle
                        columnKey={c.key}
                        isDragging={draggingKey === c.key}
                        {...getSeparatorProps(c.key)}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((_item, i) => (
                // rows are a positional, backend-ordered list with no per-row local state;
                // item paths may legitimately duplicate, so index keys are correct here.
                // oxlint-disable-next-line react/no-array-index-key
                <TaskRow index={i} key={i} />
              ))}
            </tbody>
          </table>
        </div>
      </ReorderDndProvider>
      {/* Polite, visually-hidden announcement of the last reorder. `output` has
          an implicit status (polite live) role; aria-live is kept explicit. */}
      <output data-testid="reorder-live" aria-live="polite" className="sr-only">
        {liveMessage}
      </output>
    </ReorderAnimationProvider>
  );
}
