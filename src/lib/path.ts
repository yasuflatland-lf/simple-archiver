/**
 * Joins a directory path and filename for display purposes.
 * Handles null/empty directory gracefully and avoids double slashes.
 *
 * @param dir - Directory path, null, or empty string
 * @param name - Filename to append
 * @returns Combined path with "/" separator, or just the filename if dir is null/empty
 */
export function joinOutputPath(dir: string | null, name: string): string {
  if (!dir) {
    return name;
  }

  const trimmedDir = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  return `${trimmedDir}/${name}`;
}
