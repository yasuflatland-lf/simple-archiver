import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import type { JobSummaryDto } from "@/bindings/JobSummaryDto";
import type { ProgressEvent } from "@/bindings/ProgressEvent";

/** Tauri event channel name emitted by the backend during an active archive job. */
export const PROGRESS_EVENT = "archive://progress";

/**
 * Add one or more file/folder paths to the current draft.
 * Returns the updated draft snapshot.
 */
export function addItems(paths: string[]): Promise<DraftSnapshot> {
  return invoke<DraftSnapshot>("add_items", { paths });
}

/**
 * Move the draft item at index `from` to index `to`.
 * Returns the updated draft snapshot.
 */
export function reorder(from: number, to: number): Promise<DraftSnapshot> {
  return invoke<DraftSnapshot>("reorder", { from, to });
}

/**
 * Set the naming-rule template used when generating output filenames.
 * Returns the updated draft snapshot.
 */
export function setNamingRule(template: string): Promise<DraftSnapshot> {
  return invoke<DraftSnapshot>("set_naming_rule", { template });
}

/**
 * Set the output directory where archives will be written.
 * Returns the updated draft snapshot.
 */
export function setOutputDir(dir: string): Promise<DraftSnapshot> {
  return invoke<DraftSnapshot>("set_output_dir", { dir });
}

/**
 * Start the archive job for the current draft.
 * Resolves with a summary once the job finishes (succeeded, cancelled, or failed tasks).
 */
export function runJob(): Promise<JobSummaryDto> {
  return invoke<JobSummaryDto>("run_job");
}

/**
 * Request cancellation of the running archive job.
 * Resolves when the cancellation signal has been delivered.
 */
export function cancelJob(): Promise<void> {
  return invoke<void>("cancel_job");
}

/**
 * Subscribe to real-time progress events emitted by the backend during a job.
 * Returns the unlisten function; call it to stop receiving events.
 */
export function subscribeProgress(
  onProgress: (event: ProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<ProgressEvent>(PROGRESS_EVENT, (e) => onProgress(e.payload));
}
