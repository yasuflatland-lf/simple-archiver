import { describe, expect, it } from "vitest";

import { readinessFor, runUnavailableReason } from "./readiness";

describe("readinessFor", () => {
  it("reports add-files when the queue is empty (checked before destination)", () => {
    expect(readinessFor(0, "/out", "zip", "photo_{n}")).toBe("add-files");
    expect(readinessFor(0, null, "zip", null)).toBe("add-files");
  });

  it("reports choose-destination when items exist but no destination is set", () => {
    expect(readinessFor(1, null, "zip", "photo_{n}")).toBe(
      "choose-destination",
    );
  });

  it("reports choose-destination for a whitespace-only output directory", () => {
    expect(readinessFor(1, "   ", "zip", "photo_{n}")).toBe(
      "choose-destination",
    );
    expect(readinessFor(1, "\t", "zip", "photo_{n}")).toBe(
      "choose-destination",
    );
    expect(readinessFor(1, "", "zip", "photo_{n}")).toBe("choose-destination");
  });

  it("reports ready when items exist and a destination is set", () => {
    expect(readinessFor(1, "/out", "zip", "photo_{n}")).toBe("ready");
  });

  it("reports set-naming-template when Zip mode has no template", () => {
    expect(readinessFor(1, "/out", "zip", null)).toBe("set-naming-template");
  });

  it("reports ready when Folder mode has no template", () => {
    expect(readinessFor(1, "/out", "folder", null)).toBe("ready");
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

  it("maps set-naming-template to the naming-template reason", () => {
    expect(runUnavailableReason("set-naming-template")).toBe(
      "Set a naming template",
    );
  });

  it("returns an empty reason when ready", () => {
    expect(runUnavailableReason("ready")).toBe("");
  });
});
