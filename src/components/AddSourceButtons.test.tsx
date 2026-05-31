import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { AddSourceButtons } from "./AddSourceButtons";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("AddSourceButtons", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(open).mockReset();
  });

  it("opens the rar file dialog and adds the picked files", async () => {
    vi.mocked(open).mockResolvedValue(["/x.rar"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add files/i }));

    expect(vi.mocked(open)).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      filters: [{ name: "rar", extensions: ["rar"] }],
    });
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/x.rar"]));
  });

  it("opens the folder dialog and adds the picked folder", async () => {
    vi.mocked(open).mockResolvedValue(["/my/folder"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add folder/i }));

    expect(vi.mocked(open)).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
    });
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/my/folder"]));
  });

  it("does not add when the dialog is cancelled (open returns null)", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    const user = userEvent.setup();
    render(<AddSourceButtons />);
    await user.click(screen.getByRole("button", { name: /add files/i }));
    expect(addItems).not.toHaveBeenCalled();
  });

  it("surfaces a dialog/IPC error to the store", async () => {
    vi.mocked(open).mockRejectedValue(new Error("permission denied"));
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
});
