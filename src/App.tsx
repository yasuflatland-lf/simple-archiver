import { useEffect } from "react";

import "./App.css";
import { AppShell } from "@/components/AppShell";
import { DropOverlay } from "@/components/DropOverlay";
import { EmptyQueue } from "@/components/EmptyQueue";
import { SetupToolbar } from "@/components/SetupToolbar";
import { StatusBar } from "@/components/StatusBar";
import { TaskList } from "@/components/TaskList";
import { useFileDrop } from "@/hooks/useFileDrop";
import { subscribeProgress } from "@/lib/archive";
import { resolveInitialOutputDir } from "@/lib/output-dir-default";
import { useJobStore } from "@/store/jobStore";

function App() {
  const error = useJobStore((s) => s.error);
  const hasItems = useJobStore((s) => s.draft.items.length > 0);
  // Single OS drag-drop subscription for the whole app; drives DropOverlay.
  const { isDragging } = useFileDrop();

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

  useEffect(() => {
    // Only seed a default when no destination is set yet; never override a
    // value the user (or persistence via setOutputDir) has already chosen.
    // Bail with no cleanup: no async work started, so there is nothing to guard.
    if (useJobStore.getState().draft.outputDir !== null) {
      return;
    }

    // Track liveness so a StrictMode remount / unmount mid-resolution does not
    // apply a stale value to a store that may have moved on.
    let active = true;

    resolveInitialOutputDir()
      .then((dir) => {
        // Re-check both liveness and the store after awaiting: a user choice
        // could have landed while resolveInitialOutputDir was in flight.
        if (
          active &&
          dir !== null &&
          useJobStore.getState().draft.outputDir === null
        ) {
          // setOutputDir persists the choice itself, keeping the next launch in
          // sync with what the user sees now.
          void useJobStore.getState().setOutputDir(dir);
        }
      })
      .catch((reason) => {
        // The smart default is a non-fatal enhancement; the empty-state UI still
        // works with a null directory. Log so a misconfigured env is debuggable.
        console.error("default output dir resolution failed", reason);
      });

    return () => {
      active = false;
    };
  }, []);

  // Surface the latest store error in a single top-level banner slot.
  const banner =
    error !== null ? (
      <p
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {error}
      </p>
    ) : undefined;

  return (
    <>
      <AppShell
        toolbar={<SetupToolbar />}
        banner={banner}
        statusBar={<StatusBar />}
      >
        {hasItems ? <TaskList /> : <EmptyQueue />}
      </AppShell>
      <DropOverlay visible={isDragging} />
    </>
  );
}

export default App;
