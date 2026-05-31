import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";

// Mock the command wrappers so the store can be driven without a Tauri backend.
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

import * as archive from "@/lib/archive";

import { resetJobStore, useJobStore } from "./jobStore";

// Cast the mocked wrappers to vitest's mock type for typed `mockResolvedValue`.
const mockArchive = vi.mocked(archive);

// Build a draft snapshot with the given number of items and naming template.
function makeDraft(
  itemCount: number,
  namingTemplate: string | null = null,
  outputDir: string | null = null,
): DraftSnapshot {
  return {
    items: Array.from({ length: itemCount }, (_, i) => ({
      path: `/tmp/item-${i}.rar`,
      kind: "rar" as const,
    })),
    namingTemplate,
    outputDir,
  };
}

const INITIAL_DRAFT: DraftSnapshot = {
  items: [],
  namingTemplate: null,
  outputDir: null,
};

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
});

describe("jobStore initial state", () => {
  it("starts with the locked initial state", () => {
    const state = useJobStore.getState();
    expect(state.draft).toEqual(INITIAL_DRAFT);
    expect(state.previewNames).toEqual([]);
    expect(state.progress).toBeNull();
    expect(state.summary).toBeNull();
    expect(state.taskIdByIndex).toEqual([]);
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("addItems", () => {
  it("calls archive.addItems and replaces the draft on success", async () => {
    const draft = makeDraft(2);
    mockArchive.addItems.mockResolvedValue(draft);

    await useJobStore.getState().addItems(["/a.rar", "/b.rar"]);

    expect(mockArchive.addItems).toHaveBeenCalledWith(["/a.rar", "/b.rar"]);
    expect(useJobStore.getState().draft).toEqual(draft);
    expect(useJobStore.getState().error).toBeNull();
  });

  it("recomputes previews after adding (empty when template is null)", async () => {
    const draft = makeDraft(2, null);
    mockArchive.addItems.mockResolvedValue(draft);

    await useJobStore.getState().addItems(["/a.rar", "/b.rar"]);

    // namingTemplate is null in the returned snapshot, so no preview calls and
    // previewNames is empty.
    expect(mockArchive.previewOutputName).not.toHaveBeenCalled();
    expect(useJobStore.getState().previewNames).toEqual([]);
  });

  it("clears stale finished-job result state on success", async () => {
    // Simulate a state left over from a finished job whose per-row verdicts are
    // keyed to the OLD ordering. Editing the draft must invalidate them.
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [{ taskId: 11, reason: "boom" }],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50 },
        { taskId: 11, bytesDone: 50, bytesTotal: 50 },
      ],
      elapsedMs: 5,
    };
    useJobStore.setState({ summary, progress, taskIdByIndex: [10, 11] });

    const draft = makeDraft(3, null);
    mockArchive.addItems.mockResolvedValue(draft);

    await useJobStore.getState().addItems(["/c.rar"]);

    expect(useJobStore.getState().summary).toBeNull();
    expect(useJobStore.getState().progress).toBeNull();
    expect(useJobStore.getState().taskIdByIndex).toEqual([]);
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.addItems.mockRejectedValue("backend boom");

    await useJobStore.getState().addItems(["/a.rar"]);

    expect(useJobStore.getState().error).toBe("backend boom");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });
});

describe("reorder", () => {
  it("calls archive.reorder with (from, to) and replaces the draft", async () => {
    const draft = makeDraft(3);
    mockArchive.reorder.mockResolvedValue(draft);

    await useJobStore.getState().reorder(2, 0);

    expect(mockArchive.reorder).toHaveBeenCalledWith(2, 0);
    expect(useJobStore.getState().draft).toEqual(draft);
  });

  it("clears stale finished-job result state on success", async () => {
    // After a job finishes, summary/progress/taskIdByIndex are keyed to the OLD
    // ordering. A reorder changes the row order, so those verdicts are stale and
    // must be cleared, or TaskList.computeStatus classifies the wrong rows.
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [{ taskId: 11, reason: "boom" }],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50 },
        { taskId: 11, bytesDone: 50, bytesTotal: 50 },
      ],
      elapsedMs: 5,
    };
    useJobStore.setState({ summary, progress, taskIdByIndex: [10, 11] });

    const draft = makeDraft(2, null);
    mockArchive.reorder.mockResolvedValue(draft);

    await useJobStore.getState().reorder(0, 1);

    expect(useJobStore.getState().summary).toBeNull();
    expect(useJobStore.getState().progress).toBeNull();
    expect(useJobStore.getState().taskIdByIndex).toEqual([]);
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.reorder.mockRejectedValue(new Error("bad index"));

    await useJobStore.getState().reorder(9, 0);

    expect(useJobStore.getState().error).toBe("bad index");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });
});

describe("setNamingRule", () => {
  it("recomputes previews with 1-based sequence numbers per item", async () => {
    const draft = makeDraft(3, "photo_{n:03}");
    mockArchive.setNamingRule.mockResolvedValue(draft);
    mockArchive.previewOutputName.mockImplementation((_template, seq) =>
      Promise.resolve(`photo_${String(seq).padStart(3, "0")}.zip`),
    );

    await useJobStore.getState().setNamingRule("photo_{n:03}");

    expect(mockArchive.setNamingRule).toHaveBeenCalledWith("photo_{n:03}");
    expect(mockArchive.previewOutputName).toHaveBeenCalledTimes(3);
    expect(mockArchive.previewOutputName).toHaveBeenNthCalledWith(
      1,
      "photo_{n:03}",
      1,
    );
    expect(mockArchive.previewOutputName).toHaveBeenNthCalledWith(
      2,
      "photo_{n:03}",
      2,
    );
    expect(mockArchive.previewOutputName).toHaveBeenNthCalledWith(
      3,
      "photo_{n:03}",
      3,
    );
    expect(useJobStore.getState().previewNames).toEqual([
      "photo_001.zip",
      "photo_002.zip",
      "photo_003.zip",
    ]);
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.setNamingRule.mockRejectedValue("invalid template");

    await useJobStore.getState().setNamingRule("{bad}");

    expect(useJobStore.getState().error).toBe("invalid template");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });
});

describe("setOutputDir", () => {
  it("updates the draft outputDir without recomputing previews", async () => {
    const draft = makeDraft(2, "photo_{n}", "/out");
    mockArchive.setOutputDir.mockResolvedValue(draft);

    await useJobStore.getState().setOutputDir("/out");

    expect(mockArchive.setOutputDir).toHaveBeenCalledWith("/out");
    expect(useJobStore.getState().draft.outputDir).toBe("/out");
    expect(mockArchive.previewOutputName).not.toHaveBeenCalled();
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.setOutputDir.mockRejectedValue("no such dir");

    await useJobStore.getState().setOutputDir("/nope");

    expect(useJobStore.getState().error).toBe("no such dir");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });
});

describe("recomputePreviews", () => {
  it("clears previews and sets error when previewOutputName rejects", async () => {
    const draft = makeDraft(2, "photo_{n}");
    mockArchive.setNamingRule.mockResolvedValue(draft);
    mockArchive.previewOutputName.mockRejectedValue("invalid template");

    await useJobStore.getState().setNamingRule("photo_{n}");

    expect(useJobStore.getState().previewNames).toEqual([]);
    expect(useJobStore.getState().error).toBe("invalid template");
  });

  it("resolves to empty previews for an empty draft even with a template", async () => {
    // No items means no preview calls, but a non-null template must not skip the
    // success bookkeeping: previewNames is [] and error is cleared.
    useJobStore.setState({
      draft: { items: [], namingTemplate: "photo_{n}", outputDir: null },
      error: "stale error",
    });

    await useJobStore.getState().recomputePreviews();

    expect(mockArchive.previewOutputName).not.toHaveBeenCalled();
    expect(useJobStore.getState().previewNames).toEqual([]);
    expect(useJobStore.getState().error).toBeNull();
  });

  it("ignores a stale recompute that resolves after a newer one (generation guard)", async () => {
    // Drive two overlapping recomputes with manually-controlled promises so we
    // can resolve the newer batch (B) before the older one (A). The stale A
    // result must NOT overwrite B's previews.
    const resolvers: Array<(value: string) => void> = [];
    mockArchive.previewOutputName.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    // Run A: one item.
    useJobStore.setState({
      draft: {
        items: makeDraft(1).items,
        namingTemplate: "a",
        outputDir: null,
      },
    });
    const runA = useJobStore.getState().recomputePreviews();
    const resolveA = resolvers.shift();

    // Run B: one item, started after A so it has the newer generation.
    useJobStore.setState({
      draft: {
        items: makeDraft(1).items,
        namingTemplate: "b",
        outputDir: null,
      },
    });
    const runB = useJobStore.getState().recomputePreviews();
    const resolveB = resolvers.shift();

    // Resolve B first (the winner), then the stale A.
    resolveB?.("B.zip");
    await runB;
    expect(useJobStore.getState().previewNames).toEqual(["B.zip"]);

    resolveA?.("A.zip");
    await runA;

    // A is stale and must not clobber B's result.
    expect(useJobStore.getState().previewNames).toEqual(["B.zip"]);
  });
});

describe("runJob", () => {
  it("flips running true synchronously and false after resolving with a summary", async () => {
    const summary: JobSummaryDto = {
      succeeded: [1, 2],
      cancelled: [],
      failed: [],
    };
    // A manually-resolved promise lets us observe the in-flight running flag.
    let resolveRun: (value: JobSummaryDto) => void = () => {};
    mockArchive.runJob.mockReturnValue(
      new Promise<JobSummaryDto>((resolve) => {
        resolveRun = resolve;
      }),
    );

    const pending = useJobStore.getState().runJob();

    // Synchronously after the call, the job is marked running.
    expect(useJobStore.getState().running).toBe(true);
    expect(useJobStore.getState().summary).toBeNull();

    resolveRun(summary);
    await pending;

    expect(useJobStore.getState().running).toBe(false);
    expect(useJobStore.getState().summary).toEqual(summary);
  });

  it("sets error and clears running on failure", async () => {
    mockArchive.runJob.mockRejectedValue("job exploded");

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().running).toBe(false);
    expect(useJobStore.getState().error).toBe("job exploded");
  });

  it("derives taskIdByIndex from current progress on success", async () => {
    const event: ProgressEvent = {
      overall: { bytesDone: 0, bytesTotal: 100 },
      perTask: [
        { taskId: 11, bytesDone: 0, bytesTotal: 50 },
        { taskId: 22, bytesDone: 0, bytesTotal: 50 },
      ],
      elapsedMs: 0,
    };
    useJobStore.getState().applyProgress(event);

    const summary: JobSummaryDto = {
      succeeded: [11, 22],
      cancelled: [],
      failed: [],
    };
    mockArchive.runJob.mockResolvedValue(summary);

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().taskIdByIndex).toEqual([11, 22]);
    expect(useJobStore.getState().summary).toEqual(summary);
  });

  it("keeps the existing taskIdByIndex when no progress was emitted", async () => {
    // With progress === null, runJob falls back to the existing taskIdByIndex
    // instead of wiping it to []. Seed it via setState since addItems/reorder
    // now clear it on edit.
    useJobStore.setState({ progress: null, taskIdByIndex: [33, 44] });

    const summary: JobSummaryDto = {
      succeeded: [33, 44],
      cancelled: [],
      failed: [],
    };
    mockArchive.runJob.mockResolvedValue(summary);

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().taskIdByIndex).toEqual([33, 44]);
    expect(useJobStore.getState().summary).toEqual(summary);
  });
});

describe("applyProgress", () => {
  it("stores the event and derives taskIdByIndex from perTask", () => {
    const event: ProgressEvent = {
      overall: { bytesDone: 10, bytesTotal: 100 },
      perTask: [
        { taskId: 7, bytesDone: 5, bytesTotal: 50 },
        { taskId: 8, bytesDone: 5, bytesTotal: 50 },
      ],
      elapsedMs: 42,
    };

    useJobStore.getState().applyProgress(event);

    expect(useJobStore.getState().progress).toEqual(event);
    expect(useJobStore.getState().taskIdByIndex).toEqual([7, 8]);
  });
});

describe("cancelJob", () => {
  it("calls archive.cancelJob and leaves running unchanged", async () => {
    mockArchive.cancelJob.mockResolvedValue(undefined);
    // Put the store into a running state to prove cancelJob does not touch it.
    useJobStore.setState({ running: true });

    await useJobStore.getState().cancelJob();

    expect(mockArchive.cancelJob).toHaveBeenCalledTimes(1);
    expect(useJobStore.getState().running).toBe(true);
  });

  it("sets error on failure without changing running", async () => {
    mockArchive.cancelJob.mockRejectedValue("cancel failed");
    useJobStore.setState({ running: true });

    await useJobStore.getState().cancelJob();

    expect(useJobStore.getState().error).toBe("cancel failed");
    expect(useJobStore.getState().running).toBe(true);
  });
});
