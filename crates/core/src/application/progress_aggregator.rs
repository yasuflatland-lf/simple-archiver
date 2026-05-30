//! The single-writer aggregator: owns job status + the progress projection.

use std::collections::HashMap;
use std::time::Instant;

use crate::application::progress::JobProgress;
use crate::domain::archive_job::{ArchiveJob, JobError};
use crate::domain::archive_task::TaskId;
use crate::domain::task_progress::TaskProgress;
use crate::domain::task_status::{TaskEvent, TaskStatus};

/// A message sent by a worker to the aggregator over the internal channel.
pub(crate) enum WorkerMsg {
    /// A lifecycle event for `task` (StartCompressing / Complete / Fail / ...).
    Status { task: TaskId, event: TaskEvent },
    /// A cumulative byte-progress update for `task`.
    Progress {
        task: TaskId,
        progress: TaskProgress,
    },
}

/// The outcome of a finished job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobSummary {
    /// Tasks that completed successfully, in job order.
    pub succeeded: Vec<TaskId>,
    /// Tasks that failed, paired with their reason, in job order.
    pub failed: Vec<(TaskId, String)>,
}

/// Owns the `ArchiveJob` (for status) and the per-task progress projection.
/// The only writer of job state, so no shared lock is needed.
pub(crate) struct Aggregator {
    job: ArchiveJob,
    progress: HashMap<TaskId, TaskProgress>,
    started_at: Instant,
}

impl Aggregator {
    /// Create an aggregator over `job`, marking `started_at` as the job start.
    pub fn new(job: ArchiveJob, started_at: Instant) -> Self {
        Self {
            job,
            progress: HashMap::new(),
            started_at,
        }
    }

    /// Apply one worker message. Status events drive the task state machine;
    /// progress updates replace the task's projected counters. An illegal status
    /// transition surfaces as `JobError` (it cannot occur given worker ordering).
    pub fn apply(&mut self, msg: WorkerMsg) -> Result<(), JobError> {
        match msg {
            WorkerMsg::Status { task, event } => self.job.apply_event(task, event),
            WorkerMsg::Progress { task, progress } => {
                self.progress.insert(task, progress);
                Ok(())
            }
        }
    }

    /// Build an aggregated snapshot as of `now`, in job task order.
    pub fn snapshot(&self, now: Instant) -> JobProgress {
        let mut done = 0u64;
        let mut total = 0u64;
        let per_task = self
            .job
            .tasks()
            .iter()
            .map(|t| {
                let p = self
                    .progress
                    .get(&t.id())
                    .copied()
                    .unwrap_or_else(TaskProgress::zero);
                done += p.bytes_done();
                total += p.bytes_total();
                (t.id(), p)
            })
            .collect();
        JobProgress {
            overall: TaskProgress::new(done, total),
            per_task,
            elapsed: now.saturating_duration_since(self.started_at),
        }
    }

    /// Consume the aggregator and derive the summary from final task statuses.
    pub fn into_summary(self) -> JobSummary {
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        for t in self.job.tasks() {
            match t.status() {
                TaskStatus::Completed => succeeded.push(t.id()),
                TaskStatus::Failed { reason } => failed.push((t.id(), reason.clone())),
                other => failed.push((
                    t.id(),
                    // A task that never reached Completed/Failed (e.g. its worker panicked)
                    // must still be accounted for, so the summary is always complete.
                    // PR-5b will refine this once Cancelled is a distinct outcome.
                    format!("task did not reach a terminal state (status: {other:?})"),
                )),
            }
        }
        JobSummary { succeeded, failed }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::naming_rule::NamingRule;
    use crate::domain::output_directory::OutputDirectory;
    use crate::domain::source_item::SourceItem;
    use std::path::PathBuf;
    use std::time::Duration;

    fn job(n: usize) -> ArchiveJob {
        let items = (0..n)
            .map(|i| SourceItem::Folder(PathBuf::from(format!("dir{i}"))))
            .collect();
        ArchiveJob::plan(
            items,
            NamingRule::parse("f{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap()
    }

    fn ids(j: &ArchiveJob) -> Vec<TaskId> {
        j.tasks().iter().map(|t| t.id()).collect()
    }

    #[test]
    fn snapshot_tallies_overall_and_keeps_task_order() {
        let j = job(2);
        let id = ids(&j);
        let base = Instant::now();
        let mut agg = Aggregator::new(j, base);
        agg.apply(WorkerMsg::Progress {
            task: id[0],
            progress: TaskProgress::new(2, 10),
        })
        .unwrap();
        agg.apply(WorkerMsg::Progress {
            task: id[1],
            progress: TaskProgress::new(3, 5),
        })
        .unwrap();
        let snap = agg.snapshot(base + Duration::from_millis(50));
        assert_eq!(snap.overall, TaskProgress::new(5, 15));
        assert_eq!(
            snap.per_task,
            vec![
                (id[0], TaskProgress::new(2, 10)),
                (id[1], TaskProgress::new(3, 5))
            ]
        );
        assert_eq!(snap.elapsed, Duration::from_millis(50));
    }

    #[test]
    fn summary_splits_completed_and_failed_in_job_order() {
        let j = job(3);
        let id = ids(&j);
        let mut agg = Aggregator::new(j, Instant::now());
        agg.apply(WorkerMsg::Status {
            task: id[0],
            event: TaskEvent::StartCompressing,
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[0],
            event: TaskEvent::Complete,
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[1],
            event: TaskEvent::Fail {
                reason: "boom".into(),
            },
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[2],
            event: TaskEvent::StartCompressing,
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[2],
            event: TaskEvent::Complete,
        })
        .unwrap();
        let s = agg.into_summary();
        assert_eq!(s.succeeded, vec![id[0], id[2]]);
        assert_eq!(s.failed, vec![(id[1], "boom".to_string())]);
    }

    #[test]
    fn progress_only_surfaces_for_tasks_in_the_job() {
        let j = job(1);
        let id = ids(&j);
        let mut agg = Aggregator::new(j, Instant::now());
        agg.apply(WorkerMsg::Progress {
            task: id[0],
            progress: TaskProgress::new(1, 1),
        })
        .unwrap();
        assert_eq!(agg.snapshot(Instant::now()).per_task.len(), 1);
    }

    #[test]
    fn non_terminal_task_is_reconciled_as_failed() {
        let j = job(2);
        let id = ids(&j);
        let mut agg = Aggregator::new(j, Instant::now());
        // task 0 reaches a terminal state; task 1 starts but never completes
        // (mirrors a worker that panicked before emitting Complete/Fail).
        agg.apply(WorkerMsg::Status {
            task: id[0],
            event: TaskEvent::StartCompressing,
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[0],
            event: TaskEvent::Complete,
        })
        .unwrap();
        agg.apply(WorkerMsg::Status {
            task: id[1],
            event: TaskEvent::StartCompressing,
        })
        .unwrap();
        let s = agg.into_summary();
        assert_eq!(s.succeeded, vec![id[0]]);
        assert_eq!(
            s.failed.len(),
            1,
            "non-terminal task must be tallied as failed"
        );
        assert_eq!(s.failed[0].0, id[1]);
        assert!(
            !s.failed[0].1.is_empty(),
            "reconciled failure must carry a non-empty reason"
        );
    }
}
