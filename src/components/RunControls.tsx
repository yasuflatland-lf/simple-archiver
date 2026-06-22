import { Check, CircleDot, Play } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  type Readiness,
  readinessFor,
  runUnavailableReason,
} from "@/lib/readiness";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

// Stable id linking the disabled Run button to its reason via aria-describedby.
const RUN_REASON_ID = "run-disabled-reason";

// Chip label for each pending readiness state. "ready" gets its own confirming
// branch in ReadinessChip, so it maps to an empty label here.
const READINESS_CHIP_LABEL: Record<Readiness, string> = {
  "add-files": "Add files",
  "choose-destination": "Choose a destination",
  ready: "",
};

// Visual mirror of Run's disabled reason, placed immediately to the left of the
// Run button. Pending states nudge the user toward the next required action;
// "ready" confirms a run is possible. Only rendered in the idle state.
function ReadinessChip({ readiness }: { readiness: Readiness }) {
  if (readiness === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-status-success-foreground">
        <Check aria-hidden="true" className="size-3.5" />
        Ready
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground">
      <CircleDot aria-hidden="true" className="size-3.5" />
      {READINESS_CHIP_LABEL[readiness]}
    </span>
  );
}

/**
 * RunControls renders the queue's run row for the current state:
 *   - idle  (running === false): the readiness chip + Run grouped at the right
 *     edge.
 *   - active (running === true): Cancel only (Run is not in the DOM), kept at the
 *     right edge so the primary button does not jump when toggling Run↔Cancel.
 *
 * Both states anchor the primary button (Run / Cancel) at the right edge so it
 * never shifts position. The reset action (Clear / New batch) lives in the queue
 * toolbar in the right canvas, not here.
 *
 * Run retains full accessible-disabled semantics (aria-disabled / aria-describedby /
 * sr-only reason span / title / handler guard) so assistive technology can announce
 * why it is unavailable even before the user has filled in all required fields.
 */
export function RunControls() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const outputMode = useJobStore((s) => s.draft.outputMode);
  const conflictPolicy = useJobStore((s) => s.draft.conflictPolicy);
  const running = useJobStore((s) => s.running);

  const [confirmOpen, setConfirmOpen] = React.useState(false);

  // Compute readiness once; derive the reason string from it so both the
  // Run button's accessible-disabled semantics and the ReadinessChip share
  // the same Readiness value without calling readinessFor twice.
  const readiness = readinessFor(itemCount, outputDir);
  const runReason = runUnavailableReason(readiness);
  const runDisabled = runReason !== "";

  // Overwrite in Folder mode is destructive (it removes existing folders before
  // extracting), so it must be confirmed before the job starts.
  const needsOverwriteConfirm =
    outputMode === "folder" && conflictPolicy === "overwrite";

  function startRun() {
    useJobStore.getState().runJob();
  }

  function handleRun() {
    // Run uses aria-disabled instead of the native disabled attribute so it stays
    // focusable and AT can announce the reason. Guard clicks explicitly because
    // aria-disabled does not suppress them.
    if (runDisabled) return;
    if (needsOverwriteConfirm) {
      setConfirmOpen(true);
      return;
    }
    startRun();
  }

  function handleConfirmOverwrite() {
    setConfirmOpen(false);
    startRun();
  }

  function handleCancelOverwrite() {
    setConfirmOpen(false);
  }

  function handleCancel() {
    useJobStore.getState().cancelJob();
  }

  if (running) {
    // Cancel sits at the right edge, where Run was, so the primary button keeps
    // its position across the Run↔Cancel toggle.
    return (
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="flex items-center gap-2">
        <ReadinessChip readiness={readiness} />
        <Button
          type="button"
          variant="brand"
          aria-disabled={runDisabled || undefined}
          aria-describedby={runDisabled ? RUN_REASON_ID : undefined}
          title={runReason || undefined}
          className={cn(runDisabled && "opacity-50")}
          onClick={handleRun}
        >
          <Play aria-hidden="true" />
          Run
        </Button>
        {runDisabled ? (
          <span id={RUN_REASON_ID} className="sr-only">
            {runReason}
          </span>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Overwrite existing folders?"
        description="Overwrite removes any existing destination folder before extracting. This cannot be undone."
        confirmLabel="Overwrite and run"
        cancelLabel="Cancel"
        onConfirm={handleConfirmOverwrite}
        onCancel={handleCancelOverwrite}
      />
    </div>
  );
}
