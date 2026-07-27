import { describe, expect, it } from "vitest";

import { scrollDeltaToShowRow, selectionFocusIndex } from "./row-visibility";

// A scroller occupying viewport rows 100..400.
const VIEW = { top: 100, bottom: 400 };

describe("scrollDeltaToShowRow", () => {
  it("does not scroll a row that already clears both margins", () => {
    expect(scrollDeltaToShowRow(VIEW, { top: 200, bottom: 230 }, 30)).toBe(0);
  });

  it("scrolls up by the shortfall when the row crowds the top edge", () => {
    // The row's top (110) must reach 130 = view top + margin, so 20px up.
    expect(scrollDeltaToShowRow(VIEW, { top: 110, bottom: 140 }, 30)).toBe(-20);
  });

  it("scrolls down by the shortfall when the row crowds the bottom edge", () => {
    // The row's bottom (390) must reach 370 = view bottom - margin: 20px down.
    expect(scrollDeltaToShowRow(VIEW, { top: 360, bottom: 390 }, 30)).toBe(20);
  });

  it("brings a fully off-screen row in with its margin intact", () => {
    expect(scrollDeltaToShowRow(VIEW, { top: 500, bottom: 530 }, 30)).toBe(160);
  });

  it("clamps to the top edge for a row taller than the view", () => {
    // Honouring the bottom margin would push the row's top off-screen, so the
    // top edge wins and the row's start stays visible.
    expect(scrollDeltaToShowRow(VIEW, { top: 150, bottom: 600 }, 30)).toBe(50);
  });
});

describe("selectionFocusIndex", () => {
  it("shows nothing when the selection was cleared", () => {
    expect(selectionFocusIndex([2], [], 10)).toBeNull();
  });

  it("shows nothing for select-all", () => {
    expect(selectionFocusIndex([0], [0, 1, 2], 3)).toBeNull();
  });

  it("shows nothing when the selection is unchanged", () => {
    expect(selectionFocusIndex([1, 2], [1, 2], 10)).toBeNull();
  });

  it("shows the topmost row when the selection moved up", () => {
    expect(selectionFocusIndex([4, 5], [3, 4], 10)).toBe(3);
  });

  it("shows the bottommost row when the selection moved down", () => {
    expect(selectionFocusIndex([4, 5], [5, 6], 10)).toBe(6);
  });

  it("shows the bottommost row of a brand-new selection", () => {
    expect(selectionFocusIndex([], [7], 10)).toBe(7);
  });
});
