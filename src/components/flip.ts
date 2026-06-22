// Pure geometry helpers for the position-based FLIP reorder animation.
//
// The queue rows are keyed by list index and have no stable per-row id, so a
// classic identity-keyed FLIP does not apply. Instead, because a reorder is a
// known (from, to), we reproduce the post-move permutation and use measured row
// tops to compute how far each row must be inverted before it plays back to its
// settled position. These functions are pure (no DOM, no IO).

/**
 * Reproduce the index permutation of moving the item at `from` to `to`, using
 * the same remove-then-insert semantics as the store's `reorder`. Returns an
 * array `perm` where `perm[newIndex] === oldIndex`: the element shown at
 * `newIndex` after the move was at `oldIndex` before it.
 */
export function reorderPermutation(
  from: number,
  to: number,
  count: number,
): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  const [moved] = indices.splice(from, 1);
  indices.splice(to, 0, moved);
  return indices;
}

/**
 * Compute each row's vertical FLIP delta (px) from before/after tops.
 * `beforeTops` is indexed by old index, `afterTops` by new index, and `perm`
 * maps new index to old index. The delta is where the row *was* minus where it
 * *is*, so applying `translateY(delta)` then animating to 0 makes the row glide
 * from its old position to its new one. A missing measurement counts as 0.
 */
export function computeFlipDeltas(
  perm: number[],
  beforeTops: number[],
  afterTops: number[],
): number[] {
  return perm.map((oldIndex, newIndex) => {
    const before = beforeTops[oldIndex];
    const after = afterTops[newIndex];
    if (before === undefined || after === undefined) return 0;
    return before - after;
  });
}
