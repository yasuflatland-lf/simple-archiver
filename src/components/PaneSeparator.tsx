import type { PaneSeparatorProps } from "@/hooks/usePaneResize";
import { cn } from "@/lib/utils";

interface Props extends PaneSeparatorProps {
  /** True while a drag is in progress — renders the active highlight. */
  isDragging: boolean;
}

/**
 * The draggable divider between the left rail and the right canvas. It is a thin
 * vertical bar that replaces the rail's former right border: it shows the
 * hairline color at rest, highlights to the primary color on hover, and stays
 * highlighted while dragging. The `col-resize` cursor and the `separator` role
 * communicate the resize affordance.
 *
 * Keyboard interaction is intentionally omitted: the separator is not focusable.
 * It is a non-focusable structural divider (role=separator + aria-orientation +
 * aria-label), so it carries no aria-value* properties — those would imply an
 * operable window-splitter widget the user cannot focus or adjust.
 */
export function PaneSeparator({ isDragging, ...separatorProps }: Props) {
  return (
    <div
      {...separatorProps}
      data-testid="pane-separator"
      data-dragging={isDragging ? "true" : undefined}
      className={cn(
        "w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-border transition-colors hover:bg-primary/70",
        isDragging && "bg-primary",
      )}
    />
  );
}
