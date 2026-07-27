// Pure math for keeping a queue row visible. No DOM, no store, no IO: callers
// hand in plain rect numbers and get back a scroll delta, which keeps the
// arithmetic unit-testable in an environment (jsdom) that has no layout.

/** The vertical span of an element, in viewport coordinates. */
export interface VerticalBounds {
  top: number;
  bottom: number;
}

/**
 * Pixels to ADD to the scroller's `scrollTop` so `row` sits inside `view` with
 * `margin` pixels of clearance at whichever edge it was crowding. Negative
 * scrolls up, positive scrolls down, and `0` means the row already clears both
 * margins — scrolling is minimum-distance, so a visible row never moves.
 *
 * A row taller than the view cannot satisfy both margins at once; the top edge
 * wins, so the start of the row stays visible rather than an arbitrary slice.
 */
export function scrollDeltaToShowRow(
  view: VerticalBounds,
  row: VerticalBounds,
  margin: number,
): number {
  const shortfallAbove = row.top - margin - view.top;
  if (shortfallAbove < 0) return shortfallAbove;
  const shortfallBelow = row.bottom + margin - view.bottom;
  if (shortfallBelow > 0) {
    // Never scroll so far down that the row's own top leaves the view.
    return Math.min(shortfallBelow, row.top - view.top);
  }
  return 0;
}

/** True when both sorted index lists hold exactly the same rows. */
function sameIndices(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Which row a selection change should bring into view, or `null` when the
 * change should not scroll at all. `previous` and `next` must be sorted
 * ascending, which every store path that writes `selectedIndices` guarantees.
 *
 * Nothing scrolls when the selection was cleared (Escape, or a structural edit
 * that drops it), when every row is selected (Cmd+A — scrolling would fight the
 * user's reading position), or when the selection did not actually change (an
 * unrelated re-render). Otherwise the edge row on the side the selection grew
 * towards is the one the user is tracking.
 */
export function selectionFocusIndex(
  previous: number[],
  next: number[],
  itemCount: number,
): number | null {
  if (next.length === 0) return null;
  if (itemCount > 0 && next.length === itemCount) return null;
  if (sameIndices(previous, next)) return null;
  const grewUpward = previous.length > 0 && next[0] < previous[0];
  return grewUpward ? next[0] : next[next.length - 1];
}
