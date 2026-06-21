import { open } from "@tauri-apps/plugin-dialog";

// Thin wrapper around the Tauri dialog plugin, mirroring how lib/archive.ts
// centralizes all invoke IPC. Keeping every open() call here gives the app a
// single, typed surface for native pickers (and a single mock point in tests).
//
// open() rejects only on a real dialog/IPC failure; cancellation resolves to
// null, which these wrappers normalize per their documented return type.

/**
 * Open a multi-select file picker filtered to rar/zip archives.
 * Returns the selected paths, or an empty array when the user cancels.
 */
export async function pickFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Archives", extensions: ["rar", "zip"] }],
  });
  return result ?? [];
}

/**
 * Open a multi-select folder picker.
 * Returns the selected folder paths, or an empty array when the user cancels.
 */
export async function pickFolders(): Promise<string[]> {
  const result = await open({ directory: true, multiple: true });
  return result ?? [];
}

/**
 * Open a single-select directory picker.
 * Returns the chosen directory, or null when the user cancels.
 */
export function pickDirectory(): Promise<string | null> {
  // directory: true requests a folder picker, not a file picker.
  return open({ directory: true });
}
