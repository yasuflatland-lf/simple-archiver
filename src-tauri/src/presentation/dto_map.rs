//! Application -> wire mapping for the presentation DTOs.
//!
//! This module answers "how core maps onto the wire," keeping that translation
//! layer separate from the wire-contract declarations in [`super::dto`], which
//! answer "what the wire contract is." The `From` impls are defined on the DTO
//! target types, so they remain visible wherever those types are in scope; the
//! free function [`draft_item_from_source`] is re-exported from `dto` so callers
//! resolve it unchanged.

use std::time::Duration;

use simple_archiver_core::application::progress::JobProgress;
use simple_archiver_core::application::progress_aggregator::JobSummary;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::domain::task_progress::TaskProgress;

use super::dto::{
    DraftItemDto, FailedTaskDto, JobSummaryDto, ProgressCounts, ProgressEvent, SourceKind,
    TaskProgressDto,
};

impl From<&TaskProgress> for ProgressCounts {
    fn from(progress: &TaskProgress) -> Self {
        Self {
            bytes_done: progress.bytes_done(),
            bytes_total: progress.bytes_total(),
        }
    }
}

/// Convert a `Duration` to whole milliseconds, saturating at `u64::MAX`
/// (~585 million years) instead of silently truncating the upper bits.
fn duration_to_millis_u64(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

impl From<&JobProgress> for ProgressEvent {
    fn from(job_progress: &JobProgress) -> Self {
        Self {
            overall: ProgressCounts::from(&job_progress.overall()),
            overall_eta_ms: job_progress.overall_eta.map(duration_to_millis_u64),
            per_task: job_progress
                .per_task
                .iter()
                .map(|e| TaskProgressDto {
                    task_id: e.id.get(),
                    bytes_done: e.progress.bytes_done(),
                    bytes_total: e.progress.bytes_total(),
                    eta_ms: e.eta.map(duration_to_millis_u64),
                })
                .collect(),
            elapsed_ms: duration_to_millis_u64(job_progress.elapsed),
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
        SourceItem::ZipFile(p) => (p, SourceKind::Zip),
    };
    DraftItemDto {
        path: path.to_string_lossy().into_owned(),
        kind,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Duration;

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
        // empty vec. With an empty `per_task`, `overall()` returns {0, 0}.
        // The overall_eta and elapsed conversions are the primary checks here.
        let job_progress = JobProgress {
            overall_eta: Some(Duration::from_millis(2500)),
            per_task: Vec::new(),
            elapsed: Duration::from_millis(1234),
        };
        let event = ProgressEvent::from(&job_progress);
        // overall() == {0, 0} when per_task is empty (TaskId is pub(crate)).
        assert_eq!(
            event.overall,
            ProgressCounts {
                bytes_done: 0,
                bytes_total: 0,
            }
        );
        assert!(event.per_task.is_empty());
        assert_eq!(event.elapsed_ms, 1234);
        assert_eq!(event.overall_eta_ms, Some(2500));
    }

    #[test]
    fn job_progress_elapsed_converts_to_u64_millis() {
        let job_progress = JobProgress {
            overall_eta: None,
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

    #[test]
    fn draft_item_from_zip_source() {
        let item = SourceItem::ZipFile(PathBuf::from("/some/file.zip"));
        let dto = draft_item_from_source(&item);
        assert_eq!(
            dto,
            DraftItemDto {
                path: "/some/file.zip".to_string(),
                kind: SourceKind::Zip,
            }
        );
    }

    #[test]
    fn duration_to_millis_u64_converts_exactly() {
        assert_eq!(duration_to_millis_u64(Duration::from_millis(1234)), 1234);
    }

    #[test]
    fn duration_to_millis_u64_saturates_instead_of_truncating() {
        // as_millis() here exceeds u64::MAX, so the conversion saturates rather
        // than silently returning the low bits.
        assert_eq!(
            duration_to_millis_u64(Duration::from_secs(u64::MAX)),
            u64::MAX
        );
    }
}
