import { verbForMode } from "@/lib/wording";
import { useJobStore } from "@/store/jobStore";

/**
 * The slim status footer (AppShell's `statusBar` slot). It is a quiet status
 * line only. The aggregate progress bar and the run summary render in the right
 * canvas (the morphing work area), and the queue reset action (Clear / New
 * batch) now lives beside Run in the left rail (see {@link ResetButton}), so the
 * footer stays slim.
 *
 * It shows a quiet hint: a Ready/queued-count line when idle, plus an sr-only
 * mode-aware live announcement ("extracted N" / "archived N") while a job is in
 * flight so screen-reader users hear mode-aware progress copy.
 */
export function StatusBar() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const outputMode = useJobStore((s) => s.draft.outputMode);
  const hasProgress = useJobStore((s) => s.progress !== null);
  const hasSummary = useJobStore((s) => s.summary !== null);

  // Mode-aware verb: "extracted" in Folder mode vs "archived" in Zip mode. Used
  // for the live progress announcement below.
  const verb = verbForMode(outputMode);

  return (
    <div className="min-w-0">
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
  );
}
