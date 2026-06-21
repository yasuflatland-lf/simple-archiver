import { openPath as openWith } from "@tauri-apps/plugin-opener";

// Thin wrapper around the Tauri opener plugin, mirroring how lib/dialog.ts
// centralizes the dialog plugin. Keeping every opener call here gives the app a
// single, typed surface (and a single mock point in tests). Per-row reveal/copy
// land in a later PR; this PR exposes only openPath.

/**
 * Open a folder/file with the OS default handler (opens Finder for a directory).
 *
 * Rejects on a real opener/IPC failure; the caller is responsible for surfacing
 * the error rather than swallowing it.
 */
export async function openPath(path: string): Promise<void> {
  await openWith(path);
}
