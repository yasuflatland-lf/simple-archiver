import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./App.css";
import { Button } from "@/components/ui/button";
import { NamingRuleForm } from "@/components/NamingRuleForm";

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
    <main className="container">
      <h1>simple-archiver</h1>

      <div className="row">
        <Button onClick={selectFolder}>Select folder</Button>
        <Button onClick={chooseOutput}>Choose output</Button>
        <Button onClick={compress} disabled={!src || !out}>
          Compress
        </Button>
      </div>

      <p>Source: {src ?? "(none)"}</p>
      <p>Output: {out ?? "(none)"}</p>
      <p>{status}</p>
      <NamingRuleForm />
    </main>
  );
}

export default App;
