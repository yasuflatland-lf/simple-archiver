import { AddSourceButtons } from "@/components/AddSourceButtons";
import { OutputSettings } from "@/components/OutputSettings";
import { RunControls } from "@/components/RunControls";
import { useJobStore } from "@/store/jobStore";

/**
 * The setup zone (AppShell's `toolbar` slot): a two-row layout — the OUTPUT
 * group (Destination + Name + full-path preview + readiness) above an action
 * bar (browse buttons + Cancel/Run).
 *
 * Only the settings body scrolls. The outer column caps its height (`max-h`)
 * and reserves the action bar as a non-shrinking (`shrink-0`) row *outside* the
 * scroll region, while the settings body takes the remaining space and scrolls
 * (`min-h-0 overflow-y-auto`). This keeps Run/Cancel fully visible no matter how
 * short the window gets: a vertically squeezed viewport shrinks the settings
 * body (which scrolls), never the action bar (which would otherwise be clipped
 * off the bottom edge).
 */
export function SetupToolbar() {
  // The browse buttons live here ONLY when the queue has items: while empty,
  // the EmptyQueue drop zone owns the Add affordance, so showing them here too
  // would duplicate it. Once items exist the drop zone is gone, so the toolbar
  // becomes the persistent browse affordance alongside drag-and-drop.
  const hasItems = useJobStore((s) => s.draft.items.length > 0);

  return (
    <div className="flex max-h-[40vh] flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <OutputSettings />
      </div>
      <div
        data-testid="setup-action-bar"
        className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3"
      >
        {hasItems ? <AddSourceButtons /> : null}
        <div className="ml-auto">
          <RunControls />
        </div>
      </div>
    </div>
  );
}
