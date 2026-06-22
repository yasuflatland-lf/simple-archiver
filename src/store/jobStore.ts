import { create } from "zustand";

import type { ConflictPolicy } from "@/bindings/ConflictPolicy";
import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { OutputMode } from "@/bindings/OutputMode";
import type { ProgressEvent } from "@/bindings/ProgressEvent";
// Namespace import to disambiguate the command wrappers from the store actions,
// which share names (addItems, reorder, setNamingRule, ...).
import * as archive from "@/lib/archive";
import { messageFromReason } from "@/lib/errors";
import {
  DEFAULT_START,
  DEFAULT_TEMPLATE,
  nextStartAfterBatch,
} from "@/lib/naming";
import { persistOutputDir } from "@/lib/output-dir-default";
import { taskIdsFromProgress } from "@/lib/status";

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
    // A structural draft change re-indexes the rows, so any index-based row
    // selection now points at the wrong rows and is dropped.
    selectedIndices: [],
    selectionAnchor: null,
  };
}

/**
 * A snapshot of the most recently cleared run, kept so the residual "last batch"
 * chip can summarize it (count + destination) and Undo can restore its Ledger.
 * Only the single most-recent batch is retained — there is no run history.
 */
interface LastBatch {
  /** The finished job's summary, restored verbatim by restoreResults(). */
  summary: JobSummaryDto;
  /** The destination the batch wrote to (the chip's Open target), or null. */
  outputDir: string | null;
  /** The number of tasks in the batch (drives the chip label + auto-continue). */
  count: number;
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
   * source of truth for the left rail's full-path hero — it does not run its own
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
  /**
   * The most recently cleared run, kept so the residual chip can summarize it
   * and Undo can restore its Ledger. Null when no run has been cleared (or the
   * chip was discarded by queuing/running the next batch).
   */
  lastBatch: LastBatch | null;
  /**
   * True after a finished run was cleared: the canvas folds back to the drop
   * zone while `lastBatch` pins the residual chip above it. Reset to false once
   * the next batch is queued/run or the clear is undone.
   */
  cleared: boolean;
  /**
   * Indices of the currently selected queue rows (sorted ascending). Drives the
   * row highlight and the keyboard delete. Index-based, so it is cleared whenever
   * the draft is structurally edited (see {@link draftEdit}).
   */
  selectedIndices: number[];
  /**
   * The anchor row for a Shift range selection (the row a range extends from),
   * or null when there is no active selection to extend from.
   */
  selectionAnchor: number | null;

  /** Add file/folder paths to the draft, then recompute previews. */
  addItems: (paths: string[]) => Promise<void>;
  /** Move the draft item at `from` to `to`, then recompute previews. */
  reorder: (from: number, to: number) => Promise<void>;
  /** Remove the draft item at `index`, then recompute previews. */
  removeItem: (index: number) => Promise<void>;
  /** Set the naming template, then recompute previews. */
  setNamingRule: (template: string) => Promise<void>;
  /** Set the sequence start number (may be 0), then recompute previews. */
  setStartNumber: (start: number) => Promise<void>;
  /** Set the output directory (does not affect preview filenames). */
  setOutputDir: (dir: string) => Promise<void>;
  /** Set the output mode (re-zip vs extract-to-folder); stores the returned draft. */
  setOutputMode: (mode: OutputMode) => Promise<void>;
  /** Set the Folder-mode collision policy; stores the returned draft. */
  setConflictPolicy: (policy: ConflictPolicy) => Promise<void>;
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
  /**
   * Fold the finished run's Ledger back to the drop zone, ready for the next
   * batch. Stashes the current summary into `lastBatch` (so the residual chip
   * and Undo can use it), advances Start # by the batch count (auto-continue,
   * clamped to MAX_START), clears the queue, and nulls the transient job state
   * like reset() — but KEEPS `lastBatch`. Files on disk are never touched; this
   * only folds the list view. No-op when there is no finished summary.
   */
  clearResults: () => Promise<void>;
  /**
   * Undo the most recent clear: restore the stashed summary (returning the
   * canvas to the Ledger), unset `cleared`, and drop `lastBatch`. No-op when
   * there is no residual batch to restore.
   */
  restoreResults: () => void;
  /**
   * Select the row at `index`, interpreting the click modifiers:
   * - plain (no modifier): select only this row, anchoring future Shift ranges
   *   here;
   * - meta (Cmd/Ctrl): toggle this row in/out of the selection, re-anchoring here;
   * - shift: select the inclusive range from the current anchor to this row
   *   (behaves like a plain click when there is no anchor).
   */
  selectItem: (index: number, mods: { meta: boolean; shift: boolean }) => void;
  /** Select every queued row. No-op when the queue is empty. */
  selectAll: () => void;
  /** Clear the row selection and its anchor. */
  clearSelection: () => void;
  /**
   * Remove every selected row. Deleting all rows takes the single-call `reset()`
   * path (same as Clear, without its dialog); otherwise the rows are removed
   * highest-index-first so a removal never shifts a not-yet-removed index.
   */
  deleteSelected: () => Promise<void>;
}

export const useJobStore = create<JobState>()((set, get) => ({
  draft: {
    items: [],
    namingTemplate: null,
    startNumber: DEFAULT_START,
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
  lastBatch: null,
  cleared: false,
  selectedIndices: [],
  selectionAnchor: null,

  addItems: async (paths) => {
    try {
      const draft = await archive.addItems(paths);
      // Queuing the next batch discards the residual chip: it only ever refers
      // to the most recent completed run.
      set({ ...draftEdit(draft), lastBatch: null, cleared: false });
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  reorder: async (from, to) => {
    try {
      // A structural edit clears the selection (draftEdit), but if the moved row
      // was the only selected one, follow it to its new index so keyboard reorder
      // can chain and the eye keeps track of the row. Drag/button paths get the
      // same harmless follow when their row happens to be the sole selection.
      const sel = get().selectedIndices;
      const followsMovedRow = sel.length === 1 && sel[0] === from;
      const draft = await archive.reorder(from, to);
      set(draftEdit(draft));
      if (followsMovedRow) set({ selectedIndices: [to], selectionAnchor: to });
      await get().recomputePreviews();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  removeItem: async (index) => {
    try {
      const draft = await archive.removeItem(index);
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

  setStartNumber: async (start) => {
    try {
      // The start number shifts every per-item number and the hero preview, so
      // recompute previews after the backend stores it.
      const draft = await archive.setStartNumber(start);
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

  setConflictPolicy: async (policy) => {
    try {
      // The collision policy only affects Folder-mode placement at run time, not
      // the preview filenames, so no recompute is needed.
      const draft = await archive.setConflictPolicy(policy);
      set({ draft, error: null });
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  runJob: async () => {
    // Starting the next run supersedes the residual chip, just like queuing.
    set({
      running: true,
      summary: null,
      error: null,
      lastBatch: null,
      cleared: false,
      // A run owns the positional progress arrays; drop any pending row selection
      // so a stale highlight cannot linger over a now-running queue.
      selectedIndices: [],
      selectionAnchor: null,
    });
    try {
      const summary = await archive.runJob();
      // Derive task ids from the latest progress if a job emitted any.
      const progress = get().progress;
      const taskIdByIndex = progress
        ? taskIdsFromProgress(progress)
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
    set({ progress: event, taskIdByIndex: taskIdsFromProgress(event) });
  },

  recomputePreviews: async () => {
    // Tag this run; a later run bumps the counter and supersedes us. The same
    // guard covers both the per-item previewNames and the single hero preview,
    // so they can never disagree mid-flight (the bug F7 collapsed: there is now
    // one debounce + one race guard, not two).
    const generation = ++previewGeneration;
    const { draft } = get();
    const template = draft.namingTemplate;
    // Numbering starts at the draft's start number: the hero shows `start` and
    // per-item previews show `start + i`, mirroring the backend's plan_with_start.
    const start = draft.startNumber;
    // The hero always shows a representative filename: fall back to the shared
    // default before NamingRuleForm has pushed a template, so the OUTPUT group
    // is meaningful on first paint even with an empty queue.
    const heroTemplate = template ?? DEFAULT_TEMPLATE;
    // Mark the hero as loading; firstPreview === null suppresses the hero path
    // while the recompute is in flight, mirroring the old component-local guard.
    set({ firstPreview: null });
    try {
      // The hero preview uses `start`; per-item previews use `start + i`.
      const [heroName, names] = await Promise.all([
        archive.previewOutputName(heroTemplate, start),
        // previewNames stays index-aligned with draft.items and empty for a null
        // template (no items, or no template => no per-item names).
        template === null
          ? Promise.resolve<string[]>([])
          : Promise.all(
              draft.items.map((_item, i) =>
                archive.previewOutputName(template, start + i),
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
        selectedIndices: [],
        selectionAnchor: null,
      });
    } catch (reason) {
      set({ error: messageFromReason(reason) });
    }
  },

  clearResults: async () => {
    const { summary, draft } = get();
    // No finished run means nothing to clear; Clear is a no-op there.
    if (summary === null) return;
    const count = summary.results.length;
    // Auto-continue: the next batch picks up where this one ended (clamped to
    // the backend's u32 max). The clamp itself lives in lib/naming, unit-tested.
    const nextStart = nextStartAfterBatch(draft.startNumber, count);
    // Stash the finished run BEFORE mutating, so the residual chip and Undo can
    // summarize/restore it. setStartNumber recomputes previews against the new
    // (empty) queue; clearItems empties the backend draft.
    set({
      lastBatch: { summary, outputDir: draft.outputDir, count },
      cleared: true,
    });
    let clearedDraft: DraftSnapshot;
    try {
      // setStartNumber pushes the advanced start (and recomputes previews);
      // clearItems empties the backend draft and returns the cleared snapshot.
      await get().setStartNumber(nextStart);
      clearedDraft = await archive.clearItems();
    } catch (reason) {
      set({ error: messageFromReason(reason) });
      return;
    }
    // Mirror reset()'s transient wipe, but KEEP lastBatch so Undo still works.
    // Store the cleared snapshot so the draft (empty queue + advanced start)
    // stays in sync with the backend, just as reset() does.
    set({
      draft: clearedDraft,
      summary: null,
      progress: null,
      taskIdByIndex: [],
      previewNames: [],
      selectedIndices: [],
      selectionAnchor: null,
    });
  },

  restoreResults: () => {
    const lastBatch = get().lastBatch;
    // Nothing stashed means nothing to undo.
    if (lastBatch === null) return;
    // Return to the results/Ledger phase with the previously cleared summary.
    set({ summary: lastBatch.summary, cleared: false, lastBatch: null });
  },

  selectItem: (index, mods) => {
    set((s) => {
      // Shift extends the inclusive range from the anchor; with no anchor yet it
      // degrades to a plain single-row selection.
      if (mods.shift && s.selectionAnchor !== null) {
        const lo = Math.min(s.selectionAnchor, index);
        const hi = Math.max(s.selectionAnchor, index);
        const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        // Keep the anchor where it is so a further Shift click re-extends from it.
        return { selectedIndices: range };
      }
      // Meta (Cmd/Ctrl) toggles a single row, re-anchoring on it.
      if (mods.meta) {
        const next = s.selectedIndices.includes(index)
          ? s.selectedIndices.filter((i) => i !== index)
          : [...s.selectedIndices, index].sort((a, b) => a - b);
        return { selectedIndices: next, selectionAnchor: index };
      }
      // Plain click: select only this row and anchor here.
      return { selectedIndices: [index], selectionAnchor: index };
    });
  },

  selectAll: () => {
    set((s) => {
      const count = s.draft.items.length;
      if (count === 0) return {};
      return {
        selectedIndices: Array.from({ length: count }, (_, i) => i),
        selectionAnchor: 0,
      };
    });
  },

  clearSelection: () => set({ selectedIndices: [], selectionAnchor: null }),

  deleteSelected: async () => {
    const { selectedIndices, draft } = get();
    if (selectedIndices.length === 0) return;
    // Removing every row is exactly the Clear action: do it in one backend call
    // (no per-row recompute) and skip the per-row loop below.
    if (selectedIndices.length === draft.items.length) {
      await get().reset();
      return;
    }
    // Snapshot the targets before mutating: each removeItem clears the selection
    // via draftEdit, and removing highest-index-first keeps the still-pending
    // indices valid (a lower index never shifts when a higher row is removed).
    const targets = [...selectedIndices].sort((a, b) => b - a);
    for (const index of targets) {
      await get().removeItem(index);
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
 * source of preview truth the left rail reads (it no longer runs its own
 * debounced previewOutputName pipeline). Tri-state: null = loading, "" = error,
 * <str> = resolved filename.
 */
export const selectFirstPreview = (s: JobState): string | null =>
  s.firstPreview;
