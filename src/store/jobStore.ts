import { create } from "zustand";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { OutputMode } from "@/bindings/OutputMode";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
// Namespace import to disambiguate the command wrappers from the store actions,
// which share names (addItems, reorder, setNamingRule, ...).
import * as archive from "@/lib/archive";
import { messageFromReason } from "@/lib/errors";
import { DEFAULT_TEMPLATE } from "@/lib/naming";
import { persistOutputDir } from "@/lib/output-dir-default";

// Monotonic counter tagging each recomputePreviews run. A run only commits its
// result if it is still the latest; otherwise a slower batch could overwrite a
// newer one and leave previewNames out of sync with draft.items.
let previewGeneration = 0;

// Build the state patch for a structural draft edit (add/reorder). Editing the
// draft changes item identity/order, so any prior job's positionally-aligned
// per-row verdicts (summary/progress/taskIdByIndex) are now stale and cleared.
function draftEdit(draft: DraftSnapshot): Partial<JobState> {
  return {
    draft,
    error: null,
    summary: null,
    progress: null,
    taskIdByIndex: [],
  };
}

/**
 * The central UI state for building a draft and running an archive job.
 * State fields mirror the backend's draft snapshot plus job/progress results;
 * actions wrap the typed command wrappers in `@/lib/archive`.
 */
export interface JobState {
  /** The current draft (queued items, naming template, output dir). */
  draft: DraftSnapshot;
  /**
   * Preview output filenames, index-aligned with draft.items: either empty
   * (no template, or a recompute in flight) or exactly items.length long.
   */
  previewNames: string[];
  /**
   * The single hero preview filename for the OUTPUT group, computed from the
   * effective template (the draft template, or DEFAULT_TEMPLATE before one has
   * been pushed) at sequence 1. Independent of draft.items so the OUTPUT group
   * shows a representative filename even with an empty queue. This is the single
   * source of truth for OutputSettings' full-path hero — it does not run its own
   * preview pipeline. Tri-state mirroring the old component-local convention:
   *   null  = loading (a recompute is pending / in flight),
   *   ""    = the preview could not be resolved (error path),
   *   <str> = the resolved filename ready for display.
   */
  firstPreview: string | null;
  /**
   * The error message for the hero preview, or null on success. Distinct from
   * `error` (general action errors) so the OUTPUT alert reflects only preview
   * resolution failures, matching the previous component-local `error` state.
   */
  previewError: string | null;
  /** The latest progress snapshot received during a job, if any. */
  progress: ProgressEvent | null;
  /** The summary of the most recently finished job, if any. */
  summary: JobSummaryDto | null;
  /**
   * Backend task id for each draft item, positionally aligned with draft.items
   * (index i corresponds to the task rendered at row i). Derived from the latest
   * progress event or the finished-job summary; cleared when the draft is edited.
   */
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
  /** Set the output mode (re-zip vs extract-to-folder); stores the returned draft. */
  setOutputMode: (mode: OutputMode) => Promise<void>;
  /** Start the archive job and store its summary when it finishes. */
  runJob: () => Promise<void>;
  /** Request cancellation of the running job (does not flip `running`). */
  cancelJob: () => Promise<void>;
  /** Apply a progress event, deriving task ids from its per-task entries. */
  applyProgress: (event: ProgressEvent) => void;
  /** Recompute preview filenames from the current draft. */
  recomputePreviews: () => Promise<void>;
  /**
   * Clear all queued items while preserving the naming template and output dir.
   * Resets transient job state (summary, progress, error, taskIdByIndex,
   * previewNames) and sets running to false. The UI only reaches reset() when
   * running is already false, but defensively forcing it prevents a stale
   * spinner if the invariant is ever violated. The retained settings come from
   * the backend snapshot so they remain in sync with the backend draft. This is
   * a user-initiated queue clear — distinct from resetJobStore(), which is the
   * test-only full reset.
   */
  reset: () => Promise<void>;
}

export const useJobStore = create<JobState>()((set, get) => ({
  draft: {
    items: [],
    namingTemplate: null,
    outputDir: null,
    outputMode: "zip",
    conflictPolicy: "autoRename",
  },
  previewNames: [],
  firstPreview: null,
  previewError: null,
  progress: null,
  summary: null,
  taskIdByIndex: [],
  running: false,
  error: null,

  addItems: async (paths) => {
    try {
      const draft = await archive.addItems(paths);
      set(draftEdit(draft));
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  reorder: async (from, to) => {
    try {
      const draft = await archive.reorder(from, to);
      set(draftEdit(draft));
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
      return;
    }
    // Persistence is best-effort: a localStorage failure (quota / disabled
    // storage) must not surface as a user-facing error for an operation that
    // already succeeded.
    try {
      persistOutputDir(dir);
    } catch (reason) {
      console.error("setOutputDir: persisting output dir failed", reason);
    }
  },

  setOutputMode: async (mode) => {
    try {
      // A mode change drives what the OUTPUT group shows (re-zip vs extract),
      // not the preview filenames, so no recompute is needed.
      const draft = await archive.setOutputMode(mode);
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
    // Tag this run; a later run bumps the counter and supersedes us. The same
    // guard covers both the per-item previewNames and the single hero preview,
    // so they can never disagree mid-flight (the bug F7 collapsed: there is now
    // one debounce + one race guard, not two).
    const generation = ++previewGeneration;
    const { draft } = get();
    const template = draft.namingTemplate;
    // The hero always shows a representative filename: fall back to the shared
    // default before NamingRuleForm has pushed a template, so the OUTPUT group
    // is meaningful on first paint even with an empty queue.
    const heroTemplate = template ?? DEFAULT_TEMPLATE;
    // Mark the hero as loading; firstPreview === null suppresses the hero path
    // while the recompute is in flight, mirroring the old component-local guard.
    set({ firstPreview: null });
    try {
      // Sequence numbers are 1-based, matching the backend's naming contract.
      // The hero preview uses sequence 1; per-item previews use i + 1.
      const [heroName, names] = await Promise.all([
        archive.previewOutputName(heroTemplate, 1),
        // previewNames stays index-aligned with draft.items and empty for a null
        // template (no items, or no template => no per-item names).
        template === null
          ? Promise.resolve<string[]>([])
          : Promise.all(
              draft.items.map((_item, i) =>
                archive.previewOutputName(template, i + 1),
              ),
            ),
      ]);
      // Bail if a newer recompute superseded this one while awaiting.
      if (generation !== previewGeneration) return;
      set({
        previewNames: names,
        firstPreview: heroName,
        previewError: null,
        // Preserve the pre-refactor general-error semantics exactly: only a real
        // per-item recompute (non-null template) cleared the top-level `error`;
        // a null-template recompute left it untouched. The hero preview drives
        // only `previewError`, never App's top banner.
        ...(template !== null ? { error: null } : {}),
      });
    } catch (reason) {
      // Same staleness check on the failure path.
      if (generation !== previewGeneration) return;
      const message = messageFromReason(reason);
      set({
        previewNames: [],
        firstPreview: "",
        previewError: message,
        // Parity with the success path: a null-template recompute never touched
        // the general `error` before (it returned early), so a hero-only failure
        // must not raise the top-level banner.
        ...(template !== null ? { error: message } : {}),
      });
    }
  },

  reset: async () => {
    try {
      const draft = await archive.clearItems();
      // Defensively set running to false even though the UI only reaches reset()
      // when running is already false; this prevents a stuck spinner if the
      // invariant is ever violated.
      set({
        draft,
        running: false,
        summary: null,
        progress: null,
        error: null,
        previewError: null,
        taskIdByIndex: [],
        previewNames: [],
        firstPreview: null,
      });
    } catch (reason) {
      set({ error: messageFromReason(reason) });
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

/**
 * Select the single hero preview filename for the OUTPUT group. This is the one
 * source of preview truth OutputSettings reads (it no longer runs its own
 * debounced previewOutputName pipeline). Tri-state: null = loading, "" = error,
 * <str> = resolved filename.
 */
export const selectFirstPreview = (s: JobState): string | null =>
  s.firstPreview;
