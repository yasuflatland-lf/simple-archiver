import { RotateCcw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { verbForMode } from "@/lib/wording";
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
 * The slim status footer (AppShell's `statusBar` slot). It is a quiet status
 * line plus the queue Reset/Clear action. The aggregate progress bar and the
 * run summary no longer live here — they render in the right canvas (the
 * morphing work area), so the footer stays slim.
 *
 * The left slot shows a quiet hint: a Ready/queued-count line when idle, and an
 * sr-only mode-aware live announcement ("extracted N" / "archived N") while a
 * job is in flight so screen-reader users hear mode-aware progress copy.
 *
 * The right slot holds a Reset button that is visible when there are queued
 * items and no job is running. It opens a ConfirmDialog before calling the
 * store's reset() action so the user never accidentally clears the queue.
 */
export function StatusBar() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const outputMode = useJobStore((s) => s.draft.outputMode);
  const hasProgress = useJobStore((s) => s.progress !== null);
  const hasSummary = useJobStore((s) => s.summary !== null);
  const running = useJobStore((s) => s.running);
  const reset = useJobStore((s) => s.reset);

  // Mode-aware verb: "extracted" in Folder mode vs "archived" in Zip mode. Used
  // for the live progress announcement below.
  const verb = verbForMode(outputMode);

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

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* While a job is in flight (progress, no summary yet) announce the
              mode-aware action so screen-reader users hear "extracted"/"archived".
              The visible aggregate bar lives in the canvas; this footer only
              carries the sr-only line. */}
          {hasProgress && !hasSummary ? (
            <p className="sr-only" aria-live="polite">
              {verb} {itemCount}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {itemCount === 0
              ? "Ready — add files or folders to begin."
              : `${itemCount} item${itemCount === 1 ? "" : "s"} queued`}
          </p>
        </div>
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
