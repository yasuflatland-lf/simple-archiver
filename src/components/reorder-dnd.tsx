import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  useAnimatedMoveSelectedTo,
  useAnimatedReorder,
} from "@/components/reorder-animation";
import { useJobStore } from "@/store/jobStore";

type RowPointerEvent = ReactPointerEvent<HTMLElement>;

/** Smallest pointer travel (px) that turns a row-body press into a drag. */
const DRAG_THRESHOLD_PX = 5;

interface ReorderDndContextValue {
  enabled: boolean;
  draggingIndex: number | null;
  /** Insertion gap g in [0, count]: the dragged row lands before row g. */
  overGap: number | null;
  count: number;
  startImmediate: (index: number, event: RowPointerEvent) => void;
  startDeferred: (index: number, event: RowPointerEvent) => void;
  pointerMoveOnRow: (index: number, event: RowPointerEvent) => void;
  drop: () => void;
}

const ReorderDndContext = createContext<ReorderDndContextValue | null>(null);

/**
 * ReorderDndProvider owns the ephemeral drag state (which row is being dragged,
 * which insertion gap is the current drop target) and translates a pointer-drag
 * gesture into a single `reorder(from, to)` store action.
 *
 * Pointer events — not HTML5 drag-and-drop — drive the gesture on purpose: the
 * app needs Tauri's native webview drag-drop handler enabled so files/folders
 * can be dropped onto the window to be added (see {@link useFileDrop}), and that
 * handler intercepts native drag gestures over the webview, so the DOM `drop`
 * event never fires for in-page HTML5 dragging. Pointer events are not
 * intercepted, so reordering works alongside the file-drop affordance. This also
 * mirrors how the pane divider drag is implemented (`usePaneResize`).
 *
 * The state lives here rather than in the global job store because it is purely
 * transient UI state; it is only observed by the rows during an active drag,
 * which never overlaps a running job (reordering is disabled then).
 */
export function ReorderDndProvider({ children }: { children: ReactNode }) {
  const running = useJobStore((s) => s.running);
  const animatedReorder = useAnimatedReorder();
  const animatedMoveSelectedTo = useAnimatedMoveSelectedTo();
  const count = useJobStore((s) => s.draft.items.length);

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overGap, setOverGap] = useState<number | null>(null);
  // Mirror the active drag source and gap synchronously so the pointer handlers
  // (and the window-level teardown) read them without waiting for a state flush.
  const draggingRef = useRef<number | null>(null);
  const overGapRef = useRef<number | null>(null);
  // Origin of a row-body press that has not yet passed the drag threshold.
  const pendingRef = useRef<{ index: number; x: number; y: number } | null>(
    null,
  );

  const enabled = !running;

  const reset = useCallback(() => {
    draggingRef.current = null;
    overGapRef.current = null;
    pendingRef.current = null;
    setDraggingIndex(null);
    setOverGap(null);
  }, []);

  const arm = useCallback((index: number) => {
    pendingRef.current = null;
    draggingRef.current = index;
    setDraggingIndex(index);
  }, []);

  // Grip handle: there is nothing to click or select there, so start at once.
  const startImmediate = useCallback(
    (index: number, event: RowPointerEvent) => {
      if (!enabled) return;
      event.preventDefault();
      arm(index);
    },
    [enabled, arm],
  );

  // Row body: record the origin but defer arming until the pointer moves past the
  // threshold, so a plain click or a text selection is not mistaken for a drag.
  const startDeferred = useCallback(
    (index: number, event: RowPointerEvent) => {
      if (!enabled) return;
      pendingRef.current = { index, x: event.clientX, y: event.clientY };
    },
    [enabled],
  );

  const pointerMoveOnRow = useCallback(
    (index: number, event: RowPointerEvent) => {
      // Do nothing while reordering is disabled; a pending press must not arm
      // into a drag mid-run even if the pointer has traveled far enough.
      if (!enabled) return;
      // Promote a pending row-body press to a real drag once it passes threshold.
      const pending = pendingRef.current;
      if (pending && draggingRef.current === null) {
        const moved = Math.hypot(
          event.clientX - pending.x,
          event.clientY - pending.y,
        );
        if (moved < DRAG_THRESHOLD_PX) return;
        // Cancel any nascent native text-selection now that this is a drag.
        event.preventDefault();
        arm(pending.index);
      }
      if (draggingRef.current === null) return;
      // Insert-above when the pointer is in the row's upper half, else below.
      const rect = event.currentTarget.getBoundingClientRect();
      const gap =
        event.clientY < rect.top + rect.height / 2 ? index : index + 1;
      overGapRef.current = gap;
      setOverGap(gap);
    },
    [enabled, arm],
  );

  const drop = useCallback(() => {
    const from = draggingRef.current;
    const gap = overGapRef.current;
    if (from !== null && gap !== null && enabled) {
      const { selectedIndices } = useJobStore.getState();
      if (selectedIndices.length > 1 && selectedIndices.includes(from)) {
        // Dragging any row of a multi-row selection relocates the WHOLE
        // selection to the drop gap; the store gathers it into a contiguous
        // block (a no-op when the gap falls inside that block).
        void animatedMoveSelectedTo(gap);
      } else {
        // Single-row drag: reorder is remove-then-insert, so removing `from`
        // shifts every gap after it left by one — a gap past `from` maps to
        // `gap - 1`.
        const to = gap <= from ? gap : gap - 1;
        if (to !== from) void animatedReorder(from, to);
      }
    }
    reset();
  }, [enabled, animatedReorder, animatedMoveSelectedTo, reset]);

  // End the gesture on any release/cancel anywhere so a drag never gets stuck.
  // A still-pending (un-armed) press needs no window backstop: the row's own
  // onPointerUp -> drop() clears it, and the next press overwrites pendingRef.
  useEffect(() => {
    if (draggingIndex === null) return;
    const end = () => reset();
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [draggingIndex, reset]);

  const value = useMemo<ReorderDndContextValue>(
    () => ({
      enabled,
      draggingIndex,
      overGap,
      count,
      startImmediate,
      startDeferred,
      pointerMoveOnRow,
      drop,
    }),
    [
      enabled,
      draggingIndex,
      overGap,
      count,
      startImmediate,
      startDeferred,
      pointerMoveOnRow,
      drop,
    ],
  );

  return (
    <ReorderDndContext.Provider value={value}>
      {children}
    </ReorderDndContext.Provider>
  );
}

type DropEdge = "top" | "bottom" | null;

interface ReorderRow {
  enabled: boolean;
  isDragging: boolean;
  isDraggingAny: boolean;
  /** Which edge of this row to paint the insertion line on, if any. */
  dropEdge: DropEdge;
  handleProps: { onPointerDown: (event: RowPointerEvent) => void };
  rowProps: {
    onPointerDown: (event: RowPointerEvent) => void;
    onPointerMove: (event: RowPointerEvent) => void;
    onPointerUp: () => void;
  };
}

// Fallback for a row rendered outside a provider (e.g. an isolated unit test):
// the row is simply not reorderable; its up/down buttons still work.
const NON_DRAGGABLE_ROW: ReorderRow = {
  enabled: false,
  isDragging: false,
  isDraggingAny: false,
  dropEdge: null,
  handleProps: { onPointerDown: () => {} },
  rowProps: {
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
  },
};

/**
 * useReorderRow returns the pointer props and visual flags for the row at
 * `index`. Outside a {@link ReorderDndProvider} the row falls back to
 * non-draggable.
 */
export function useReorderRow(index: number): ReorderRow {
  const ctx = useContext(ReorderDndContext);
  if (ctx === null) return NON_DRAGGABLE_ROW;
  const {
    enabled,
    draggingIndex,
    overGap,
    count,
    startImmediate,
    startDeferred,
    pointerMoveOnRow,
    drop,
  } = ctx;

  // Interior gap g renders as row g's top edge; the trailing gap (== count)
  // renders as the last row's bottom edge, so each gap draws exactly one line.
  // The dragged row itself never shows an insertion line (it is already dimmed).
  const isLast = index === count - 1;
  const dropEdge: DropEdge =
    overGap === null || draggingIndex === index
      ? null
      : overGap === index
        ? "top"
        : isLast && overGap === index + 1
          ? "bottom"
          : null;

  return {
    enabled,
    isDragging: draggingIndex === index,
    isDraggingAny: draggingIndex !== null,
    dropEdge,
    handleProps: {
      onPointerDown: (event) => startImmediate(index, event),
    },
    rowProps: {
      onPointerDown: (event) => {
        // The grip starts its own immediate drag, and the action buttons must
        // stay clickable; exclude both so a row-body press never double-fires.
        const target = event.target as HTMLElement;
        if (target.closest("button, a, input, [data-reorder-handle]")) return;
        startDeferred(index, event);
      },
      onPointerMove: (event) => pointerMoveOnRow(index, event),
      onPointerUp: () => drop(),
    },
  };
}
