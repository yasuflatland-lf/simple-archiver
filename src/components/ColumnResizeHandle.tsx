import type { TaskColumnKey } from "@/components/task-columns";
import type { ColumnSeparatorProps } from "@/hooks/useColumnResize";
import { cn } from "@/lib/utils";

interface Props extends ColumnSeparatorProps {
  /** Column this handle resizes — used for the test id. */
  columnKey: TaskColumnKey;
  /** True while this column's drag is in progress — renders the highlight. */
  isDragging: boolean;
}

/**
 * The draggable handle on a queue-table column's right edge. It is a thin
 * vertical bar absolutely positioned over the column boundary (its parent `<th>`
 * is `position: relative`). It is invisible at rest so it does not clutter the
 * header, highlights to the primary color on hover, and stays highlighted while
 * dragging. The `col-resize` cursor and the `separator` role communicate the
 * resize affordance.
 *
 * Keyboard interaction is intentionally omitted: like {@link ./PaneSeparator},
 * this is a non-focusable structural divider (role=separator + aria-orientation +
 * aria-label), so it carries no aria-value* properties.
 */
export function ColumnResizeHandle({ columnKey, isDragging, ...props }: Props) {
  return (
    <span
      {...props}
      data-testid={`column-resize-${columnKey}`}
      data-dragging={isDragging ? "true" : undefined}
      className={cn(
        "absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-primary/70",
        isDragging && "bg-primary",
      )}
    />
  );
}
