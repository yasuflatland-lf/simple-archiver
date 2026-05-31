import { AddSourceButtons } from "@/components/AddSourceButtons";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { RunControls } from "@/components/RunControls";
import { useJobStore } from "@/store/jobStore";

/**
 * The setup zone (AppShell's `toolbar` slot): a two-row layout — a settings
 * grid (naming template + output directory) above an action bar (browse
 * buttons + Cancel/Run). The grid aligns label/control rows instead of
 * bottom-floating mismatched-height controls, and collapses to a single column
 * on narrow windows. `max-h` caps the zone so it never crowds out the
 * scrollable queue on short windows.
 */
export function SetupToolbar() {
  // The browse buttons live here ONLY when the queue has items: while empty,
  // the EmptyQueue drop zone owns the Add affordance, so showing them here too
  // would duplicate it. Once items exist the drop zone is gone, so the toolbar
  // becomes the persistent browse affordance alongside drag-and-drop.
  const hasItems = useJobStore((s) => s.draft.items.length > 0);

  return (
    <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto">
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-2 md:grid-cols-2">
        <NamingRuleForm />
        <OutputDirPicker />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {hasItems ? <AddSourceButtons /> : null}
        <div className="ml-auto">
          <RunControls />
        </div>
      </div>
    </div>
  );
}
