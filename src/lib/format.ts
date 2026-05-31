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
