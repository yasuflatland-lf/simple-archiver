import { Progress } from "@/components/ui/progress";
import { formatEta, progressPercent } from "@/lib/format";
import { useJobStore } from "@/store/jobStore";

/**
 * Aggregate progress for the whole job: a single bar plus the overall percent
 * and ETA. Renders nothing until a progress event has arrived. All values come
 * from the backend `ProgressEvent`; this component only formats them.
 */
export function OverallProgress() {
  const progress = useJobStore((s) => s.progress);
  if (progress === null) return null;

  const percent = progressPercent(
    progress.overall.bytesDone,
    progress.overall.bytesTotal,
  );

  // Right-pad percent to width 3 and render monospace/pre so the line keeps a
  // constant width as percent grows 0 → 100 and does not shift horizontally.
  const etaLabel = `${String(percent).padStart(3)}% · ETA ${formatEta(progress.overallEtaMs)}`;

  return (
    <section aria-label="Overall progress" className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">Overall</span>
        <span className="font-mono whitespace-pre">{etaLabel}</span>
      </div>
      <Progress value={percent} />
    </section>
  );
}
