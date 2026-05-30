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
      .catch(() => {
        // Subscription failure is non-fatal for the UI shell.
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
