import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useRef, useState } from "react";

import type { ColumnContentMeasurer } from "@/components/column-measure";
import { domColumnMeasurer } from "@/components/column-measure";
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
  /** Fit one resizable column to its content width and un-pin it (double-click). */
  fitColumn: (key: TaskColumnKey) => void;
  /** Fit every resizable column not pinned by a manual drag to its content. */
  fitAll: () => void;
}

interface UseColumnResizeOptions {
  /** The table to measure when fitting columns to content. */
  tableRef?: RefObject<HTMLTableElement | null>;
  /** How a column's intrinsic content width is measured (injectable for tests). */
  measurer?: ColumnContentMeasurer;
}

/** Seed every column to its configured default width. */
function defaultWidths(): Record<TaskColumnKey, number> {
  return Object.fromEntries(
    TASK_COLUMNS.map((c) => [c.key, c.defaultWidth]),
  ) as Record<TaskColumnKey, number>;
}

/** Position of a column key within the render-ordered TASK_COLUMNS list. */
function columnIndexOf(key: TaskColumnKey): number {
  return TASK_COLUMNS.findIndex((c) => c.key === key);
}

/**
 * Measure a column's content and clamp it to the column's bounds, or null when
 * the measurer cannot measure (no layout / no cell) so callers leave it as-is.
 */
function fitWidthFor(
  table: HTMLTableElement,
  key: TaskColumnKey,
  measurer: ColumnContentMeasurer,
): number | null {
  const measured = measurer.measure(table, columnIndexOf(key));
  return measured === null
    ? null
    : clampColumnWidth(COLUMN_BY_KEY[key], measured);
}

/**
 * Owns the per-column widths of the queue table. Columns auto-fit to their
 * content (via {@link ColumnResize.fitAll}, driven by the consumer on mount /
 * item changes), and the user can still drag a resizable column's right edge to
 * a custom width or double-click its handle to re-fit it. Each column is clamped
 * to its own [minWidth, MAX_COLUMN_WIDTH] range and the columns are independent
 * — dragging one never moves another.
 *
 * Manual drags **pin** a column: once dragged, it is left alone by auto-fit so a
 * later item change does not undo the user's width. A double-click on the handle
 * re-fits the column to its content and un-pins it, returning it to auto-fit.
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
export function useColumnResize(
  options: UseColumnResizeOptions = {},
): ColumnResize {
  const { tableRef, measurer = domColumnMeasurer } = options;
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

  // Columns the user has manually resized. Auto-fit leaves these alone until a
  // double-click re-fits and un-pins them. A ref (not state) because it only
  // gates the fit callbacks — it never needs to drive a render.
  const overridesRef = useRef<Set<TaskColumnKey>>(new Set());

  const endDrag = useCallback(() => {
    if (dragOrigin.current === null) return;
    dragOrigin.current = null;
    setDraggingKey(null);
  }, []);

  // Fit a single resizable column to its content and un-pin it. Used by the
  // handle's double-click; non-resizable columns and unmeasurable widths no-op.
  const fitColumn = useCallback(
    (key: TaskColumnKey) => {
      if (!COLUMN_BY_KEY[key].resizable) return;
      const table = tableRef?.current;
      if (!table) return;
      const next = fitWidthFor(table, key, measurer);
      if (next === null) return;
      setWidths((prev) => ({ ...prev, [key]: next }));
      overridesRef.current.delete(key);
    },
    [tableRef, measurer],
  );

  // Fit every resizable, non-pinned column to its content in one batched update.
  const fitAll = useCallback(() => {
    const table = tableRef?.current;
    if (!table) return;
    setWidths((prev) => {
      const next = { ...prev };
      for (const c of TASK_COLUMNS) {
        if (!c.resizable || overridesRef.current.has(c.key)) continue;
        const fitted = fitWidthFor(table, c.key, measurer);
        if (fitted !== null) next[c.key] = fitted;
      }
      return next;
    });
  }, [tableRef, measurer]);

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
          // A manual resize pins the column against later auto-fit passes.
          overridesRef.current.add(key);
        },
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onLostPointerCapture: endDrag,
        // Double-click the handle to re-fit the column to its content.
        onDoubleClick: () => fitColumn(key),
      };
    },
    [endDrag, fitColumn],
  );

  return { widths, draggingKey, getSeparatorProps, fitColumn, fitAll };
}
