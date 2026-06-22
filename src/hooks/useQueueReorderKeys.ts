import { type KeyboardEvent, useCallback } from "react";

import { useJobStore } from "@/store/jobStore";

type AnimatedReorder = (from: number, to: number) => Promise<void>;

/**
 * Returns a keydown handler that moves the single selected queue row with the
 * vertical arrow keys: ArrowUp moves it up one slot, ArrowDown down one. The move
 * routes through the supplied `animatedReorder` so the FLIP slide, settle
 * highlight, and live-region announce fire identically to a drag or button
 * reorder, and the store keeps the row selected at its new index so presses chain.
 *
 * The handler is inert — and leaves the arrow key for native scrolling — unless
 * exactly one row is selected and no job is running. At a list edge the key is
 * consumed (preventDefault) but nothing moves. It reads the store via
 * `getState()` so it stays referentially stable, and is attached to the focusable
 * queue container, not the document, so it only fires when the queue is focused.
 */
export function useQueueReorderKeys(
  animatedReorder: AnimatedReorder,
): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      const state = useJobStore.getState();
      // The queue is read-only while a job runs; leave the key for scrolling.
      if (state.running) return;
      // Only a single selected row can be moved with the arrows; otherwise leave
      // the key alone so the queue can scroll.
      if (state.selectedIndices.length !== 1) return;

      const from = state.selectedIndices[0];
      const count = state.draft.items.length;
      const to = event.key === "ArrowUp" ? from - 1 : from + 1;

      // Consume the key either way so the focused queue does not also scroll; only
      // a move within bounds reorders.
      event.preventDefault();
      if (to < 0 || to >= count) return;
      void animatedReorder(from, to);
    },
    [animatedReorder],
  );
}
