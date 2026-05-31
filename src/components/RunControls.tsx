import { Button } from "@/components/ui/button";
import { useJobStore } from "@/store/jobStore";

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
  const runDisabled = items.length === 0 || !outputDir || running;

  // Human-readable reason Run is unavailable, shown on hover (empty when ready).
  const runReason =
    items.length === 0
      ? "Add at least one item"
      : !outputDir
        ? "Choose an output directory"
        : running
          ? "A job is already running"
          : "";

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
