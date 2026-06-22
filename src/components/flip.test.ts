import { describe, expect, it } from "vitest";

import { computeFlipDeltas, reorderPermutation } from "./flip";

describe("reorderPermutation", () => {
  it("moves the first row to the last", () => {
    // [0,1,2] -> remove 0 -> [1,2] -> insert at 2 -> [1,2,0]
    expect(reorderPermutation(0, 2, 3)).toEqual([1, 2, 0]);
  });

  it("moves the last row to the first", () => {
    expect(reorderPermutation(2, 0, 3)).toEqual([2, 0, 1]);
  });

  it("swaps two adjacent rows", () => {
    expect(reorderPermutation(0, 1, 3)).toEqual([1, 0, 2]);
  });

  it("is the identity for a no-op move", () => {
    expect(reorderPermutation(1, 1, 3)).toEqual([0, 1, 2]);
  });

  it("handles an interior move", () => {
    // [0,1,2,3,4] move index 1 to 3 -> [0,2,3,1,4]
    expect(reorderPermutation(1, 3, 5)).toEqual([0, 2, 3, 1, 4]);
  });
});

describe("computeFlipDeltas", () => {
  it("inverts the moved row and the rows it displaces (move down)", () => {
    const perm = reorderPermutation(0, 2, 3); // [1,2,0]
    const tops = [0, 20, 40];
    // new0<-old1: 20-0; new1<-old2: 40-20; new2<-old0(moved): 0-40
    expect(computeFlipDeltas(perm, tops, tops)).toEqual([20, 20, -40]);
  });

  it("inverts correctly for a move up", () => {
    const perm = reorderPermutation(2, 0, 3); // [2,0,1]
    const tops = [0, 20, 40];
    // new0<-old2(moved): 40-0; new1<-old0: 0-20; new2<-old1: 20-40
    expect(computeFlipDeltas(perm, tops, tops)).toEqual([40, -20, -20]);
  });

  it("yields all-zero deltas for the identity permutation", () => {
    const perm = reorderPermutation(1, 1, 3);
    const tops = [0, 20, 40];
    expect(computeFlipDeltas(perm, tops, tops)).toEqual([0, 0, 0]);
  });

  it("treats a missing measurement as zero", () => {
    const perm = [1, 0];
    // afterTops has no entry for new index 1 -> that row's delta guards to 0.
    expect(computeFlipDeltas(perm, [0, 20], [0])).toEqual([20, 0]);
  });
});
