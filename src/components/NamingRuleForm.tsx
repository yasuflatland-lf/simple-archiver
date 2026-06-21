import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_TEMPLATE } from "@/lib/naming";
import { useJobStore } from "@/store/jobStore";

// Re-export so existing importers (and tests) keep a stable entry point while
// the constant itself lives in lib (shared with the store, no import cycle).
export { DEFAULT_TEMPLATE };

// Wait this long after the last keystroke before pushing the template into the
// store, so we make one store/IPC round-trip per typing pause rather than one
// per character.
export const DEBOUNCE_MS = 200;

/**
 * The "Name" control inside the OUTPUT group: a debounced template input that
 * pushes the template into the store via setNamingRule. The live preview and
 * template-error display live in the left rail, which derives the full landing
 * path from the store template + output directory.
 *
 * Renders as a self-contained vertical block (a tier-2 "Name" label above the
 * template input) so it stacks cleanly in the left rail, keeping its
 * label/input association intact for a11y.
 */
export function NamingRuleForm() {
  // Source the initial value from the store so a non-default draft template
  // (future session restore, or a seeded test) shows the correct value rather
  // than always starting from the compile-time default. Fall back to the
  // default when the store has no template yet (the common first-paint case).
  const storedTemplate = useJobStore((s) => s.draft.namingTemplate);
  const [template, setTemplate] = useState(storedTemplate ?? DEFAULT_TEMPLATE);

  useEffect(() => {
    const handle = setTimeout(() => {
      // Push the template into the store so per-row previews and the OUTPUT
      // group's full-path preview stay in sync with the backend draft. Use
      // getState() to avoid adding the store action to the dependency array and
      // preserve the single-dep [template] debounce.
      useJobStore.getState().setNamingRule(template);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [template]);

  // Sync the field when the store template changes from OUTSIDE this form
  // (e.g. session restore). Depend only on `storedTemplate` so this reacts to
  // external store changes, not to local keystrokes (which already drive the
  // debounce push above). The functional updater reads the current field value
  // without closing over `template`, so the dep array stays exhaustive AND the
  // equality guard breaks the debounce push-back loop: when our own debounce
  // pushes `template` into the store, the resolved value equals `current`, so
  // this is a no-op and starts no update cycle. A null/default store value is
  // skipped, leaving the initial state untouched, so behavior is unchanged when
  // nothing is stored.
  useEffect(() => {
    if (storedTemplate !== null) {
      setTemplate((current) =>
        storedTemplate === current ? current : storedTemplate,
      );
    }
  }, [storedTemplate]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor="naming-template"
        className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground"
      >
        Name
      </Label>
      <Input
        id="naming-template"
        value={template}
        onChange={(event) => setTemplate(event.target.value)}
      />
    </div>
  );
}
