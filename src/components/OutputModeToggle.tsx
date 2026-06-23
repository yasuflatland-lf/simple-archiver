import { Folder, Package, type LucideIcon } from "lucide-react";

import type { OutputMode } from "@/bindings/OutputMode";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

const OPTIONS: { value: OutputMode; label: string; Icon: LucideIcon }[] = [
  { value: "zip", label: "Re-archive", Icon: Package },
  { value: "folder", label: "Unarchive", Icon: Folder },
];

/**
 * The "Output as" mode selector at the top of the OUTPUT rail, rendered as a
 * sliding pill: a rounded track whose navy thumb slides under the selected
 * segment. The thumb is decorative (CSS-only motion, honoring
 * prefers-reduced-motion); the two role="radio" buttons in a role="radiogroup"
 * carry selection state for assistive tech.
 */
export function OutputModeToggle() {
  const mode = useJobStore((s) => s.draft.outputMode);

  function choose(next: OutputMode) {
    if (next === mode) return;
    void useJobStore.getState().setOutputMode(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Output as"
      className="relative flex w-full rounded-full border border-border bg-muted p-1"
    >
      {/* Sliding thumb: navy fill positioned under the selected segment. It
          transitions left/right on change; motion-reduce disables the slide. */}
      <span
        aria-hidden="true"
        data-testid="mode-thumb"
        className={cn(
          "absolute inset-y-1 rounded-full bg-primary shadow-sm transition-[left,right] duration-200 ease-out motion-reduce:transition-none",
          mode === "zip"
            ? "left-1 right-1/2 mr-0.5" // half-unit gutter at the pill's midline (gap between the two thumb positions)
            : "left-1/2 right-1 ml-0.5", // half-unit gutter at the pill's midline (gap between the two thumb positions)
        )}
      />
      {OPTIONS.map((opt) => {
        const selected = opt.value === mode;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.value}
            type="button"
            // A segmented toggle of buttons in a radiogroup is the intended
            // pattern (a native radio input cannot host the segmented visual).
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="radio"
            aria-checked={selected}
            onClick={() => choose(opt.value)}
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
              selected
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
