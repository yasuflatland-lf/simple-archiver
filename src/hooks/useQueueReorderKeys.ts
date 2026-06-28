import { type KeyboardEvent, useCallback } from "react";

import { useJobStore } from "@/store/jobStore";

type AnimatedReorder = (from: number, to: number) => Promise<void>;
type AnimatedMoveSelected = (direction: "up" | "down") => Promise<void>;

/**
 * Returns a keydown handler that moves the selected queue row(s) with the
 * vertical arrow keys: ArrowUp moves the selection up one slot, ArrowDown down
 * one. A single selected row routes through `animatedReorder` (the existing
 * one-row move); a multi-row selection routes through `animatedMoveSelected`,
 * which shifts the whole block one slot, preserving relative order and clamping
 * at the list edge. Both share the FLIP slide, settle highlight, and live-region
 * announce of a drag or button reorder, and the store keeps the rows selected at
 * their new positions so presses chain.
 *
 * The handler is inert — and leaves the arrow key for native scrolling — unless
 * at least one row is selected and no job is running. At a single-row list edge
 * the key is consumed (preventDefault) but nothing moves; a multi-row move
 * likewise consumes the key and clamps to a no-op at the edge. It reads the
 * store via `getState()` so it stays referentially stable, and is attached to
 * the focusable queue container, not the document, so it only fires when the
 * queue is focused.
 */
export function useQueueReorderKeys(
  animatedReorder: AnimatedReorder,
  animatedMoveSelected: AnimatedMoveSelected,
): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      const state = useJobStore.getState();
      // The queue is read-only while a job runs; leave the key for scrolling.
      if (state.running) return;
      // No selection means there is nothing to move; leave the key for scrolling.
      const selectionCount = state.selectedIndices.length;
      if (selectionCount === 0) return;

      const direction = event.key === "ArrowUp" ? "up" : "down";

      // A multi-row selection moves as a group; the store clamps at the edge, so
      // just consume the key and delegate.
      if (selectionCount > 1) {
        event.preventDefault();
        void animatedMoveSelected(direction);
        return;
      }

      // Single-row move: unchanged from before — compute the target slot and
      // consume the key either way so the focused queue does not also scroll;
      // only a move within bounds reorders.
      const from = state.selectedIndices[0];
      const count = state.draft.items.length;
      const to = direction === "up" ? from - 1 : from + 1;
      event.preventDefault();
      if (to < 0 || to >= count) return;
      void animatedReorder(from, to);
    },
    [animatedReorder, animatedMoveSelected],
  );
}
