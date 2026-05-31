import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DEBOUNCE_MS,
  DEFAULT_TEMPLATE,
  NamingRuleForm,
} from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { previewOutputName } from "@/lib/archive";
import { messageFromReason } from "@/lib/errors";
import { joinOutputPath } from "@/lib/path";
import { useJobStore } from "@/store/jobStore";

// The live preview always uses the first (1-based) sequence number, matching the
// backend's naming contract.
const PREVIEW_SEQ = 1;

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
 * for the filename. OutputSettings reads the store's naming template (falling
 * back to DEFAULT_TEMPLATE before NamingRuleForm has pushed one), debounces a
 * single previewOutputName(template, 1) call, then joins the result with the
 * output directory for display. The sub-controls keep their own concerns
 * (input + store push, directory picking); OutputSettings only joins them for
 * display.
 *
 * Note on preview state: this component holds one local previewName string
 * (the single filename resolved from the store template). This is distinct from
 * the store's per-item previewNames array consumed by TaskList/RunSummary; the
 * two never overlap.
 */
export function OutputSettings() {
  const template = useJobStore((s) => s.draft.namingTemplate);
  const outputDir = useJobStore((s) => s.draft.outputDir);

  // null  = still loading (debounce pending or first async call in flight).
  // ""    = preview could not be resolved (error path); the hero path is
  //         suppressed the same way as for null, so the directory is never
  //         shown in isolation.
  // <str> = resolved filename ready for display.
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [error, setError] = useState("");

  // The effective template: the store value once NamingRuleForm has pushed it,
  // otherwise the shared default so the preview is meaningful on first paint.
  const effectiveTemplate = template ?? DEFAULT_TEMPLATE;

  useEffect(() => {
    // Mark preview as loading so the UI shows nothing while the debounce window
    // is open and the async call is in flight. This prevents the directory path
    // alone from briefly appearing when the template has not yet resolved.
    setPreviewName(null);

    // Guard against out-of-order async results: only the latest effect run may
    // commit state, so a slow call for an older template cannot overwrite a
    // newer preview/error.
    let active = true;
    const handle = setTimeout(() => {
      previewOutputName(effectiveTemplate, PREVIEW_SEQ)
        .then((name) => {
          if (!active) return;
          setPreviewName(name);
          setError("");
        })
        .catch((reason) => {
          if (!active) return;
          setPreviewName("");
          setError(
            messageFromReason(
              reason,
              "Could not generate a preview. Please try again.",
            ),
          );
        });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [effectiveTemplate]);

  // The hero path is only shown when previewName is a non-empty string. Both
  // null (still loading) and "" (error path, set by .catch) suppress it, so the
  // output directory is never displayed in isolation, which would mislead the
  // user about the actual destination. joinOutputPath already returns the bare
  // filename when outputDir is null, so the same value drives both the full
  // path (destination set) and the filename-only hero (no destination).
  const heroPath = previewName ? joinOutputPath(outputDir, previewName) : null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
        OUTPUT
      </span>

      {/* Hero: the full landing path is the focal point of the group. It is
          only shown once the preview filename has resolved, so the user never
          sees the destination directory in isolation (which would mislead). The
          leading arrow only appears once a destination joins the filename into a
          full path. */}
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
        {error ? (
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
          control + action columns. */}
      <div className="grid grid-cols-[max-content_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5">
        <OutputDirPicker />
        <NamingRuleForm />
      </div>
    </section>
  );
}
