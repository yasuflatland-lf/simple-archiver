import { getCurrentWebview } from "@tauri-apps/api/webview";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { useFileDrop } from "./useFileDrop";

vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));

// A tiny probe component that surfaces the hook's isDragging via a data attr.
function Probe() {
  const { isDragging } = useFileDrop();
  return <div data-testid="probe" data-dragging={String(isDragging)} />;
}

describe("useFileDrop", () => {
  let unlisten: ReturnType<typeof vi.fn>;
  let captured:
    | ((event: { payload: { type: string; paths?: string[] } }) => void)
    | undefined;
  let onDragDropEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobStore();
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

  it("subscribes once on mount", async () => {
    render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalledTimes(1));
  });

  it("sets isDragging true on enter/over and false on leave", async () => {
    const { getByTestId } = render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () => captured?.({ payload: { type: "enter" } }));
    expect(getByTestId("probe").dataset.dragging).toBe("true");

    await act(async () => captured?.({ payload: { type: "over" } }));
    expect(getByTestId("probe").dataset.dragging).toBe("true");

    await act(async () => captured?.({ payload: { type: "leave" } }));
    expect(getByTestId("probe").dataset.dragging).toBe("false");
  });

  it("calls addItems with dropped paths and clears dragging", async () => {
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });
    const { getByTestId } = render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () =>
      captured?.({ payload: { type: "drop", paths: ["/a.rar", "/b"] } }),
    );
    expect(addItems).toHaveBeenCalledWith(["/a.rar", "/b"]);
    expect(getByTestId("probe").dataset.dragging).toBe("false");
  });

  it("ignores an empty drop but still clears dragging", async () => {
    const addItems = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ addItems });
    const { getByTestId } = render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () => captured?.({ payload: { type: "drop", paths: [] } }));
    expect(addItems).not.toHaveBeenCalled();
    expect(getByTestId("probe").dataset.dragging).toBe("false");
  });

  it("calls unlisten on unmount", async () => {
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  // B. Subscription failure path — primary affordance; surfaces banner.
  it("surfaces banner when onDragDropEvent subscription rejects", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const subscriptionError = new Error("channel broken");
    onDragDropEvent = vi.fn(() => Promise.reject(subscriptionError));
    vi.mocked(getCurrentWebview).mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);

    const { getByTestId } = render(<Probe />);

    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "drag-drop subscription failed",
      subscriptionError,
    );
    expect(useJobStore.getState().error).toBe(
      "Drag-and-drop is unavailable. Use Add files / Add folder instead.",
    );
    expect(getByTestId("probe").dataset.dragging).toBe("false");

    consoleErrorSpy.mockRestore();
  });

  // C. Early unmount before subscription resolves — unlisten must still fire.
  it("calls unlisten even when unmount races the subscription promise", async () => {
    let resolveSubscription!: (fn: () => void) => void;
    const deferred = new Promise<() => void>((res) => {
      resolveSubscription = res;
    });
    onDragDropEvent = vi.fn((_cb) => deferred);
    vi.mocked(getCurrentWebview).mockReturnValue({
      onDragDropEvent,
    } as unknown as ReturnType<typeof getCurrentWebview>);

    const { unmount } = render(<Probe />);
    // Unmount BEFORE the subscription promise resolves.
    unmount();
    // Now resolve the deferred promise with the unlisten spy.
    resolveSubscription(unlisten as unknown as () => void);

    // The hook's mounted=false path must still call unlisten.
    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });

  // D. Drop failure routes to error banner via messageFromReason.
  it("routes addItems rejection to the error banner", async () => {
    const addItems = vi.fn().mockRejectedValue(new Error("disk full"));
    useJobStore.setState({ addItems });
    render(<Probe />);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());

    await act(async () =>
      captured?.({ payload: { type: "drop", paths: ["/a.rar"] } }),
    );

    await waitFor(() => expect(useJobStore.getState().error).toBe("disk full"));
  });
});
