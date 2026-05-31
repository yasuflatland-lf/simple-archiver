import { Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

// Human-readable reason Run is unavailable, shown on hover and to assistive technology (AT); empty string when ready.
function runUnavailableReason(
  itemCount: number,
  outputDir: string | null,
): string {
  if (itemCount === 0) return "Add at least one item";
  if (!outputDir) return "Choose an output directory";
  return "";
}

// Stable id linking the disabled Run button to its reason via aria-describedby.
const RUN_REASON_ID = "run-disabled-reason";

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

  // Run disabled reason is computed only from items/outputDir; the running
  // branch is never shown while running (Cancel replaces Run entirely).
  const runReason = runUnavailableReason(itemCount, outputDir);
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
