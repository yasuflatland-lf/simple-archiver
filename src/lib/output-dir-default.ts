import { downloadDir } from "@tauri-apps/api/path";

/** localStorage key for the user's last chosen output directory. */
export const OUTPUT_DIR_STORAGE_KEY = "simple-archiver-output-dir";

/**
 * Type guard: returns true only for a non-empty, non-whitespace string.
 * Defends against stale or corrupt persisted values (mirrors the `isTheme`
 * guard in theme-provider.tsx).
 */
export function isValidOutputDir(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

/**
 * Read the persisted output directory from localStorage.
 * Returns the stored value only when it passes `isValidOutputDir`; otherwise
 * returns null.  Never throws.
 */
export function loadPersistedOutputDir(): string | null {
  const stored = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY);
  return isValidOutputDir(stored) ? stored : null;
}

/**
 * Write the given directory path to localStorage under the storage key.
 */
export function persistOutputDir(dir: string): void {
  localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, dir);
}

/**
 * Ask Tauri for the OS Downloads folder and return it if valid.
 * On any failure, resolves to null — progress is a non-fatal enhancement and
 * the empty-state UI handles a null directory gracefully.
 */
export async function resolveDefaultOutputDir(): Promise<string | null> {
  try {
    const dir = await downloadDir();
    return isValidOutputDir(dir) ? dir : null;
  } catch (reason) {
    // Non-fatal: the UI can still show an empty output-dir state.  Log so a
    // misconfigured Tauri environment is debuggable.
    console.error("resolveDefaultOutputDir: downloadDir failed", reason);
    return null;
  }
}

/**
 * Resolve the initial output directory for the app on mount.
 * Uses the persisted user choice when available; falls back to the OS
 * Downloads folder via Tauri, then to null.
 */
export async function resolveInitialOutputDir(): Promise<string | null> {
  const persisted = loadPersistedOutputDir();
  if (persisted !== null) {
    return persisted;
  }
  return resolveDefaultOutputDir();
}
