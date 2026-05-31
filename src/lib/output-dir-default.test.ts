import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({ downloadDir: vi.fn() }));

// Import after mocks are registered.
import { downloadDir } from "@tauri-apps/api/path";

import {
  isValidOutputDir,
  loadPersistedOutputDir,
  OUTPUT_DIR_STORAGE_KEY,
  persistOutputDir,
  resolveDefaultOutputDir,
  resolveInitialOutputDir,
} from "./output-dir-default";

const mockedDownloadDir = vi.mocked(downloadDir);

beforeEach(() => {
  localStorage.clear();
  mockedDownloadDir.mockReset();
});

describe("isValidOutputDir", () => {
  it("returns true for a non-empty string", () => {
    expect(isValidOutputDir("/Users/me/Downloads")).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidOutputDir(null)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidOutputDir("")).toBe(false);
  });

  it("returns false for a whitespace-only string", () => {
    expect(isValidOutputDir("   ")).toBe(false);
  });
});

describe("loadPersistedOutputDir", () => {
  it("returns the stored value when it is valid", () => {
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, "/Users/me/Downloads");
    expect(loadPersistedOutputDir()).toBe("/Users/me/Downloads");
  });

  it("returns null when nothing is stored", () => {
    expect(loadPersistedOutputDir()).toBeNull();
  });

  it("returns null when the stored value is an empty string", () => {
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, "");
    expect(loadPersistedOutputDir()).toBeNull();
  });

  it("returns null when the stored value is whitespace only", () => {
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, "   ");
    expect(loadPersistedOutputDir()).toBeNull();
  });

  it("returns null (does not throw) when localStorage.getItem throws a SecurityError", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    expect(() => loadPersistedOutputDir()).not.toThrow();
    expect(loadPersistedOutputDir()).toBeNull();
  });
});

describe("persistOutputDir", () => {
  it("writes the directory value under the storage key", () => {
    persistOutputDir("/Users/me/Archives");
    expect(localStorage.getItem(OUTPUT_DIR_STORAGE_KEY)).toBe(
      "/Users/me/Archives",
    );
  });

  it("does not write to localStorage when dir is an empty string", () => {
    persistOutputDir("");
    expect(localStorage.getItem(OUTPUT_DIR_STORAGE_KEY)).toBeNull();
  });

  it("does not write to localStorage when dir is whitespace only", () => {
    persistOutputDir("   ");
    expect(localStorage.getItem(OUTPUT_DIR_STORAGE_KEY)).toBeNull();
  });

  it("writes a valid path to localStorage", () => {
    persistOutputDir("/valid/path");
    expect(localStorage.getItem(OUTPUT_DIR_STORAGE_KEY)).toBe("/valid/path");
  });
});

describe("resolveDefaultOutputDir", () => {
  it("returns the path when downloadDir resolves successfully", async () => {
    mockedDownloadDir.mockResolvedValue("/Users/me/Downloads");
    await expect(resolveDefaultOutputDir()).resolves.toBe(
      "/Users/me/Downloads",
    );
  });

  it("returns null and does not throw when downloadDir rejects", async () => {
    mockedDownloadDir.mockRejectedValue(new Error("tauri not available"));
    await expect(resolveDefaultOutputDir()).resolves.toBeNull();
  });

  it("returns null when downloadDir resolves to an empty string", async () => {
    mockedDownloadDir.mockResolvedValue("");
    await expect(resolveDefaultOutputDir()).resolves.toBeNull();
  });

  it("returns null when downloadDir resolves to a whitespace-only string", async () => {
    mockedDownloadDir.mockResolvedValue("   ");
    await expect(resolveDefaultOutputDir()).resolves.toBeNull();
  });
});

describe("resolveInitialOutputDir", () => {
  it("returns the persisted value without calling downloadDir when a valid value is stored", async () => {
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, "/Users/me/Archives");
    const result = await resolveInitialOutputDir();
    expect(result).toBe("/Users/me/Archives");
    expect(mockedDownloadDir).not.toHaveBeenCalled();
  });

  it("returns downloadDir's value when no persisted value is present", async () => {
    mockedDownloadDir.mockResolvedValue("/Users/me/Downloads");
    const result = await resolveInitialOutputDir();
    expect(result).toBe("/Users/me/Downloads");
    expect(mockedDownloadDir).toHaveBeenCalledOnce();
  });

  it("returns downloadDir's value when the persisted value is invalid", async () => {
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, "   ");
    mockedDownloadDir.mockResolvedValue("/Users/me/Downloads");
    const result = await resolveInitialOutputDir();
    expect(result).toBe("/Users/me/Downloads");
    expect(mockedDownloadDir).toHaveBeenCalledOnce();
  });
});
