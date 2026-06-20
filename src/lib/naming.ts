/**
 * The naming template the UI seeds with and falls back to before a template has
 * been pushed into the store. Kept in lib (presentation-agnostic) so both the
 * store and the NamingRuleForm can share one source of truth for the starting
 * template without a presentation -> store import cycle.
 */
export const DEFAULT_TEMPLATE = "photo_{n:03}";
