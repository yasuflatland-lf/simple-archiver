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

import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type RowPointerEvent = ReactPointerEvent<HTMLElement>;

interface ReorderDndContextValue {
  /** Whether rows may be reordered at all (false while a job is running). */
  enabled: boolean;
  /** Index of the row currently being dragged, or null. */
  draggingIndex: number | null;
  /** Index of the row currently hovered as the drop target, or null. */
  overIndex: number | null;
  start: (index: number, event: RowPointerEvent) => void;
  over: (index: number) => void;
  drop: (index: number) => void;
}

const ReorderDndContext = createContext<ReorderDndContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ReorderDndProvider owns the ephemeral drag state (which row is being dragged,
 * which row is the current drop target) and translates a pointer-drag gesture
 * into a single `reorder(from, to)` store action.
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
  const reorder = useJobStore((s) => s.reorder);

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  // Mirror the active drag source synchronously so the pointer handlers (and the
  // window-level teardown below) read it without waiting for a state flush.
  const draggingRef = useRef<number | null>(null);

  const enabled = !running;

  const reset = useCallback(() => {
    draggingRef.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }, []);

  const start = useCallback(
    (index: number, event: RowPointerEvent) => {
      // Guard so a stray pointerdown can never begin a drag mid-run.
      if (!enabled) return;
      // Stop the press from starting a text selection while dragging.
      event.preventDefault();
      draggingRef.current = index;
      setDraggingIndex(index);
    },
    [enabled],
  );

  const over = useCallback((index: number) => {
    // Only track a hover target while a drag is actually in progress.
    if (draggingRef.current === null) return;
    setOverIndex(index);
  }, []);

  const drop = useCallback(
    (index: number) => {
      const from = draggingRef.current;
      // Dropping a row onto index `to` lands it exactly at `to` (the store's
      // reorder is a remove-then-insert), so the drop target index maps
      // directly to the destination. Skip no-op and mid-run drops.
      if (from !== null && from !== index && enabled) {
        void reorder(from, index);
      }
      reset();
    },
    [enabled, reorder, reset],
  );

  // End the gesture on any pointer release (or cancel) anywhere, so a release
  // off the rows — or an OS-interrupted drag — never leaves a row stuck in the
  // dragging state. A drop onto a row resets first (React's root handler runs
  // before this window listener), so this is the idempotent backstop.
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
    () => ({ enabled, draggingIndex, overIndex, start, over, drop }),
    [enabled, draggingIndex, overIndex, start, over, drop],
  );

  return (
    <ReorderDndContext.Provider value={value}>
      {children}
    </ReorderDndContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Row consumer hook
// ---------------------------------------------------------------------------

interface ReorderRow {
  /** Whether this row's grip handle may start a drag. */
  enabled: boolean;
  isDragging: boolean;
  isOver: boolean;
  /** Whether any row is currently being dragged (drives drag-wide styling). */
  isDraggingAny: boolean;
  /** Props for the grip handle that starts a drag. */
  handleProps: {
    onPointerDown: (event: RowPointerEvent) => void;
  };
  /** Props for the row element that acts as a drop target. */
  rowProps: {
    onPointerMove: () => void;
    onPointerUp: () => void;
  };
}

// Fallback for a row rendered outside a provider (e.g. an isolated unit test):
// the row is simply not reorderable; its up/down buttons still work.
const NON_DRAGGABLE_ROW: ReorderRow = {
  enabled: false,
  isDragging: false,
  isOver: false,
  isDraggingAny: false,
  handleProps: { onPointerDown: () => {} },
  rowProps: { onPointerMove: () => {}, onPointerUp: () => {} },
};

/**
 * useReorderRow returns the pointer props and visual flags for the row at
 * `index`. Outside a {@link ReorderDndProvider} the row falls back to
 * non-draggable.
 */
export function useReorderRow(index: number): ReorderRow {
  const ctx = useContext(ReorderDndContext);
  if (ctx === null) {
    return NON_DRAGGABLE_ROW;
  }
  const { enabled, draggingIndex, overIndex, start, over, drop } = ctx;
  return {
    enabled,
    isDragging: draggingIndex === index,
    // The dragged row is never its own drop target.
    isOver: overIndex === index && draggingIndex !== index,
    isDraggingAny: draggingIndex !== null,
    handleProps: {
      onPointerDown: (event) => start(index, event),
    },
    rowProps: {
      onPointerMove: () => over(index),
      onPointerUp: () => drop(index),
    },
  };
}
