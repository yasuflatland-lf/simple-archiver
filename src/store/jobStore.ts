import { create } from "zustand";
import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
// Namespace import to disambiguate the command wrappers from the store actions,
// which share names (addItems, reorder, setNamingRule, ...).
import * as archive from "@/lib/archive";

// Normalize a rejection reason into a human-readable message. Tauri command
// errors arrive as strings; transport/serialization failures may reject with an
// Error or other value, so avoid rendering "[object Object]".
function messageFromReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "Something went wrong. Please try again.";
}

/**
 * The central UI state for building a draft and running an archive job.
 * State fields mirror the backend's draft snapshot plus job/progress results;
 * actions wrap the typed command wrappers in `@/lib/archive`.
 */
export interface JobState {
  /** The current draft (queued items, naming template, output dir). */
  draft: DraftSnapshot;
  /** Preview output filenames, one per draft item, in order. */
  previewNames: string[];
  /** The latest progress snapshot received during a job, if any. */
  progress: ProgressEvent | null;
  /** The summary of the most recently finished job, if any. */
  summary: JobSummaryDto | null;
  /** Task ids in job order, derived from progress / a finished job. */
  taskIdByIndex: number[];
  /** Whether an archive job is currently in flight. */
  running: boolean;
  /** The latest error message, or null when the last action succeeded. */
  error: string | null;

  /** Add file/folder paths to the draft, then recompute previews. */
  addItems: (paths: string[]) => Promise<void>;
  /** Move the draft item at `from` to `to`, then recompute previews. */
  reorder: (from: number, to: number) => Promise<void>;
  /** Set the naming template, then recompute previews. */
  setNamingRule: (template: string) => Promise<void>;
  /** Set the output directory (does not affect preview filenames). */
  setOutputDir: (dir: string) => Promise<void>;
  /** Start the archive job and store its summary when it finishes. */
  runJob: () => Promise<void>;
  /** Request cancellation of the running job (does not flip `running`). */
  cancelJob: () => Promise<void>;
  /** Apply a progress event, deriving task ids from its per-task entries. */
  applyProgress: (event: ProgressEvent) => void;
  /** Recompute preview filenames from the current draft. */
  recomputePreviews: () => Promise<void>;
}

export const useJobStore = create<JobState>()((set, get) => ({
  draft: { items: [], namingTemplate: null, outputDir: null },
  previewNames: [],
  progress: null,
  summary: null,
  taskIdByIndex: [],
  running: false,
  error: null,

  addItems: async (paths) => {
    try {
      const draft = await archive.addItems(paths);
      set({ draft, error: null });
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  reorder: async (from, to) => {
    try {
      const draft = await archive.reorder(from, to);
      set({ draft, error: null });
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  setNamingRule: async (template) => {
    try {
      const draft = await archive.setNamingRule(template);
      set({ draft, error: null });
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  setOutputDir: async (dir) => {
    try {
      // Output dir does not affect preview filenames, so skip recompute.
      const draft = await archive.setOutputDir(dir);
      set({ draft, error: null });
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  runJob: async () => {
    set({ running: true, summary: null, error: null });
    try {
      const summary = await archive.runJob();
      // Derive task ids from the latest progress if a job emitted any.
      const progress = get().progress;
      const taskIdByIndex = progress
        ? progress.perTask.map((t) => t.taskId)
        : get().taskIdByIndex;
      set({ summary, running: false, taskIdByIndex });
    } catch (reason) {
      set({ running: false, error: messageFromReason(reason) });
    }
  },

  cancelJob: async () => {
    try {
      // Do not flip `running`: the in-flight runJob resolves with a summary
      // that already includes the cancelled tasks.
      await archive.cancelJob();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  applyProgress: (event) => {
    set({ progress: event, taskIdByIndex: event.perTask.map((t) => t.taskId) });
  },

  recomputePreviews: async () => {
    const { draft } = get();
    const template = draft.namingTemplate;
    if (template === null) {
      set({ previewNames: [] });
      return;
    }
    try {
      // Sequence numbers are 1-based, matching the backend's naming contract.
      const names = await Promise.all(
        draft.items.map((_item, i) =>
          archive.previewOutputName(template, i + 1),
        ),
      );
      set({ previewNames: names, error: null });
    } catch (reason) {
      set({ previewNames: [], error: messageFromReason(reason) });
    }
  },
}));

/**
 * Reset the store to its initial state. zustand v5's `getInitialState()`
 * returns the full initial state including action functions, so replace-mode
 * (`true`) reset restores real actions. This is the canonical test reset.
 */
export function resetJobStore(): void {
  useJobStore.setState(useJobStore.getInitialState(), true);
}
