import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetJobStore, useJobStore } from "@/store/jobStore";
import { FileDropZone } from "./FileDropZone";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("FileDropZone", () => {
  // Shared mocks set up before each test.
  let unlisten: ReturnType<typeof vi.fn>;
  let captured:
    | ((event: { payload: { type: string; paths?: string[] } }) => void)
    | undefined;
  let onDragDropEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobStore();
    vi.mocked(open).mockReset();

    unlisten = vi.fn();
    captured = undefined;
    onDragDropEvent = vi.fn((cb) => {
      captured = cb;
      return Promise.resolve(unlisten);
    });
    vi.mocked(getCurrentWebview).mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);
  });

  it("subscribes to drag-drop events on mount via onDragDropEvent", async () => {
    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());
  });

  it("calls addItems with dropped paths on a drop event", async () => {
    // Spy on the real store action.
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () => {
      captured?.({ payload: { type: "drop", paths: ["/a.rar", "/b"] } });
    });

    await waitFor(() =>
      expect(addItems).toHaveBeenCalledWith(["/a.rar", "/b"]),
    );
  });

  it("highlights the drop zone on a drag enter event and removes it on leave", async () => {
    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const zone = screen.getByTestId("drop-zone");
    const baseClass = zone.className;

    // Enter: should gain a highlight class.
    await act(async () => {
      captured?.({ payload: { type: "enter" } });
    });
    expect(zone.className).not.toBe(baseClass);

    // Leave: highlight should be gone.
    await act(async () => {
      captured?.({ payload: { type: "leave" } });
    });
    expect(zone.className).toBe(baseClass);
  });

  it("highlights the drop zone on a drag over event", async () => {
    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const zone = screen.getByTestId("drop-zone");
    const baseClass = zone.className;

    await act(async () => {
      captured?.({ payload: { type: "over" } });
    });
    expect(zone.className).not.toBe(baseClass);
  });

  it("calls unlisten on component unmount", async () => {
    const { unmount } = render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    unmount();
    // unlisten is called asynchronously in a cleanup; wait for it.
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  it("opens rar file dialog when Add files button is clicked", async () => {
    vi.mocked(open).mockResolvedValue(["/x.rar"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add files/i }));

    expect(vi.mocked(open)).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      filters: [{ name: "rar", extensions: ["rar"] }],
    });
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/x.rar"]));
  });

  it("opens folder dialog when Add folder button is clicked", async () => {
    vi.mocked(open).mockResolvedValue(["/my/folder"]);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add folder/i }));

    expect(vi.mocked(open)).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
    });
    await waitFor(() => expect(addItems).toHaveBeenCalledWith(["/my/folder"]));
  });

  it("does not call addItems when the dialog is cancelled (open returns null)", async () => {
    vi.mocked(open).mockResolvedValue(null);
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /add files/i }));

    // Give any pending microtasks a chance to run.
    await act(async () => {});
    expect(addItems).not.toHaveBeenCalled();
  });

  it("surfaces a dialog/IPC error to the store when Add files open() rejects", async () => {
    vi.mocked(open).mockRejectedValue("boom");
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const user = userEvent.setup();
    // Component must not crash.
    await user.click(screen.getByRole("button", { name: /add files/i }));

    await act(async () => {});
    // addItems must NOT be called on a dialog failure.
    expect(addItems).not.toHaveBeenCalled();
    // The real error message must appear in the store.
    expect(useJobStore.getState().error).toBe("boom");
  });

  it("surfaces a dialog/IPC error to the store when Add folder open() rejects", async () => {
    vi.mocked(open).mockRejectedValue(new Error("permission denied"));
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    const user = userEvent.setup();
    // Component must not crash.
    await user.click(screen.getByRole("button", { name: /add folder/i }));

    await act(async () => {});
    // addItems must NOT be called on a dialog failure.
    expect(addItems).not.toHaveBeenCalled();
    // The real error message must appear in the store.
    expect(useJobStore.getState().error).toBe("permission denied");
  });

  it("does not call addItems when a drop event delivers an empty paths array", async () => {
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });

    render(<FileDropZone />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () => {
      captured?.({ payload: { type: "drop", paths: [] } });
    });

    await act(async () => {});
    // Empty drop must be ignored; isDragging should still be cleared.
    expect(addItems).not.toHaveBeenCalled();
    // The drop zone should no longer be highlighted (isDragging reset to false).
    const zone = screen.getByTestId("drop-zone");
    expect(zone.className).not.toContain("border-primary");
  });
});
