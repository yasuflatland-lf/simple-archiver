import type { OutputMode } from "@/bindings/OutputMode";

/**
 * The past-tense verb describing what a finished job did to its items, keyed by
 * output mode. Folder mode extracts archives into folders ("extracted"); zip
 * mode re-normalizes them into zip archives ("archived"). Shared by the
 * StatusBar and RunSummary so the post-run copy stays consistent across both.
 */
export function verbForMode(mode: OutputMode): string {
  return mode === "folder" ? "extracted" : "archived";
}
