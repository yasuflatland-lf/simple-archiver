import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RunSummary } from "@/components/RunSummary";
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

beforeEach(() => {
  resetJobStore();
  runJob.mockReset();
  cancelJob.mockReset();
});

describe("run → summary flow", () => {
  it("flips running off and projects the summary when a job finishes", async () => {
    runJob.mockResolvedValue({
      succeeded: [1],
      cancelled: [],
      failed: [{ taskId: 2, reason: "unrar error: boom" }],
    });
    useJobStore.setState({
      previewNames: ["out_1.zip", "out_2.zip"],
      taskIdByIndex: [1, 2],
    });

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().running).toBe(false);
    expect(useJobStore.getState().summary?.failed[0]?.reason).toBe(
      "unrar error: boom",
    );

    render(<RunSummary />);
    expect(screen.getByText(/Succeeded/).textContent).toMatch(/Succeeded\s*1/);
    expect(screen.getByText(/out_2\.zip/).textContent).toContain(
      "unrar error: boom",
    );
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
