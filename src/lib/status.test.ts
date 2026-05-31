import { describe, expect, it } from "vitest";

import { statusVisual } from "./status";

describe("statusVisual", () => {
  it("maps succeeded to the unified 'Succeeded' label and the success tokens", () => {
    const v = statusVisual("succeeded");
    expect(v.label).toBe("Succeeded");
    expect(v.icon).toBe("✓");
    expect(v.className).toContain("bg-status-success-subtle");
    expect(v.className).toContain("text-status-success-foreground");
  });

  it("maps cancelled to 'Cancelled' and the warning tokens", () => {
    const v = statusVisual("cancelled");
    expect(v.label).toBe("Cancelled");
    expect(v.icon).toBe("⚠");
    expect(v.className).toContain("bg-status-warning-subtle");
    expect(v.className).toContain("text-status-warning-foreground");
  });

  it("maps failed to 'Failed' and the danger tokens", () => {
    const v = statusVisual("failed");
    expect(v.label).toBe("Failed");
    expect(v.icon).toBe("✗");
    expect(v.className).toContain("bg-status-danger-subtle");
    expect(v.className).toContain("text-status-danger-foreground");
  });
});
