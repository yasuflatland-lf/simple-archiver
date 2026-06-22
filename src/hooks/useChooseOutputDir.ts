import { useCallback } from "react";

import { pickDirectory } from "@/lib/dialog";
import { messageFromReason } from "@/lib/errors";
import { useJobStore } from "@/store/jobStore";

/**
 * Shared "pick an output directory" action: opens the native directory picker
 * and pushes the chosen path into the store (cancel is a no-op; a real dialog
 * failure surfaces via the store error). Used by ResultPreview's Change /
 * Choose-folder controls.
 */
export function useChooseOutputDir(): () => Promise<void> {
  const setOutputDir = useJobStore((s) => s.setOutputDir);

  return useCallback(async () => {
    try {
      const picked = await pickDirectory();
      if (typeof picked === "string") {
        await setOutputDir(picked);
      }
      // null means the user cancelled — do nothing.
    } catch (reason) {
      // pickDirectory rejects only on a real dialog/IPC failure.
      useJobStore.setState({ error: messageFromReason(reason) });
    }
  }, [setOutputDir]);
}
