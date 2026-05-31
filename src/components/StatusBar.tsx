import { RotateCcw } from "lucide-react";
import * as React from "react";

import { OverallProgress } from "@/components/OverallProgress";
import { RunSummary } from "@/components/RunSummary";
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
 * The footer (AppShell's `statusBar` slot): the post-run observation zone.
 * While a job runs, `OverallProgress` shows the aggregate bar + ETA; once it
 * finishes, `RunSummary` shows the Succeeded/Failed/Cancelled projection. When
 * idle (no progress, no summary) the left slot shows a quiet hint so the footer
 * is never empty chrome. OverallProgress and RunSummary each keep their own
 * internal null-guards for when they are mounted but their store slice is null.
 *
 * The right slot holds a Reset button that is visible when there are queued
 * items and no job is running. It opens a ConfirmDialog before calling the
 * store's reset() action so the user never accidentally clears the queue.
 */
export function StatusBar() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const hasProgress = useJobStore((s) => s.progress !== null);
  const hasSummary = useJobStore((s) => s.summary !== null);
  const running = useJobStore((s) => s.running);
  const reset = useJobStore((s) => s.reset);

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const hasItems = itemCount > 0;
  const showReset = hasItems && !running;

  // Choose dialog copy based on whether a finished summary is present.
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

  const leftContent =
    !hasProgress && !hasSummary ? (
      <p className="text-xs text-muted-foreground">
        {itemCount === 0
          ? "Ready — add files or folders to begin."
          : `${itemCount} item${itemCount === 1 ? "" : "s"} queued`}
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        <OverallProgress />
        <RunSummary />
      </div>
    );

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">{leftContent}</div>
        {/* Reset slot — fixed height to avoid footer reflow when it appears/disappears. */}
        <div className="flex h-8 shrink-0 items-center">
          {showReset && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetClick}
            >
              <RotateCcw aria-hidden="true" />
              {buttonLabel}
            </Button>
          )}
        </div>
      </div>
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
