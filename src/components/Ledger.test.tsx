import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
import * as archive from "@/lib/archive";
import { copyText, openPath } from "@/lib/reveal";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { Ledger } from "./Ledger";

// The store module imports the archive lib at load time; mock it so nothing
// reaches the real Tauri backend.
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

// Mock the opener/clipboard wrapper so the row actions never reach Tauri.
vi.mock("@/lib/reveal", () => ({
  openPath: vi.fn(),
  copyText: vi.fn(),
}));

beforeEach(() => {
  resetJobStore();
  vi.mocked(openPath).mockReset();
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

    // Count data rows by their Copy action (group-heading rows have no button).
    expect(screen.getAllByRole("button", { name: /copy/i })).toHaveLength(3);

    expect(screen.getByText("a.rar")).toBeTruthy();
    expect(screen.getByText("b.rar")).toBeTruthy();
    expect(screen.getByText("c.rar")).toBeTruthy();
    expect(screen.getByText("out_1.zip")).toBeTruthy();
    expect(screen.getByText("out_2.zip")).toBeTruthy();
    expect(screen.getByText("out_3.zip")).toBeTruthy();
  });

  it("insets the sequence-number cell so the row numbers align with the sticky header", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);

    // The header insets its content by px-4; the number cell must carry pl-4 so
    // the row numbers line up with it. Target a known data row (grouping reorders
    // rows, so the first DOM row is a group heading, not a data row).
    const row = screen.getByText("out_1.zip").closest("tr") as HTMLElement;
    const numberCell = within(row).getAllByRole("cell")[0];
    expect(numberCell.className).toContain("pl-4");
  });

  it("shows the failure reason inline on a failed row", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    expect(screen.getByText(/unrar error: boom/)).toBeTruthy();
  });

  it("orders groups failures-first, successes-last", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    // out_3.zip is the failed row, out_1.zip the succeeded row: failures first.
    const failed = screen.getByText("out_3.zip");
    const succeeded = screen.getByText("out_1.zip");
    expect(
      failed.compareDocumentPosition(succeeded) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders a group heading with the count for each non-empty outcome", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    expect(screen.getByText(/Failed\s*·\s*1/)).toBeTruthy();
    expect(screen.getByText(/Cancelled\s*·\s*1/)).toBeTruthy();
    expect(screen.getByText(/Succeeded\s*·\s*1/)).toBeTruthy();
  });

  it("omits a group heading for an outcome with no results", () => {
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
    expect(screen.queryByText(/Failed\s*·/)).toBeNull();
    expect(screen.queryByText(/Cancelled\s*·/)).toBeNull();
    expect(screen.getByText(/Succeeded\s*·\s*1/)).toBeTruthy();
  });

  it("numbers rows by original job order after grouping reorders them", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    // Failed (out_3.zip) is index 2 in results → number 3, even though it leads.
    const failedRow = screen
      .getByText("out_3.zip")
      .closest("tr") as HTMLElement;
    expect(within(failedRow).getAllByRole("cell")[0].textContent).toBe("3");
  });

  it("summarises the batch in the header with per-outcome counts", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    // Total + a subline that omits zero categories.
    expect(screen.getByText(/3 archives/i)).toBeTruthy();
    expect(screen.getByText(/1 succeeded/i)).toBeTruthy();
    expect(screen.getByText(/1 cancelled/i)).toBeTruthy();
    expect(screen.getByText(/1 failed/i)).toBeTruthy();
  });

  it("gives Open folder primary emphasis and Clear an outline treatment", () => {
    useJobStore.setState({
      draft: draftWith(["/in/a.rar"], "/out"),
      summary: MIXED_SUMMARY,
    });
    render(<Ledger />);
    expect(
      screen.getByRole("button", { name: /open folder/i }).className,
    ).toContain("bg-primary");
    expect(
      screen.getByRole("button", { name: /clear results/i }).className,
    ).toContain("border");
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
    // 2048 bytes total → "2.0 / 2.0 KB": formatBytes renders KB and larger with
    // one fixed-width decimal (the row passes bytesTotal as both done and total).
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

    it("offers no Reveal action on any row (the column was removed)", () => {
      render(<Ledger />);
      expect(screen.queryAllByRole("button", { name: /reveal/i })).toHaveLength(
        0,
      );
      // Every result row keeps exactly its single Copy action.
      for (const name of ["out_1.zip", "out_2.zip", "out_3.zip"]) {
        const row = screen.getByText(name).closest("tr") as HTMLElement;
        expect(within(row).getAllByRole("button")).toHaveLength(1);
        expect(within(row).getByRole("button", { name: /copy/i })).toBeTruthy();
      }
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
      // The success affordance appears (and we await it to settle the state
      // update so the assertions above run inside act()).
      await screen.findByText(/path was copied/i);
    });

    it("Copy is available even on a failed row (the path can still be pasted)", async () => {
      vi.mocked(copyText).mockResolvedValue(undefined);
      render(<Ledger />);

      const failedRow = screen.getByText("out_3.zip").closest("tr");
      await userEvent.click(
        within(failedRow as HTMLElement).getByRole("button", {
          name: /copy/i,
        }),
      );

      expect(vi.mocked(copyText)).toHaveBeenCalledWith("/out/out_3.zip");
      await screen.findByText(/path was copied/i);
    });

    it("marks the clicked row as Copied and reverts after the timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(copyText).mockResolvedValue(undefined);
        render(<Ledger />);

        const succeededRow = screen
          .getByText("out_1.zip")
          .closest("tr") as HTMLElement;
        fireEvent.click(
          within(succeededRow).getByRole("button", { name: /copy/i }),
        );
        // Flush the async copy → state update that flips the row into Copied.
        await act(async () => {
          await Promise.resolve();
        });
        expect(within(succeededRow).getByText(/copied/i)).toBeTruthy();

        // After the timeout elapses, the row reverts to the bare Copy action.
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(within(succeededRow).queryByText(/copied/i)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("only marks the row that was clicked as Copied", async () => {
      vi.mocked(copyText).mockResolvedValue(undefined);
      render(<Ledger />);

      const succeededRow = screen
        .getByText("out_1.zip")
        .closest("tr") as HTMLElement;
      const cancelledRow = screen
        .getByText("out_2.zip")
        .closest("tr") as HTMLElement;
      await userEvent.click(
        within(succeededRow).getByRole("button", { name: /copy/i }),
      );

      expect(within(succeededRow).getByText(/copied/i)).toBeTruthy();
      expect(within(cancelledRow).queryByText(/copied/i)).toBeNull();
    });

    it("shows the Copied confirmation as a small popup anchored in the row, not morphed into the button", async () => {
      vi.mocked(copyText).mockResolvedValue(undefined);
      const { container } = render(<Ledger />);

      const row = screen.getByText("out_1.zip").closest("tr") as HTMLElement;
      const button = within(row).getByRole("button", { name: /copy/i });
      await userEvent.click(button);
      // Settle the async copy → state update before asserting on the popup.
      await screen.findByText(/path was copied/i);

      // The confirmation renders as a dedicated, absolutely-positioned popup that
      // lives in the clicked row — not as text morphed into the Copy button.
      const popup = container.querySelector(".copied-popup");
      expect(popup).not.toBeNull();
      expect(popup?.textContent).toMatch(/copied/i);
      expect(popup?.className).toContain("absolute");
      expect(row.contains(popup)).toBe(true);
      expect(button.textContent ?? "").not.toMatch(/copied/i);
    });

    it("surfaces an error when copying fails (and shows no affordance)", async () => {
      vi.mocked(copyText).mockRejectedValue(new Error("clipboard denied"));
      render(<Ledger />);

      const succeededRow = screen.getByText("out_1.zip").closest("tr");
      await userEvent.click(
        within(succeededRow as HTMLElement).getByRole("button", {
          name: /copy/i,
        }),
      );

      expect(useJobStore.getState().error).toBe("clipboard denied");
      expect(screen.queryByText(/path was copied/i)).toBeNull();
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

  describe("Clear button", () => {
    it("clears the results into a residual last batch when clicked", async () => {
      // setStartNumber recomputes previews; give it a resolving default so the
      // clearResults round-trip settles.
      vi.mocked(archive.previewOutputName).mockResolvedValue("photo_001.zip");
      vi.mocked(archive.setStartNumber).mockResolvedValue(
        draftWith([], "/out"),
      );
      vi.mocked(archive.clearItems).mockResolvedValue(draftWith([], "/out"));
      useJobStore.setState({
        draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
        summary: MIXED_SUMMARY,
      });
      render(<Ledger />);

      await userEvent.click(
        screen.getByRole("button", { name: /clear results/i }),
      );

      const state = useJobStore.getState();
      expect(state.cleared).toBe(true);
      expect(state.lastBatch?.count).toBe(3);
      expect(state.summary).toBeNull();
      // Start # auto-continues from 1 by the 3-task count.
      expect(vi.mocked(archive.setStartNumber)).toHaveBeenCalledWith(4);
      expect(vi.mocked(archive.clearItems)).toHaveBeenCalledTimes(1);
    });

    it("labels the Clear control for assistive tech", () => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar"]),
        summary: MIXED_SUMMARY,
      });
      render(<Ledger />);
      expect(
        screen.getByRole("button", { name: /clear results/i }),
      ).toBeTruthy();
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
      // The per-row Copy icon button carries an accessible name.
      expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
    });
  });

  describe("proportion bar", () => {
    it("renders one segment per non-empty outcome", () => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
        summary: MIXED_SUMMARY,
      });
      const { container } = render(<Ledger />);
      const bar = container.querySelector(".ledger-segment-bar");
      expect(bar).not.toBeNull();
      expect((bar as HTMLElement).children).toHaveLength(3);
    });

    it("renders a single segment when every task shares one outcome", () => {
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
      const { container } = render(<Ledger />);
      const bar = container.querySelector(".ledger-segment-bar");
      expect((bar as HTMLElement).children).toHaveLength(1);
    });
  });

  describe("column content-fit", () => {
    beforeEach(() => {
      useJobStore.setState({
        draft: draftWith(["/in/a.rar", "/in/b.rar", "/in/c.rar"]),
        summary: MIXED_SUMMARY,
      });
    });

    // The row keeps full card width, but only the source → output column grows:
    // it absorbs the slack so the size and Copy columns fit their content and pack
    // to the right edge.
    it("stretches the source → output cell to absorb the row's slack", () => {
      render(<Ledger />);
      const row = screen.getByText("out_1.zip").closest("tr") as HTMLElement;
      const cells = within(row).getAllByRole("cell");
      // cells: [#, source → output, size, Copy] — index 1 is the greedy column.
      expect(cells[1].className).toContain("w-full");
    });

    it("keeps the size cell on a single line so size and Copy stay aligned", () => {
      render(<Ledger />);
      const row = screen.getByText("out_1.zip").closest("tr") as HTMLElement;
      const cells = within(row).getAllByRole("cell");
      expect(cells[2].className).toContain("whitespace-nowrap");
    });
  });
});
