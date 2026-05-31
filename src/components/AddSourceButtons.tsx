import { type OpenDialogOptions, open } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

// Shared logic for both browse buttons: open the picker, then add the selected
// paths. open() rejects only on a real dialog/IPC failure; cancellation
// resolves to null (handled by the Array.isArray guard). The native browse
// dialog is mode-exclusive (files XOR folders), which is why there are two
// buttons — drag-and-drop is the single affordance that accepts both kinds.
async function browseAndAdd(options: OpenDialogOptions) {
  try {
    const result = await open(options);
    if (Array.isArray(result) && result.length > 0) {
      useJobStore.getState().addItems(result as string[]);
    }
  } catch (reason) {
    useJobStore.setState({ error: messageFromReason(reason) });
  }
}

function handleAddFiles() {
  return browseAndAdd({
    multiple: true,
    directory: false,
    filters: [{ name: "rar", extensions: ["rar"] }],
  });
}

function handleAddFolder() {
  return browseAndAdd({ directory: true, multiple: true });
}

interface AddSourceButtonsProps {
  /** Button size; defaults to "sm" for the toolbar. */
  size?: "sm" | "default";
}

/**
 * The two browse fallbacks for adding sources: a rar-filtered file picker and a
 * folder picker. Reused by the toolbar and the empty-state CTA.
 */
export function AddSourceButtons({ size = "sm" }: AddSourceButtonsProps) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size={size} onClick={handleAddFiles}>
        Add files
      </Button>
      <Button variant="outline" size={size} onClick={handleAddFolder}>
        Add folder
      </Button>
    </div>
  );
}
