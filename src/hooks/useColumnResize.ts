import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef, useState } from "react";

import type { TaskColumnKey } from "@/components/task-columns";
import {
  clampColumnWidth,
  COLUMN_BY_KEY,
  TASK_COLUMNS,
} from "@/components/task-columns";

/** ARIA + pointer handlers a column's resize handle spreads to become draggable. */
export interface ColumnSeparatorProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onLostPointerCapture: (event: ReactPointerEvent) => void;
  onDoubleClick: () => void;
}

export interface ColumnResize {
  /** Current width per column key, in px, each clamped to its own bounds. */
  widths: Record<TaskColumnKey, number>;
  /** The column currently being dragged, or null when no drag is in progress. */
  draggingKey: TaskColumnKey | null;
  /** Build the props to spread onto a column's right-edge resize handle. */
  getSeparatorProps: (key: TaskColumnKey) => ColumnSeparatorProps;
}

/** Seed every column to its configured default width. */
function defaultWidths(): Record<TaskColumnKey, number> {
  return Object.fromEntries(
    TASK_COLUMNS.map((c) => [c.key, c.defaultWidth]),
  ) as Record<TaskColumnKey, number>;
}

/**
 * Owns the per-column widths of the queue table: a pointer-drag resize on each
 * resizable column's right edge and a double-click reset to its default. Each
 * column is clamped to its own [minWidth, MAX_COLUMN_WIDTH] range and the
 * columns are independent — dragging one never moves another.
 *
 * Widths live only in component state for the current session; nothing is
 * persisted, so a restart returns every column to its default. The drag is
 * tracked relative to its origin (pointer X and column width at pointerdown),
 * so it is robust regardless of where the handle sits. Pointer capture keeps the
 * gesture flowing even when the cursor leaves the thin handle; environments
 * without it (e.g. jsdom) simply skip it. Teardown is shared by pointerup,
 * pointercancel, and lost capture, and a move with no button held self-heals, so
 * a drag can never get stuck active.
 */
export function useColumnResize(): ColumnResize {
  const [widths, setWidths] =
    useState<Record<TaskColumnKey, number>>(defaultWidths);
  const [draggingKey, setDraggingKey] = useState<TaskColumnKey | null>(null);
  // Drag origin captured at pointerdown; null when no drag is in progress.
  const dragOrigin = useRef<{
    key: TaskColumnKey;
    pointerX: number;
    width: number;
  } | null>(null);
  // Mirror the latest widths so a pointerdown can read the starting width
  // without re-creating the handlers on every drag frame.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const endDrag = useCallback(() => {
    if (dragOrigin.current === null) return;
    dragOrigin.current = null;
    setDraggingKey(null);
  }, []);

  const getSeparatorProps = useCallback(
    (key: TaskColumnKey): ColumnSeparatorProps => {
      const def = COLUMN_BY_KEY[key];
      return {
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": `Resize ${def.label} column`,
        onPointerDown: (event) => {
          event.preventDefault();
          dragOrigin.current = {
            key,
            pointerX: event.clientX,
            width: widthsRef.current[key],
          };
          setDraggingKey(key);
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch (reason) {
            // Pointer capture is unsupported in some environments (e.g. jsdom);
            // the origin-relative math still tracks the drag, so ignore it.
            void reason;
          }
        },
        onPointerMove: (event) => {
          const origin = dragOrigin.current;
          if (origin === null || origin.key !== key) return;
          // Self-heal a stuck drag: a move with no button held (interrupted
          // gesture / lost capture) ends the drag instead of resizing on hover.
          if (event.buttons === 0) {
            endDrag();
            return;
          }
          const next = clampColumnWidth(
            def,
            origin.width + (event.clientX - origin.pointerX),
          );
          setWidths((prev) => ({ ...prev, [key]: next }));
        },
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onLostPointerCapture: endDrag,
        onDoubleClick: () => {
          setWidths((prev) => ({ ...prev, [key]: def.defaultWidth }));
        },
      };
    },
    [endDrag],
  );

  return { widths, draggingKey, getSeparatorProps };
}
