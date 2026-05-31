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
});
