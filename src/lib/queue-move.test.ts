import { describe, expect, it } from "vitest";

import {
  type MovePlan,
  planRelocateSelection,
  planShiftSelection,
} from "./queue-move";

// Replay a plan's single (from, to) moves against the identity array using the
// same remove-then-insert semantics as the backend `reorder`, so a test can
// assert the moves actually reproduce the declared `order` permutation.
function applyMoves(count: number, plan: MovePlan): number[] {
  const arr = Array.from({ length: count }, (_, i) => i);
  for (const [from, to] of plan.moves) {
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
  }
  return arr;
}

describe("planShiftSelection", () => {
  it("shifts a contiguous block up by one, preserving relative order", () => {
    const plan = planShiftSelection(4, [1, 2], "up");
    expect(plan.order).toEqual([1, 2, 0, 3]);
    expect(plan.selected).toEqual([0, 1]);
    expect(applyMoves(4, plan)).toEqual(plan.order);
  });

  it("shifts a non-contiguous selection up, keeping each row's gaps", () => {
    const plan = planShiftSelection(4, [1, 3], "up");
    expect(plan.order).toEqual([1, 0, 3, 2]);
    expect(plan.selected).toEqual([0, 2]);
    expect(applyMoves(4, plan)).toEqual(plan.order);
  });

  it("shifts a contiguous block down by one", () => {
    const plan = planShiftSelection(4, [1, 2], "down");
    expect(plan.order).toEqual([0, 3, 1, 2]);
    expect(plan.selected).toEqual([2, 3]);
    expect(applyMoves(4, plan)).toEqual(plan.order);
  });

  it("clamps at the top edge: a no-op move keeps the selection", () => {
    const plan = planShiftSelection(4, [0, 1], "up");
    expect(plan.moves).toEqual([]);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(plan.selected).toEqual([0, 1]);
  });

  it("clamps at the bottom edge: a no-op move keeps the selection", () => {
    const plan = planShiftSelection(4, [2, 3], "down");
    expect(plan.moves).toEqual([]);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(plan.selected).toEqual([2, 3]);
  });

  it("compresses a selection partly against the top edge", () => {
    // Row 0 is pinned at the top; row 2 slides up into row 1's slot.
    const plan = planShiftSelection(4, [0, 2], "up");
    expect(plan.order).toEqual([0, 2, 1, 3]);
    expect(plan.selected).toEqual([0, 1]);
    expect(applyMoves(4, plan)).toEqual(plan.order);
  });

  it("treats an empty selection as a no-op", () => {
    const plan = planShiftSelection(4, [], "up");
    expect(plan.moves).toEqual([]);
    expect(plan.selected).toEqual([]);
  });
});

describe("planRelocateSelection", () => {
  it("relocates a selection to the bottom, preserving relative order", () => {
    const plan = planRelocateSelection(5, [1, 3], 5);
    expect(plan.order).toEqual([0, 2, 4, 1, 3]);
    expect(plan.selected).toEqual([3, 4]);
    expect(applyMoves(5, plan)).toEqual(plan.order);
  });

  it("relocates a selection to the top, preserving relative order", () => {
    const plan = planRelocateSelection(5, [1, 3], 0);
    expect(plan.order).toEqual([1, 3, 0, 2, 4]);
    expect(plan.selected).toEqual([0, 1]);
    expect(applyMoves(5, plan)).toEqual(plan.order);
  });

  it("gathers a scattered selection into a contiguous block at the gap", () => {
    const plan = planRelocateSelection(5, [0, 2, 4], 5);
    expect(plan.order).toEqual([1, 3, 0, 2, 4]);
    expect(plan.selected).toEqual([2, 3, 4]);
    expect(applyMoves(5, plan)).toEqual(plan.order);
  });

  it("is a no-op when dropping onto a gap inside the existing block", () => {
    const plan = planRelocateSelection(4, [1, 2], 2);
    expect(plan.moves).toEqual([]);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(plan.selected).toEqual([1, 2]);
  });

  it("is a no-op when dropping flush against the block's leading edge", () => {
    const plan = planRelocateSelection(4, [1, 2], 1);
    expect(plan.moves).toEqual([]);
    expect(plan.selected).toEqual([1, 2]);
  });
});
