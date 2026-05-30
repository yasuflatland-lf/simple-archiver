import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useJobStore } from "@/store/jobStore";

// Live preview always uses the first (1-based) sequence number.
const PREVIEW_SEQ = 1;
// Wait this long after the last keystroke before invoking the backend, so we
// make one IPC call per typing pause rather than one per character.
export const DEBOUNCE_MS = 200;

// Normalize an invoke rejection into a human-readable message. Tauri command
// errors arrive as strings; transport/serialization failures may reject with an
// Error or other value, so avoid rendering "[object Object]".
function messageFromReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return "Could not generate a preview. Please try again.";
}

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

      invoke<string>("preview_output_name", { template, seq: PREVIEW_SEQ })
        .then((name) => {
          if (!active) return;
          setPreview(name);
          setError("");
        })
        .catch((reason) => {
          if (!active) return;
          setPreview("");
          setError(messageFromReason(reason));
        });
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [template]);

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
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
