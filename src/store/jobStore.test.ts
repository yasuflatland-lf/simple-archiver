import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";

// Mock the command wrappers so the store can be driven without a Tauri backend.
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  removeItem: vi.fn(),
  setNamingRule: vi.fn(),
  setStartNumber: vi.fn(),
  setOutputDir: vi.fn(),
  setOutputMode: vi.fn(),
  setConflictPolicy: vi.fn(),
  clearItems: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));

// Mock the output-dir persistence helper so the store action's persistence
// side effect can be asserted without touching real localStorage behavior.
vi.mock("@/lib/output-dir-default", () => ({ persistOutputDir: vi.fn() }));

import * as archive from "@/lib/archive";
import { DEFAULT_TEMPLATE, MAX_START } from "@/lib/naming";
import { persistOutputDir } from "@/lib/output-dir-default";

import { resetJobStore, useJobStore } from "./jobStore";

const mockPersistOutputDir = vi.mocked(persistOutputDir);

// Cast the mocked wrappers to vitest's mock type for typed `mockResolvedValue`.
const mockArchive = vi.mocked(archive);

// Build a draft snapshot with the given number of items and naming template.
function makeDraft(
  itemCount: number,
  namingTemplate: string | null = null,
  outputDir: string | null = null,
  startNumber: number = 1,
): DraftSnapshot {
  return {
    items: Array.from({ length: itemCount }, (_, i) => ({
      path: `/tmp/item-${i}.rar`,
      kind: "rar" as const,
    })),
    namingTemplate,
    startNumber,
    outputDir,
    outputMode: "zip",
    conflictPolicy: "autoRename",
  };
}

const INITIAL_DRAFT: DraftSnapshot = {
  items: [],
  namingTemplate: null,
  startNumber: 1,
  outputDir: null,
  outputMode: "zip",
  conflictPolicy: "autoRename",
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
    expect(state.lastBatch).toBeNull();
    expect(state.cleared).toBe(false);
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

  it("recomputes previews after adding (empty per-item names when template is null)", async () => {
    const draft = makeDraft(2, null);
    mockArchive.addItems.mockResolvedValue(draft);

    await useJobStore.getState().addItems(["/a.rar", "/b.rar"]);

    // namingTemplate is null in the returned snapshot, so there are no per-item
    // preview calls and previewNames is empty. The single hero preview still
    // resolves from DEFAULT_TEMPLATE at seq 1 (the OUTPUT group always shows a
    // representative filename, even before a template is pushed).
    expect(mockArchive.previewOutputName).toHaveBeenCalledTimes(1);
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      DEFAULT_TEMPLATE,
      1,
    );
    expect(useJobStore.getState().previewNames).toEqual([]);
  });

  it("clears stale finished-job result state on success", async () => {
    // Simulate a state left over from a finished job whose per-row verdicts are
    // keyed to the OLD ordering. Editing the draft must invalidate them.
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [{ taskId: 11, reason: "boom" }],
      results: [],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50, etaMs: null },
        { taskId: 11, bytesDone: 50, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 5,
      overallEtaMs: null,
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

  it("discards the residual last-batch chip when the next batch is queued", async () => {
    // Simulate a prior Clear leaving a residual chip; queuing a new batch must
    // dismiss it so the chip only ever refers to the most recent completed run.
    const lastBatch = {
      summary: {
        succeeded: [1],
        cancelled: [],
        failed: [],
        results: [],
      } as JobSummaryDto,
      outputDir: "/out",
      count: 1,
    };
    useJobStore.setState({ lastBatch, cleared: true });

    const draft = makeDraft(1);
    mockArchive.addItems.mockResolvedValue(draft);

    await useJobStore.getState().addItems(["/a.rar"]);

    expect(useJobStore.getState().lastBatch).toBeNull();
    expect(useJobStore.getState().cleared).toBe(false);
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
      results: [],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50, etaMs: null },
        { taskId: 11, bytesDone: 50, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 5,
      overallEtaMs: null,
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

describe("removeItem", () => {
  it("calls archive.removeItem with the index and replaces the draft", async () => {
    const draft = makeDraft(2);
    mockArchive.removeItem.mockResolvedValue(draft);

    await useJobStore.getState().removeItem(1);

    expect(mockArchive.removeItem).toHaveBeenCalledWith(1);
    expect(useJobStore.getState().draft).toEqual(draft);
  });

  it("recomputes previews so the # sequence and names shift up", async () => {
    // Removing a row renumbers every row below it, so the store must recompute
    // previews against the new, shorter item list (start + i for each item).
    const draft = makeDraft(2, "photo_{n:03}");
    mockArchive.removeItem.mockResolvedValue(draft);
    mockArchive.previewOutputName.mockImplementation((_template, seq) =>
      Promise.resolve(`photo_${String(seq).padStart(3, "0")}.zip`),
    );

    await useJobStore.getState().removeItem(0);

    // One call per remaining item, sequential from the start number.
    expect(useJobStore.getState().previewNames).toEqual([
      "photo_001.zip",
      "photo_002.zip",
    ]);
  });

  it("clears stale finished-job result state on success", async () => {
    // Like reorder, removing a row invalidates the positionally-aligned verdicts
    // (summary/progress/taskIdByIndex) from any prior finished job.
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [{ taskId: 11, reason: "boom" }],
      results: [],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50, etaMs: null },
        { taskId: 11, bytesDone: 50, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 5,
      overallEtaMs: null,
    };
    useJobStore.setState({ summary, progress, taskIdByIndex: [10, 11] });

    const draft = makeDraft(1, null);
    mockArchive.removeItem.mockResolvedValue(draft);

    await useJobStore.getState().removeItem(0);

    expect(useJobStore.getState().summary).toBeNull();
    expect(useJobStore.getState().progress).toBeNull();
    expect(useJobStore.getState().taskIdByIndex).toEqual([]);
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.removeItem.mockRejectedValue(new Error("bad index"));

    await useJobStore.getState().removeItem(9);

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
    // Three per-item previews (seq 1..3) plus one hero preview (seq 1) = four
    // calls. Each per-item sequence is requested with the template.
    expect(mockArchive.previewOutputName).toHaveBeenCalledTimes(4);
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      1,
    );
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      2,
    );
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      3,
    );
    // previewNames stays index-aligned with the three items.
    expect(useJobStore.getState().previewNames).toEqual([
      "photo_001.zip",
      "photo_002.zip",
      "photo_003.zip",
    ]);
    // The hero preview is the seq-1 filename for the same template.
    expect(useJobStore.getState().firstPreview).toBe("photo_001.zip");
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.setNamingRule.mockRejectedValue("invalid template");

    await useJobStore.getState().setNamingRule("{bad}");

    expect(useJobStore.getState().error).toBe("invalid template");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });
});

describe("setStartNumber", () => {
  it("recomputes previews numbering the hero and items from the new start", async () => {
    const draft = makeDraft(3, "photo_{n:03}", null, 5);
    mockArchive.setStartNumber.mockResolvedValue(draft);
    mockArchive.previewOutputName.mockImplementation((_template, seq) =>
      Promise.resolve(`photo_${String(seq).padStart(3, "0")}.zip`),
    );

    await useJobStore.getState().setStartNumber(5);

    expect(mockArchive.setStartNumber).toHaveBeenCalledWith(5);
    // Hero uses start (5); the three items use start + i = 5, 6, 7.
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      5,
    );
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      6,
    );
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith(
      "photo_{n:03}",
      7,
    );
    expect(useJobStore.getState().previewNames).toEqual([
      "photo_005.zip",
      "photo_006.zip",
      "photo_007.zip",
    ]);
    expect(useJobStore.getState().firstPreview).toBe("photo_005.zip");
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.setStartNumber.mockRejectedValue("boom");

    await useJobStore.getState().setStartNumber(3);

    expect(useJobStore.getState().error).toBe("boom");
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

  it("persists the directory on success", async () => {
    const draft = makeDraft(2, "photo_{n}", "/out");
    mockArchive.setOutputDir.mockResolvedValue(draft);

    await useJobStore.getState().setOutputDir("/out");

    expect(mockPersistOutputDir).toHaveBeenCalledWith("/out");
  });

  it("sets error and leaves the draft unchanged on failure", async () => {
    mockArchive.setOutputDir.mockRejectedValue("no such dir");

    await useJobStore.getState().setOutputDir("/nope");

    expect(useJobStore.getState().error).toBe("no such dir");
    expect(useJobStore.getState().draft).toEqual(INITIAL_DRAFT);
  });

  it("does not persist the directory on failure", async () => {
    mockArchive.setOutputDir.mockRejectedValue("no such dir");

    await useJobStore.getState().setOutputDir("/nope");

    expect(mockPersistOutputDir).not.toHaveBeenCalled();
  });

  it("does not surface an error when persistence throws (best-effort localStorage)", async () => {
    // Simulate a QuotaExceededError / SecurityError from localStorage. The
    // backend already succeeded, so the draft must reflect the new dir and
    // error must remain null — the persistence failure is logged, not shown.
    const draft = makeDraft(2, "photo_{n}", "/out");
    mockArchive.setOutputDir.mockResolvedValue(draft);
    mockPersistOutputDir.mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    await useJobStore.getState().setOutputDir("/out");

    expect(useJobStore.getState().draft.outputDir).toBe("/out");
    expect(useJobStore.getState().error).toBeNull();
  });

  it("clears a pre-existing error when the backend succeeds", async () => {
    // Seed a non-null error (e.g. from a previous failed operation) to verify
    // that a successful setOutputDir wipes it via set({ draft, error: null }).
    useJobStore.setState({ error: "stale error" });

    const draft = makeDraft(2, "photo_{n}", "/out");
    mockArchive.setOutputDir.mockResolvedValue(draft);

    await useJobStore.getState().setOutputDir("/out");

    expect(useJobStore.getState().error).toBeNull();
  });
});

describe("setOutputMode", () => {
  it("setOutputMode pushes the mode and stores the returned draft", async () => {
    const spy = vi.spyOn(archive, "setOutputMode").mockResolvedValue({
      items: [],
      namingTemplate: null,
      startNumber: 1,
      outputDir: "/out",
      outputMode: "folder",
      conflictPolicy: "autoRename",
    });

    await useJobStore.getState().setOutputMode("folder");

    expect(spy).toHaveBeenCalledWith("folder");
    expect(useJobStore.getState().draft.outputMode).toBe("folder");
  });
});

describe("setConflictPolicy", () => {
  it("setConflictPolicy pushes the policy and stores the returned draft", async () => {
    const spy = vi.spyOn(archive, "setConflictPolicy").mockResolvedValue({
      items: [],
      namingTemplate: null,
      startNumber: 1,
      outputDir: "/out",
      outputMode: "folder",
      conflictPolicy: "overwrite",
    });

    await useJobStore.getState().setConflictPolicy("overwrite");

    expect(spy).toHaveBeenCalledWith("overwrite");
    expect(useJobStore.getState().draft.conflictPolicy).toBe("overwrite");
  });

  it("setConflictPolicy records the error when the wrapper rejects", async () => {
    vi.spyOn(archive, "setConflictPolicy").mockRejectedValue("boom");

    await useJobStore.getState().setConflictPolicy("skip");

    expect(useJobStore.getState().error).toBe("boom");
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

  it("resolves to empty per-item previews for an empty draft even with a template", async () => {
    // No items means no per-item preview calls, but a non-null template must not
    // skip the success bookkeeping: previewNames is [] and error is cleared. The
    // single hero preview (seq 1) still resolves so the OUTPUT group renders.
    mockArchive.previewOutputName.mockResolvedValue("photo_001.zip");
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n}",
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      error: "stale error",
    });

    await useJobStore.getState().recomputePreviews();

    // Only the hero call fires (no items => no per-item calls).
    expect(mockArchive.previewOutputName).toHaveBeenCalledTimes(1);
    expect(mockArchive.previewOutputName).toHaveBeenCalledWith("photo_{n}", 1);
    expect(useJobStore.getState().previewNames).toEqual([]);
    expect(useJobStore.getState().firstPreview).toBe("photo_001.zip");
    expect(useJobStore.getState().error).toBeNull();
  });

  it("ignores a stale recompute that resolves after a newer one (generation guard)", async () => {
    // Drive two overlapping recomputes with manually-controlled promises so we
    // can resolve the newer batch (B) before the older one (A). The stale A
    // result must NOT overwrite B's previews. Each recompute now issues two
    // calls (the hero seq-1 preview and the single per-item preview), so the
    // resolvers accumulate in call order and are released per run.
    const resolvers: Array<(value: string) => void> = [];
    mockArchive.previewOutputName.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    // Run A: one item. Pulls its two resolvers (hero + per-item) off the queue.
    useJobStore.setState({
      draft: {
        items: makeDraft(1).items,
        namingTemplate: "a",
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
    });
    const runA = useJobStore.getState().recomputePreviews();
    const resolveAItem = resolvers.shift();
    const resolveAHero = resolvers.shift();

    // Run B: one item, started after A so it has the newer generation.
    useJobStore.setState({
      draft: {
        items: makeDraft(1).items,
        namingTemplate: "b",
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
    });
    const runB = useJobStore.getState().recomputePreviews();
    const resolveBItem = resolvers.shift();
    const resolveBHero = resolvers.shift();

    // Resolve B first (the winner), then the stale A.
    resolveBItem?.("B.zip");
    resolveBHero?.("B.zip");
    await runB;
    expect(useJobStore.getState().previewNames).toEqual(["B.zip"]);

    resolveAItem?.("A.zip");
    resolveAHero?.("A.zip");
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
      results: [],
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
        { taskId: 11, bytesDone: 0, bytesTotal: 50, etaMs: null },
        { taskId: 22, bytesDone: 0, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 0,
      overallEtaMs: null,
    };
    useJobStore.getState().applyProgress(event);

    const summary: JobSummaryDto = {
      succeeded: [11, 22],
      cancelled: [],
      failed: [],
      results: [],
    };
    mockArchive.runJob.mockResolvedValue(summary);

    await useJobStore.getState().runJob();

    expect(useJobStore.getState().taskIdByIndex).toEqual([11, 22]);
    expect(useJobStore.getState().summary).toEqual(summary);
  });

  it("discards the residual last-batch chip when a new job starts", async () => {
    // Running the next batch supersedes the residual chip, just like queuing.
    const lastBatch = {
      summary: {
        succeeded: [1],
        cancelled: [],
        failed: [],
        results: [],
      } as JobSummaryDto,
      outputDir: "/out",
      count: 1,
    };
    useJobStore.setState({ lastBatch, cleared: true });

    const summary: JobSummaryDto = {
      succeeded: [1],
      cancelled: [],
      failed: [],
      results: [],
    };
    mockArchive.runJob.mockResolvedValue(summary);

    const pending = useJobStore.getState().runJob();
    // The chip is dropped synchronously when the run starts.
    expect(useJobStore.getState().lastBatch).toBeNull();
    expect(useJobStore.getState().cleared).toBe(false);
    await pending;
    expect(useJobStore.getState().lastBatch).toBeNull();
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
      results: [],
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
        { taskId: 7, bytesDone: 5, bytesTotal: 50, etaMs: null },
        { taskId: 8, bytesDone: 5, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 42,
      overallEtaMs: null,
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

describe("reset", () => {
  it("calls archive.clearItems exactly once", async () => {
    const clearedDraft: DraftSnapshot = {
      items: [],
      namingTemplate: "photo_{n}",
      startNumber: 1,
      outputDir: "/out",
      outputMode: "zip",
      conflictPolicy: "autoRename",
    };
    mockArchive.clearItems.mockResolvedValue(clearedDraft);

    await useJobStore.getState().reset();

    expect(mockArchive.clearItems).toHaveBeenCalledTimes(1);
  });

  it("clears items while preserving namingTemplate and outputDir from the returned snapshot", async () => {
    // Seed the store with items and non-null settings.
    useJobStore.setState({
      draft: makeDraft(3, "photo_{n}", "/out"),
    });

    const clearedDraft: DraftSnapshot = {
      items: [],
      namingTemplate: "photo_{n}",
      startNumber: 1,
      outputDir: "/out",
      outputMode: "zip",
      conflictPolicy: "autoRename",
    };
    mockArchive.clearItems.mockResolvedValue(clearedDraft);

    await useJobStore.getState().reset();

    const state = useJobStore.getState();
    expect(state.draft.items).toEqual([]);
    expect(state.draft.namingTemplate).toBe("photo_{n}");
    expect(state.draft.outputDir).toBe("/out");
  });

  it("clears summary, progress, error, taskIdByIndex, and previewNames", async () => {
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [{ taskId: 11, reason: "boom" }],
      results: [],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [
        { taskId: 10, bytesDone: 50, bytesTotal: 50, etaMs: null },
        { taskId: 11, bytesDone: 50, bytesTotal: 50, etaMs: null },
      ],
      elapsedMs: 5,
      overallEtaMs: null,
    };
    // Seed non-empty transient state to verify it is wiped.
    useJobStore.setState({
      summary,
      progress,
      error: "stale error",
      taskIdByIndex: [10, 11],
      previewNames: ["photo_001.zip", "photo_002.zip"],
    });

    const clearedDraft: DraftSnapshot = {
      items: [],
      namingTemplate: "photo_{n}",
      startNumber: 1,
      outputDir: "/out",
      outputMode: "zip",
      conflictPolicy: "autoRename",
    };
    mockArchive.clearItems.mockResolvedValue(clearedDraft);

    await useJobStore.getState().reset();

    const state = useJobStore.getState();
    expect(state.summary).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.error).toBeNull();
    expect(state.taskIdByIndex).toEqual([]);
    expect(state.previewNames).toEqual([]);
  });

  it("sets running to false even when it was true before reset", async () => {
    // Seed running: true alongside items and transient state to verify the
    // defensive running: false patch in the success branch.
    const summary: JobSummaryDto = {
      succeeded: [10],
      cancelled: [],
      failed: [],
      results: [],
    };
    const progress: ProgressEvent = {
      overall: { bytesDone: 100, bytesTotal: 100 },
      perTask: [{ taskId: 10, bytesDone: 100, bytesTotal: 100, etaMs: null }],
      elapsedMs: 5,
      overallEtaMs: null,
    };
    useJobStore.setState({
      draft: makeDraft(2, "photo_{n}", "/out"),
      running: true,
      summary,
      progress,
      taskIdByIndex: [10],
      previewNames: ["photo_001.zip", "photo_002.zip"],
    });

    const clearedDraft: DraftSnapshot = {
      items: [],
      namingTemplate: "photo_{n}",
      startNumber: 1,
      outputDir: "/out",
      outputMode: "zip",
      conflictPolicy: "autoRename",
    };
    mockArchive.clearItems.mockResolvedValue(clearedDraft);

    await useJobStore.getState().reset();

    const state = useJobStore.getState();
    // running must be false regardless of its seeded value.
    expect(state.running).toBe(false);
    // Items must be cleared; template and outputDir retained from snapshot.
    expect(state.draft.items).toEqual([]);
    expect(state.draft.namingTemplate).toBe("photo_{n}");
    expect(state.draft.outputDir).toBe("/out");
    // Transient state must be wiped.
    expect(state.summary).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.taskIdByIndex).toEqual([]);
    expect(state.previewNames).toEqual([]);
  });

  it("sets error on failure and leaves the draft unchanged", async () => {
    const originalDraft = makeDraft(2, "photo_{n}", "/out");
    useJobStore.setState({ draft: originalDraft });
    mockArchive.clearItems.mockRejectedValue("backend boom");

    await useJobStore.getState().reset();

    const state = useJobStore.getState();
    expect(state.error).toBe("backend boom");
    expect(state.draft).toEqual(originalDraft);
  });
});

describe("clearResults", () => {
  // A mixed three-task summary; only its length feeds the auto-continue count.
  const SUMMARY: JobSummaryDto = {
    succeeded: [10, 11],
    cancelled: [],
    failed: [{ taskId: 12, reason: "boom" }],
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
        status: "succeeded",
        reason: null,
      },
      {
        taskId: 12,
        outputName: "out_3.zip",
        outputPath: "/out/out_3.zip",
        status: "failed",
        reason: "boom",
      },
    ],
  };

  // clearResults advances Start # via setStartNumber, which recomputes previews.
  // Give previewOutputName a resolving default so the recompute settles (other
  // describe blocks leave a never-resolving impl behind, since vi.clearAllMocks
  // resets call history but not implementations).
  beforeEach(() => {
    mockArchive.previewOutputName.mockResolvedValue("photo_001.zip");
  });

  it("does nothing when there is no finished summary", async () => {
    await useJobStore.getState().clearResults();

    expect(useJobStore.getState().cleared).toBe(false);
    expect(useJobStore.getState().lastBatch).toBeNull();
    expect(mockArchive.clearItems).not.toHaveBeenCalled();
    expect(mockArchive.setStartNumber).not.toHaveBeenCalled();
  });

  it("stashes the summary into lastBatch, marks cleared, and nulls the summary", async () => {
    useJobStore.setState({
      draft: makeDraft(3, "photo_{n}", "/out", 1),
      summary: SUMMARY,
    });
    // setStartNumber and clearItems both return refreshed drafts.
    mockArchive.setStartNumber.mockResolvedValue(
      makeDraft(3, "photo_{n}", "/out", 4),
    );
    mockArchive.clearItems.mockResolvedValue(
      makeDraft(0, "photo_{n}", "/out", 4),
    );

    await useJobStore.getState().clearResults();

    const state = useJobStore.getState();
    expect(state.cleared).toBe(true);
    expect(state.lastBatch).toEqual({
      summary: SUMMARY,
      outputDir: "/out",
      count: 3,
    });
    expect(state.summary).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.taskIdByIndex).toEqual([]);
    expect(state.previewNames).toEqual([]);
  });

  it("auto-continues the start number by the batch count and clears the queue", async () => {
    useJobStore.setState({
      draft: makeDraft(3, "photo_{n}", "/out", 1),
      summary: SUMMARY,
    });
    mockArchive.setStartNumber.mockResolvedValue(
      makeDraft(3, "photo_{n}", "/out", 4),
    );
    mockArchive.clearItems.mockResolvedValue(
      makeDraft(0, "photo_{n}", "/out", 4),
    );

    await useJobStore.getState().clearResults();

    // Start # advances from 1 by the three-task count to 4.
    expect(mockArchive.setStartNumber).toHaveBeenCalledWith(4);
    expect(mockArchive.clearItems).toHaveBeenCalledTimes(1);
  });

  it("clamps the auto-continued start number to MAX_START", async () => {
    // A start near u32::MAX plus the batch count must not overflow the field.
    useJobStore.setState({
      draft: makeDraft(3, "photo_{n}", "/out", MAX_START - 1),
      summary: SUMMARY,
    });
    mockArchive.setStartNumber.mockResolvedValue(
      makeDraft(3, "photo_{n}", "/out", MAX_START),
    );
    mockArchive.clearItems.mockResolvedValue(
      makeDraft(0, "photo_{n}", "/out", MAX_START),
    );

    await useJobStore.getState().clearResults();

    expect(mockArchive.setStartNumber).toHaveBeenCalledWith(MAX_START);
  });

  it("keeps lastBatch after the queue is cleared (Undo must still work)", async () => {
    useJobStore.setState({
      draft: makeDraft(3, "photo_{n}", "/out", 1),
      summary: SUMMARY,
    });
    mockArchive.setStartNumber.mockResolvedValue(
      makeDraft(3, "photo_{n}", "/out", 4),
    );
    mockArchive.clearItems.mockResolvedValue(
      makeDraft(0, "photo_{n}", "/out", 4),
    );

    await useJobStore.getState().clearResults();

    expect(useJobStore.getState().lastBatch).not.toBeNull();
    expect(useJobStore.getState().lastBatch?.count).toBe(3);
  });
});

describe("restoreResults", () => {
  const SUMMARY: JobSummaryDto = {
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
  };

  it("does nothing when there is no residual last batch", () => {
    useJobStore.getState().restoreResults();

    expect(useJobStore.getState().summary).toBeNull();
    expect(useJobStore.getState().cleared).toBe(false);
  });

  it("restores the stashed summary, unsets cleared, and drops lastBatch", () => {
    useJobStore.setState({
      cleared: true,
      summary: null,
      lastBatch: { summary: SUMMARY, outputDir: "/out", count: 1 },
    });

    useJobStore.getState().restoreResults();

    const state = useJobStore.getState();
    expect(state.summary).toEqual(SUMMARY);
    expect(state.cleared).toBe(false);
    expect(state.lastBatch).toBeNull();
  });
});
