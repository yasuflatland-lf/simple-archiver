import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { RightCanvas } from "./RightCanvas";

// EmptyQueue / AddSourceButtons reach the dialog plugin on interaction; mock it
// so the canvas renders without a native Tauri runtime.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("preview.zip")),
}));

const ITEM = { path: "/a.rar", kind: "rar" as const };

const SUMMARY: JobSummaryDto = {
  succeeded: [1],
  cancelled: [],
  failed: [],
  results: [],
};

beforeEach(() => {
  resetJobStore();
});

function setItems(count: number) {
  useJobStore.setState({
    draft: {
      items: Array.from({ length: count }, () => ITEM),
      namingTemplate: null,
      startNumber: 1,
      outputDir: "/out",
      outputMode: "zip",
      conflictPolicy: "autoRename",
    },
  });
}

describe("RightCanvas", () => {
  it("is an accessible main landmark labelled as the work area", () => {
    render(<RightCanvas />);
    // The canvas is the <main> landmark; the aria-label names it the work area.
    expect(screen.getByRole("main", { name: /work area/i })).toBeTruthy();
  });

  it("renders the empty drop zone when there are no items", () => {
    render(<RightCanvas />);
    expect(screen.getByTestId("empty-queue")).toBeTruthy();
    expect(screen.getByText(/drag .* drop files or folders/i)).toBeTruthy();
  });

  it("renders the task list (not the drop zone) when items are queued", () => {
    setItems(2);
    render(<RightCanvas />);
    expect(screen.queryByTestId("empty-queue")).toBeNull();
    // The table chrome from TaskList is present.
    expect(screen.getByRole("table")).toBeTruthy();
    // setItems(2) queues two identical rows, so the basename appears twice.
    expect(screen.getAllByText("a.rar").length).toBe(2);
  });

  it("offers the browse fallback to add more sources when items are queued", () => {
    setItems(2);
    render(<RightCanvas />);
    expect(screen.getByRole("button", { name: /add files/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeTruthy();
  });

  it("renders overall progress and the task list while running", () => {
    setItems(2);
    useJobStore.setState({
      running: true,
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        perTask: [{ taskId: 1, bytesDone: 5, bytesTotal: 10, etaMs: null }],
        elapsedMs: 1,
        overallEtaMs: null,
      },
    });
    render(<RightCanvas />);
    expect(
      screen.getByRole("region", { name: /overall progress/i }),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("renders the run summary when a summary is present", () => {
    setItems(1);
    useJobStore.setState({ summary: SUMMARY });
    render(<RightCanvas />);
    expect(screen.getByRole("status", { name: /run summary/i })).toBeTruthy();
    // The drop zone must be gone in the results phase.
    expect(screen.queryByTestId("empty-queue")).toBeNull();
  });

  it("prefers the running phase over a stale summary", () => {
    setItems(1);
    useJobStore.setState({
      running: true,
      summary: SUMMARY,
      progress: {
        overall: { bytesDone: 1, bytesTotal: 10 },
        perTask: [{ taskId: 1, bytesDone: 1, bytesTotal: 10, etaMs: null }],
        elapsedMs: 1,
        overallEtaMs: null,
      },
    });
    render(<RightCanvas />);
    expect(
      screen.getByRole("region", { name: /overall progress/i }),
    ).toBeTruthy();
    // The summary panel must not show while a job is still running.
    expect(screen.queryByRole("status", { name: /run summary/i })).toBeNull();
  });
});
