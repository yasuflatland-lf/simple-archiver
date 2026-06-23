import { ConflictPolicySelect } from "@/components/ConflictPolicySelect";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputModeToggle } from "@/components/OutputModeToggle";
import { ResultPreview } from "@/components/ResultPreview";
import { RunControls } from "@/components/RunControls";
import { StartNumberForm } from "@/components/StartNumberForm";
import { DEFAULT_RAIL_WIDTH } from "@/lib/rail-width";
import { useJobStore } from "@/store/jobStore";

/**
 * The left rail: the fixed column of OUTPUT settings and the run action. It is a
 * result-led layout — the mode pill picks the output shape, the ResultPreview
 * card is the visual anchor ("where + what will I get"), and the mode-specific
 * controls (zip: naming + start number; folder: collision policy) feed it.
 * RunControls is pinned to the foot via mt-auto.
 *
 * The rail fills its resizable pane (width owned by AppShell). On a viewport too
 * short to fit, it scrolls internally; its content wrapper never collapses below
 * {@link DEFAULT_RAIL_WIDTH}, so a narrower pane scrolls horizontally rather than
 * clipping. It is a labelled complementary landmark (an <aside>).
 */
export function LeftRail() {
  const outputMode = useJobStore((s) => s.draft.outputMode);

  return (
    <aside
      aria-label="Output settings"
      className="flex min-h-0 w-full overflow-auto bg-muted/40"
    >
      <div
        data-testid="rail-content"
        className="flex min-h-full w-full flex-col gap-4 px-5 py-4"
        style={{ minWidth: `${DEFAULT_RAIL_WIDTH}px` }}
      >
        {/* Primary "what do you want to do?" choice. */}
        <OutputModeToggle />

        {/* Result-led hero: destination + landing preview in one card. */}
        <ResultPreview />

        {/* Mode-specific controls feed the preview above. */}
        {outputMode === "folder" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              If a folder exists
            </span>
            <ConflictPolicySelect />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
              Naming
            </span>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <NamingRuleForm hideLabel />
              </div>
              <div className="w-20">
                <StartNumberForm hideLabel />
              </div>
            </div>
          </div>
        )}

        {/* The run action is pinned to the foot of the rail. */}
        <div className="mt-auto border-t border-border pt-4">
          <RunControls />
        </div>
      </div>
    </aside>
  );
}
