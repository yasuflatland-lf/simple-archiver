import { useEffect } from "react";

import "./App.css";
import { FileDropZone } from "@/components/FileDropZone";
import { ModeToggle } from "@/components/mode-toggle";
import { NamingRuleForm } from "@/components/NamingRuleForm";
import { OutputDirPicker } from "@/components/OutputDirPicker";
import { RunControls } from "@/components/RunControls";
import { TaskList } from "@/components/TaskList";
import { subscribeProgress } from "@/lib/archive";
import { useJobStore } from "@/store/jobStore";

function App() {
  // Surface the latest store error in a single top-level banner.
  const error = useJobStore((s) => s.error);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // Track liveness so we can immediately release if the component unmounts
    // before the subscription promise resolves.
    let active = true;

    subscribeProgress((event) => useJobStore.getState().applyProgress(event))
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          // Already unmounted — release immediately.
          fn();
        }
      })
      .catch((reason) => {
        // Progress is a non-fatal enhancement; the job still runs and returns a
        // final summary. Log so a misconfigured event channel is debuggable.
        console.error("progress subscription failed", reason);
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

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

        {error !== null && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <FileDropZone />
        <NamingRuleForm />
        <TaskList />
        <OutputDirPicker />
        <RunControls />
      </div>
    </main>
  );
}

export default App;
