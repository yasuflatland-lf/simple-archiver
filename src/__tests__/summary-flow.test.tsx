import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Ledger } from "@/components/Ledger";
import { resetJobStore, useJobStore } from "@/store/jobStore";

// Control the archive lib so runJob/cancelJob resolve deterministically.
const runJob = vi.fn();
const cancelJob = vi.fn();
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  setNamingRule: vi.fn(),
  setOutputDir: vi.fn(),
  runJob: () => runJob(),
  cancelJob: () => cancelJob(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));

// The Ledger row actions go through the reveal wrapper; mock it so nothing
// reaches the real Tauri backend.
vi.mock("@/lib/reveal", () => ({
  openPath: vi.fn(),
  copyText: vi.fn(),
}));

beforeEach(() => {
  resetJobStore();
  runJob.mockReset();
  cancelJob.mockReset();
});

describe("run → summary flow", () => {
  it("flips running off and projects the summary into the ledger when a job finishes", async () => {
    runJob.mockResolvedValue({
      succeeded: [1],
      cancelled: [],
      failed: [{ taskId: 2, reason: "unrar error: boom" }],
      results: [
        {
          taskId: 1,
          outputName: "out_1.zip",
          outputPath: "/out/out_1.zip",
          status: "succeeded",
          reason: null,
        },
        {
          taskId: 2,
          outputName: "out_2.zip",
          outputPath: "/out/out_2.zip",
          status: "failed",
          reason: "unrar error: boom",
        },
      ],
    });
    useJobStore.setState({
      draft: {
        items: [
          { path: "/in/a.rar", kind: "rar" },
          { path: "/in/b.rar", kind: "rar" },
        ],
        namingTemplate: null,
        startNumber: 1,
        outputDir: "/out",
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
    });

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().running).toBe(false);
    expect(useJobStore.getState().summary?.failed[0]?.reason).toBe(
      "unrar error: boom",
    );

    render(<Ledger />);
    // The header subline summarises the projected outcomes.
    expect(screen.getByText(/1 succeeded/i)).toBeTruthy();
    expect(screen.getByText("out_2.zip")).toBeTruthy();
    expect(screen.getByText(/unrar error: boom/)).toBeTruthy();
  });

  it("requesting cancel does not flip running off (summary still arrives via runJob)", async () => {
    useJobStore.setState({ running: true });
    await useJobStore.getState().cancelJob();
    expect(cancelJob).toHaveBeenCalledTimes(1);
    // cancelJob intentionally leaves `running` true; the in-flight runJob resolves
    // with a summary that already includes the cancelled tasks.
    expect(useJobStore.getState().running).toBe(true);
  });
});
