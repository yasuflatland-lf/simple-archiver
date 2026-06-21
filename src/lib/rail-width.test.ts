import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampRailWidth,
  DEFAULT_RAIL_WIDTH,
  loadPersistedRailWidth,
  MAX_RAIL_WIDTH,
  MIN_RAIL_WIDTH,
  persistRailWidth,
  RAIL_WIDTH_STORAGE_KEY,
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

  it("clamps a width above the maximum down to the maximum", () => {
    expect(clampRailWidth(MAX_RAIL_WIDTH + 50)).toBe(MAX_RAIL_WIDTH);
  });

  it("rounds a fractional width to a whole pixel", () => {
    expect(clampRailWidth(400.6)).toBe(401);
  });

  it("falls back to the default for a non-finite width", () => {
    expect(clampRailWidth(Number.NaN)).toBe(DEFAULT_RAIL_WIDTH);
    expect(clampRailWidth(Number.POSITIVE_INFINITY)).toBe(MAX_RAIL_WIDTH);
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

  it("clamps an out-of-range stored width", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "9999");
    expect(loadPersistedRailWidth()).toBe(MAX_RAIL_WIDTH);
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

  it("clamps the width before writing", () => {
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
