//! Outbound progress port and the aggregated progress snapshot.

use crate::domain::archive_task::TaskId;
use crate::domain::task_progress::TaskProgress;
use std::time::Duration;

/// Per-task byte progress with an optional ETA, in the job's task order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskProgressEntry {
    /// The task this entry belongs to.
    pub id: TaskId,
    /// The task's byte counters.
    pub progress: TaskProgress,
    /// Estimated time remaining for this task, or `None` when not yet known.
    pub eta: Option<Duration>,
}

/// An aggregated progress snapshot emitted by the engine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobProgress {
    /// Estimated time remaining for the whole job, or `None` when not yet known.
    pub overall_eta: Option<Duration>,
    /// Per-task progress (with ETA) in the job's task order.
    pub per_task: Vec<TaskProgressEntry>,
    /// Time elapsed since the job started.
    pub elapsed: Duration,
}

impl JobProgress {
    /// Return the overall byte progress derived from all per-task entries.
    ///
    /// `bytes_done` is the saturating sum of each task's `bytes_done`;
    /// `bytes_total` is the saturating sum of each task's `bytes_total`.
    /// Returns `TaskProgress::new(0, 0)` when `per_task` is empty.
    pub fn overall(&self) -> TaskProgress {
        let mut done: u64 = 0;
        let mut total: u64 = 0;
        for entry in &self.per_task {
            done = done.saturating_add(entry.progress.bytes_done());
            total = total.saturating_add(entry.progress.bytes_total());
        }
        // Saturation here would mean an upstream bug fed corrupt counters
        // (a real job never approaches u64::MAX bytes). Surface it loudly in
        // debug/test builds while keeping release builds panic-free.
        debug_assert!(
            done < u64::MAX && total < u64::MAX,
            "JobProgress::overall summation saturated"
        );
        TaskProgress::new(done, total)
    }
}

/// Outbound port: the engine reports aggregated progress to the caller
/// (presentation adapts it to Tauri events; tests record it).
pub trait ProgressSink: Send + Sync {
    /// Receive an aggregated progress snapshot.
    fn report(&self, snapshot: JobProgress);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::archive_task::TaskId;
    use std::sync::Mutex;
    use std::time::Duration;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<JobProgress>>);
    impl ProgressSink for Recorder {
        fn report(&self, snapshot: JobProgress) {
            self.0.lock().unwrap().push(snapshot);
        }
    }

    #[test]
    fn recorder_captures_reported_snapshot() {
        let recorder = Recorder::default();
        let snapshot = JobProgress {
            overall_eta: None,
            per_task: Vec::new(),
            elapsed: Duration::from_secs(0),
        };
        recorder.report(snapshot.clone());
        assert_eq!(recorder.0.lock().unwrap().as_slice(), &[snapshot]);
    }

    /// `overall()` sums `bytes_done` and `bytes_total` across all per-task entries.
    #[test]
    fn overall_sums_per_task_progress_when_non_empty() {
        let id0 = TaskId::new(1);
        let id1 = TaskId::new(2);
        let snap = JobProgress {
            overall_eta: None,
            per_task: vec![
                TaskProgressEntry {
                    id: id0,
                    progress: TaskProgress::new(2, 10),
                    eta: None,
                },
                TaskProgressEntry {
                    id: id1,
                    progress: TaskProgress::new(3, 5),
                    eta: None,
                },
            ],
            elapsed: Duration::ZERO,
        };
        assert_eq!(snap.overall(), TaskProgress::new(5, 15));
    }

    /// `overall()` returns `{0, 0}` when `per_task` is empty.
    #[test]
    fn overall_returns_zero_when_per_task_is_empty() {
        let snap = JobProgress {
            overall_eta: None,
            per_task: Vec::new(),
            elapsed: Duration::ZERO,
        };
        assert_eq!(snap.overall(), TaskProgress::new(0, 0));
    }
}
