import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// Import after the mock is registered.
import { pickDirectory, pickFiles, pickFolders } from "./dialog";

describe("dialog client", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  describe("pickFiles", () => {
    it("opens a multi-select archive (rar/zip) file picker", async () => {
      vi.mocked(open).mockResolvedValue(["/a.rar", "/b.zip"]);

      const result = await pickFiles();

      expect(vi.mocked(open)).toHaveBeenCalledWith({
        multiple: true,
        directory: false,
        filters: [{ name: "Archives", extensions: ["rar", "zip"] }],
      });
      expect(result).toEqual(["/a.rar", "/b.zip"]);
    });

    it("normalizes a cancelled pick (null) to an empty array", async () => {
      vi.mocked(open).mockResolvedValue(null);

      expect(await pickFiles()).toEqual([]);
    });
  });

  describe("pickFolders", () => {
    it("opens a multi-select folder picker", async () => {
      vi.mocked(open).mockResolvedValue(["/one", "/two"]);

      const result = await pickFolders();

      expect(vi.mocked(open)).toHaveBeenCalledWith({
        directory: true,
        multiple: true,
      });
      expect(result).toEqual(["/one", "/two"]);
    });

    it("normalizes a cancelled pick (null) to an empty array", async () => {
      vi.mocked(open).mockResolvedValue(null);

      expect(await pickFolders()).toEqual([]);
    });
  });

  describe("pickDirectory", () => {
    it("opens a single-select directory picker", async () => {
      vi.mocked(open).mockResolvedValue("/picked/dir");

      const result = await pickDirectory();

      expect(vi.mocked(open)).toHaveBeenCalledWith({ directory: true });
      expect(result).toBe("/picked/dir");
    });

    it("returns null when the user cancels", async () => {
      vi.mocked(open).mockResolvedValue(null);

      expect(await pickDirectory()).toBeNull();
    });
  });
});
