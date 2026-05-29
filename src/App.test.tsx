import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve("/picked/folder")),
  save: vi.fn(() => Promise.resolve("/picked/out.zip")),
}));

describe("App compress flow", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
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
});
