import { describe, expect, it } from "vitest";

import { basename, joinOutputPath } from "./path";

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

describe("basename", () => {
  it("returns empty string for empty input", () => {
    expect(basename("")).toBe("");
  });

  it("returns the filename when there is no separator", () => {
    expect(basename("archive.rar")).toBe("archive.rar");
  });

  it("returns the last segment of a POSIX path", () => {
    expect(basename("/home/user/archive.rar")).toBe("archive.rar");
  });

  it("returns the last segment of a Windows backslash path", () => {
    expect(basename("C:\\Users\\user\\archive.rar")).toBe("archive.rar");
  });

  it("handles mixed slashes", () => {
    expect(basename("/home/user\\archive.rar")).toBe("archive.rar");
  });

  it("ignores a trailing slash and returns the last non-empty segment", () => {
    expect(basename("/home/user/")).toBe("user");
  });
});
