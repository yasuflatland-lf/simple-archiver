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

/**
 * Return the last path segment of a filesystem path, handling both forward-
 * slash (POSIX) and backslash (Windows) separators.
 */
export function basename(path: string): string {
  const segments = path.split(/[/\\]/);
  // Filter empties in case of trailing slashes, then take the last segment.
  const nonEmpty = segments.filter((s) => s.length > 0);
  return nonEmpty[nonEmpty.length - 1] ?? path;
}
