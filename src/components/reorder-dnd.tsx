import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type RowDragEvent = DragEvent<HTMLTableRowElement>;

interface ReorderDndContextValue {
  /** Whether rows may be dragged at all (false while a job is running). */
  draggable: boolean;
  /** Index of the row currently being dragged, or null. */
  draggingIndex: number | null;
  /** Index of the row currently hovered as the drop target, or null. */
  overIndex: number | null;
  start: (index: number, event: RowDragEvent) => void;
  over: (index: number, event: RowDragEvent) => void;
  drop: (index: number, event: RowDragEvent) => void;
  end: () => void;
}

const ReorderDndContext = createContext<ReorderDndContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * ReorderDndProvider owns the ephemeral drag state (which row is being dragged,
 * which row is the current drop target) and translates a native HTML5
 * drag-and-drop gesture into a single `reorder(from, to)` store action.
 *
 * The state lives here rather than in the global job store because it is
 * purely transient UI state; it is only observed by the rows during an active
 * drag, which never overlaps a running job (dragging is disabled then).
 */
export function ReorderDndProvider({ children }: { children: ReactNode }) {
  const running = useJobStore((s) => s.running);
  const reorder = useJobStore((s) => s.reorder);

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const draggable = !running;

  const reset = useCallback(() => {
    setDraggingIndex(null);
    setOverIndex(null);
  }, []);

  const start = useCallback(
    (index: number, event: RowDragEvent) => {
      // Guard so a synthetic dragstart can never begin a drag mid-run.
      if (running) return;
      setDraggingIndex(index);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        // A payload makes the gesture a valid native drag in every browser.
        event.dataTransfer.setData("text/plain", String(index));
      }
    },
    [running],
  );

  const over = useCallback((index: number, event: RowDragEvent) => {
    // preventDefault is what marks this row as a valid drop target.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setOverIndex(index);
  }, []);

  const drop = useCallback(
    (index: number, event: RowDragEvent) => {
      event.preventDefault();
      // Dropping a row onto index `to` lands it exactly at `to` (the store's
      // reorder is a remove-then-insert), so the drop target index maps
      // directly to the destination. Skip no-op and mid-run drops.
      if (draggingIndex !== null && draggingIndex !== index && !running) {
        void reorder(draggingIndex, index);
      }
      reset();
    },
    [draggingIndex, running, reorder, reset],
  );

  const value = useMemo<ReorderDndContextValue>(
    () => ({
      draggable,
      draggingIndex,
      overIndex,
      start,
      over,
      drop,
      end: reset,
    }),
    [draggable, draggingIndex, overIndex, start, over, drop, reset],
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
  draggable: boolean;
  isDragging: boolean;
  isOver: boolean;
  onDragStart: (event: RowDragEvent) => void;
  onDragOver: (event: RowDragEvent) => void;
  onDrop: (event: RowDragEvent) => void;
  onDragEnd: () => void;
}

// Fallback for a row rendered outside a provider (e.g. an isolated unit test):
// the row is simply not reorderable; its up/down buttons still work.
const NON_DRAGGABLE_ROW: ReorderRow = {
  draggable: false,
  isDragging: false,
  isOver: false,
  onDragStart: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
};

/**
 * useReorderRow returns the drag props and visual flags for the row at `index`.
 * Outside a {@link ReorderDndProvider} the row falls back to non-draggable.
 */
export function useReorderRow(index: number): ReorderRow {
  const ctx = useContext(ReorderDndContext);
  if (ctx === null) {
    return NON_DRAGGABLE_ROW;
  }
  const { draggable, draggingIndex, overIndex, start, over, drop, end } = ctx;
  return {
    draggable,
    isDragging: draggingIndex === index,
    // The dragged row is never its own drop target.
    isOver: overIndex === index && draggingIndex !== index,
    onDragStart: (event) => start(index, event),
    onDragOver: (event) => over(index, event),
    onDrop: (event) => drop(index, event),
    onDragEnd: end,
  };
}
