import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { ColumnContentMeasurer } from "@/components/column-measure";
import { domColumnMeasurer } from "@/components/column-measure";
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

interface TaskListProps {
  /** How a column's content width is measured for auto-fit (injectable for tests). */
  measurer?: ColumnContentMeasurer;
  /** The vertical scroller wrapping the queue; enables drag edge auto-scroll. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

/**
 * TaskList renders the table chrome (header row and the empty-state fallback)
 * and delegates each draft item to a memoized {@link TaskRow}. Per-row reads of
 * progress/summary live in the rows, so a high-frequency progress tick only
 * re-renders the rows whose bytes actually changed.
 */
export function TaskList({
  measurer = domColumnMeasurer,
  scrollContainerRef,
}: TaskListProps = {}) {
  // Only the item count drives the chrome (header + which rows exist); the rows
  // themselves read everything else they need directly from the store.
  const items = useJobStore((s) => s.draft.items);
  // The table ref is shared by the reorder animation (which measures rows for the
  // FLIP slide) and the column sizing (which measures cell content to auto-fit).
  const tableRef = useRef<HTMLTableElement>(null);
  // Column widths are owned here so the hook state survives the empty-state
  // toggle below (the hook must run before any early return).
  const { widths, draggingKey, getSeparatorProps, fitAll } = useColumnResize({
    tableRef,
    measurer,
  });
  // Queue-scoped keyboard shortcuts (select all / delete / clear). Stable across
  // renders, so it is safe to call before the early return below.
  const onSelectionKeys = useQueueSelectionKeys();
  const {
    animatedReorder,
    animatedMoveSelected,
    animatedMoveSelectedTo,
    justMovedIndex,
    liveMessage,
  } = useReorderAnimation(tableRef);
  // Arrow keys move the selected row(s): a single selection routes through the
  // single animated reorder, a multi-row selection through the grouped shift, so
  // the slide/settle/announce match drag and the buttons either way.
  const onReorderKeys = useQueueReorderKeys(
    animatedReorder,
    animatedMoveSelected,
  );
  // One handler for the grid: the two hooks own disjoint keys (arrows vs
  // select-all/delete/clear), so the order is immaterial.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      onReorderKeys(event);
      onSelectionKeys(event);
    },
    [onReorderKeys, onSelectionKeys],
  );

  // Auto-fit columns to their content after the rows render, and again whenever
  // the item set changes (add / remove). Columns the user has manually resized
  // are left pinned by the hook; in environments without layout (jsdom) the
  // measurer reports nothing and this is a no-op, so widths stay at their default.
  useEffect(() => {
    fitAll();
  }, [items.length, fitAll]);

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
      animatedMoveSelected={animatedMoveSelected}
      animatedMoveSelectedTo={animatedMoveSelectedTo}
      justMovedIndex={justMovedIndex}
    >
      <ReorderDndProvider scrollContainerRef={scrollContainerRef}>
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
