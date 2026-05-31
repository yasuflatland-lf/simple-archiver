import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { OutputDirPicker } from "./OutputDirPicker";

// Mock the Tauri dialog plugin so tests run without a native Tauri runtime.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("OutputDirPicker", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(open).mockReset();
  });

  it("renders the Destination heading", () => {
    render(<OutputDirPicker />);

    expect(screen.getByText("Destination")).toBeDefined();
  });

  it("renders the current outputDir when set", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: "/my/output" },
    });
    render(<OutputDirPicker />);

    expect(screen.getByText("/my/output")).toBeDefined();
  });

  it("renders a muted placeholder when outputDir is null", () => {
    // resetJobStore already sets outputDir: null, but be explicit.
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
    });
    render(<OutputDirPicker />);

    expect(screen.getByText("(none)")).toBeDefined();
  });

  it("calls open with { directory: true } when the Choose button is clicked", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(vi.mocked(open)).toHaveBeenCalledWith({ directory: true });
    });
  });

  it("calls setOutputDir with the picked path when open resolves a string", async () => {
    vi.mocked(open).mockResolvedValue("/picked/dir");
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(setOutputDir).toHaveBeenCalledWith("/picked/dir");
    });
  });

  it("does NOT call setOutputDir when open resolves null (user cancelled)", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(vi.mocked(open)).toHaveBeenCalled();
    });

    expect(setOutputDir).not.toHaveBeenCalled();
  });

  it("surfaces a real dialog error via the store without crashing or calling setOutputDir", async () => {
    vi.mocked(open).mockRejectedValue("disk fail");
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(useJobStore.getState().error).toBe("disk fail");
    });

    expect(setOutputDir).not.toHaveBeenCalled();
  });
});
