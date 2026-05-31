import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProgressEvent } from "@/bindings/ProgressEvent";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import App from "./App";

// ---------------------------------------------------------------------------
// Tauri / plugin mocks — must be set up before the component is imported.
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("preview.zip")),
}));

vi.mock("@/lib/archive", () => ({
  subscribeProgress: vi.fn(() => Promise.resolve(() => {})),
  addItems: vi.fn(),
  reorder: vi.fn(),
  setNamingRule: vi.fn(),
  setOutputDir: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  previewOutputName: vi.fn(() => Promise.resolve("preview.zip")),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Import the mocked module so tests can access vi.fn() instances directly.
import * as archiveMock from "@/lib/archive";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("App", () => {
  beforeEach(() => {
    resetJobStore();
    vi.clearAllMocks();
    // Restore the default mock return so individual tests that override it
    // don't bleed into subsequent tests.
    vi.mocked(archiveMock.subscribeProgress).mockResolvedValue(() => {});
  });

  // -------------------------------------------------------------------------
  // 1. Renders the key UI elements
  // -------------------------------------------------------------------------
  it("renders the key UI elements", async () => {
    render(<App />);

    // Page heading
    expect(screen.getByText("simple-archiver")).toBeDefined();

    // FileDropZone — "Add files" browse button
    expect(screen.getByRole("button", { name: /add files/i })).toBeDefined();

    // NamingRuleForm — "Naming template" label
    expect(screen.getByText(/naming template/i)).toBeDefined();

    // TaskList — empty-state message
    expect(screen.getByText(/no items yet/i)).toBeDefined();

    // OutputDirPicker — "Output directory" label
    expect(screen.getByText(/output directory/i)).toBeDefined();

    // RunControls — "Run" button
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 2. Subscribes to progress on mount and routes events to applyProgress
  // -------------------------------------------------------------------------
  it("subscribes to progress on mount and routes events into the store", async () => {
    // Capture the callback that App passes to subscribeProgress.
    let capturedCallback: ((event: ProgressEvent) => void) | undefined;
    vi.mocked(archiveMock.subscribeProgress).mockImplementation((cb) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    });

    render(<App />);

    // Wait until subscribeProgress has been called.
    await waitFor(() =>
      expect(archiveMock.subscribeProgress).toHaveBeenCalledTimes(1),
    );

    expect(capturedCallback).toBeDefined();

    // Simulate a progress event arriving from the backend.
    const progressEvent = {
      overall: { bytesDone: 5, bytesTotal: 10 },
      perTask: [{ taskId: 1, bytesDone: 5, bytesTotal: 10 }],
      elapsedMs: 1,
    };

    await act(async () => {
      capturedCallback?.(progressEvent);
    });

    // Verify the store reflects the routed progress event.
    expect(useJobStore.getState().progress).toEqual(progressEvent);
    expect(useJobStore.getState().taskIdByIndex).toEqual([1]);
  });

  // -------------------------------------------------------------------------
  // 3. Unsubscribes on unmount
  // -------------------------------------------------------------------------
  it("calls the unlisten function when the component unmounts", async () => {
    const unlistenSpy = vi.fn();
    vi.mocked(archiveMock.subscribeProgress).mockResolvedValue(unlistenSpy);

    const { unmount } = render(<App />);

    // Ensure the subscription promise has resolved before unmounting.
    await waitFor(() =>
      expect(archiveMock.subscribeProgress).toHaveBeenCalled(),
    );

    unmount();

    // The unlisten function must be called after unmount.
    await waitFor(() => expect(unlistenSpy).toHaveBeenCalled());
  });

  // -------------------------------------------------------------------------
  // 4. Happy-path: Run button triggers runJob and TaskList shows item basename
  // -------------------------------------------------------------------------
  it("clicking Run calls runJob and TaskList shows the item basename", async () => {
    // Set up a runnable draft in the store.
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: "photo_{n:03}",
        outputDir: "/out",
      },
    });

    // Replace the store's runJob action with a spy so we can assert it was called.
    const runJobSpy = vi.fn(() => Promise.resolve());
    useJobStore.setState({ runJob: runJobSpy });

    const user = userEvent.setup();
    render(<App />);

    // TaskList should display the basename of the queued item.
    expect(screen.getByText("a.rar")).toBeDefined();

    // Run button must be enabled BEFORE clicking (items + outputDir are set).
    const runButton = screen.getByRole("button", { name: /^run$/i });
    expect((runButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(runButton);

    expect(runJobSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 5. Error banner: store.error is rendered in a top-level role="alert"
  // -------------------------------------------------------------------------
  it("shows a role=alert banner containing the error string when store.error is set", () => {
    useJobStore.setState({ error: "kaboom" });

    render(<App />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("kaboom");
  });
});
