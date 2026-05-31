import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useJobStore } from "@/store/jobStore";

// The naming template the form seeds with. Exported so OutputSettings can use
// the same default when the store has not yet been given a template, keeping a
// single source of truth for the starting template.
export const DEFAULT_TEMPLATE = "photo_{n:03}";

// Wait this long after the last keystroke before pushing the template into the
// store, so we make one store/IPC round-trip per typing pause rather than one
// per character.
export const DEBOUNCE_MS = 200;

/**
 * The "Name" control inside the OUTPUT group: a debounced template input that
 * pushes the template into the store via setNamingRule. The live preview and
 * template-error display live in OutputSettings, which derives the full landing
 * path from the store template + output directory.
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
