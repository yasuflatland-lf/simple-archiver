import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { StatusBar } from "./StatusBar";

// Minimal DraftItemDto stub.
const ITEM = { path: "/a.rar", kind: "rar" as const };

describe("StatusBar", () => {
  beforeEach(() => resetJobStore());

  it("shows a Ready hint when idle and empty", () => {
    render(<StatusBar />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });

  it("shows the queued count when idle with items", () => {
    useJobStore.setState({
      draft: {
        items: [
          { path: "/a.rar", kind: "rar" },
          { path: "/b", kind: "folder" },
        ],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
    });
    render(<StatusBar />);
    expect(screen.getByText(/2 items queued/i)).toBeTruthy();
  });

  it("shows the singular form when idle with 1 item queued", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      progress: null,
      summary: null,
      running: false,
    });
    render(<StatusBar />);
    expect(screen.getByText(/1 item queued/i)).toBeTruthy();
  });

  // The visible aggregate progress bar moved to the right canvas; the slim
  // footer must NOT render it anymore.
  it("does not render the overall progress bar in the footer while running", () => {
    useJobStore.setState({
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        overallEtaMs: 12000,
        perTask: [],
        elapsedMs: 1000,
      },
    });
    render(<StatusBar />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("announces the mode-aware verb while a folder job runs", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM, ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: "/out",
        outputMode: "folder",
        conflictPolicy: "autoRename",
      },
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        overallEtaMs: 12000,
        perTask: [],
        elapsedMs: 1000,
      },
      summary: null,
    });
    render(<StatusBar />);
    expect(screen.getByText(/extracted 2/i)).toBeTruthy();
  });

  it("announces the archive verb while a zip job runs", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM, ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: "/out",
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        overallEtaMs: 12000,
        perTask: [],
        elapsedMs: 1000,
      },
      summary: null,
    });
    render(<StatusBar />);
    expect(screen.getByText(/archived 2/i)).toBeTruthy();
  });

  // The run summary moved to the right canvas; the slim footer must NOT render
  // it anymore (no role="status" panel in the footer).
  it("does not render the run summary panel in the footer when a job has finished", () => {
    useJobStore.setState({
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
    });
    render(<StatusBar />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reset slot — visibility
// ---------------------------------------------------------------------------

describe("StatusBar Reset slot – visibility", () => {
  beforeEach(() => resetJobStore());

  it("does not show Reset when items is empty (not running)", () => {
    // default state: no items, not running
    render(<StatusBar />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("does not show Reset when items is empty and running", () => {
    useJobStore.setState({ running: true });
    render(<StatusBar />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("shows Reset when hasItems and not running (no summary)", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
    });
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("does not show Reset when hasItems but running", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: true,
      summary: null,
    });
    render(<StatusBar />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("shows Reset after job finishes (summary set, hasItems, not running)", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
    });
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: /new batch/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reset slot — label
// ---------------------------------------------------------------------------

describe("StatusBar Reset slot – label", () => {
  beforeEach(() => resetJobStore());

  it("labels the button 'Clear' when summary is null", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
    });
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: /^clear$/i })).toBeTruthy();
  });

  it("labels the button 'New batch' when summary is not null", () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: {
        succeeded: [],
        cancelled: [],
        failed: [{ taskId: 1, reason: "error" }],
        results: [],
      },
    });
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: /^new batch$/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reset slot — ConfirmDialog flow
// ---------------------------------------------------------------------------

describe("StatusBar Reset slot – confirm dialog", () => {
  beforeEach(() => resetJobStore());

  it("opens the dialog when the Reset button is clicked", async () => {
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("calls reset() once when the user confirms the dialog (Clear flow)", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    // The confirm button inside the dialog: scope to dialog to avoid ambiguity.
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^clear$/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not call reset() when the user cancels the dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(reset).not.toHaveBeenCalled();
  });

  it("calls reset() once when confirming the 'New batch' dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^new batch$/i }));
    // Scope to the dialog to avoid ambiguity with the footer Reset button.
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^new batch$/i }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not call reset() when cancelling the 'New batch' dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^new batch$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(reset).not.toHaveBeenCalled();
  });

  it("closes the dialog after confirming", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^clear$/i,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dialog after cancelling", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [ITEM],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
