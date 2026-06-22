import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import { openPath } from "@/lib/reveal";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { LastBatchChip } from "./LastBatchChip";

// The store imports the archive lib at load time; mock it so nothing reaches
// the real Tauri backend during render/interaction.
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  setNamingRule: vi.fn(),
  setStartNumber: vi.fn(),
  setOutputDir: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  clearItems: vi.fn(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));

// Mock the opener wrapper so the chip's Open action never reaches Tauri.
vi.mock("@/lib/reveal", () => ({
  openPath: vi.fn(),
  copyText: vi.fn(),
}));

const SUMMARY: JobSummaryDto = {
  succeeded: [1, 2, 3],
  cancelled: [],
  failed: [],
  results: [],
};

beforeEach(() => {
  resetJobStore();
  vi.mocked(openPath).mockReset();
});

describe("LastBatchChip", () => {
  it("renders nothing when there is no residual last batch", () => {
    const { container } = render(<LastBatchChip />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the batch count and destination", () => {
    useJobStore.setState({
      lastBatch: { summary: SUMMARY, outputDir: "/out/dir", count: 3 },
    });
    render(<LastBatchChip />);
    expect(screen.getByText(/3 items/i)).toBeTruthy();
    expect(screen.getByText(/\/out\/dir/)).toBeTruthy();
  });

  it("opens the batch destination when Open is clicked", async () => {
    vi.mocked(openPath).mockResolvedValue(undefined);
    useJobStore.setState({
      lastBatch: { summary: SUMMARY, outputDir: "/out/dir", count: 3 },
    });
    render(<LastBatchChip />);

    await userEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(vi.mocked(openPath)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openPath)).toHaveBeenCalledWith("/out/dir");
  });

  it("disables Open when the destination is null", () => {
    useJobStore.setState({
      lastBatch: { summary: SUMMARY, outputDir: null, count: 3 },
    });
    render(<LastBatchChip />);
    const open = screen.getByRole("button", { name: /open/i });
    expect((open as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores the cleared run when Undo is clicked", async () => {
    useJobStore.setState({
      cleared: true,
      summary: null,
      lastBatch: { summary: SUMMARY, outputDir: "/out/dir", count: 3 },
    });
    render(<LastBatchChip />);

    await userEvent.click(screen.getByRole("button", { name: /undo/i }));

    const state = useJobStore.getState();
    expect(state.summary).toEqual(SUMMARY);
    expect(state.cleared).toBe(false);
    expect(state.lastBatch).toBeNull();
  });

  it("labels the Open and Undo actions for assistive tech", () => {
    useJobStore.setState({
      lastBatch: { summary: SUMMARY, outputDir: "/out/dir", count: 3 },
    });
    render(<LastBatchChip />);
    expect(screen.getByRole("button", { name: /open/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
  });
});
