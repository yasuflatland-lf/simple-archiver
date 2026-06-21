import { type KeyboardEvent, useCallback } from "react";

import { useJobStore } from "@/store/jobStore";

/**
 * Returns a keydown handler implementing the queue's row-selection shortcuts:
 * Cmd/Ctrl+A selects every row, Delete/Backspace removes the current selection,
 * and Escape clears it.
 *
 * The handler reads the store via `getState()` so it stays referentially stable
 * (no re-subscription per render) while always seeing the latest snapshot. It is
 * attached to the focusable queue container — not the document — so it only
 * fires when the queue is focused and never hijacks Cmd+A / Delete inside the
 * naming-template input or anywhere else on the page.
 */
export function useQueueSelectionKeys(): (
  event: KeyboardEvent<HTMLElement>,
) => void {
  return useCallback((event: KeyboardEvent<HTMLElement>) => {
    const state = useJobStore.getState();
    // The queue is read-only while a job runs: the positional progress arrays
    // must stay fixed, so the selection shortcuts are inert.
    if (state.running) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      // Nothing to select in an empty queue; leave the native behavior alone.
      if (state.draft.items.length === 0) return;
      // Override the browser's select-all-text default within the queue.
      event.preventDefault();
      state.selectAll();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (state.selectedIndices.length === 0) return;
      // Also stop Backspace from triggering browser back-navigation.
      event.preventDefault();
      void state.deleteSelected();
      return;
    }

    if (event.key === "Escape") {
      state.clearSelection();
    }
  }, []);
}
