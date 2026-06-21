/** localStorage key for the user's chosen left-rail width, in pixels. */
export const RAIL_WIDTH_STORAGE_KEY = "simple-archiver-rail-width";

/** Default left-rail width in px (the previous fixed `w-80` = 20rem = 320px). */
export const DEFAULT_RAIL_WIDTH = 320;

/** Minimum left-rail width in px — keeps the setup controls from collapsing. */
export const MIN_RAIL_WIDTH = 240;

/** Maximum left-rail width in px — keeps the right canvas usable. */
export const MAX_RAIL_WIDTH = 560;

/**
 * Clamp an arbitrary width to the [MIN, MAX] range and round it to a whole
 * pixel. A non-finite input (NaN) falls back to the default; ±Infinity clamps
 * to the corresponding bound via Math.min/Math.max.
 */
export function clampRailWidth(width: number): number {
  if (Number.isNaN(width)) return DEFAULT_RAIL_WIDTH;
  return Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, Math.round(width)));
}

/**
 * Read the persisted rail width from localStorage. Returns the clamped stored
 * value, or the default when nothing valid is stored. Never throws — DOM
 * storage may be disabled (private mode, restricted WebView), in which case the
 * default applies. Mirrors the validate-before-use pattern used elsewhere
 * (e.g. {@link ../lib/output-dir-default}).
 */
export function loadPersistedRailWidth(): number {
  try {
    const stored = localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
    if (stored === null) return DEFAULT_RAIL_WIDTH;
    const parsed = Number.parseInt(stored, 10);
    return Number.isNaN(parsed) ? DEFAULT_RAIL_WIDTH : clampRailWidth(parsed);
  } catch (reason) {
    console.error(
      "loadPersistedRailWidth: reading localStorage failed",
      reason,
    );
    return DEFAULT_RAIL_WIDTH;
  }
}

/**
 * Persist the rail width to localStorage, clamped to the valid range so a
 * corrupt out-of-range value can never be stored. Never throws (storage may be
 * disabled).
 */
export function persistRailWidth(width: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(clampRailWidth(width)));
  } catch (reason) {
    console.error("persistRailWidth: writing localStorage failed", reason);
  }
}
