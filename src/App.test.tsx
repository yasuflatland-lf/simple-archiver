import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

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

// Mock the smart-default output-dir resolver so the mount effect can be driven
// deterministically without a Tauri backend.
vi.mock("@/lib/output-dir-default", () => ({
  resolveInitialOutputDir: vi.fn(() => Promise.resolve(null)),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Import the mocked module so tests can access vi.fn() instances directly.
import * as archiveMock from "@/lib/archive";
import { resolveInitialOutputDir } from "@/lib/output-dir-default";

const mockResolveInitialOutputDir = vi.mocked(resolveInitialOutputDir);

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
    // Default the smart-default resolver to "no directory" so unrelated tests
    // don't trigger an output-dir apply; tests that exercise it override this.
    mockResolveInitialOutputDir.mockResolvedValue(null);
    // App renders NamingRuleForm, whose mount effect calls the store's
    // setNamingRule after a debounce. The real action awaits the mocked
    // archive.setNamingRule (which returns undefined here) and would then
    // set draft: undefined, crashing TaskList/RunControls. On fast runners the
    // test finishes and unmounts before the debounce fires; on slow ones it
    // fires mid-test. Replace the action with a no-op spy so the debounce can
    // never mutate the draft, mirroring NamingRuleForm.test.tsx.
    useJobStore.setState({ setNamingRule: vi.fn() });
  });

  // -------------------------------------------------------------------------
  // 1. Renders the key UI elements
  // -------------------------------------------------------------------------
  it("renders the key UI elements", async () => {
    render(<App />);

    // Header
    expect(screen.getByText("simple-archiver")).toBeDefined();
    // Toolbar — add-source fallback + setup controls. The empty-state CTA also
    // renders AddSourceButtons, so "Add files" appears in both the toolbar and
    // the main region; assert at least one is present.
    expect(
      screen.getAllByRole("button", { name: /add files/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Destination")).toBeDefined();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDefined();
    // Main — empty-state CTA (replaces the old "No items yet" text)
    expect(screen.getByText(/drag .* drop files or folders/i)).toBeDefined();
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
      perTask: [{ taskId: 1, bytesDone: 5, bytesTotal: 10, etaMs: null }],
      elapsedMs: 1,
      overallEtaMs: null,
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

  // -------------------------------------------------------------------------
  // 6–10. Smart-default output dir
  // -------------------------------------------------------------------------
  describe("smart-default output dir", () => {
    // Shared spy — reset by outer beforeEach (resetJobStore) then re-applied
    // here so all five cases can assert on the same action without repeating
    // the two-line setup.
    let setOutputDirSpy: Mock<(dir: string) => Promise<void>>;

    beforeEach(() => {
      setOutputDirSpy = vi.fn(async (_dir: string) => {});
      useJobStore.setState({ setOutputDir: setOutputDirSpy });
    });

    // Helper: return a deferred promise whose resolve handle is exposed so a
    // test can control exactly when the resolution lands (tests 8 and 9).
    function makeDeferredDir(): {
      promise: Promise<string | null>;
      resolve: (dir: string | null) => void;
    } {
      let resolve: (dir: string | null) => void = () => {};
      const promise = new Promise<string | null>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    }

    // -------------------------------------------------------------------------
    // 6. Applied at mount when none is set yet
    // -------------------------------------------------------------------------
    it("applies the resolved default output dir on mount when none is set", async () => {
      mockResolveInitialOutputDir.mockResolvedValue("/Users/me/Downloads");

      render(<App />);

      await waitFor(() =>
        expect(setOutputDirSpy).toHaveBeenCalledWith("/Users/me/Downloads"),
      );
    });

    // -------------------------------------------------------------------------
    // 7. Never overrides an existing destination
    // -------------------------------------------------------------------------
    it("does not apply the default when a destination is already set", async () => {
      mockResolveInitialOutputDir.mockResolvedValue("/Users/me/Downloads");

      // Seed an existing destination so the mount effect bails before
      // resolving the default. Merged into a single setState call.
      useJobStore.setState({
        draft: { items: [], namingTemplate: null, outputDir: "/already/set" },
        setOutputDir: setOutputDirSpy,
      });

      render(<App />);

      // Give any pending microtasks a chance to run, then assert no apply.
      await waitFor(() =>
        expect(archiveMock.subscribeProgress).toHaveBeenCalled(),
      );
      expect(mockResolveInitialOutputDir).not.toHaveBeenCalled();
      expect(setOutputDirSpy).not.toHaveBeenCalled();
      expect(useJobStore.getState().draft.outputDir).toBe("/already/set");
    });

    // -------------------------------------------------------------------------
    // 8. Unmount before resolution → no apply
    // -------------------------------------------------------------------------
    it("does not apply the default when the component unmounts before resolution", async () => {
      const { promise, resolve: resolveDir } = makeDeferredDir();
      mockResolveInitialOutputDir.mockReturnValue(promise);

      const { unmount } = render(<App />);

      // The resolver must have been invoked (no destination is set yet).
      await waitFor(() =>
        expect(mockResolveInitialOutputDir).toHaveBeenCalled(),
      );

      // Unmount BEFORE the resolution lands; the effect's `active` flag must now
      // suppress the apply when the promise finally resolves.
      unmount();

      await act(async () => {
        resolveDir("/Users/me/Downloads");
      });

      expect(setOutputDirSpy).not.toHaveBeenCalled();
      expect(useJobStore.getState().draft.outputDir).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 9. A concurrent user choice is not clobbered
    // -------------------------------------------------------------------------
    it("does not clobber a destination chosen while resolution is in flight", async () => {
      const { promise, resolve: resolveDir } = makeDeferredDir();
      mockResolveInitialOutputDir.mockReturnValue(promise);

      render(<App />);

      await waitFor(() =>
        expect(mockResolveInitialOutputDir).toHaveBeenCalled(),
      );

      // A user (or persistence) picks a destination while the resolver is still
      // pending. The post-await store re-check must keep this value intact.
      act(() => {
        useJobStore.setState({
          draft: { items: [], namingTemplate: null, outputDir: "/user/picked" },
        });
      });

      // The resolver finally yields a DIFFERENT directory; the guard must drop it.
      await act(async () => {
        resolveDir("/Users/me/Downloads");
      });

      expect(setOutputDirSpy).not.toHaveBeenCalled();
      expect(useJobStore.getState().draft.outputDir).toBe("/user/picked");
    });

    // -------------------------------------------------------------------------
    // 10. A rejected resolution is non-fatal
    // -------------------------------------------------------------------------
    it("does not mutate the store or crash when resolution rejects", async () => {
      mockResolveInitialOutputDir.mockRejectedValue(new Error("resolver boom"));

      // Silence the effect's non-fatal .catch log for a clean test run.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(<App />);

      // The rejection must have been observed by the effect's .catch handler.
      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "default output dir resolution failed",
          expect.any(Error),
        ),
      );

      expect(setOutputDirSpy).not.toHaveBeenCalled();
      expect(useJobStore.getState().draft.outputDir).toBeNull();
      // The app stays mounted and rendered despite the rejection.
      expect(screen.getByText("simple-archiver")).toBeDefined();

      errorSpy.mockRestore();
    });
  });
});
