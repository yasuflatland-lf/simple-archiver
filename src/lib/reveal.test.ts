import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  openPath as openWith,
  revealItemInDir,
} from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

// Import after the mocks are registered.
import { copyText, openPath, revealItem } from "./reveal";

describe("reveal client", () => {
  beforeEach(() => {
    vi.mocked(openWith).mockReset();
    vi.mocked(revealItemInDir).mockReset();
    vi.mocked(writeText).mockReset();
  });

  describe("openPath", () => {
    it("opens the given path via the opener plugin exactly once", async () => {
      vi.mocked(openWith).mockResolvedValue(undefined);

      await openPath("/x");

      expect(vi.mocked(openWith)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(openWith)).toHaveBeenCalledWith("/x");
    });

    it("propagates a plugin failure rather than swallowing it", async () => {
      vi.mocked(openWith).mockRejectedValue(new Error("no such path"));

      await expect(openPath("/missing")).rejects.toThrow("no such path");
    });
  });

  describe("revealItem", () => {
    it("reveals the given path via revealItemInDir exactly once", async () => {
      vi.mocked(revealItemInDir).mockResolvedValue(undefined);

      await revealItem("/out/photo_001.zip");

      expect(vi.mocked(revealItemInDir)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(revealItemInDir)).toHaveBeenCalledWith(
        "/out/photo_001.zip",
      );
    });

    it("propagates a reveal failure rather than swallowing it", async () => {
      vi.mocked(revealItemInDir).mockRejectedValue(new Error("not found"));

      await expect(revealItem("/missing")).rejects.toThrow("not found");
    });
  });

  describe("copyText", () => {
    it("writes the given text to the clipboard exactly once", async () => {
      vi.mocked(writeText).mockResolvedValue(undefined);

      await copyText("/out/photo_001.zip");

      expect(vi.mocked(writeText)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(writeText)).toHaveBeenCalledWith("/out/photo_001.zip");
    });

    it("propagates a clipboard failure rather than swallowing it", async () => {
      vi.mocked(writeText).mockRejectedValue(new Error("clipboard denied"));

      await expect(copyText("/x")).rejects.toThrow("clipboard denied");
    });
  });
});
