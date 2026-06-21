import { RotateCcw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJobStore } from "@/store/jobStore";

/** Content and labels for the confirm dialog, keyed by reset variant. */
interface ResetDialogConfig {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

const CLEAR_CONFIG: ResetDialogConfig = {
  title: "Clear the queue?",
  description:
    "This removes all queued items. Your destination and naming are kept.",
  confirmLabel: "Clear",
  cancelLabel: "Cancel",
};

const NEW_BATCH_CONFIG: ResetDialogConfig = {
  title: "Start a new batch?",
  description:
    "This clears the finished queue and summary. Your destination and naming are kept.",
  confirmLabel: "New batch",
  cancelLabel: "Cancel",
};

/**
 * The queue reset action (Clear / New batch). It is visible only when there are
 * queued items and no job is running, and opens a ConfirmDialog before calling
 * the store's reset() so the user never accidentally clears the queue.
 *
 * Copy is summary-aware: "Clear" while a batch is being assembled, "New batch"
 * once a run summary is present. It now sits at the left of the queue toolbar in
 * the right canvas (the ghost variant keeps it visually subordinate to the
 * outline Add buttons sharing that row and the brand Run in the left rail).
 *
 * It is fully self-contained (no props): it reads its visibility and the reset
 * action from the store, so it is a drop-in wherever the run row is composed.
 */
export function ResetButton() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const hasSummary = useJobStore((s) => s.summary !== null);
  const running = useJobStore((s) => s.running);
  const reset = useJobStore((s) => s.reset);

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const showReset = itemCount > 0 && !running;

  // Choose dialog copy and the button label based on whether a finished summary
  // is present.
  const dialogConfig = hasSummary ? NEW_BATCH_CONFIG : CLEAR_CONFIG;
  const buttonLabel = hasSummary ? "New batch" : "Clear";

  function handleResetClick() {
    setDialogOpen(true);
  }

  function handleConfirm() {
    setDialogOpen(false);
    void reset();
  }

  function handleCancel() {
    setDialogOpen(false);
  }

  if (!showReset) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleResetClick}
      >
        <RotateCcw aria-hidden="true" />
        {buttonLabel}
      </Button>
      <ConfirmDialog
        open={dialogOpen}
        title={dialogConfig.title}
        description={dialogConfig.description}
        confirmLabel={dialogConfig.confirmLabel}
        cancelLabel={dialogConfig.cancelLabel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
