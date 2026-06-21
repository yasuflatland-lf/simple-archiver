/**
 * The naming template the UI seeds with and falls back to before a template has
 * been pushed into the store. Kept in lib (presentation-agnostic) so both the
 * store and the NamingRuleForm can share one source of truth for the starting
 * template without a presentation -> store import cycle.
 */
export const DEFAULT_TEMPLATE = "photo_{n:03}";

/**
 * The default sequence start number. 1 preserves the historical numbering, so
 * existing templates render 1, 2, 3, ... unless the user changes the start.
 * Must match the backend `JobDraft` default.
 */
export const DEFAULT_START = 1;

/** The largest valid start number — the backend numbers with a `u32`. */
export const MAX_START = 4_294_967_295; // u32::MAX

/**
 * Parse a start-number input string into a valid start value, or `null` when the
 * input is not a usable integer (empty / non-numeric / fractional). Negative
 * values clamp to 0; values above `MAX_START` clamp to the maximum. Callers treat
 * `null` as "leave the stored value unchanged" so partial edits never push an
 * invalid start to the backend.
 */
export function sanitizeStartNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return null;
  if (value < 0) return 0;
  if (value > MAX_START) return MAX_START;
  return value;
}
