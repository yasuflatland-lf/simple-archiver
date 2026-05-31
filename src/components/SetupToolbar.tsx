import { AddSourceButtons } from "@/components/AddSourceButtons";
import { OutputSettings } from "@/components/OutputSettings";
import { RunControls } from "@/components/RunControls";
import { useJobStore } from "@/store/jobStore";

/**
 * The setup zone (AppShell's `toolbar` slot): a two-row layout — the OUTPUT
 * group (Destination + Name + full-path preview + readiness) above an action
 * bar (browse buttons + Cancel/Run). `max-h` caps the zone so it never crowds
 * out the scrollable queue on short windows.
 */
export function SetupToolbar() {
  // The browse buttons live here ONLY when the queue has items: while empty,
  // the EmptyQueue drop zone owns the Add affordance, so showing them here too
  // would duplicate it. Once items exist the drop zone is gone, so the toolbar
  // becomes the persistent browse affordance alongside drag-and-drop.
  const hasItems = useJobStore((s) => s.draft.items.length > 0);

  return (
    <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
      <OutputSettings />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {hasItems ? <AddSourceButtons /> : null}
        <div className="ml-auto">
          <RunControls />
        </div>
      </div>
    </div>
  );
}
