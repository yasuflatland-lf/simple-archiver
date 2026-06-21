import { Button } from "@/components/ui/button";
import { pickDirectory } from "@/lib/dialog";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

/**
 * The collapsed Destination summary in the left rail: a "Destination" label, the
 * current path (or a "(not set)" empty state with a "Required" badge when none
 * is chosen), and a "Change…" button that opens the native OS directory picker.
 *
 * Calls setOutputDir in the job store when a directory is chosen. Self-contained
 * (a vertical summary block), unlike its previous incarnation as three cells of
 * a shared OUTPUT grid.
 */
export function OutputDirPicker() {
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const setOutputDir = useJobStore((s) => s.setOutputDir);

  async function handleChoose() {
    try {
      const picked = await pickDirectory();
      if (typeof picked === "string") {
        await setOutputDir(picked);
      }
      // null means the user cancelled — do nothing.
    } catch (reason) {
      // pickDirectory rejects only on a real dialog/IPC failure; cancellation resolves to null.
      useJobStore.setState({ error: messageFromReason(reason) });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground">
          Destination
        </span>
        <Button variant="outline" size="sm" onClick={handleChoose}>
          Change…
        </Button>
      </div>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {outputDir !== null ? (
          <span className="truncate font-mono" title={outputDir}>
            {outputDir}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">(not set)</span>
            <span className="rounded-full bg-status-danger-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-danger-foreground">
              Required
            </span>
          </>
        )}
      </span>
    </div>
  );
}
