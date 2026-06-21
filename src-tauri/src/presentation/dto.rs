//! Wire-contract DTOs — the single authored source of the Rust<->TS contract.
//!
//! These types are the *send-only* payloads the presentation layer emits to the
//! frontend (Tauri events / command results). They are deliberately distinct
//! from the domain/application types so the wire shape can evolve independently
//! of the core model. `#[derive(TS)]` exports a matching TypeScript declaration
//! into `src/bindings/` (see the `export_to` attribute); the serde-shape tests
//! below are the Rust half of the contract and guard against silent drift.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Re-export the draft mapping helper from `dto_map` so callers resolve it via
// `crate::presentation::dto::draft_item_from_source` unchanged.
pub(crate) use super::dto_map::draft_item_from_source;

/// Tauri event channel name used to stream [`ProgressEvent`] payloads.
pub const PROGRESS_EVENT: &str = "archive://progress";

// ─────────────────────────────────────────────────────────────────────────────
// Progress DTOs
// ─────────────────────────────────────────────────────────────────────────────

/// An aggregated progress snapshot, adapted from [`JobProgress`] for the wire.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProgressEvent {
    /// Byte counters summed across all per-task entries (derived from `JobProgress::overall`).
    pub overall: ProgressCounts,
    /// Estimated time remaining for the whole job, in milliseconds; null when unknown.
    // ts-rs would emit `bigint | null` for Option<u64>; Tauri IPC delivers a JSON
    // number-or-null, so override (values < 2^53).
    #[ts(type = "number | null")]
    pub overall_eta_ms: Option<u64>,
    /// Per-task progress in the job's task order.
    pub per_task: Vec<TaskProgressDto>,
    /// Time elapsed since the job started, in milliseconds.
    // ts-rs would emit bigint for u64; Tauri IPC delivers JSON number, so override (values < 2^53).
    #[ts(type = "number")]
    pub elapsed_ms: u64,
}

/// A pair of byte counters (done / total).
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ProgressCounts {
    /// Bytes processed so far.
    // ts-rs would emit bigint for u64; Tauri IPC delivers JSON number, so override (values < 2^53).
    #[ts(type = "number")]
    pub bytes_done: u64,
    /// Total bytes to process.
    // ts-rs would emit bigint for u64; Tauri IPC delivers JSON number, so override (values < 2^53).
    #[ts(type = "number")]
    pub bytes_total: u64,
}

/// Byte progress for a single task, keyed by its raw task id.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TaskProgressDto {
    /// The raw task id.
    pub task_id: u32,
    /// Bytes processed so far.
    // ts-rs would emit bigint for u64; Tauri IPC delivers JSON number, so override (values < 2^53).
    #[ts(type = "number")]
    pub bytes_done: u64,
    /// Total bytes to process.
    // ts-rs would emit bigint for u64; Tauri IPC delivers JSON number, so override (values < 2^53).
    #[ts(type = "number")]
    pub bytes_total: u64,
    /// Estimated time remaining for this task, in milliseconds; null when unknown.
    #[ts(type = "number | null")]
    pub eta_ms: Option<u64>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary DTOs
// ─────────────────────────────────────────────────────────────────────────────

/// The outcome of a finished job, adapted from [`JobSummary`] for the wire.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct JobSummaryDto {
    /// Raw ids of tasks that completed successfully, in job order.
    pub succeeded: Vec<u32>,
    /// Raw ids of tasks that were cancelled, in job order.
    pub cancelled: Vec<u32>,
    /// Tasks that failed, paired with their reason, in job order.
    pub failed: Vec<FailedTaskDto>,
    /// Per-task results in job order, each carrying the task's absolute output
    /// path and terminal status. Additive companion to the legacy
    /// `succeeded`/`cancelled`/`failed` buckets: it is the single per-task
    /// projection the completion UI uses to surface "where did my files go".
    pub results: Vec<TaskResultDto>,
}

/// A failed task paired with its human-readable reason.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct FailedTaskDto {
    /// The raw task id.
    pub task_id: u32,
    /// Why the task failed.
    pub reason: String,
}

/// One task's terminal result, carrying its absolute output path.
///
/// This is the per-task projection the completion UI reads to surface where each
/// produced file/folder landed. The `output_path` is computed in the presentation
/// layer from the planned job (PathBuf rendered to a lossy UTF-8 string at this
/// wire boundary), mirroring the engine's destination formula.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct TaskResultDto {
    /// The raw task id.
    pub task_id: u32,
    /// The output base name, e.g. `"photo_001.zip"` (Zip mode) or the folder
    /// name (Folder mode).
    pub output_name: String,
    /// The absolute output path the task wrote to.
    pub output_path: String,
    /// The task's terminal status.
    pub status: TaskStatusDto,
    /// The failure reason; `Some` only when `status` is [`TaskStatusDto::Failed`].
    pub reason: Option<String>,
}

/// A task's terminal status on the wire.
#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum TaskStatusDto {
    /// The task completed successfully.
    Succeeded,
    /// The task was cancelled before completion.
    Cancelled,
    /// The task failed.
    Failed,
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft DTOs
// ─────────────────────────────────────────────────────────────────────────────

/// A snapshot of the current draft (pending plan) shown in the UI.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DraftSnapshot {
    /// The source items queued in the draft, in order.
    pub items: Vec<DraftItemDto>,
    /// The naming template, if one has been set.
    pub naming_template: Option<String>,
    /// The sequence start number used to render output filenames (default 1).
    pub start_number: u32,
    /// The output directory, if one has been chosen.
    pub output_dir: Option<String>,
    /// The chosen output mode (re-zip vs extract-to-folder).
    pub output_mode: OutputMode,
    /// The chosen collision policy for Folder-mode extraction.
    pub conflict_policy: ConflictPolicy,
}

/// A single draft item: its path and what kind of source it is.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DraftItemDto {
    /// The item's filesystem path (lossy UTF-8).
    pub path: String,
    /// Whether the item is a folder, a rar, or a zip.
    pub kind: SourceKind,
}

/// The kind of a draft source item.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum SourceKind {
    /// A folder to be archived.
    Folder,
    /// A rar file to be extracted and re-archived.
    Rar,
    /// A zip file to be extracted and re-archived.
    Zip,
}

/// The batch output mode chosen in the UI.
#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum OutputMode {
    /// Re-archive each source into a `.zip`.
    Zip,
    /// Extract each archive into its own folder.
    Folder,
}

/// The collision policy chosen in the UI for Folder-mode extraction.
///
/// The serde wire values are camelCase (`autoRename` / `skip` / `overwrite`) and
/// are pinned by [`tests::conflict_policy_serializes_to_camel_case_variants`].
#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub enum ConflictPolicy {
    /// Write to `name (2)`, `name (3)`, … on collision (default).
    #[default]
    AutoRename,
    /// Leave the existing folder; do not extract this item.
    Skip,
    /// Remove the existing folder, then extract.
    Overwrite,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use ts_rs::TS;

    // ── TypeScript binding export (regenerates `src/bindings/*.ts`) ────────────

    /// Write the TypeScript declaration for every DTO to `src/bindings/`.
    ///
    /// `#[ts(export, export_to = "...")]` routes each `.export()` call to that
    /// directory. Running the test suite regenerates the bindings, so the TS
    /// side of the wire contract can never silently drift from the Rust side.
    #[test]
    fn export_typescript_bindings() {
        ProgressEvent::export().expect("export ProgressEvent");
        ProgressCounts::export().expect("export ProgressCounts");
        TaskProgressDto::export().expect("export TaskProgressDto");
        JobSummaryDto::export().expect("export JobSummaryDto");
        FailedTaskDto::export().expect("export FailedTaskDto");
        TaskResultDto::export().expect("export TaskResultDto");
        TaskStatusDto::export().expect("export TaskStatusDto");
        DraftSnapshot::export().expect("export DraftSnapshot");
        DraftItemDto::export().expect("export DraftItemDto");
        SourceKind::export().expect("export SourceKind");
        OutputMode::export().expect("export OutputMode");
        ConflictPolicy::export().expect("export ConflictPolicy");
    }

    /// Guard: `u64` fields must be typed as `number` (not `bigint`) in the
    /// TypeScript declarations.  Tauri IPC serialises `u64` to a JSON number
    /// which JS decodes as `number`, so generating `bigint` would create a
    /// type-unsafety mismatch at the call site.
    ///
    /// The test uses `ts_rs::TS::inline()` / `decl()` rather than reading the
    /// generated files, so it is self-contained and runs without filesystem
    /// side-effects beyond what `export_typescript_bindings` already does.
    #[test]
    fn u64_fields_emit_number_not_bigint_in_ts_bindings() {
        // ProgressCounts: bytesDone and bytesTotal must be `number`.
        let counts_decl = ProgressCounts::decl();
        assert!(
            counts_decl.contains("bytesDone: number"),
            "ProgressCounts.bytesDone should be `number`, got: {counts_decl}"
        );
        assert!(
            counts_decl.contains("bytesTotal: number"),
            "ProgressCounts.bytesTotal should be `number`, got: {counts_decl}"
        );
        assert!(
            !counts_decl.contains("bigint"),
            "ProgressCounts must not contain `bigint`, got: {counts_decl}"
        );

        // TaskProgressDto: bytesDone and bytesTotal must be `number`; etaMs must be `number | null`.
        let task_decl = TaskProgressDto::decl();
        assert!(
            task_decl.contains("bytesDone: number"),
            "TaskProgressDto.bytesDone should be `number`, got: {task_decl}"
        );
        assert!(
            task_decl.contains("bytesTotal: number"),
            "TaskProgressDto.bytesTotal should be `number`, got: {task_decl}"
        );
        assert!(
            task_decl.contains("etaMs: number | null"),
            "TaskProgressDto.etaMs should be `number | null`, got: {task_decl}"
        );
        assert!(
            !task_decl.contains("bigint"),
            "TaskProgressDto must not contain `bigint`, got: {task_decl}"
        );

        // ProgressEvent: elapsedMs must be `number`; overallEtaMs must be `number | null`.
        let event_decl = ProgressEvent::decl();
        assert!(
            event_decl.contains("elapsedMs: number"),
            "ProgressEvent.elapsedMs should be `number`, got: {event_decl}"
        );
        assert!(
            event_decl.contains("overallEtaMs: number | null"),
            "ProgressEvent.overallEtaMs should be `number | null`, got: {event_decl}"
        );
        assert!(
            !event_decl.contains("bigint"),
            "ProgressEvent must not contain `bigint`, got: {event_decl}"
        );
    }

    // ── serde-shape contract (the Rust half of the wire contract) ─────────────

    #[test]
    fn progress_event_serializes_to_camel_case_shape() {
        let event = ProgressEvent {
            overall: ProgressCounts {
                bytes_done: 5,
                bytes_total: 15,
            },
            overall_eta_ms: Some(2000),
            per_task: vec![TaskProgressDto {
                task_id: 7,
                bytes_done: 2,
                bytes_total: 10,
                eta_ms: Some(1500),
            }],
            elapsed_ms: 50,
        };
        let v = serde_json::to_value(&event).unwrap();
        assert_eq!(v["overall"]["bytesDone"], json!(5));
        assert_eq!(v["overall"]["bytesTotal"], json!(15));
        assert_eq!(v["overallEtaMs"], json!(2000));
        assert_eq!(v["perTask"][0]["taskId"], json!(7));
        assert_eq!(v["perTask"][0]["bytesDone"], json!(2));
        assert_eq!(v["perTask"][0]["bytesTotal"], json!(10));
        assert_eq!(v["perTask"][0]["etaMs"], json!(1500));
        assert_eq!(v["elapsedMs"], json!(50));
        // Confirm snake_case keys are absent.
        assert!(v.get("per_task").is_none());
        assert!(v.get("elapsed_ms").is_none());
    }

    /// Null-shape test: `None` ETA fields must serialise to JSON `null`.
    #[test]
    fn progress_event_null_eta_fields_serialize_to_null() {
        let event = ProgressEvent {
            overall: ProgressCounts {
                bytes_done: 0,
                bytes_total: 0,
            },
            overall_eta_ms: None,
            per_task: vec![TaskProgressDto {
                task_id: 1,
                bytes_done: 0,
                bytes_total: 0,
                eta_ms: None,
            }],
            elapsed_ms: 0,
        };
        let v = serde_json::to_value(&event).unwrap();
        assert_eq!(v["overallEtaMs"], json!(null));
        assert_eq!(v["perTask"][0]["etaMs"], json!(null));
    }

    #[test]
    fn job_summary_dto_serializes_to_camel_case_shape() {
        let summary = JobSummaryDto {
            succeeded: vec![1, 3],
            cancelled: vec![4],
            failed: vec![FailedTaskDto {
                task_id: 2,
                reason: "boom".to_string(),
            }],
            results: vec![TaskResultDto {
                task_id: 1,
                output_name: "out_1.zip".to_string(),
                output_path: "/out/out_1.zip".to_string(),
                status: TaskStatusDto::Succeeded,
                reason: None,
            }],
        };
        let v = serde_json::to_value(&summary).unwrap();
        assert_eq!(v["succeeded"], json!([1, 3]));
        assert_eq!(v["cancelled"], json!([4]));
        assert_eq!(v["failed"][0]["taskId"], json!(2));
        assert_eq!(v["failed"][0]["reason"], json!("boom"));
        // `results` carries the per-task projection in camelCase.
        assert_eq!(v["results"][0]["taskId"], json!(1));
        assert_eq!(v["results"][0]["outputName"], json!("out_1.zip"));
        assert_eq!(v["results"][0]["outputPath"], json!("/out/out_1.zip"));
        assert_eq!(v["results"][0]["status"], json!("succeeded"));
        assert_eq!(v["results"][0]["reason"], json!(null));
        // Confirm snake_case keys are absent on the nested result.
        assert!(v["results"][0].get("output_name").is_none());
        assert!(v["results"][0].get("output_path").is_none());
    }

    #[test]
    fn task_status_dto_serializes_to_camel_case_variants() {
        assert_eq!(
            serde_json::to_value(TaskStatusDto::Succeeded).unwrap(),
            json!("succeeded")
        );
        assert_eq!(
            serde_json::to_value(TaskStatusDto::Cancelled).unwrap(),
            json!("cancelled")
        );
        assert_eq!(
            serde_json::to_value(TaskStatusDto::Failed).unwrap(),
            json!("failed")
        );
    }

    #[test]
    fn task_result_dto_failed_carries_reason() {
        let result = TaskResultDto {
            task_id: 2,
            output_name: "out_2.zip".to_string(),
            output_path: "/out/out_2.zip".to_string(),
            status: TaskStatusDto::Failed,
            reason: Some("boom".to_string()),
        };
        let v = serde_json::to_value(&result).unwrap();
        assert_eq!(v["status"], json!("failed"));
        assert_eq!(v["reason"], json!("boom"));
    }

    #[test]
    fn draft_snapshot_serializes_to_camel_case_shape() {
        let snapshot = DraftSnapshot {
            items: vec![
                DraftItemDto {
                    path: "/a/folder".to_string(),
                    kind: SourceKind::Folder,
                },
                DraftItemDto {
                    path: "/a/file.rar".to_string(),
                    kind: SourceKind::Rar,
                },
            ],
            naming_template: Some("f{n}".to_string()),
            start_number: 1,
            output_dir: Some("/out".to_string()),
            output_mode: OutputMode::Zip,
            conflict_policy: ConflictPolicy::AutoRename,
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["items"][0]["path"], json!("/a/folder"));
        assert_eq!(v["items"][0]["kind"], json!("folder"));
        assert_eq!(v["items"][1]["kind"], json!("rar"));
        assert_eq!(v["namingTemplate"], json!("f{n}"));
        assert_eq!(v["startNumber"], json!(1));
        assert_eq!(v["outputDir"], json!("/out"));
        assert!(v.get("naming_template").is_none());
        assert!(v.get("start_number").is_none());
        assert!(v.get("output_dir").is_none());
    }

    #[test]
    fn draft_snapshot_omitted_optionals_serialize_to_null() {
        let snapshot = DraftSnapshot {
            items: Vec::new(),
            naming_template: None,
            start_number: 1,
            output_dir: None,
            output_mode: OutputMode::Zip,
            conflict_policy: ConflictPolicy::AutoRename,
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["namingTemplate"], json!(null));
        assert_eq!(v["outputDir"], json!(null));
    }

    #[test]
    fn source_kind_serializes_to_lowercase_variants() {
        assert_eq!(
            serde_json::to_value(SourceKind::Folder).unwrap(),
            json!("folder")
        );
        assert_eq!(serde_json::to_value(SourceKind::Rar).unwrap(), json!("rar"));
        assert_eq!(serde_json::to_value(SourceKind::Zip).unwrap(), json!("zip"));
    }

    #[test]
    fn output_mode_serializes_to_lowercase_variants() {
        assert_eq!(serde_json::to_value(OutputMode::Zip).unwrap(), json!("zip"));
        assert_eq!(
            serde_json::to_value(OutputMode::Folder).unwrap(),
            json!("folder")
        );
    }

    #[test]
    fn draft_snapshot_includes_output_mode() {
        let snapshot = DraftSnapshot {
            items: Vec::new(),
            naming_template: None,
            start_number: 1,
            output_dir: None,
            output_mode: OutputMode::Folder,
            conflict_policy: ConflictPolicy::AutoRename,
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["outputMode"], json!("folder"));
    }

    #[test]
    fn conflict_policy_serializes_to_camel_case_variants() {
        assert_eq!(
            serde_json::to_value(ConflictPolicy::AutoRename).unwrap(),
            json!("autoRename")
        );
        assert_eq!(
            serde_json::to_value(ConflictPolicy::Skip).unwrap(),
            json!("skip")
        );
        assert_eq!(
            serde_json::to_value(ConflictPolicy::Overwrite).unwrap(),
            json!("overwrite")
        );
    }

    #[test]
    fn conflict_policy_deserializes_from_camel_case_variants() {
        assert_eq!(
            serde_json::from_value::<ConflictPolicy>(json!("autoRename")).unwrap(),
            ConflictPolicy::AutoRename
        );
        assert_eq!(
            serde_json::from_value::<ConflictPolicy>(json!("skip")).unwrap(),
            ConflictPolicy::Skip
        );
        assert_eq!(
            serde_json::from_value::<ConflictPolicy>(json!("overwrite")).unwrap(),
            ConflictPolicy::Overwrite
        );
    }

    #[test]
    fn conflict_policy_default_is_auto_rename() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::AutoRename);
    }

    #[test]
    fn draft_snapshot_includes_conflict_policy() {
        let snapshot = DraftSnapshot {
            items: Vec::new(),
            naming_template: None,
            start_number: 1,
            output_dir: None,
            output_mode: OutputMode::Folder,
            conflict_policy: ConflictPolicy::Overwrite,
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["conflictPolicy"], json!("overwrite"));
    }

    #[test]
    fn draft_snapshot_includes_start_number() {
        let snapshot = DraftSnapshot {
            items: Vec::new(),
            naming_template: None,
            start_number: 5,
            output_dir: None,
            output_mode: OutputMode::Zip,
            conflict_policy: ConflictPolicy::AutoRename,
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["startNumber"], json!(5));
    }
}
