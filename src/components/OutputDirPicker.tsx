import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
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
    } catch {
      // Ignore dialog errors gracefully; the store already surfaces backend errors.
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
        Output directory
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
    </section>
  );
}
