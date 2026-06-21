import type { ConflictPolicy } from "@/bindings/ConflictPolicy";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

const OPTIONS: { value: ConflictPolicy; label: string }[] = [
  { value: "autoRename", label: "Auto-rename" },
  { value: "skip", label: "Skip" },
  { value: "overwrite", label: "Overwrite" },
];

/**
 * The "If exists" segmented control shown only in Folder mode. Selecting a
 * policy pushes it into the store, which threads it to the backend placement at
 * run time. Three `role="radio"` buttons in a `role="radiogroup"` keep it
 * keyboard- and screen-reader-friendly, matching OutputModeToggle.
 */
export function ConflictPolicySelect() {
  const policy = useJobStore((s) => s.draft.conflictPolicy);

  function choose(next: ConflictPolicy) {
    if (next === policy) return;
    void useJobStore.getState().setConflictPolicy(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="If a folder already exists"
      className="inline-flex overflow-hidden rounded-md border border-border"
    >
      {OPTIONS.map((opt) => {
        const selected = opt.value === policy;
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
