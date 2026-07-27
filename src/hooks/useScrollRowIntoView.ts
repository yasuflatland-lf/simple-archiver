import { useCallback, type RefObject } from "react";

import { scrollDeltaToShowRow } from "@/lib/row-visibility";

/** Bring the queue row at `index` into the scroller's visible area. */
export type ScrollRowIntoView = (index: number) => void;

interface ScrollRowIntoViewRefs {
  /** The element wrapping the rows (the <table>); rows carry `data-row-index`. */
  tableRef: RefObject<HTMLElement | null>;
  /** The vertical scroller. Omitted (or null) makes the returned callback inert. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

/**
 * Returns a callback that scrolls the queue's vertical scroller by the minimum
 * distance needed to show the row at `index`, keeping one row of clearance at
 * the edge it was crowding. A row already fully visible does not move the
 * scroller, so repeat calls are idempotent and two callers asking for the same
 * row cost nothing.
 *
 * The scroll is instant by design: the row itself is already sliding through the
 * FLIP animation, and a competing smooth scroll would lag behind a held-down
 * arrow key.
 *
 * Every lookup is guarded, so the callback is a no-op before mount, without a
 * scroller (a standalone TaskList in a unit test), and for an index that is not
 * rendered. In an environment without layout the rects are zero-sized, the delta
 * is 0, and nothing scrolls — the same way column auto-fit degrades.
 */
export function useScrollRowIntoView({
  tableRef,
  scrollContainerRef,
}: ScrollRowIntoViewRefs): ScrollRowIntoView {
  return useCallback(
    (index: number) => {
      const scroller = scrollContainerRef?.current;
      const table = tableRef.current;
      if (!scroller || !table) return;
      const row = table.querySelector<HTMLElement>(
        `tr[data-row-index="${index}"]`,
      );
      if (!row) return;
      const rowBounds = row.getBoundingClientRect();
      const delta = scrollDeltaToShowRow(
        scroller.getBoundingClientRect(),
        rowBounds,
        // One row of clearance, measured from the row itself so it stays correct
        // when row heights differ.
        rowBounds.height,
      );
      if (delta !== 0) scroller.scrollTop += delta;
    },
    [tableRef, scrollContainerRef],
  );
}
