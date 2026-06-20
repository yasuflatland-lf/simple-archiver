import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickFiles, pickFolders } from "@/lib/dialog";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { AddSourceButtons } from "./AddSourceButtons";

// Mock the dialog lib so tests run without a native Tauri runtime; the lib
// itself centralizes the plugin open() calls (asserted in lib/dialog.test.ts).
vi.mock("@/lib/dialog", () => ({
  pickFiles: vi.fn(),
  pickFolders: vi.fn(),
}));

describe("AddSourceButtons", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(pickFiles).mockReset();
    vi.mocked(pickFolders).mockReset();
  });

  it("opens the archive file dialog (rar/zip) and adds the picked files", async () => {
    vi.mocked(pickFiles).mockResolvedValue(["/x.rar"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add files/i }));

    expect(vi.mocked(pickFiles)).toHaveBeenCalled();
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/x.rar"]));
  });

  it("opens the folder dialog and adds the picked folder", async () => {
    vi.mocked(pickFolders).mockResolvedValue(["/my/folder"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add folder/i }));

    expect(vi.mocked(pickFolders)).toHaveBeenCalled();
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/my/folder"]));
  });

  it("does not add when the dialog is cancelled (pick returns empty)", async () => {
    vi.mocked(pickFiles).mockResolvedValue([]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add files/i }));
    expect(addItems).not.toHaveBeenCalled();
  });

  it("surfaces a dialog/IPC error to the store", async () => {
    vi.mocked(pickFolders).mockRejectedValue(new Error("permission denied"));
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add folder/i }));

    await waitFor(() =>
      expect(useJobStore.getState().error).toBe("permission denied"),
    );
    expect(addItems).not.toHaveBeenCalled();
  });

  it("surfaces a string-typed dialog rejection on the files button", async () => {
    // Tauri command errors can arrive as raw strings, not wrapped in Error objects.
    // This test ensures that messageFromReason handles string-type rejections.
    vi.mocked(pickFiles).mockRejectedValue("boom");
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add files/i }));

    await waitFor(() => expect(useJobStore.getState().error).toBe("boom"));
    expect(addItems).not.toHaveBeenCalled();
  });
});

describe("AddSourceButtons – icons", () => {
  beforeEach(() => resetJobStore());

  it("renders a decorative icon on each button without changing the accessible name", () => {
    render(<AddSourceButtons />);
    const files = screen.getByRole("button", { name: /add files/i });
    const folder = screen.getByRole("button", { name: /add folder/i });
    const filesSvg = files.querySelector("svg");
    const folderSvg = folder.querySelector("svg");
    expect(filesSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(folderSvg?.getAttribute("aria-hidden")).toBe("true");
  });
});
