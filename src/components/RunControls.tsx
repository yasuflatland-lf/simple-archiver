import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

// Human-readable reason Run is unavailable, shown on hover and to AT (empty when ready).
function runUnavailableReason(
  itemCount: number,
  outputDir: string | null,
  running: boolean,
): string {
  if (itemCount === 0) return "Add at least one item";
  if (!outputDir) return "Choose an output directory";
  if (running) return "A job is already running";
  return "";
}

// Stable id linking the disabled Run button to its reason via aria-describedby.
const RUN_REASON_ID = "run-disabled-reason";

/**
 * RunControls renders the primary job actions (Cancel / Run). Run is the
 * right-edge primary; Cancel sits to its left and is recessive. The completion
 * summary is rendered separately by RunSummary; error display is the top-level
 * App banner — no duplication here.
 */
export function RunControls() {
  const items = useJobStore((s) => s.draft.items);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const running = useJobStore((s) => s.running);
  // Run is only enabled with at least one item, an output directory set, and no
  // job in flight.
  const runReason = runUnavailableReason(items.length, outputDir, running);
  const runDisabled = runReason !== "";

  function handleRun() {
    // Run uses aria-disabled (not the native disabled attribute) so it stays
    // focusable and AT can announce why it is unavailable. Guard the action.
    if (runDisabled) return;
    useJobStore.getState().runJob();
  }

  function handleCancel() {
    useJobStore.getState().cancelJob();
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={!running} onClick={handleCancel}>
        Cancel
      </Button>
      <Button
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
