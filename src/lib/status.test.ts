import { describe, expect, it } from "vitest";

import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";

import { computeStatus, statusVisual, taskOutcomeFor } from "./status";

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
    results: [],
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

describe("computeStatus", () => {
  const progressWith = (perTask: ProgressEvent["perTask"]): ProgressEvent => ({
    overall: { bytesDone: 0, bytesTotal: 0 },
    overallEtaMs: null,
    perTask,
    elapsedMs: 0,
  });

  it("returns the human-scaled byte string while running with a per-task entry", () => {
    const progress = progressWith([
      { taskId: 10, bytesDone: 512, bytesTotal: 2048, etaMs: null },
    ]);
    expect(computeStatus(0, true, progress, null, [10])).toBe("0.5 / 2.0 KB");
  });

  it("returns 'Processing' while running before this row's per-task entry arrives", () => {
    expect(computeStatus(0, true, null, null, [10])).toBe("Processing");
    expect(computeStatus(1, true, progressWith([]), null, [10])).toBe(
      "Processing",
    );
  });

  it("maps a succeeded id to its label once finished", () => {
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [],
      results: [],
    };
    expect(computeStatus(0, false, null, summary, [10])).toBe("Succeeded");
  });

  it("maps a cancelled id to its label once finished", () => {
    const summary: JobSummaryDto = {
      succeeded: [],
      cancelled: [10],
      failed: [],
      results: [],
    };
    expect(computeStatus(0, false, null, summary, [10])).toBe("Cancelled");
  });

  it("maps a failed id to its label plus the verbatim reason", () => {
    const summary: JobSummaryDto = {
      succeeded: [],
      cancelled: [],
      failed: [{ taskId: 10, reason: "boom" }],
      results: [],
    };
    expect(computeStatus(0, false, null, summary, [10])).toBe("Failed: boom");
  });

  it("returns 'Done' when a summary exists but the row has no mapped task id", () => {
    const summary: JobSummaryDto = {
      succeeded: [],
      cancelled: [],
      failed: [],
      results: [],
    };
    expect(computeStatus(5, false, null, summary, [10])).toBe("Done");
  });

  it("returns 'Done' when a summary exists but the id is in no bucket", () => {
    const summary: JobSummaryDto = {
      succeeded: [],
      cancelled: [],
      failed: [],
      results: [],
    };
    expect(computeStatus(0, false, null, summary, [10])).toBe("Done");
  });

  it("returns 'Waiting' when not running and no summary yet", () => {
    expect(computeStatus(0, false, null, null, [10])).toBe("Waiting");
  });
});
