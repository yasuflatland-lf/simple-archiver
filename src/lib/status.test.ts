import { describe, expect, it } from "vitest";

import type { JobSummaryDto } from "@/bindings/JobSummaryDto";

import { statusVisual, taskOutcomeFor } from "./status";

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

describe("taskOutcomeFor", () => {
  const summary: JobSummaryDto = {
    succeeded: [1, 2],
    cancelled: [3],
    failed: [{ taskId: 4, reason: "boom" }],
  };

  it("resolves a succeeded id to a succeeded outcome", () => {
    expect(taskOutcomeFor(1, summary)).toEqual({ kind: "succeeded" });
  });

  it("resolves a cancelled id to a cancelled outcome", () => {
    expect(taskOutcomeFor(3, summary)).toEqual({ kind: "cancelled" });
  });

  it("resolves a failed id to a failed outcome carrying its reason", () => {
    expect(taskOutcomeFor(4, summary)).toEqual({
      kind: "failed",
      reason: "boom",
    });
  });

  it("resolves an id in no bucket to a done outcome", () => {
    expect(taskOutcomeFor(99, summary)).toEqual({ kind: "done" });
  });

  it("resolves to pending when there is no summary yet", () => {
    expect(taskOutcomeFor(1, null)).toEqual({ kind: "pending" });
  });
});
