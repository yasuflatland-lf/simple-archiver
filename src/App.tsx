import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import "./App.css";
import { ModeToggle } from "@/components/mode-toggle";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { Button } from "@/components/ui/button";

function App() {
  const [src, setSrc] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function selectFolder() {
    try {
      const picked = await open({ directory: true });
      // null/undefined means the user cancelled — intentionally silent
      if (typeof picked === "string") {
        setSrc(picked);
      }
    } catch (error) {
      setStatus(`Failed to open folder picker: ${error}`);
    }
  }

  async function chooseOutput() {
    try {
      const target = await save({
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      // null/undefined means the user cancelled — intentionally silent
      if (typeof target === "string") {
        setOut(target);
      }
    } catch (error) {
      setStatus(`Failed to choose output: ${error}`);
    }
  }

  async function compress() {
    if (!src || !out) {
      return;
    }
    setStatus("Compressing...");
    try {
      await invoke("compress_folder", { src, out });
      setStatus("Done");
    } catch (error) {
      setStatus(`Failed: ${error}`);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center justify-between">
          <h1 className="text-[28px] leading-8 font-bold tracking-[-0.56px] text-[var(--heading)]">
            simple-archiver
          </h1>
          <ModeToggle />
        </header>

        <p className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
          Batch archive · RAR → ZIP
        </p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={selectFolder}>Select folder</Button>
          <Button variant="secondary" onClick={chooseOutput}>
            Choose output
          </Button>
          <Button variant="brand" onClick={compress} disabled={!src || !out}>
            Compress
          </Button>
        </div>

        <div className="text-sm text-muted-foreground">
          <p>
            Source: <span className="text-foreground">{src ?? "(none)"}</span>
          </p>
          <p>
            Output: <span className="text-foreground">{out ?? "(none)"}</span>
          </p>
          <p>{status}</p>
        </div>

        <NamingRuleForm />
      </div>
    </main>
  );
}

export default App;
