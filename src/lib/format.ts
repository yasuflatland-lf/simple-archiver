/**
 * Format an ETA in milliseconds as a compact human string.
 * `null` (unknown throughput) renders as an em dash; non-positive renders "0s".
 */
export function formatEta(ms: number | null): string {
  if (ms === null) return "—";
  if (ms <= 0) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Percentage (0–100) of bytes done; 0 when total is unknown/zero, clamped to 100.
 * Pure formatting only — the backend owns all progress truth.
 */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Format a byte pair as "<done> / <total> <unit>", choosing the unit from the
 * total so both numbers share one scale (e.g. "12.4 / 19 MB"). Bytes render as
 * whole numbers; larger units keep one decimal. Pure formatting only — the
 * backend owns all progress truth.
 */
export function formatBytes(done: number, total: number): string {
  // Byte counts are non-negative by construction; clamp defensively so this
  // formatter degrades the same way its sibling progressPercent does.
  done = Math.max(0, done);
  total = Math.max(0, total);

  let unitIndex = 0;
  while (
    total >= 1024 ** (unitIndex + 1) &&
    unitIndex < BYTE_UNITS.length - 1
  ) {
    unitIndex++;
  }
  const render = (n: number) => {
    const scaled = n / 1024 ** unitIndex;
    return unitIndex === 0
      ? String(Math.round(scaled))
      : (Math.round(scaled * 10) / 10).toString();
  };
  return `${render(done)} / ${render(total)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Format a byte-progress pair as "<done> / <total> bytes" using raw integer
 * counts (no unit scaling). Matches the status string emitted by computeStatus
 * in TaskRow. Use formatBytes for a human-scaled alternative.
 * TODO: unify onto formatBytes in a follow-up.
 */
export function formatByteProgress(done: number, total: number): string {
  return `${done} / ${total} bytes`;
}
