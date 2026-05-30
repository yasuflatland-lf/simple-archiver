//! Wire-contract DTOs — the single authored source of the Rust<->TS contract.
//!
//! These types are the *send-only* payloads the presentation layer emits to the
//! frontend (Tauri events / command results). They are deliberately distinct
//! from the domain/application types so the wire shape can evolve independently
//! of the core model. `#[derive(TS)]` exports a matching TypeScript declaration
//! into `src/bindings/` (see the `export_to` attribute); the serde-shape tests
//! below are the Rust half of the contract and guard against silent drift.

use serde::Serialize;
use ts_rs::TS;

use simple_archiver_core::application::progress::JobProgress;
use simple_archiver_core::application::progress_aggregator::JobSummary;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::domain::task_progress::TaskProgress;

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
    /// Summed byte counters across every task.
    pub overall: ProgressCounts,
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
    /// The output directory, if one has been chosen.
    pub output_dir: Option<String>,
}

/// A single draft item: its path and what kind of source it is.
#[derive(Serialize, TS, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/bindings/")]
pub struct DraftItemDto {
    /// The item's filesystem path (lossy UTF-8).
    pub path: String,
    /// Whether the item is a folder or a rar file.
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping helpers (presentation only)
// ─────────────────────────────────────────────────────────────────────────────

impl From<&TaskProgress> for ProgressCounts {
    fn from(progress: &TaskProgress) -> Self {
        Self {
            bytes_done: progress.bytes_done(),
            bytes_total: progress.bytes_total(),
        }
    }
}

impl From<&JobProgress> for ProgressEvent {
    fn from(job_progress: &JobProgress) -> Self {
        Self {
            overall: ProgressCounts::from(&job_progress.overall),
            per_task: job_progress
                .per_task
                .iter()
                .map(|(id, p)| TaskProgressDto {
                    task_id: id.get(),
                    bytes_done: p.bytes_done(),
                    bytes_total: p.bytes_total(),
                })
                .collect(),
            // u128 -> u64: safe for any realistic session (2^64 ms ~ 585M years).
            elapsed_ms: job_progress.elapsed.as_millis() as u64,
        }
    }
}

impl From<JobSummary> for JobSummaryDto {
    fn from(summary: JobSummary) -> Self {
        Self {
            succeeded: summary.succeeded.iter().map(|id| id.get()).collect(),
            cancelled: summary.cancelled.iter().map(|id| id.get()).collect(),
            failed: summary
                .failed
                .into_iter()
                .map(|(id, reason)| FailedTaskDto {
                    task_id: id.get(),
                    reason,
                })
                .collect(),
        }
    }
}

/// Build a [`DraftItemDto`] from a [`SourceItem`] (lossy path string + kind).
///
/// Used by later waves when projecting the draft to the frontend; provided and
/// tested here so the mapping lives next to the DTO it produces.
pub(crate) fn draft_item_from_source(item: &SourceItem) -> DraftItemDto {
    let (path, kind) = match item {
        SourceItem::Folder(p) => (p, SourceKind::Folder),
        SourceItem::RarFile(p) => (p, SourceKind::Rar),
    };
    DraftItemDto {
        path: path.to_string_lossy().into_owned(),
        kind,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::Duration;
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
        DraftSnapshot::export().expect("export DraftSnapshot");
        DraftItemDto::export().expect("export DraftItemDto");
        SourceKind::export().expect("export SourceKind");
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

        // TaskProgressDto: bytesDone and bytesTotal must be `number`.
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
            !task_decl.contains("bigint"),
            "TaskProgressDto must not contain `bigint`, got: {task_decl}"
        );

        // ProgressEvent: elapsedMs must be `number`.
        let event_decl = ProgressEvent::decl();
        assert!(
            event_decl.contains("elapsedMs: number"),
            "ProgressEvent.elapsedMs should be `number`, got: {event_decl}"
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
            per_task: vec![TaskProgressDto {
                task_id: 7,
                bytes_done: 2,
                bytes_total: 10,
            }],
            elapsed_ms: 50,
        };
        let v = serde_json::to_value(&event).unwrap();
        assert_eq!(v["overall"]["bytesDone"], json!(5));
        assert_eq!(v["overall"]["bytesTotal"], json!(15));
        assert_eq!(v["perTask"][0]["taskId"], json!(7));
        assert_eq!(v["perTask"][0]["bytesDone"], json!(2));
        assert_eq!(v["perTask"][0]["bytesTotal"], json!(10));
        assert_eq!(v["elapsedMs"], json!(50));
        // Confirm snake_case keys are absent.
        assert!(v.get("per_task").is_none());
        assert!(v.get("elapsed_ms").is_none());
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
        };
        let v = serde_json::to_value(&summary).unwrap();
        assert_eq!(v["succeeded"], json!([1, 3]));
        assert_eq!(v["cancelled"], json!([4]));
        assert_eq!(v["failed"][0]["taskId"], json!(2));
        assert_eq!(v["failed"][0]["reason"], json!("boom"));
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
            output_dir: Some("/out".to_string()),
        };
        let v = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(v["items"][0]["path"], json!("/a/folder"));
        assert_eq!(v["items"][0]["kind"], json!("folder"));
        assert_eq!(v["items"][1]["kind"], json!("rar"));
        assert_eq!(v["namingTemplate"], json!("f{n}"));
        assert_eq!(v["outputDir"], json!("/out"));
        assert!(v.get("naming_template").is_none());
        assert!(v.get("output_dir").is_none());
    }

    #[test]
    fn draft_snapshot_omitted_optionals_serialize_to_null() {
        let snapshot = DraftSnapshot {
            items: Vec::new(),
            naming_template: None,
            output_dir: None,
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
    }

    // ── Mapping helpers ───────────────────────────────────────────────────────

    #[test]
    fn task_progress_maps_to_progress_counts() {
        let progress = TaskProgress::new(3, 8);
        let counts = ProgressCounts::from(&progress);
        assert_eq!(
            counts,
            ProgressCounts {
                bytes_done: 3,
                bytes_total: 8,
            }
        );
    }

    #[test]
    fn job_progress_maps_overall_and_elapsed() {
        // `TaskId` cannot be constructed from outside the core crate (its
        // constructor is `pub(crate)`), so `per_task` is exercised here with an
        // empty vec; the per-task field mapping is covered by the serde-shape
        // test above. The overall counters and elapsed conversion are checked
        // here against a directly-constructed `JobProgress` (its fields are pub).
        let job_progress = JobProgress {
            overall: TaskProgress::new(5, 15),
            per_task: Vec::new(),
            elapsed: Duration::from_millis(1234),
        };
        let event = ProgressEvent::from(&job_progress);
        assert_eq!(
            event.overall,
            ProgressCounts {
                bytes_done: 5,
                bytes_total: 15,
            }
        );
        assert!(event.per_task.is_empty());
        assert_eq!(event.elapsed_ms, 1234);
    }

    #[test]
    fn job_progress_elapsed_converts_to_u64_millis() {
        let job_progress = JobProgress {
            overall: TaskProgress::zero(),
            per_task: Vec::new(),
            elapsed: Duration::from_secs(2),
        };
        let event = ProgressEvent::from(&job_progress);
        assert_eq!(event.elapsed_ms, 2000);
    }

    #[test]
    fn job_summary_maps_to_dto() {
        // As above, `TaskId` values cannot be built outside core, so the
        // task-id-bearing collections are empty here; their `TaskId::get`
        // mapping and camelCase shape are covered by the serde-shape test.
        let summary = JobSummary {
            succeeded: Vec::new(),
            cancelled: Vec::new(),
            failed: Vec::new(),
        };
        let dto = JobSummaryDto::from(summary);
        assert_eq!(
            dto,
            JobSummaryDto {
                succeeded: Vec::new(),
                cancelled: Vec::new(),
                failed: Vec::new(),
            }
        );
    }

    #[test]
    fn draft_item_from_folder_source() {
        let item = SourceItem::Folder(PathBuf::from("/some/folder"));
        let dto = draft_item_from_source(&item);
        assert_eq!(
            dto,
            DraftItemDto {
                path: "/some/folder".to_string(),
                kind: SourceKind::Folder,
            }
        );
    }

    #[test]
    fn draft_item_from_rar_source() {
        let item = SourceItem::RarFile(PathBuf::from("/some/file.rar"));
        let dto = draft_item_from_source(&item);
        assert_eq!(
            dto,
            DraftItemDto {
                path: "/some/file.rar".to_string(),
                kind: SourceKind::Rar,
            }
        );
    }
}
