// Pure planning for moving a multi-row queue selection. No DOM, no IO.
//
// The only reorder primitive the backend exposes is `reorder(from, to)` — a
// single remove-then-insert. A multi-row move therefore decomposes into a
// SEQUENCE of single-item moves. For a given selection and a requested motion
// these helpers compute three things:
//   - `order`:    the resulting permutation (`order[newIndex] === oldIndex`),
//                 handed straight to the FLIP animation as its perm;
//   - `moves`:    the single (from, to) reorders that realize `order` via
//                 remove-then-insert, applied in turn to the backend draft;
//   - `selected`: where the originally-selected rows end up (sorted ascending),
//                 so the selection highlight follows the block after the move.

/** The decomposed plan for a grouped queue move. */
export interface MovePlan {
  /** Resulting permutation: `order[newIndex] === oldIndex`. */
  order: number[];
  /** Single (from, to) remove-then-insert moves that realize `order`, in order. */
  moves: Array<[number, number]>;
  /** New positions of the originally-selected rows, sorted ascending. */
  selected: number[];
}

/**
 * Decompose a target permutation (`order[newIndex] === oldIndex`) into the
 * sequence of single remove-then-insert moves that realizes it. Positions are
 * filled left to right: once index `p` holds its target it is never disturbed,
 * so every emitted move is `[from, p]` with `from > p` and stays valid against
 * the progressively-reordered array.
 */
function decompose(order: number[]): Array<[number, number]> {
  // `cur[pos]` is the old index currently sitting at `pos` (identity to start).
  const cur = order.map((_, i) => i);
  const moves: Array<[number, number]> = [];
  for (let p = 0; p < order.length; p++) {
    const want = order[p];
    if (cur[p] === want) continue;
    // Positions [0, p) are already settled, so the wanted item is at some p+.
    let from = p + 1;
    while (from < order.length && cur[from] !== want) from++;
    if (from >= order.length) {
      // `order` is not a permutation of [0, length): the wanted old index is
      // absent. The planners normalize their selection so this is unreachable,
      // but bound the search and fail loudly rather than spinning the UI thread
      // on a malformed permutation.
      throw new Error(`decompose: ${want} is not present in the permutation`);
    }
    moves.push([from, p]);
    cur.splice(from, 1);
    cur.splice(p, 0, want);
  }
  return moves;
}

/** Sorted-ascending copy (the selection invariant already excludes duplicates). */
function sortedAsc(indices: number[]): number[] {
  return [...indices].sort((a, b) => a - b);
}

/**
 * Sorted-ascending, de-duplicated selection restricted to valid row indices
 * `[0, count)`. The selection store already maintains these invariants, but
 * enforcing them here keeps a stale or out-of-range index from reaching
 * {@link decompose}, where an absent target would otherwise loop forever.
 */
function normalizeSelection(
  selectedIndices: number[],
  count: number,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of selectedIndices) {
    if (Number.isInteger(i) && i >= 0 && i < count && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Shift the selected rows one slot up or down as a group, preserving their
 * relative order and clamping against the list edge: the topmost (ArrowUp) or
 * bottommost (ArrowDown) selected row never leaves the list, and rows already
 * packed against that edge stay put while the rest of the block compresses
 * toward it. A selection flush with the edge in the travel direction yields an
 * empty `moves` (a clamped no-op) while still reporting its unchanged
 * `selected`.
 */
export function planShiftSelection(
  count: number,
  selectedIndices: number[],
  direction: "up" | "down",
): MovePlan {
  // `slot[pos]` holds the old index currently at `pos`; `picked` tracks which
  // positions are selected as the block walks toward the edge.
  const slot = Array.from({ length: count }, (_, i) => i);
  const picked = new Set(normalizeSelection(selectedIndices, count));
  if (direction === "up") {
    for (let i = 1; i < count; i++) {
      // A selected row with a free (unselected) slot above swaps up into it.
      if (picked.has(i) && !picked.has(i - 1)) {
        [slot[i - 1], slot[i]] = [slot[i], slot[i - 1]];
        picked.delete(i);
        picked.add(i - 1);
      }
    }
  } else {
    for (let i = count - 2; i >= 0; i--) {
      // A selected row with a free slot below swaps down into it.
      if (picked.has(i) && !picked.has(i + 1)) {
        [slot[i], slot[i + 1]] = [slot[i + 1], slot[i]];
        picked.delete(i);
        picked.add(i + 1);
      }
    }
  }
  return {
    order: slot,
    moves: decompose(slot),
    selected: sortedAsc([...picked]),
  };
}

/**
 * Relocate the selected rows so they sit as one contiguous block at insertion
 * gap `gap` (in [0, count]: the block lands before the original row `gap`),
 * preserving their relative order. Dropping onto a gap inside or flush against
 * the existing block is a no-op (empty `moves`), leaving the selection where it
 * is.
 */
export function planRelocateSelection(
  count: number,
  selectedIndices: number[],
  gap: number,
): MovePlan {
  const selected = normalizeSelection(selectedIndices, count);
  const pickedSet = new Set(selected);
  // The un-selected rows, in their original order.
  const rest: number[] = [];
  for (let i = 0; i < count; i++) if (!pickedSet.has(i)) rest.push(i);
  // How many un-selected rows sit before the gap == the block's insertion point
  // within `rest`.
  let insertAt = 0;
  for (const i of rest) if (i < gap) insertAt++;
  const order = [
    ...rest.slice(0, insertAt),
    ...selected,
    ...rest.slice(insertAt),
  ];
  const newSelected = selected.map((_, k) => insertAt + k);
  return { order, moves: decompose(order), selected: newSelected };
}
