//! Per-task execution context handed to the `Archiver`.

use crate::domain::archive_task::TaskId;
use crate::domain::task_progress::TaskProgress;
use std::sync::Arc;

/// Internal report target so `CompressContext` can forward per-task byte
/// progress without exposing the engine's channel type on the public port.
pub(crate) trait TaskProgressReport: Send + Sync {
    /// Forward a per-task progress update.
    fn report(&self, task: TaskId, progress: TaskProgress);
}

/// A report target that drops every update; used by detached compressions.
struct NoopReport;
impl TaskProgressReport for NoopReport {
    fn report(&self, _task: TaskId, _progress: TaskProgress) {}
}

/// Context passed to `Archiver::compress`, carrying the task identity and the
/// report target. The worker owns it so the compress future is `'static` when
/// spawned.
pub struct CompressContext {
    task: TaskId,
    reporter: Arc<dyn TaskProgressReport>,
}

impl CompressContext {
    /// Build a context bound to `task` that forwards progress to `reporter`.
    pub(crate) fn new(task: TaskId, reporter: Arc<dyn TaskProgressReport>) -> Self {
        Self { task, reporter }
    }

    /// Build a context not tied to any job; all progress reports are dropped.
    /// Used by the single-folder Tauri command and integration tests.
    pub fn detached() -> Self {
        Self {
            task: TaskId::new(0),
            reporter: Arc::new(NoopReport),
        }
    }

    /// Report cumulative byte progress for this task.
    pub fn report(&self, bytes_done: u64, bytes_total: u64) {
        self.reporter
            .report(self.task, TaskProgress::new(bytes_done, bytes_total));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Capture(Mutex<Vec<(u32, TaskProgress)>>);
    impl TaskProgressReport for Capture {
        fn report(&self, task: TaskId, progress: TaskProgress) {
            self.0.lock().unwrap().push((task.get(), progress));
        }
    }

    #[test]
    fn report_forwards_task_id_and_progress() {
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        let ctx = CompressContext::new(TaskId::new(7), capture.clone());
        ctx.report(4, 8);
        assert_eq!(
            capture.0.lock().unwrap().as_slice(),
            &[(7, TaskProgress::new(4, 8))]
        );
    }

    #[test]
    fn detached_drops_reports_without_panicking() {
        let ctx = CompressContext::detached();
        ctx.report(1, 2);
    }
}
