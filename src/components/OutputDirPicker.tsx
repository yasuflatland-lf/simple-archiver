import { open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

/**
 * Lets the user pick an output directory via the native OS dialog.
 * Displays the current selection (or a muted placeholder when none is set).
 * Calls setOutputDir in the job store when a directory is chosen.
 */
export function OutputDirPicker() {
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const setOutputDir = useJobStore((s) => s.setOutputDir);

  async function handleChoose() {
    try {
      // directory: true requests a folder picker, not a file picker.
      const picked = await open({ directory: true });
      if (typeof picked === "string") {
        await setOutputDir(picked);
      }
      // null means the user cancelled — do nothing.
    } catch (reason) {
      // open() rejects only on a real dialog/IPC failure; cancellation resolves to null.
      useJobStore.setState({ error: messageFromReason(reason) });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
        Destination
      </span>
      <div className="flex items-center gap-3">
        <span className="flex-1 truncate text-sm">
          {outputDir !== null ? (
            outputDir
          ) : (
            <span className="text-muted-foreground">(none)</span>
          )}
        </span>
        <Button variant="outline" size="sm" onClick={handleChoose}>
          Choose…
        </Button>
      </div>
    </div>
  );
}
