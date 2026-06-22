import type { OutputMode } from "@/bindings/OutputMode";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

const OPTIONS: { value: OutputMode; label: string }[] = [
  { value: "zip", label: "Rebundle to zip file(s)" },
  { value: "folder", label: "Unarchive to folders" },
];

/**
 * The "Output as" segmented control at the top of the OUTPUT group. Selecting a
 * mode pushes it into the store, which drives the conditional OUTPUT fields and
 * the hero path. Two `role="radio"` buttons in a `role="radiogroup"` keep it
 * keyboard- and screen-reader-friendly.
 *
 * This is the primary "what do you want to do?" decision, so it is deliberately
 * the loudest control in the rail: a full-width pair of equal segments, larger
 * type, and a strong brand-primary fill on the selected segment — heavier than
 * the subtler `bg-accent` segmented controls elsewhere (e.g. ConflictPolicySelect).
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
      className="flex w-full overflow-hidden rounded-md border border-border shadow-sm"
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            // A segmented toggle of buttons in a radiogroup is the intended
            // pattern here (a native radio input cannot host the segmented
            // visual treatment); keep the explicit ARIA role.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="radio"
            aria-checked={selected}
            onClick={() => choose(opt.value)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-semibold transition-colors",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
