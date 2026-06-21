import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampRailWidth,
  DEFAULT_RAIL_WIDTH,
  loadPersistedRailWidth,
  MIN_CANVAS_WIDTH,
  MIN_RAIL_WIDTH,
  persistRailWidth,
  RAIL_WIDTH_STORAGE_KEY,
  railWidthMaxFor,
} from "./rail-width";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clampRailWidth", () => {
  it("returns a width within range unchanged", () => {
    expect(clampRailWidth(400)).toBe(400);
  });

  it("clamps a width below the minimum up to the minimum", () => {
    expect(clampRailWidth(MIN_RAIL_WIDTH - 50)).toBe(MIN_RAIL_WIDTH);
  });

  it("does not cap a wide width when no maximum is given", () => {
    // Free expansion: with no dynamic ceiling, a wide value passes through so a
    // width set on a roomy window survives a persistence round-trip.
    expect(clampRailWidth(900)).toBe(900);
  });

  it("clamps a width above the given dynamic maximum down to it", () => {
    expect(clampRailWidth(900, 634)).toBe(634);
  });

  it("never returns below the minimum even when the dynamic maximum is smaller", () => {
    // A very narrow container can drive the ceiling below the floor; the floor
    // wins so the rail stays usable.
    expect(clampRailWidth(900, 100)).toBe(MIN_RAIL_WIDTH);
  });

  it("rounds a fractional width to a whole pixel", () => {
    expect(clampRailWidth(400.6)).toBe(401);
  });

  it("falls back to the default for a non-finite width", () => {
    expect(clampRailWidth(Number.NaN)).toBe(DEFAULT_RAIL_WIDTH);
    expect(clampRailWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RAIL_WIDTH);
  });
});

describe("railWidthMaxFor", () => {
  it("reserves MIN_CANVAS_WIDTH for the canvas beside the separator", () => {
    expect(railWidthMaxFor(1000, 6)).toBe(1000 - 6 - MIN_CANVAS_WIDTH);
  });

  it("returns +Infinity when the container is not yet measured", () => {
    // Width 0 (unlaid-out shell, e.g. jsdom before layout) must not clamp the
    // rail to a degenerate value before the real geometry is known.
    expect(railWidthMaxFor(0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("loadPersistedRailWidth", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadPersistedRailWidth()).toBe(DEFAULT_RAIL_WIDTH);
  });

  it("returns the stored width when valid", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "420");
    expect(loadPersistedRailWidth()).toBe(420);
  });

  it("preserves a wide stored width (the canvas-min clamp happens on layout)", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "900");
    expect(loadPersistedRailWidth()).toBe(900);
  });

  it("clamps a below-minimum stored width up to the minimum", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "100");
    expect(loadPersistedRailWidth()).toBe(MIN_RAIL_WIDTH);
  });

  it("returns the default for a non-numeric stored value", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "not-a-number");
    expect(loadPersistedRailWidth()).toBe(DEFAULT_RAIL_WIDTH);
  });

  it("returns the default when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPersistedRailWidth()).toBe(DEFAULT_RAIL_WIDTH);
  });
});

describe("persistRailWidth", () => {
  it("writes the width to localStorage", () => {
    persistRailWidth(380);
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe("380");
  });

  it("preserves a wide width when writing", () => {
    persistRailWidth(900);
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe("900");
  });

  it("clamps a below-minimum width up before writing", () => {
    persistRailWidth(50);
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(MIN_RAIL_WIDTH),
    );
  });

  it("does not throw when localStorage write fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => persistRailWidth(400)).not.toThrow();
  });
});
