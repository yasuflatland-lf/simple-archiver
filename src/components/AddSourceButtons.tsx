import { FilePlus, FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pickFiles, pickFolders } from "@/lib/dialog";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

// Shared logic for both browse buttons: open the picker, then add the selected
// paths. The picker wrappers reject only on a real dialog/IPC failure;
// cancellation resolves to an empty array (handled by the length guard). The
// native browse dialog is mode-exclusive (files XOR folders), which is why
// there are two buttons — drag-and-drop is the single affordance that accepts
// both kinds.
async function browseAndAdd(pick: () => Promise<string[]>) {
  try {
    const paths = await pick();
    if (paths.length > 0) {
      useJobStore.getState().addItems(paths);
    }
  } catch (reason) {
    useJobStore.setState({ error: messageFromReason(reason) });
  }
}

function handleAddFiles() {
  return browseAndAdd(pickFiles);
}

function handleAddFolder() {
  return browseAndAdd(pickFolders);
}

interface AddSourceButtonsProps {
  /** Button size; defaults to "sm" for the toolbar. */
  size?: "sm" | "default";
}

/**
 * The two browse fallbacks for adding sources: a rar/zip-filtered file picker and a
 * folder picker. Rendered by EmptyQueue (always) and by the SetupToolbar action bar (only when the queue has items).
 */
export function AddSourceButtons({ size = "sm" }: AddSourceButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size={size} onClick={handleAddFiles}>
        <FilePlus aria-hidden="true" />
        Add files
      </Button>
      <Button variant="outline" size={size} onClick={handleAddFolder}>
        <FolderPlus aria-hidden="true" />
        Add folder
      </Button>
    </div>
  );
}
