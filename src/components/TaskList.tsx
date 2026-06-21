import { ColumnResizeHandle } from "@/components/ColumnResizeHandle";
import { ReorderDndProvider } from "@/components/reorder-dnd";
import { TASK_COLUMNS } from "@/components/task-columns";
import { TaskRow } from "@/components/TaskRow";
import { useColumnResize } from "@/hooks/useColumnResize";
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
    <ReorderDndProvider>
      <div className="overflow-x-auto">
        <table
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
  );
}
