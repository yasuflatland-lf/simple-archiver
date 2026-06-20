import { describe, expect, it } from "vitest";

import { readinessFor, runUnavailableReason } from "./readiness";

describe("readinessFor", () => {
  it("reports add-files when the queue is empty (checked before destination)", () => {
    expect(readinessFor(0, "/out")).toBe("add-files");
    expect(readinessFor(0, null)).toBe("add-files");
  });

  it("reports choose-destination when items exist but no destination is set", () => {
    expect(readinessFor(1, null)).toBe("choose-destination");
  });

  it("reports choose-destination for a whitespace-only output directory", () => {
    expect(readinessFor(1, "   ")).toBe("choose-destination");
    expect(readinessFor(1, "\t")).toBe("choose-destination");
    expect(readinessFor(1, "")).toBe("choose-destination");
  });

  it("reports ready when items exist and a destination is set", () => {
    expect(readinessFor(1, "/out")).toBe("ready");
  });
});

describe("runUnavailableReason", () => {
  it("maps add-files to the add-an-item reason", () => {
    expect(runUnavailableReason("add-files")).toBe("Add at least one item");
  });

  it("maps choose-destination to the output-directory reason", () => {
    expect(runUnavailableReason("choose-destination")).toBe(
      "Choose an output directory",
    );
  });

  it("returns an empty reason when ready", () => {
    expect(runUnavailableReason("ready")).toBe("");
  });
});
