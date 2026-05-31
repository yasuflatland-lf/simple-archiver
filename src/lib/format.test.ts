import { describe, expect, it } from "vitest";

import { formatEta, progressPercent } from "./format";

describe("formatEta", () => {
  it("returns an em dash for unknown (null) ETA", () => {
    expect(formatEta(null)).toBe("—");
  });
  it("returns 0s for zero or negative", () => {
    expect(formatEta(0)).toBe("0s");
    expect(formatEta(-5)).toBe("0s");
  });
  it("formats sub-minute durations as seconds", () => {
    expect(formatEta(12000)).toBe("12s");
    expect(formatEta(999)).toBe("1s"); // rounds to the nearest second
  });
  it("formats minutes and seconds", () => {
    expect(formatEta(83000)).toBe("1m 23s");
  });
  it("formats hours and minutes (drops seconds)", () => {
    expect(formatEta(3_660_000)).toBe("1h 1m");
  });
});

describe("progressPercent", () => {
  it("is 0 when total is zero or negative", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 0)).toBe(0);
  });
  it("rounds the ratio to a whole percent", () => {
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(1, 3)).toBe(33);
  });
  it("clamps to 100", () => {
    expect(progressPercent(120, 100)).toBe(100);
  });
});
