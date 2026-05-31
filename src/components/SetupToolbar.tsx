import { AddSourceButtons } from "@/components/AddSourceButtons";
import { OutputSettings } from "@/components/OutputSettings";
import { RunControls } from "@/components/RunControls";
import { useJobStore } from "@/store/jobStore";

/**
 * The setup zone (AppShell's `toolbar` slot): a two-row layout — the OUTPUT
 * group (Destination + Name + full-path preview + readiness) above an action
 * bar (browse buttons + Cancel/Run).
 *
 * The zone is content-sized and has no internal scroll. Its whole content (the
 * OUTPUT group *and* the action bar) lives in one non-scrolling column, so
 * nothing here is ever clipped when the window shrinks vertically: the queue
 * region in AppShell is the only zone that scrolls to absorb vertical shrink,
 * and AppShell's last-resort scroll keeps the setup reachable on extremely
 * short viewports. This guarantees the readiness chip, the full-path preview,
 * the browse buttons and Run/Cancel all stay fully visible together.
 */
export function SetupToolbar() {
  // The browse buttons live here ONLY when the queue has items: while empty,
  // the EmptyQueue drop zone owns the Add affordance, so showing them here too
  // would duplicate it. Once items exist the drop zone is gone, so the toolbar
  // becomes the persistent browse affordance alongside drag-and-drop.
  const hasItems = useJobStore((s) => s.draft.items.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <OutputSettings />
      <div
        data-testid="setup-action-bar"
        className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
      >
        {hasItems ? <AddSourceButtons /> : null}
        <div className="ml-auto">
          <RunControls />
        </div>
      </div>
    </div>
  );
}
