import { describe, expect, it } from "vitest";

import { joinOutputPath } from "./path";

describe("joinOutputPath", () => {
  it("returns the filename when dir is null", () => {
    expect(joinOutputPath(null, "photo_001.zip")).toBe("photo_001.zip");
  });

  it("returns the filename when dir is an empty string", () => {
    expect(joinOutputPath("", "photo_001.zip")).toBe("photo_001.zip");
  });

  it("combines dir and filename with a slash when dir is a normal path", () => {
    expect(joinOutputPath("~/Archives", "photo_001.zip")).toBe(
      "~/Archives/photo_001.zip",
    );
  });

  it("combines dir and filename without double slash when dir ends with slash", () => {
    expect(joinOutputPath("~/Archives/", "photo_001.zip")).toBe(
      "~/Archives/photo_001.zip",
    );
  });

  it("combines dir and filename with absolute path", () => {
    expect(joinOutputPath("/Users/x/out", "file.zip")).toBe(
      "/Users/x/out/file.zip",
    );
  });
});
