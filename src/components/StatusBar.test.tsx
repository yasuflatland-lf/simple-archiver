import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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
// Reset action — relocated to RunControls (regression guard)
// ---------------------------------------------------------------------------

describe("StatusBar – reset action moved out", () => {
  beforeEach(() => resetJobStore());

  // The Clear / New batch action moved to RunControls (beside Run). The slim
  // footer must no longer render it, in any queue/summary state.
  it("does not render a Clear/New batch button when items are queued", () => {
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
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("does not render a Clear/New batch button after a job finishes", () => {
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
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });
});
