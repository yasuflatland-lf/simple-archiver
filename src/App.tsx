import { useEffect } from "react";

import "./App.css";
import { AppHeader } from "@/components/AppHeader";
import { AppShell } from "@/components/AppShell";
import { DropOverlay } from "@/components/DropOverlay";
import { EmptyQueue } from "@/components/EmptyQueue";
import { SetupToolbar } from "@/components/SetupToolbar";
import { StatusBar } from "@/components/StatusBar";
import { TaskList } from "@/components/TaskList";
import { useFileDrop } from "@/hooks/useFileDrop";
import { subscribeProgress } from "@/lib/archive";
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
        header={<AppHeader />}
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
