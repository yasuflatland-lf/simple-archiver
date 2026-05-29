import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// Live preview always uses the first (1-based) sequence number.
const PREVIEW_SEQ = 1;
const DEBOUNCE_MS = 200;

export function NamingRuleForm() {
  const [template, setTemplate] = useState("photo_{n:03}");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      invoke<string>("preview_output_name", { template, seq: PREVIEW_SEQ })
        .then((name) => {
          setPreview(name);
          setError("");
        })
        .catch((reason) => {
          setPreview("");
          setError(String(reason));
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [template]);

  return (
    <section>
      <label htmlFor="naming-template">Naming template</label>
      <input
        id="naming-template"
        value={template}
        onChange={(event) => setTemplate(event.target.value)}
      />
      <p>Preview: {preview}</p>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
