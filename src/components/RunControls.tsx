import { Check, CircleDot, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
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
 * RunControls renders the primary job action for the current state:
 *   - idle  (running === false): Run only (Cancel is not in the DOM).
 *   - active (running === true): Cancel only (Run is not in the DOM).
 *
 * Run retains full accessible-disabled semantics (aria-disabled / aria-describedby /
 * sr-only reason span / title / handler guard) so assistive technology can announce
 * why it is unavailable even before the user has filled in all required fields.
 */
export function RunControls() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const running = useJobStore((s) => s.running);

  // Compute readiness once; derive the reason string from it so both the
  // Run button's accessible-disabled semantics and the ReadinessChip share
  // the same Readiness value without calling readinessFor twice.
  const readiness = readinessFor(itemCount, outputDir);
  const runReason = runUnavailableReason(readiness);
  const runDisabled = runReason !== "";

  function handleRun() {
    // Run uses aria-disabled instead of the native disabled attribute so it stays
    // focusable and AT can announce the reason. Guard clicks explicitly because
    // aria-disabled does not suppress them.
    if (runDisabled) return;
    useJobStore.getState().runJob();
  }

  function handleCancel() {
    useJobStore.getState().cancelJob();
  }

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
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
  );
}
