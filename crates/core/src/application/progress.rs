//! Outbound progress port and the aggregated progress snapshot.

use crate::domain::archive_task::TaskId;
use crate::domain::task_progress::TaskProgress;
use std::time::Duration;

/// An aggregated progress snapshot emitted by the engine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobProgress {
    /// Sum of byte counters across every task.
    pub overall: TaskProgress,
    /// Per-task progress in the job's task order.
    pub per_task: Vec<(TaskId, TaskProgress)>,
    /// Time elapsed since the job started.
    pub elapsed: Duration,
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
            overall: TaskProgress::new(1, 2),
            per_task: Vec::new(),
            elapsed: Duration::from_secs(0),
        };
        recorder.report(snapshot.clone());
        assert_eq!(recorder.0.lock().unwrap().as_slice(), &[snapshot]);
    }
}
