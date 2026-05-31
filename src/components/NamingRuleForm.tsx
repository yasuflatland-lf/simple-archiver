import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

// Live preview always uses the first (1-based) sequence number.
const PREVIEW_SEQ = 1;
// Wait this long after the last keystroke before invoking the backend, so we
// make one IPC call per typing pause rather than one per character.
export const DEBOUNCE_MS = 200;

export function NamingRuleForm() {
  const [template, setTemplate] = useState("photo_{n:03}");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Guard against out-of-order async results: only the latest effect run may
    // write state. Without this, a slow invoke for an older template could
    // resolve after a newer one and leave a stale preview/error on screen.
    let active = true;
    const handle = setTimeout(() => {
      // Push the template into the store so per-row previews stay in sync with
      // the backend draft. Use getState() to avoid adding the store action to
      // the dependency array and preserving the single-dep [template] debounce.
      useJobStore.getState().setNamingRule(template);

      // This form invokes preview_output_name independently from the store's
      // setNamingRule even though setNamingRule also recomputes per-row previews.
      // The form's preview must work BEFORE any items have been added — when the
      // store's per-row preview list is empty — so it independently shows a
      // seq=1 preview to give the user live feedback while typing.
      invoke<string>("preview_output_name", { template, seq: PREVIEW_SEQ })
        .then((name) => {
          if (!active) return;
          setPreview(name);
          setError("");
        })
        .catch((reason) => {
          if (!active) return;
          setPreview("");
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
  }, [template]);

  return (
    <section className="flex flex-col gap-1.5">
      <Label
        htmlFor="naming-template"
        className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground"
      >
        Naming template
      </Label>
      <Input
        id="naming-template"
        value={template}
        onChange={(event) => setTemplate(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        Preview: <span className="text-foreground">{preview}</span>
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
