import { ArrowRight, Check, CircleDot } from "lucide-react";
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

// What the user still needs to do before a run is possible, surfaced as a single
// readiness chip. "ready" is the only state where Run would be enabled.
type Readiness = "add-files" | "choose-destination" | "ready";

function readinessFor(itemCount: number, outputDir: string | null): Readiness {
  if (itemCount === 0) return "add-files";
  if (!outputDir) return "choose-destination";
  return "ready";
}

// The readiness chip: the visual mirror of Run's disabled reason. Each pending
// state nudges the user toward the next required action; "ready" confirms a run
// is possible. (RunControls owns the disabled-Run accessibility semantics.)
function ReadinessChip({ readiness }: { readiness: Readiness }) {
  if (readiness === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-status-success-foreground">
        <Check aria-hidden="true" className="size-3.5" />
        Ready
      </span>
    );
  }

  const label =
    readiness === "add-files" ? "Add files" : "Choose a destination";
  return (
    <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted-foreground">
      <CircleDot aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

/**
 * OutputSettings is the OUTPUT group organism. It binds the Destination
 * (OutputDirPicker) and Name (NamingRuleForm) controls under one heading and
 * makes the full landing-path preview the focal point.
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
  const itemCount = useJobStore((s) => s.draft.items.length);

  // null = still loading (debounce pending or first async call in flight).
  // "" = resolved to empty due to an error.
  // non-empty string = resolved filename ready for display.
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

  // The full landing path is only computed once the preview filename has
  // resolved. While previewName is null (debounce window or first call in
  // flight) we render nothing, avoiding a momentary directory-only display
  // that could mislead users about the output location.
  const fullPath =
    previewName !== null ? joinOutputPath(outputDir, previewName) : null;
  const readiness = readinessFor(itemCount, outputDir);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-4">
      <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
        OUTPUT
      </span>

      {/* Destination and Name stack on narrow windows (Destination → Name) and
          sit side by side from the md breakpoint up. */}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-3 md:grid-cols-2">
        <OutputDirPicker />
        <NamingRuleForm />
      </div>

      {/* The full-path preview is the focal point of the group. It is only
          shown once the preview filename has resolved, so the user never sees
          the destination directory in isolation (which would be misleading). */}
      <div className="flex flex-col gap-1">
        {fullPath !== null ? (
          <p className="flex items-center gap-2 text-sm">
            <ArrowRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="font-mono text-foreground">{fullPath}</span>
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

      <div className="flex flex-wrap items-center gap-2">
        <ReadinessChip readiness={readiness} />
      </div>
    </section>
  );
}
