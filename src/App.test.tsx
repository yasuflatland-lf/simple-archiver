import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// open and save are vi.fn() so individual tests can override them with
// mockResolvedValueOnce / mockRejectedValueOnce while keeping sane defaults.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/picked/folder")),
  save: vi.fn(() => Promise.resolve("/picked/out.zip")),
}));

describe("App compress flow", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    // Restore happy-path defaults before each test so tests are isolated.
    vi.mocked(open).mockResolvedValue("/picked/folder");
    vi.mocked(save).mockResolvedValue("/picked/out.zip");
  });

  it("invokes compress_folder with the selected source and output", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /select folder/i }));
    await user.click(screen.getByRole("button", { name: /choose output/i }));
    await user.click(screen.getByRole("button", { name: /^compress$/i }));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("compress_folder", {
      src: "/picked/folder",
      out: "/picked/out.zip",
    });
    await screen.findByText(/done/i);
  });

  it("surfaces an error message when the folder picker dialog rejects", async () => {
    // Simulate a native dialog failure (e.g. capability not initialised).
    vi.mocked(open).mockRejectedValueOnce(new Error("denied"));

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /select folder/i }));

    // The error should appear in the status paragraph — not an unhandled rejection.
    await screen.findByText(/failed to open folder picker/i);
    // The compress button must remain disabled (no source was set).
    // Use the native DOM property — jest-dom is not loaded in this setup.
    expect(
      (screen.getByRole("button", { name: /^compress$/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
