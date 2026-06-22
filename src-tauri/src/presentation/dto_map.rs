//! Application -> wire mapping for the presentation DTOs.
//!
//! This module answers "how core maps onto the wire," keeping that translation
//! layer separate from the wire-contract declarations in [`super::dto`], which
//! answer "what the wire contract is." The `From` impls are defined on the DTO
//! target types, so they remain visible wherever those types are in scope; the
//! free function [`draft_item_from_source`] is re-exported from `dto` so callers
//! resolve it unchanged.

use std::time::Duration;

use std::collections::HashMap;

use simple_archiver_core::application::progress::JobProgress;
use simple_archiver_core::application::progress_aggregator::JobSummary;
use simple_archiver_core::domain::archive_task::TaskId;
use simple_archiver_core::domain::conflict_policy::ConflictPolicy as DomainConflictPolicy;
use simple_archiver_core::domain::output_mode::OutputMode as DomainOutputMode;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::domain::task_progress::TaskProgress;

use super::dto::{
    ConflictPolicy as ConflictPolicyDto, DraftItemDto, FailedTaskDto, JobSummaryDto,
    OutputMode as OutputModeDto, ProgressCounts, ProgressEvent, SourceKind, TaskProgressDto,
    TaskResultDto, TaskStatusDto,
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

/// Per-task output metadata the presentation layer recomputes from the planned
/// job: task id, output base name, and absolute output path, in job/task order.
///
/// This is the bridge that lets the wire summary carry output paths without the
/// core engine producing them — the engine returns task ids only. The path is
/// computed via the domain SSOT `ArchiveTask::output_destination` (see
/// `commands::task_path_meta`).
pub(crate) struct TaskPathMeta {
    pub(crate) id: TaskId,
    pub(crate) output_name: String,
    pub(crate) output_path: String,
}

/// Build a [`JobSummaryDto`] from the engine's [`JobSummary`] plus per-task
/// output metadata.
///
/// The legacy `succeeded`/`cancelled`/`failed` buckets are populated exactly as
/// the old `From<JobSummary>` impl did. The additive `results` vec is built in
/// `meta` order (which mirrors the planned job's task order), classifying each
/// task from the three summary vecs and attaching a `reason` only for failures.
///
/// A task id present in `meta` but absent from all three summary buckets cannot
/// happen for a finished job (`into_summary` reconciles every task into exactly
/// one bucket); if it ever did, it is conservatively reported as `Failed` with a
/// synthesized reason rather than silently dropped.
pub(crate) fn job_summary_dto(summary: JobSummary, meta: &[TaskPathMeta]) -> JobSummaryDto {
    // Index each task id to its terminal status (and reason, for failures).
    let mut status_by_id: HashMap<u32, (TaskStatusDto, Option<String>)> = HashMap::new();
    for id in &summary.succeeded {
        status_by_id.insert(id.get(), (TaskStatusDto::Succeeded, None));
    }
    for id in &summary.cancelled {
        status_by_id.insert(id.get(), (TaskStatusDto::Cancelled, None));
    }
    for (id, reason) in &summary.failed {
        status_by_id.insert(id.get(), (TaskStatusDto::Failed, Some(reason.clone())));
    }

    let results = meta
        .iter()
        .map(|m| {
            let raw = m.id.get();
            let (status, reason) = status_by_id.get(&raw).cloned().unwrap_or_else(|| {
                (
                    TaskStatusDto::Failed,
                    Some("task was not accounted for in the run summary".to_string()),
                )
            });
            TaskResultDto {
                task_id: raw,
                output_name: m.output_name.clone(),
                output_path: m.output_path.clone(),
                status,
                reason,
            }
        })
        .collect();

    JobSummaryDto {
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
        results,
    }
}

/// Map the wire output mode to the domain output mode.
pub(crate) fn output_mode_to_domain(mode: OutputModeDto) -> DomainOutputMode {
    match mode {
        OutputModeDto::Zip => DomainOutputMode::Zip,
        OutputModeDto::Folder => DomainOutputMode::Folder,
    }
}

/// Map the domain output mode to the wire output mode.
pub(crate) fn output_mode_from_domain(mode: DomainOutputMode) -> OutputModeDto {
    match mode {
        DomainOutputMode::Zip => OutputModeDto::Zip,
        DomainOutputMode::Folder => OutputModeDto::Folder,
    }
}

/// Map the wire conflict policy to the domain conflict policy.
pub(crate) fn conflict_policy_to_domain(policy: ConflictPolicyDto) -> DomainConflictPolicy {
    match policy {
        ConflictPolicyDto::AutoRename => DomainConflictPolicy::AutoRename,
        ConflictPolicyDto::Skip => DomainConflictPolicy::Skip,
        ConflictPolicyDto::Overwrite => DomainConflictPolicy::Overwrite,
    }
}

/// Map the domain conflict policy to the wire conflict policy.
pub(crate) fn conflict_policy_from_domain(policy: DomainConflictPolicy) -> ConflictPolicyDto {
    match policy {
        DomainConflictPolicy::AutoRename => ConflictPolicyDto::AutoRename,
        DomainConflictPolicy::Skip => ConflictPolicyDto::Skip,
        DomainConflictPolicy::Overwrite => ConflictPolicyDto::Overwrite,
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
    use simple_archiver_core::domain::archive_job::ArchiveJob;
    use simple_archiver_core::domain::naming_rule::NamingRule;
    use simple_archiver_core::domain::output_directory::OutputDirectory;
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
    fn job_summary_maps_to_empty_dto_when_no_tasks_run() {
        // With no task ids and no meta, every bucket and `results` is empty.
        let summary = JobSummary {
            succeeded: Vec::new(),
            cancelled: Vec::new(),
            failed: Vec::new(),
        };
        let dto = job_summary_dto(summary, &[]);
        assert_eq!(
            dto,
            JobSummaryDto {
                succeeded: Vec::new(),
                cancelled: Vec::new(),
                failed: Vec::new(),
                results: Vec::new(),
            }
        );
    }

    // ── job_summary_dto: results builder ──────────────────────────────────────

    /// Plan a three-item Zip job so we can borrow real `TaskId`s (which cannot be
    /// constructed outside the core crate) for the builder tests.
    fn three_item_zip_job() -> ArchiveJob {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/in/a.rar")),
            SourceItem::RarFile(PathBuf::from("/in/b.rar")),
            SourceItem::RarFile(PathBuf::from("/in/c.rar")),
        ];
        ArchiveJob::plan(
            items,
            NamingRule::parse("out_{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap()
    }

    /// Build the per-task meta for a Zip job, computing the path via the domain
    /// SSOT `ArchiveTask::output_destination` so the test asserts the production
    /// formula.
    fn zip_meta(job: &ArchiveJob) -> Vec<TaskPathMeta> {
        let out_dir = job.output_directory().path();
        let mode = job.output_mode();
        job.tasks()
            .iter()
            .map(|t| TaskPathMeta {
                id: t.id(),
                output_name: t.output_name().as_str().to_string(),
                output_path: t
                    .output_destination(out_dir, mode)
                    .to_string_lossy()
                    .into_owned(),
            })
            .collect()
    }

    #[test]
    fn job_summary_dto_builds_results_for_a_mixed_run() {
        // task 0 -> succeeded, task 1 -> failed, task 2 -> cancelled.
        let job = three_item_zip_job();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let meta = zip_meta(&job);

        let summary = JobSummary {
            succeeded: vec![ids[0]],
            cancelled: vec![ids[2]],
            failed: vec![(ids[1], "boom".to_string())],
        };

        let dto = job_summary_dto(summary, &meta);

        // Results are in job/task order and carry the right status + path.
        assert_eq!(dto.results.len(), 3);

        // Build expected paths the same way production does, so the assertion is
        // platform-correct: on Windows `PathBuf::join` uses `\` as the separator,
        // not `/`, so a hard-coded forward-slash literal would fail there.
        let exp = |name: &str| {
            PathBuf::from("/out")
                .join(name)
                .to_string_lossy()
                .into_owned()
        };

        assert_eq!(dto.results[0].task_id, ids[0].get());
        assert_eq!(dto.results[0].status, TaskStatusDto::Succeeded);
        assert_eq!(dto.results[0].reason, None);
        assert_eq!(dto.results[0].output_name, "out_1.zip");
        assert_eq!(dto.results[0].output_path, exp("out_1.zip"));

        assert_eq!(dto.results[1].task_id, ids[1].get());
        assert_eq!(dto.results[1].status, TaskStatusDto::Failed);
        assert_eq!(dto.results[1].reason, Some("boom".to_string()));
        assert_eq!(dto.results[1].output_path, exp("out_2.zip"));

        assert_eq!(dto.results[2].task_id, ids[2].get());
        assert_eq!(dto.results[2].status, TaskStatusDto::Cancelled);
        assert_eq!(dto.results[2].reason, None);
        assert_eq!(dto.results[2].output_path, exp("out_3.zip"));
    }

    #[test]
    fn job_summary_dto_reason_only_on_failed() {
        let job = three_item_zip_job();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let meta = zip_meta(&job);
        let summary = JobSummary {
            succeeded: vec![ids[0], ids[2]],
            cancelled: Vec::new(),
            failed: vec![(ids[1], "kaput".to_string())],
        };

        let dto = job_summary_dto(summary, &meta);

        // Only the failed task carries a reason; the others are None.
        assert!(dto.results[0].reason.is_none());
        assert_eq!(dto.results[1].reason, Some("kaput".to_string()));
        assert!(dto.results[2].reason.is_none());
    }

    #[test]
    fn job_summary_dto_folder_mode_path_uses_source_output_stem() {
        // Folder mode: the output path is `out_dir/<source stem>`, not a zip name.
        let items = vec![SourceItem::ZipFile(PathBuf::from("/in/photos.zip"))];
        let job = ArchiveJob::plan_extract(
            items,
            OutputDirectory::new(PathBuf::from("/out")),
            simple_archiver_core::domain::conflict_policy::ConflictPolicy::default(),
        )
        .unwrap();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();

        // Build meta the same way the command does for Folder mode.
        let out_dir = job.output_directory().path();
        let mode = job.output_mode();
        let meta: Vec<TaskPathMeta> = job
            .tasks()
            .iter()
            .map(|t| TaskPathMeta {
                id: t.id(),
                output_name: t.source().output_stem(),
                output_path: t
                    .output_destination(out_dir, mode)
                    .to_string_lossy()
                    .into_owned(),
            })
            .collect();

        let summary = JobSummary {
            succeeded: vec![ids[0]],
            cancelled: Vec::new(),
            failed: Vec::new(),
        };

        let dto = job_summary_dto(summary, &meta);

        assert_eq!(dto.results[0].output_name, "photos");
        // Platform-correct expected path (Windows joins with `\`, not `/`).
        assert_eq!(
            dto.results[0].output_path,
            PathBuf::from("/out")
                .join("photos")
                .to_string_lossy()
                .into_owned()
        );
        assert_eq!(dto.results[0].status, TaskStatusDto::Succeeded);
    }

    #[test]
    fn job_summary_dto_preserves_legacy_buckets() {
        // Regression: the legacy succeeded/cancelled/failed vecs are unchanged.
        let job = three_item_zip_job();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let meta = zip_meta(&job);
        let summary = JobSummary {
            succeeded: vec![ids[0]],
            cancelled: vec![ids[2]],
            failed: vec![(ids[1], "boom".to_string())],
        };

        let dto = job_summary_dto(summary, &meta);

        assert_eq!(dto.succeeded, vec![ids[0].get()]);
        assert_eq!(dto.cancelled, vec![ids[2].get()]);
        assert_eq!(dto.failed.len(), 1);
        assert_eq!(dto.failed[0].task_id, ids[1].get());
        assert_eq!(dto.failed[0].reason, "boom");
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
    fn conflict_policy_maps_round_trip_through_domain() {
        use super::super::dto::ConflictPolicy as Dto;
        for dto in [Dto::AutoRename, Dto::Skip, Dto::Overwrite] {
            let domain = conflict_policy_to_domain(dto);
            assert_eq!(conflict_policy_from_domain(domain), dto);
        }
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
