import type { OutputMode } from "@/bindings/OutputMode";

/**
 * The past-tense verb describing what a finished job did to its items, keyed by
 * output mode. Folder mode extracts archives into folders ("extracted"); zip
 * mode re-normalizes them into zip archives ("archived"). Used by the StatusBar
 * so the in-progress/post-run copy reflects the chosen output mode.
 */
export function verbForMode(mode: OutputMode): string {
  return mode === "folder" ? "extracted" : "archived";
}
