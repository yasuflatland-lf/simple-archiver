import type { OutputMode } from "@/bindings/OutputMode";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

const OPTIONS: { value: OutputMode; label: string }[] = [
  { value: "zip", label: ".zip file" },
  { value: "folder", label: "Folder" },
];

/**
 * The "Output as" segmented control at the top of the OUTPUT group. Selecting a
 * mode pushes it into the store, which drives the conditional OUTPUT fields and
 * the hero path. Two `role="radio"` buttons in a `role="radiogroup"` keep it
 * keyboard- and screen-reader-friendly.
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
      className="inline-flex overflow-hidden rounded-md border border-border"
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(opt.value)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium",
              selected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
