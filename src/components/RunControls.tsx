import { Button } from "@/components/ui/button";
import { useJobStore } from "@/store/jobStore";

// Human-readable reason Run is unavailable, shown on hover (empty when ready).
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

/**
 * RunControls renders the primary job actions (Run / Cancel). The completion
 * summary is rendered separately by RunSummary; error display is handled by the
 * top-level App banner — there is no duplication here.
 */
export function RunControls() {
  const items = useJobStore((s) => s.draft.items);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const running = useJobStore((s) => s.running);
  // Run is only enabled when there is at least one item, an output directory
  // has been set, and no job is currently in flight.
  const runReason = runUnavailableReason(items.length, outputDir, running);
  const runDisabled = runReason !== "";

  function handleRun() {
    useJobStore.getState().runJob();
  }

  function handleCancel() {
    useJobStore.getState().cancelJob();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <span title={runReason || undefined}>
          <Button variant="brand" disabled={runDisabled} onClick={handleRun}>
            Run
          </Button>
        </span>
        <Button variant="outline" disabled={!running} onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
