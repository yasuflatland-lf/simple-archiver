import { AddSourceButtons } from "@/components/AddSourceButtons";
import { EmptyQueue } from "@/components/EmptyQueue";
import { LastBatchChip } from "@/components/LastBatchChip";
import { Ledger } from "@/components/Ledger";
import { OverallProgress } from "@/components/OverallProgress";
import { TaskList } from "@/components/TaskList";
import { canvasPhase } from "@/lib/canvas-phase";
import { useJobStore } from "@/store/jobStore";

/**
 * The right canvas: the single vertical scroller and the work area that morphs
 * through the job lifecycle. It routes to the existing components by the derived
 * canvas phase (see {@link canvasPhase}):
 *   empty   → the drop zone (EmptyQueue: drag-and-drop hero + browse buttons),
 *   queued  → the waiting TaskList,
 *   running → OverallProgress pinned to the top of the canvas + the TaskList
 *             (each row keeps its own live progress),
 *   results → the Inline Ledger (per-row Reveal/Copy + status tally header).
 *
 * After a finished run is cleared, the canvas returns to the drop zone with the
 * residual {@link LastBatchChip} pinned above it (whenever a last batch exists).
 *
 * The canvas is the only region that scrolls vertically (the left rail is
 * shrink-0 and scrolls only internally on short viewports). It is a labelled
 * landmark region so assistive tech can jump to the work area.
 */
export function RightCanvas() {
  const itemCount = useJobStore((s) => s.draft.items.length);
  const running = useJobStore((s) => s.running);
  const hasSummary = useJobStore((s) => s.summary !== null);
  const cleared = useJobStore((s) => s.cleared);

  const phase = canvasPhase({ itemCount, running, hasSummary, cleared });

  return (
    <main
      aria-label="Work area"
      className="min-w-0 flex-1 overflow-y-auto px-6 py-4"
    >
      {/* The residual chip pins above whichever phase renders below it. */}
      <LastBatchChip />
      {phase === "empty" ? <EmptyQueue /> : null}
      {phase === "queued" ? (
        <div className="flex flex-col gap-4">
          {/* Browse fallback for adding more sources once the queue is no longer
              empty (drag-and-drop still works via the app-level DropOverlay). The
              empty-state drop zone owns this affordance while the queue is empty. */}
          <div className="flex justify-end">
            <AddSourceButtons />
          </div>
          <TaskList />
        </div>
      ) : null}
      {phase === "running" ? (
        <div className="flex flex-col gap-4">
          {/* Pinned to the top of the canvas so the aggregate bar stays visible
              while the task list scrolls beneath it. */}
          <div className="sticky top-0 z-10 -mx-6 border-b border-border bg-background px-6 pb-3">
            <OverallProgress />
          </div>
          <TaskList />
        </div>
      ) : null}
      {phase === "results" ? <Ledger /> : null}
    </main>
  );
}
