import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import { copyText, openPath, revealItem } from "@/lib/reveal";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { Ledger } from "./Ledger";

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

// Mock the opener/clipboard wrapper so the row actions never reach Tauri.
vi.mock("@/lib/reveal", () => ({
  openPath: vi.fn(),
  revealItem: vi.fn(),
  copyText: vi.fn(),
}));

beforeEach(() => {
  resetJobStore();
  vi.mocked(openPath).mockReset();
  vi.mocked(revealItem).mockReset();
  vi.mocked(copyText).mockReset();
});

/** Build a draft with the given items and output directory. */
function draftWith(
  paths: string[],
  outputDir: string | null = "/out",
): DraftSnapshot {
  return {
    items: paths.map((path) => ({ path, kind: "rar" as const })),
    namingTemplate: null,
    startNumber: 1,
    outputDir,
    outputMode: "zip" as const,
    conflictPolicy: "autoRename" as const,
  };
}

/** A mixed summary: one succeeded, one cancelled, one failed. */
const MIXED_SUMMARY: JobSummaryDto = {
  succeeded: [10],
  cancelled: [11],
  failed: [{ taskId: 12, reason: "unrar error: boom" }],
  results: [
    {
      taskId: 10,
      outputName: "out_1.zip",
      outputPath: "/out/out_1.zip",
      status: "succeeded",
      reason: null,
    },
    {
      taskId: 11,
      outputName: "out_2.zip",
      outputPath: "/out/out_2.zip",
      status: "cancelled",
      reason: null,
    },
    {
      taskId: 12,
      outputName: "out_3.zip",
      outputPath: "/out/out_3.zip",
      status: "failed",
      reason: "unrar error: boom",
    },
  ],
};

describe("Ledger", () => {
  it("renders nothing before a job finishes", () => {
    const { container } = render(<Ledger />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes the ledger to assistive tech via role=status", () => {
    useJobStore.setState({
      draft: draftWith(["/a.rar"]),
      summary: {
        succeeded: [1],
        cancelled: [],
        failed: [],
        results: [
          {
            taskId: 1,
            outputName: "out_1.zip",
            outputPath: "/out/out_1.zip",
            status: "succeeded",
            reason: null,
          },
        ],
      },
    });
    render(<Ledger />);
    expect(screen.getByRole("status", { name: /run summary/i })).toBeTruthy();
  });

  it("renders one row per results entry with the source basename and output name", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);

    const rows = screen.getAllByRole("row");
    // 3 result rows (the sticky header is not a table row).
    expect(rows.length).toBe(3);

    expect(screen.getByText("a.rar")).toBeTruthy();
    expect(screen.getByText("b.rar")).toBeTruthy();
    expect(screen.getByText("c.rar")).toBeTruthy();
    expect(screen.getByText("out_1.zip")).toBeTruthy();
    expect(screen.getByText("out_2.zip")).toBeTruthy();
    expect(screen.getByText("out_3.zip")).toBeTruthy();
  });

  it("shows the failure reason inline on a failed row", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    expect(screen.getByText(/unrar error: boom/)).toBeTruthy();
  });

  it("tallies the header counts from the results status, not recomputed", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    // 1 succeeded, 1 cancelled, 1 failed. The counts (with their number) live in
    // the sticky header; the per-row status badges render only the bare label, so
    // matching "<label> <n>" uniquely resolves the header tally.
    expect(screen.getByText(/Succeeded\s*1/)).toBeTruthy();
    expect(screen.getByText(/Cancelled\s*1/)).toBeTruthy();
    expect(screen.getByText(/Failed\s*1/)).toBeTruthy();
  });

  it("shows the per-row size from the last progress event keyed by task id", () => {
    const progress: ProgressEvent = {
      overall: { bytesDone: 0, bytesTotal: 0 },
      overallEtaMs: null,
      elapsedMs: 0,
      perTask: [{ taskId: 10, bytesDone: 2048, bytesTotal: 2048, etaMs: null }],
    };
    useJobStore.setState({
      draft: draftWith(["/in/a.rar"]),
      progress,
      summary: {
        succeeded: [10],
        cancelled: [],
        failed: [],
        results: [
          {
            taskId: 10,
            outputName: "out_1.zip",
            outputPath: "/out/out_1.zip",
            status: "succeeded",
            reason: null,
          },
        ],
      },
    });
    render(<Ledger />);
    // 2048 bytes total → formatBytes renders "done / total unit": "2.0 / 2.0 KB".
    expect(screen.getByText(/2\.0 \/ 2\.0 KB/)).toBeTruthy();
  });

  it("omits the size gracefully when no progress entry matches the row", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar"]),
      progress: null,
      summary: {
        succeeded: [10],
        cancelled: [],
        failed: [],
        results: [
          {
            taskId: 10,
            outputName: "out_1.zip",
            outputPath: "/out/out_1.zip",
            status: "succeeded",
            reason: null,
          },
        ],
      },
    });
    // Should render without throwing and without a size cell value.
    expect(() => render(<Ledger />)).not.toThrow();
    expect(screen.queryByText(/KB|MB|GB/)).toBeNull();
  });

  describe("row actions", () => {
    beforeEach(() => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
        summary: MIXED_SUMMARY,
      });
    });

    it("Reveal on a succeeded row reveals that row's output path", async () => {
      vi.mocked(revealItem).mockResolvedValue(undefined);
      render(<Ledger />);

      const succeededRow = screen.getByText("out_1.zip").closest("tr");
      expect(succeededRow).not.toBeNull();
      await userEvent.click(
        within(succeededRow as HTMLElement).getByRole("button", {
          name: /reveal/i,
        }),
      );

      expect(vi.mocked(revealItem)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(revealItem)).toHaveBeenCalledWith("/out/out_1.zip");
    });

    it("Copy on a row copies that row's output path", async () => {
      vi.mocked(copyText).mockResolvedValue(undefined);
      render(<Ledger />);

      const succeededRow = screen.getByText("out_1.zip").closest("tr");
      await userEvent.click(
        within(succeededRow as HTMLElement).getByRole("button", {
          name: /copy/i,
        }),
      );

      expect(vi.mocked(copyText)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(copyText)).toHaveBeenCalledWith("/out/out_1.zip");
    });

    it("disables Reveal on a failed row (no on-disk output exists)", () => {
      render(<Ledger />);
      const failedRow = screen.getByText("out_3.zip").closest("tr");
      const reveal = within(failedRow as HTMLElement).getByRole("button", {
        name: /reveal/i,
      });
      expect((reveal as HTMLButtonElement).disabled).toBe(true);
    });

    it("surfaces an error when revealing fails", async () => {
      vi.mocked(revealItem).mockRejectedValue(new Error("no such file"));
      render(<Ledger />);

      const succeededRow = screen.getByText("out_1.zip").closest("tr");
      await userEvent.click(
        within(succeededRow as HTMLElement).getByRole("button", {
          name: /reveal/i,
        }),
      );

      expect(useJobStore.getState().error).toBe("no such file");
    });
  });

  describe("Open folder button", () => {
    it("opens the output directory when clicked", async () => {
      vi.mocked(openPath).mockResolvedValue(undefined);
      useJobStore.setState({
        draft: draftWith(["/in/a.rar"], "/out/dir"),
        summary: MIXED_SUMMARY,
      });
      render(<Ledger />);

      await userEvent.click(
        screen.getByRole("button", { name: /open folder/i }),
      );

      expect(vi.mocked(openPath)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(openPath)).toHaveBeenCalledWith("/out/dir");
    });

    it("does not render the Open folder button when outputDir is null", () => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar"], null),
        summary: MIXED_SUMMARY,
      });
      render(<Ledger />);
      expect(screen.queryByRole("button", { name: /open folder/i })).toBeNull();
    });
  });

  describe("accessibility", () => {
    it("labels the ledger region and every icon button", () => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar"]),
        summary: {
          succeeded: [10],
          cancelled: [],
          failed: [],
          results: [
            {
              taskId: 10,
              outputName: "out_1.zip",
              outputPath: "/out/out_1.zip",
              status: "succeeded",
              reason: null,
            },
          ],
        },
      });
      render(<Ledger />);

      expect(screen.getByRole("status", { name: /run summary/i })).toBeTruthy();
      // Icon buttons carry accessible names.
      expect(screen.getByRole("button", { name: /reveal/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
    });
  });
});
