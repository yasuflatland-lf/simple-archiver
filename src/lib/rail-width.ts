/** localStorage key for the user's chosen left-rail width, in pixels. */
export const RAIL_WIDTH_STORAGE_KEY = "simple-archiver-rail-width";

/** Default left-rail width in px (the previous fixed `w-80` = 20rem = 320px). */
export const DEFAULT_RAIL_WIDTH = 320;

/** Minimum left-rail width in px — keeps the setup controls from collapsing. */
export const MIN_RAIL_WIDTH = 240;

/**
 * Minimum width in px reserved for the right canvas. The rail can widen freely
 * to the right until the canvas would shrink below this, so the queue stays
 * usable on any window width instead of being capped at a fixed rail width.
 */
export const MIN_CANVAS_WIDTH = 360;

/**
 * The largest left-rail width that still leaves {@link MIN_CANVAS_WIDTH} for the
 * right canvas, given the live container (body) and separator widths in px.
 *
 * Returns +Infinity when the container is unmeasured (width <= 0) — e.g. an
 * unlaid-out shell, or jsdom before layout — so the rail is never clamped to a
 * degenerate value before the real geometry is known.
 */
export function railWidthMaxFor(
  containerWidth: number,
  separatorWidth: number,
): number {
  if (!(containerWidth > 0)) return Number.POSITIVE_INFINITY;
  return containerWidth - separatorWidth - MIN_CANVAS_WIDTH;
}

/**
 * Clamp an arbitrary width to [MIN_RAIL_WIDTH, maxWidth] and round it to a whole
 * pixel. `maxWidth` defaults to +Infinity (no ceiling) so a width set on a roomy
 * window survives a persistence round-trip; callers that know the live geometry
 * pass a {@link railWidthMaxFor} value to keep the canvas usable. The ceiling
 * can never fall below the floor, so even a very narrow container yields a width
 * >= MIN_RAIL_WIDTH. A non-finite width (NaN/±Infinity) falls back to the
 * default.
 */
export function clampRailWidth(
  width: number,
  maxWidth: number = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isFinite(width)) return DEFAULT_RAIL_WIDTH;
  const ceiling = Math.max(MIN_RAIL_WIDTH, maxWidth);
  return Math.min(ceiling, Math.max(MIN_RAIL_WIDTH, Math.round(width)));
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
 * Persist the rail width to localStorage, clamped to at least MIN_RAIL_WIDTH so
 * a corrupt below-minimum value can never be stored. No upper bound is applied
 * here (it depends on the live window size); an over-wide stored value is
 * corrected against the canvas-min bound once the shell lays out. Never throws
 * (storage may be disabled).
 */
export function persistRailWidth(width: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(clampRailWidth(width)));
  } catch (reason) {
    console.error("persistRailWidth: writing localStorage failed", reason);
  }
}
