import { ArrowRight } from "lucide-react";

import { ConflictPolicySelect } from "@/components/ConflictPolicySelect";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { OutputModeToggle } from "@/components/OutputModeToggle";
import { joinOutputPath } from "@/lib/path";
import { selectFirstPreview, useJobStore } from "@/store/jobStore";

/**
 * OutputSettings is the OUTPUT group organism. It binds the Destination
 * (OutputDirPicker) and Name (NamingRuleForm) controls under one heading and
 * makes the full landing-path preview the hero of the group.
 *
 * Information hierarchy (from the agreed design iteration; see the Notion spec):
 *   1. OUTPUT heading      — tier 1: smallest, uppercase, muted.
 *   2. Hero full path      — biggest, monospace, foreground; the focal point.
 *   3. Aligned edit rows   — Destination / Name share one label column and one
 *                            control column; Choose is pinned to the far right
 *                            of the Destination row only.
 *
 * The preview is derived state: the backend remains the single source of truth
 * for the filename, and the store is the single source of truth for the preview.
 * OutputSettings only reads the store's hero preview (firstPreview) and joins it
 * with the output directory for display — it runs no debounce or previewOutputName
 * call of its own. The store's recomputePreviews owns the debounce/race guard and
 * the DEFAULT_TEMPLATE first-paint fallback, so the per-item previewNames and this
 * hero can never disagree mid-flight. The sub-controls keep their own concerns
 * (input + store push, directory picking); OutputSettings only joins them for
 * display.
 */
export function OutputSettings() {
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const outputMode = useJobStore((s) => s.draft.outputMode);

  // The single source of preview truth. firstPreview is tri-state:
  //   null  = still loading (a recompute is pending / in flight),
  //   ""    = preview could not be resolved (error path); the hero path is
  //           suppressed the same way as for null, so the directory is never
  //           shown in isolation,
  //   <str> = resolved filename ready for display.
  const previewName = useJobStore(selectFirstPreview);
  // The preview error from the store; coalesced to "" so the alert is hidden
  // unless a preview resolution actually failed.
  const error = useJobStore((s) => s.previewError) ?? "";

  // Zip mode joins the destination with the previewed filename; Folder mode
  // shows a representative per-archive folder path. heroPath stays null until a
  // preview resolves (zip) so the directory is never shown in isolation. In
  // folder mode the filename preview is irrelevant (no re-zip), so the hero
  // shows the destination with a representative per-archive folder placeholder.
  const heroPath =
    outputMode === "folder"
      ? outputDir
        ? `${joinOutputPath(outputDir, "")}▸ <archive name>/`
        : null
      : previewName
        ? joinOutputPath(outputDir, previewName)
        : null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
          OUTPUT
        </span>
        <OutputModeToggle />
      </div>

      {/* Hero: the full landing path is the focal point of the group. It is
          only shown once the preview filename has resolved, so the user never
          sees the destination directory in isolation (which would mislead). The
          leading arrow only appears once a destination joins the filename into a
          full path. heroPath is mode-aware. */}
      <div className="flex flex-col gap-1">
        {heroPath !== null ? (
          <p className="flex items-center gap-2 truncate text-base">
            {outputDir !== null ? (
              <ArrowRight
                aria-hidden="true"
                data-testid="hero-path-arrow"
                className="size-4 shrink-0 text-muted-foreground"
              />
            ) : null}
            <span className="truncate font-mono text-foreground">
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

      {/* Aligned editing rows: one shared grid so the Destination/Name labels
          align in the first column and their controls align in the second.
          OutputDirPicker contributes three cells (label, path, Choose); the
          Choose button lands in the third/right column. NamingRuleForm
          contributes two cells (label, input) with the input spanning the
          control + action columns. In folder mode the Name field is irrelevant
          (each archive is extracted into its own folder), so it is replaced by
          an extraction note spanning the full grid width. */}
      <div className="grid grid-cols-[max-content_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5">
        <OutputDirPicker />
        {outputMode === "zip" ? (
          <NamingRuleForm />
        ) : (
          <>
            <p className="col-span-3 text-xs text-muted-foreground">
              Each archive is extracted into its own folder named after the
              archive.
            </p>
            {/* Folder-mode collision policy row: the label shares the first
                column with Destination, the control sits in the value column. */}
            <span className="text-xs font-medium text-muted-foreground">
              If exists
            </span>
            <div className="col-span-2">
              <ConflictPolicySelect />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
