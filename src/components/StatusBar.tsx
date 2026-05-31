import { OverallProgress } from "@/components/OverallProgress";
import { RunSummary } from "@/components/RunSummary";
import { useJobStore } from "@/store/jobStore";

/**
 * The footer (AppShell's `statusBar` slot): the post-run observation zone.
 * While a job runs, `OverallProgress` shows the aggregate bar + ETA; once it
 * finishes, `RunSummary` shows the Succeeded/Failed/Cancelled projection. When
 * idle (no progress, no summary) it shows a quiet hint so the footer is never
 * empty chrome. StatusBar short-circuits to an idle hint when there is nothing
 * to show; OverallProgress and RunSummary each keep their own internal
 * null-guards for when they are mounted but their store slice is null.
 */
export function StatusBar() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const hasProgress = useJobStore((s) => s.progress !== null);
  const hasSummary = useJobStore((s) => s.summary !== null);

  if (!hasProgress && !hasSummary) {
    return (
      <p className="text-xs text-muted-foreground">
        {itemCount === 0
          ? "Ready — add files or folders to begin."
          : `${itemCount} item${itemCount === 1 ? "" : "s"} queued`}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <OverallProgress />
      <RunSummary />
    </div>
  );
}
