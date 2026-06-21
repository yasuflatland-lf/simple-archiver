import { describe, expect, it } from "vitest";

import {
  DEFAULT_START,
  DEFAULT_TEMPLATE,
  MAX_START,
  sanitizeStartNumber,
} from "./naming";

describe("DEFAULT_TEMPLATE", () => {
  it("seeds the name field with a two-digit sequence by default", () => {
    expect(DEFAULT_TEMPLATE).toBe("photo_{n:02}");
  });
});

describe("sanitizeStartNumber", () => {
  it("accepts non-negative integers verbatim", () => {
    expect(sanitizeStartNumber("0")).toBe(0);
    expect(sanitizeStartNumber("5")).toBe(5);
    expect(sanitizeStartNumber("  42  ")).toBe(42);
  });

  it("clamps negative values to 0", () => {
    expect(sanitizeStartNumber("-1")).toBe(0);
    expect(sanitizeStartNumber("-100")).toBe(0);
  });

  it("clamps values above u32::MAX to MAX_START", () => {
    expect(sanitizeStartNumber(String(MAX_START + 1))).toBe(MAX_START);
    expect(sanitizeStartNumber("999999999999")).toBe(MAX_START);
  });

  it("rejects empty / non-integer / non-numeric input as null", () => {
    expect(sanitizeStartNumber("")).toBeNull();
    expect(sanitizeStartNumber("   ")).toBeNull();
    expect(sanitizeStartNumber("1.5")).toBeNull();
    expect(sanitizeStartNumber("abc")).toBeNull();
    expect(sanitizeStartNumber("1e")).toBeNull();
  });

  it("exposes a default of 1", () => {
    expect(DEFAULT_START).toBe(1);
  });
});
