import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDirectory } from "@/lib/dialog";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { OutputDirPicker } from "./OutputDirPicker";

// Mock the dialog lib so tests run without a native Tauri runtime; the lib
// centralizes the plugin open() call (asserted in lib/dialog.test.ts).
vi.mock("@/lib/dialog", () => ({
  pickDirectory: vi.fn(),
}));

describe("OutputDirPicker", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(pickDirectory).mockReset();
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

  it("renders the (not set) empty state with a Required badge when outputDir is null", () => {
    // resetJobStore already sets outputDir: null, but be explicit.
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
    });
    render(<OutputDirPicker />);

    expect(screen.getByText("(not set)")).toBeDefined();
    // The Required badge signals the destination must be set before a run.
    expect(screen.getByText("Required")).toBeDefined();
  });

  it("does not render the Required badge once a destination is set", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: "/my/output" },
    });
    render(<OutputDirPicker />);

    expect(screen.queryByText("Required")).toBeNull();
    expect(screen.queryByText("(not set)")).toBeNull();
  });

  it("invokes the directory picker when the Choose button is clicked", async () => {
    vi.mocked(pickDirectory).mockResolvedValue(null);
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(vi.mocked(pickDirectory)).toHaveBeenCalled();
    });
  });

  it("calls setOutputDir with the picked path when pickDirectory resolves a string", async () => {
    vi.mocked(pickDirectory).mockResolvedValue("/picked/dir");
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(setOutputDir).toHaveBeenCalledWith("/picked/dir");
    });
  });

  it("does NOT call setOutputDir when pickDirectory resolves null (user cancelled)", async () => {
    vi.mocked(pickDirectory).mockResolvedValue(null);
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<OutputDirPicker />);

    await user.click(screen.getByRole("button", { name: /choose/i }));

    await waitFor(() => {
      expect(vi.mocked(pickDirectory)).toHaveBeenCalled();
    });

    expect(setOutputDir).not.toHaveBeenCalled();
  });

  it("surfaces a real dialog error via the store without crashing or calling setOutputDir", async () => {
    vi.mocked(pickDirectory).mockRejectedValue("disk fail");
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
