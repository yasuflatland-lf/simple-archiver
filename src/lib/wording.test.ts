import { describe, expect, it } from "vitest";

import { verbForMode } from "./wording";

describe("verbForMode", () => {
  it("reads 'extracted' in folder mode", () => {
    expect(verbForMode("folder")).toBe("extracted");
  });

  it("reads 'archived' in zip mode", () => {
    expect(verbForMode("zip")).toBe("archived");
  });
});
