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
 * template-error display live in OutputSettings, which derives the full landing
 * path from the store template + output directory.
 *
 * Renders as a fragment of two grid cells so it flattens into the shared OUTPUT
 * editing grid owned by OutputSettings: a tier-2 "Name" label cell followed by
 * the template input. The input spans the control + action columns (no Choose
 * button on this row), keeping its label/input association intact for a11y.
 */
export function NamingRuleForm() {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

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

  return (
    <>
      <Label
        htmlFor="naming-template"
        className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground"
      >
        Name
      </Label>
      <Input
        id="naming-template"
        className="col-span-2"
        value={template}
        onChange={(event) => setTemplate(event.target.value)}
      />
    </>
  );
}
