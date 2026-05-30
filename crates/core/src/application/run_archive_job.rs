//! The RunArchiveJob use case: bounded-parallel execution feeding a
//! single-writer aggregator. Excluded from loom builds (uses the tokio runtime);
//! PR-5b adds the loom-tested concurrency nucleus.

use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{mpsc, Semaphore};

use crate::application::compress_context::{CompressContext, TaskProgressReport};
use crate::application::ports::{Archiver, Clock};
use crate::application::progress::ProgressSink;
use crate::application::progress_aggregator::{Aggregator, JobSummary, WorkerMsg};
use crate::domain::archive_job::ArchiveJob;
use crate::domain::archive_task::TaskId;
use crate::domain::source_item::SourceItem;
use crate::domain::task_progress::TaskProgress;
use crate::domain::task_status::TaskEvent;

/// Forwards per-task byte progress onto the internal worker->aggregator channel.
struct ChannelReporter {
    tx: mpsc::UnboundedSender<WorkerMsg>,
}
impl TaskProgressReport for ChannelReporter {
    fn report(&self, task: TaskId, progress: TaskProgress) {
        // The receiver lives for the whole run; a send error only means the job
        // is already tearing down, so dropping a late update is fine.
        let _ = self.tx.send(WorkerMsg::Progress { task, progress });
    }
}

/// One unit of work, extracted before the job moves into the aggregator.
struct WorkItem {
    task: TaskId,
    source: SourceItem,
    dest: PathBuf,
}

/// Runs an `ArchiveJob` with up to N concurrent workers.
pub struct RunArchiveJob<A: Archiver> {
    archiver: Arc<A>,
    parallelism: NonZeroUsize,
}

impl<A: Archiver + 'static> RunArchiveJob<A> {
    /// Build an engine with an explicit parallelism limit.
    pub fn new(archiver: Arc<A>, parallelism: NonZeroUsize) -> Self {
        Self {
            archiver,
            parallelism,
        }
    }

    /// Build an engine using `available_parallelism` (falling back to 1).
    pub fn with_default_parallelism(archiver: Arc<A>) -> Self {
        let parallelism = std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN);
        Self {
            archiver,
            parallelism,
        }
    }

    /// Execute `job`, emitting aggregated progress to `sink`, returning the summary.
    pub async fn execute<C: Clock, S: ProgressSink>(
        &self,
        job: ArchiveJob,
        clock: &C,
        sink: &S,
    ) -> JobSummary {
        // Extract an immutable work list before the job moves into the aggregator.
        let out_dir = job.output_directory().path().to_path_buf();
        let work: Vec<WorkItem> = job
            .tasks()
            .iter()
            .map(|t| WorkItem {
                task: t.id(),
                source: t.source().clone(),
                dest: out_dir.join(t.output_name().as_str()),
            })
            .collect();

        let (tx, mut rx) = mpsc::unbounded_channel::<WorkerMsg>();
        let semaphore = Arc::new(Semaphore::new(self.parallelism.get()));

        let mut handles = Vec::with_capacity(work.len());
        for item in work {
            let archiver = self.archiver.clone();
            let semaphore = semaphore.clone();
            let tx = tx.clone();
            handles.push(tokio::spawn(async move {
                // Bounded concurrency: hold a permit for the whole task.
                let _permit = semaphore.acquire_owned().await.expect("semaphore open");
                run_one(archiver.as_ref(), item, tx).await;
            }));
        }
        // Drop the engine's own sender so the channel closes once workers finish.
        drop(tx);

        // Single-writer aggregation loop on this task.
        let mut aggregator = Aggregator::new(job, clock.now());
        while let Some(msg) = rx.recv().await {
            let _ = aggregator.apply(msg);
            sink.report(aggregator.snapshot(clock.now()));
        }

        // Join workers (compress errors are already captured as Fail events).
        for handle in handles {
            let _ = handle.await;
        }
        aggregator.into_summary()
    }
}

/// Execute a single work item, sending status + progress over `tx`.
async fn run_one<A: Archiver>(archiver: &A, item: WorkItem, tx: mpsc::UnboundedSender<WorkerMsg>) {
    match item.source {
        SourceItem::Folder(ref src) => {
            let _ = tx.send(WorkerMsg::Status {
                task: item.task,
                event: TaskEvent::StartCompressing,
            });
            let reporter = Arc::new(ChannelReporter { tx: tx.clone() });
            let ctx = CompressContext::new(item.task, reporter);
            let event = match archiver.compress(src, &item.dest, &ctx).await {
                Ok(()) => TaskEvent::Complete,
                Err(e) => TaskEvent::Fail {
                    reason: e.to_string(),
                },
            };
            let _ = tx.send(WorkerMsg::Status {
                task: item.task,
                event,
            });
        }
        SourceItem::RarFile(_) => {
            // rar extraction is deferred to a later PR; fail this task so the
            // others continue (FormatRegistry + Extractor are out of scope here).
            let _ = tx.send(WorkerMsg::Status {
                task: item.task,
                event: TaskEvent::Fail {
                    reason: "rar extraction is not yet supported (PR5a is folder-only)".to_string(),
                },
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::ArchiveError;
    use crate::application::progress::{JobProgress, ProgressSink};
    use crate::domain::naming_rule::NamingRule;
    use crate::domain::output_directory::OutputDirectory;
    use std::collections::HashSet;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;

    /// A fake archiver: reports two progress ticks, optionally fails for outputs
    /// whose file name is in `fail_names`, and can rendezvous on a barrier so a
    /// test can prove tasks ran concurrently.
    struct FakeArchiver {
        fail_names: HashSet<String>,
        barrier: Option<Arc<tokio::sync::Barrier>>,
        live: Arc<AtomicUsize>,
        max_live: Arc<AtomicUsize>,
    }
    impl FakeArchiver {
        fn new() -> Self {
            Self {
                fail_names: HashSet::new(),
                barrier: None,
                live: Arc::new(AtomicUsize::new(0)),
                max_live: Arc::new(AtomicUsize::new(0)),
            }
        }
    }
    impl Archiver for FakeArchiver {
        async fn compress(
            &self,
            _src: &Path,
            dest: &Path,
            ctx: &CompressContext,
        ) -> Result<(), ArchiveError> {
            let now = self.live.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_live.fetch_max(now, Ordering::SeqCst);
            ctx.report(5, 10);
            if let Some(b) = &self.barrier {
                b.wait().await;
            }
            ctx.report(10, 10);
            self.live.fetch_sub(1, Ordering::SeqCst);
            let name = dest.file_name().unwrap().to_string_lossy().to_string();
            if self.fail_names.contains(&name) {
                Err(ArchiveError::Backend("boom".to_string()))
            } else {
                Ok(())
            }
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<JobProgress>>);
    impl ProgressSink for RecordingSink {
        fn report(&self, snapshot: JobProgress) {
            self.0.lock().unwrap().push(snapshot);
        }
    }

    struct FixedClock(Instant);
    impl Clock for FixedClock {
        fn now(&self) -> Instant {
            self.0
        }
    }

    fn folder_job(n: usize) -> ArchiveJob {
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

    fn nz(v: usize) -> NonZeroUsize {
        NonZeroUsize::new(v).unwrap()
    }

    #[tokio::test]
    async fn all_folders_succeed_and_are_tallied() {
        let job = folder_job(3);
        let mut expected: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        expected.sort_by_key(|i| i.get());
        let engine = RunArchiveJob::new(Arc::new(FakeArchiver::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let summary = engine.execute(job, &clock, &sink).await;
        let mut succeeded = summary.succeeded.clone();
        succeeded.sort_by_key(|i| i.get());
        assert_eq!(succeeded, expected);
        assert!(summary.failed.is_empty());
    }

    #[tokio::test]
    async fn one_failure_does_not_stop_the_others() {
        let job = folder_job(3); // outputs f1.zip, f2.zip, f3.zip
        let id: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let mut fake = FakeArchiver::new();
        fake.fail_names.insert("f2.zip".to_string());
        let engine = RunArchiveJob::new(Arc::new(fake), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let summary = engine.execute(job, &clock, &sink).await;
        let mut succeeded = summary.succeeded.clone();
        succeeded.sort_by_key(|i| i.get());
        assert_eq!(succeeded, vec![id[0], id[2]]);
        // The recorded reason is the full `ArchiveError::to_string()` (spec: the
        // failure list carries `reason via ArchiveError::to_string()`), so the
        // backend message "boom" surfaces with its `Display` prefix.
        assert_eq!(
            summary.failed,
            vec![(id[1], "archive backend error: boom".to_string())]
        );
    }

    #[tokio::test]
    async fn rar_item_fails_its_own_task_only() {
        let items = vec![
            SourceItem::Folder(PathBuf::from("dir0")),
            SourceItem::RarFile(PathBuf::from("a.rar")),
        ];
        let job = ArchiveJob::plan(
            items,
            NamingRule::parse("f{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap();
        let id: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let engine = RunArchiveJob::new(Arc::new(FakeArchiver::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let summary = engine.execute(job, &clock, &sink).await;
        assert_eq!(summary.succeeded, vec![id[0]]);
        assert_eq!(summary.failed.len(), 1);
        assert_eq!(summary.failed[0].0, id[1]);
        assert!(summary.failed[0].1.contains("rar"));
    }

    #[tokio::test]
    async fn emits_progress_snapshots_tallying_overall() {
        let job = folder_job(2);
        let engine = RunArchiveJob::new(Arc::new(FakeArchiver::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        engine.execute(job, &clock, &sink).await;
        let snaps = sink.0.lock().unwrap();
        assert!(!snaps.is_empty(), "expected progress snapshots");
        let last = snaps.last().unwrap();
        // Both tasks finish at 10/10 -> overall 20/20.
        assert_eq!(last.overall, TaskProgress::new(20, 20));
        assert_eq!(last.per_task.len(), 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn runs_tasks_in_parallel_up_to_the_limit() {
        let job = folder_job(2);
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let mut fake = FakeArchiver::new();
        fake.barrier = Some(barrier.clone());
        let max_live = fake.max_live.clone();
        let engine = RunArchiveJob::new(Arc::new(fake), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        // A Barrier(2) only releases if both workers are inside compress at once;
        // the timeout turns a missing-concurrency bug into a failure, not a hang.
        let summary = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            engine.execute(job, &clock, &sink),
        )
        .await
        .expect("must not deadlock — proves two tasks ran concurrently");
        assert_eq!(summary.succeeded.len(), 2);
        assert_eq!(max_live.load(Ordering::SeqCst), 2);
    }
}
