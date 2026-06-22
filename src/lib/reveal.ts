import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath as openWith } from "@tauri-apps/plugin-opener";

// Thin wrapper around the Tauri opener + clipboard plugins, mirroring how
// lib/dialog.ts centralizes the dialog plugin. Keeping every opener/clipboard
// call here gives the app a single, typed surface (and a single mock point in
// tests). The Inline Ledger's "Open folder" + per-row Copy actions go through
// here.
//
// Each function rejects on a real plugin/IPC failure; callers are responsible
// for surfacing the error rather than swallowing it.

/**
 * Open a folder/file with the OS default handler (opens Finder for a directory).
 */
export async function openPath(path: string): Promise<void> {
  await openWith(path);
}

/**
 * Copy the given text (an absolute output path) onto the system clipboard. Used
 * by the Ledger's per-row Copy action.
 */
export async function copyText(text: string): Promise<void> {
  await writeText(text);
}
