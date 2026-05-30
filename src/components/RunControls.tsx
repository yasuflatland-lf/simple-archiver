import { Button } from "@/components/ui/button";
import { useJobStore } from "@/store/jobStore";

/**
 * RunControls renders the primary job actions (Run / Cancel) and displays
 * any error message or job-summary counts below the buttons.
 */
export function RunControls() {
  const items = useJobStore((s) => s.draft.items);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const running = useJobStore((s) => s.running);
  const error = useJobStore((s) => s.error);
  const summary = useJobStore((s) => s.summary);

  // Run is only enabled when there is at least one item, an output directory
  // has been set, and no job is currently in flight.
  const runDisabled = items.length === 0 || !outputDir || running;

  function handleRun() {
    useJobStore.getState().runJob();
  }

  function handleCancel() {
    useJobStore.getState().cancelJob();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button variant="brand" disabled={runDisabled} onClick={handleRun}>
          Run
        </Button>
        <Button variant="outline" disabled={!running} onClick={handleCancel}>
          Cancel
        </Button>
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {summary !== null && (
        <p className="text-sm text-muted-foreground">
          {`Succeeded ${summary.succeeded.length}, Failed ${summary.failed.length}, Cancelled ${summary.cancelled.length}`}
        </p>
      )}
    </div>
  );
}
