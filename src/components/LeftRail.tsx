import { ArrowRight } from "lucide-react";

import { ConflictPolicySelect } from "@/components/ConflictPolicySelect";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { OutputModeToggle } from "@/components/OutputModeToggle";
import { RunControls } from "@/components/RunControls";
import { StartNumberForm } from "@/components/StartNumberForm";
import { joinOutputPath } from "@/lib/path";
import { selectFirstPreview, useJobStore } from "@/store/jobStore";

/**
 * The left rail: the fixed, never-moving column of OUTPUT settings and the run
 * action. It composes the existing OUTPUT sub-controls in a vertical stack —
 * the collapsed Destination summary, a compact full-path preview, the mode
 * toggle, the zip-mode naming/start fields (or the folder-mode collision
 * policy), and RunControls (readiness chip + Run / Cancel).
 *
 * This is a relayout of the controls that previously lived in OutputSettings +
 * SetupToolbar: the controls and their store wiring are unchanged; only their
 * container and placement move. The compact hero reads the store's single
 * source of preview truth (firstPreview, via selectFirstPreview) joined with the
 * output directory — it runs no preview pipeline of its own.
 *
 * The rail is shrink-0 so it never collapses; on a viewport too short to fit its
 * natural height it scrolls internally (the right canvas is the primary
 * scroller). It is a labelled complementary landmark (an <aside>) so assistive
 * tech can jump straight to the output settings.
 */
export function LeftRail() {
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const outputMode = useJobStore((s) => s.draft.outputMode);

  // The single source of preview truth. firstPreview is tri-state:
  //   null  = still loading (a recompute is pending / in flight),
  //   ""    = preview could not be resolved (error path); the hero path is
  //           suppressed the same way as for null,
  //   <str> = resolved filename ready for display.
  const previewName = useJobStore(selectFirstPreview);
  // The preview error from the store; coalesced to "" so the alert is hidden
  // unless a preview resolution actually failed.
  const error = useJobStore((s) => s.previewError) ?? "";

  // Zip mode joins the destination with the previewed filename; Folder mode
  // shows a representative per-archive folder path. heroPath stays null until a
  // preview resolves (zip) so the directory is never shown in isolation.
  const heroPath =
    outputMode === "folder"
      ? outputDir
        ? `${joinOutputPath(outputDir, "")}▸ <archive name>/`
        : null
      : previewName
        ? joinOutputPath(outputDir, previewName)
        : null;

  return (
    <aside
      aria-label="Output settings"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
          OUTPUT
        </span>
        <OutputModeToggle />
      </div>

      {/* Collapsed Destination: path or "(not set)" + Required, with Change. */}
      <OutputDirPicker />

      {/* Compact hero: the full landing path, shown only once the preview
          filename has resolved so the destination is never shown in isolation.
          The leading arrow only appears once a destination joins the filename. */}
      <div className="flex flex-col gap-1">
        {heroPath !== null ? (
          <p className="flex items-center gap-2 truncate text-sm">
            {outputDir !== null ? (
              <ArrowRight
                aria-hidden="true"
                data-testid="hero-path-arrow"
                className="size-4 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span
              className="truncate font-mono text-foreground"
              title={heroPath}
            >
              {heroPath}
            </span>
          </p>
        ) : null}
        {outputDir === null ? (
          <p className="text-xs text-muted-foreground">
            Select a destination to preview the full path.
          </p>
        ) : null}
        {outputMode === "zip" && error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {/* Mode-specific editing controls: naming + start number in zip mode, the
          collision policy (and an extraction note) in folder mode. */}
      {outputMode === "zip" ? (
        <div className="flex flex-col gap-3">
          <NamingRuleForm />
          <StartNumberForm />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Each archive is extracted into its own folder named after the
            archive.
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              If exists
            </span>
            <ConflictPolicySelect />
          </div>
        </div>
      )}

      {/* The run action lives at the foot of the rail, pushed to the bottom so it
          stays anchored below the settings. */}
      <div className="mt-auto border-t border-border pt-4">
        <RunControls />
      </div>
    </aside>
  );
}
