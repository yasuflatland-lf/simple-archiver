import { openPath as openWith } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));

// Import after the mock is registered.
import { openPath } from "./reveal";

describe("reveal client", () => {
  beforeEach(() => {
    vi.mocked(openWith).mockReset();
  });

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
