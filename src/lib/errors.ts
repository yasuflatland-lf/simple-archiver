/**
 * Normalize an unknown rejection/throw into a human-readable English message.
 * Tauri command errors arrive as strings; transport/serialization failures may
 * reject with an Error or some other value, so we avoid rendering
 * "[object Object]". Callers may pass a context-specific fallback.
 */
export function messageFromReason(
  reason: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  return fallback;
}
