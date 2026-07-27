import { useLayoutEffect, useRef } from "react";

import type { ScrollRowIntoView } from "@/hooks/useScrollRowIntoView";
import { selectionFocusIndex } from "@/lib/row-visibility";
import { useJobStore } from "@/store/jobStore";

/**
 * Keeps the selected queue row visible: on a PURE selection change — one where
 * the queue contents did not also change — the edge row on the side the
 * selection grew towards is scrolled into view. It stays inert for select-all,
 * for a cleared selection, and at mount.
 *
 * Any change that also swapped `draft.items` is somebody else's business. It is
 * either a move, whose landing row the reorder path already scrolls to from
 * correctly-measured geometry, or a drag / add / remove, which is deliberately
 * out of scope. That matters because a grouped move commits the block's new
 * positions as the selection, which would otherwise send this hook chasing the
 * block's trailing row long after the drop. Skipping those changes also removes
 * the double-fire where both paths scrolled to the same row after a grouped
 * move, and guarantees this hook never measures while a FLIP slide is in flight
 * — a FLIP only ever runs when `items` changed.
 *
 * The work runs in a LAYOUT effect so the scroll lands in the same frame as the
 * render that caused it, with no intermediate paint at the old offset.
 */
export function useSelectedRowVisibility(
  scrollRowIntoView: ScrollRowIntoView,
): void {
  const selectedIndices = useJobStore((s) => s.selectedIndices);
  const items = useJobStore((s) => s.draft.items);
  // Both seeded with their mount-time values so an already-selected row does not
  // yank the scroller as soon as the queue renders.
  const previousRef = useRef(selectedIndices);
  const previousItemsRef = useRef(items);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    const previousItems = previousItemsRef.current;
    previousRef.current = selectedIndices;
    previousItemsRef.current = items;
    // The queue contents changed: not a pure selection change, so leave the
    // scroller to whoever owns that edit (see the note above).
    if (previousItems !== items) return;
    const target = selectionFocusIndex(previous, selectedIndices, items.length);
    if (target !== null) scrollRowIntoView(target);
  }, [selectedIndices, items, scrollRowIntoView]);
}
