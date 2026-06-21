import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { RunSummary } from "./RunSummary";

// The store module imports the archive lib at load time; mock it so nothing
// reaches the real Tauri backend.
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  setNamingRule: vi.fn(),
  setOutputDir: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));

beforeEach(() => {
  resetJobStore();
});

describe("RunSummary", () => {
  it("renders nothing before a job finishes", () => {
    const { container } = render(<RunSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("projects the JobSummaryDto counts and failure reasons", () => {
    useJobStore.setState({
      previewNames: ["out_1.zip", "out_2.zip", "out_3.zip"],
      taskIdByIndex: [10, 11, 12],
      summary: {
        succeeded: [10],
        cancelled: [11],
        failed: [{ taskId: 12, reason: "unrar error: boom" }],
      },
    });

    render(<RunSummary />);

    // Counts (projected from array lengths, not recomputed).
    expect(screen.getByText(/Succeeded/).textContent).toMatch(/Succeeded\s*1/);
    expect(screen.getByText(/Cancelled/).textContent).toMatch(/Cancelled\s*1/);
    expect(screen.getByText(/Failed/).textContent).toMatch(/Failed\s*1/);

    // The failed item is mapped back to its output name + reason.
    const failed = screen.getByText(/out_3\.zip/);
    expect(failed.textContent).toContain("unrar error: boom");
  });

  it("exposes the summary to assistive tech via role=status", () => {
    useJobStore.setState({
      summary: { succeeded: [1], cancelled: [], failed: [] },
    });
    render(<RunSummary />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("falls back to a task-id label when the output name is unavailable", () => {
    useJobStore.setState({
      previewNames: [],
      taskIdByIndex: [],
      summary: {
        succeeded: [],
        cancelled: [],
        failed: [{ taskId: 12, reason: "boom" }],
      },
    });
    render(<RunSummary />);
    expect(screen.getByText(/task 12/).textContent).toContain("boom");
  });

  it("renders every failed item with its output name and reason", () => {
    useJobStore.setState({
      previewNames: ["out_1.zip", "out_2.zip"],
      taskIdByIndex: [10, 11],
      summary: {
        succeeded: [],
        cancelled: [],
        failed: [
          { taskId: 10, reason: "err A" },
          { taskId: 11, reason: "err B" },
        ],
      },
    });
    render(<RunSummary />);
    expect(screen.getByText(/out_1\.zip/).textContent).toContain("err A");
    expect(screen.getByText(/out_2\.zip/).textContent).toContain("err B");
  });

  it("reads 'extracted N' in folder mode", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "folder",
        conflictPolicy: "autoRename",
      },
      summary: { succeeded: [1, 2], cancelled: [], failed: [] },
    });
    render(<RunSummary />);
    expect(screen.getByText(/extracted 2/i)).toBeTruthy();
  });

  it("reads 'archived N' in zip mode", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      summary: { succeeded: [1, 2], cancelled: [], failed: [] },
    });
    render(<RunSummary />);
    expect(screen.getByText(/archived 2/i)).toBeTruthy();
  });

  it("omits the failed-items disclosure when there are no failures", () => {
    useJobStore.setState({
      summary: { succeeded: [1], cancelled: [], failed: [] },
    });
    render(<RunSummary />);
    expect(screen.queryByText(/Errors/)).toBeNull();
  });
});
