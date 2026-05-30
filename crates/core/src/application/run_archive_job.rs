//! The RunArchiveJob use case: bounded-parallel execution feeding a
//! single-writer aggregator. Excluded from loom builds (uses the tokio runtime);
//! PR-5b adds the loom-tested concurrency nucleus.

use std::num::NonZeroUsize;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::application::compress_context::{CompressContext, TaskProgressReport};
use crate::application::format_registry::FormatRegistry;
use crate::application::ports::Extractor;
use crate::application::ports::{ArchiveError, Archiver, Clock};
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
pub struct RunArchiveJob<A: Archiver, E: Extractor> {
    archiver: Arc<A>,
    registry: FormatRegistry<E>,
    parallelism: NonZeroUsize,
}

impl<A: Archiver + 'static, E: Extractor + 'static> RunArchiveJob<A, E> {
    /// Build an engine with an explicit parallelism limit.
    pub fn new(archiver: Arc<A>, extractor: Arc<E>, parallelism: NonZeroUsize) -> Self {
        Self {
            archiver,
            registry: FormatRegistry::new(extractor),
            parallelism,
        }
    }

    /// Build an engine using `available_parallelism` (falling back to 1).
    pub fn with_default_parallelism(archiver: Arc<A>, extractor: Arc<E>) -> Self {
        let parallelism = std::thread::available_parallelism().unwrap_or(NonZeroUsize::MIN);
        Self {
            archiver,
            registry: FormatRegistry::new(extractor),
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
        self.execute_with_cancellation(job, clock, sink, CancellationToken::new())
            .await
    }

    /// Execute `job` with a caller-owned cancellation token.
    pub async fn execute_with_cancellation<C: Clock, S: ProgressSink>(
        &self,
        job: ArchiveJob,
        clock: &C,
        sink: &S,
        cancellation_token: CancellationToken,
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
            let registry = self.registry.clone();
            let semaphore = semaphore.clone();
            let tx = tx.clone();
            let cancellation_token = cancellation_token.clone();
            handles.push(tokio::spawn(async move {
                // Bounded concurrency: hold a permit for the whole task.
                let _permit = semaphore.acquire_owned().await.expect("semaphore open");
                run_one(archiver.as_ref(), &registry, item, tx, cancellation_token).await;
            }));
        }
        // Drop the engine's own sender so the channel closes once workers finish.
        drop(tx);

        // Single-writer aggregation loop: runs on the caller's async task, never shared.
        let mut aggregator = Aggregator::new(job, clock.now());
        while let Some(msg) = rx.recv().await {
            // `apply` runs unconditionally (it MUST still run in release). An `Err`
            // means a worker emitted out-of-order events — an engine-ordering bug.
            // In debug/test builds we fail loudly to catch it; in release we leave
            // the task state unchanged (a no-op continue) and `into_summary`
            // reconciles any non-terminal task to `failed`. Surfacing this via
            // logging is deferred to a future logging-infrastructure PR.
            let _outcome = aggregator.apply(msg);
            debug_assert!(
                _outcome.is_ok(),
                "out-of-order worker event (engine-ordering bug): {_outcome:?}"
            );
            sink.report(aggregator.snapshot(clock.now()));
        }

        // Join workers (compress outcomes are already captured as terminal events).
        // A panicked worker yields a join error here; we ignore it because the
        // task is still tallied as `failed` via `into_summary`'s state reconciliation
        // (it never reached a terminal status), so no behavior change is needed.
        for handle in handles {
            let _ = handle.await;
        }
        aggregator.into_summary()
    }
}

/// Execute a single work item: resolve its source to a directory (extracting rar
/// into a temp guard), then compress that directory. Sends status + progress over `tx`.
async fn run_one<A: Archiver, E: Extractor>(
    archiver: &A,
    registry: &FormatRegistry<E>,
    item: WorkItem,
    tx: mpsc::UnboundedSender<WorkerMsg>,
    cancellation_token: CancellationToken,
) {
    // Best-effort `Status` sends (here and below): every one of these carries a
    // terminal/load-bearing event. A failed send means the aggregator already tore
    // down during teardown; the dropped terminal status is then reconstructed by
    // `into_summary`'s state reconciliation (a non-terminal task is classified from
    // its final `TaskStatus`), so `succeeded + cancelled + failed` stays whole.
    // Not-started cancellation checkpoint: cancel before any extraction/compression.
    if cancellation_token.is_cancelled() {
        let _ = tx.send(WorkerMsg::Status {
            task: item.task,
            event: TaskEvent::Cancel,
        });
        return;
    }

    // rar files extract first; folders compress directly. Emit the extraction
    // status only for sources that actually extract, so the task walks the legal
    // Pending -> Extracting -> Compressing path (folders take the fast-path).
    let needs_extract = matches!(item.source, SourceItem::RarFile(_));
    if needs_extract {
        let _ = tx.send(WorkerMsg::Status {
            task: item.task,
            event: TaskEvent::StartExtracting,
        });
    }

    let prepared = match registry.prepare(&item.source).await {
        Ok(prepared) => prepared,
        Err(e) => {
            let _ = tx.send(WorkerMsg::Status {
                task: item.task,
                event: TaskEvent::Fail {
                    reason: e.to_string(),
                },
            });
            return;
        }
    };

    let _ = tx.send(WorkerMsg::Status {
        task: item.task,
        event: TaskEvent::StartCompressing,
    });
    let reporter = Arc::new(ChannelReporter { tx: tx.clone() });
    let ctx = CompressContext::new(item.task, reporter, cancellation_token);
    let event = match archiver.compress(prepared.dir(), &item.dest, &ctx).await {
        Ok(()) => TaskEvent::Complete,
        Err(ArchiveError::Cancelled) => TaskEvent::Cancel,
        Err(e) => TaskEvent::Fail {
            reason: e.to_string(),
        },
    };
    let _ = tx.send(WorkerMsg::Status {
        task: item.task,
        event,
    });
    // `prepared` drops here — an extracted rar's temp directory is removed.
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::ArchiveError;
    use crate::application::ports::{ExtractError, ExtractedTree, Extractor};
    use crate::application::progress::{JobProgress, ProgressSink};
    use crate::domain::naming_rule::NamingRule;
    use crate::domain::output_directory::OutputDirectory;
    use std::collections::HashSet;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;

    /// A fake archiver: reports two progress ticks, optionally fails or cancels
    /// outputs by file name, and can rendezvous on a barrier so a test can prove
    /// tasks ran concurrently.
    struct FakeArchiver {
        fail_names: HashSet<String>,
        cancel_names: HashSet<String>,
        barrier: Option<Arc<tokio::sync::Barrier>>,
        calls: Arc<AtomicUsize>,
        live: Arc<AtomicUsize>,
        max_live: Arc<AtomicUsize>,
    }
    impl FakeArchiver {
        fn new() -> Self {
            Self {
                fail_names: HashSet::new(),
                cancel_names: HashSet::new(),
                barrier: None,
                calls: Arc::new(AtomicUsize::new(0)),
                live: Arc::new(AtomicUsize::new(0)),
                max_live: Arc::new(AtomicUsize::new(0)),
            }
        }

        fn call_count(&self) -> Arc<AtomicUsize> {
            self.calls.clone()
        }
    }
    impl Archiver for FakeArchiver {
        async fn compress(
            &self,
            _src: &Path,
            dest: &Path,
            ctx: &CompressContext,
        ) -> Result<(), ArchiveError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.live.fetch_add(1, Ordering::SeqCst);
            ctx.report(5, 10);
            if let Some(b) = &self.barrier {
                b.wait().await;
            }
            // Sample peak concurrency at the rendezvous: when a Barrier(N) releases, all
            // N workers are provably inside compress simultaneously.
            self.max_live
                .fetch_max(self.live.load(Ordering::SeqCst), Ordering::SeqCst);
            ctx.report(10, 10);
            self.live.fetch_sub(1, Ordering::SeqCst);
            let name = dest.file_name().unwrap().to_string_lossy().to_string();
            if self.cancel_names.contains(&name) {
                Err(ArchiveError::Cancelled)
            } else if self.fail_names.contains(&name) {
                Err(ArchiveError::Backend("boom".to_string()))
            } else {
                Ok(())
            }
        }
    }

    /// A fake extracted tree over a real temp dir.
    struct FakeTree {
        dir: tempfile::TempDir,
    }
    impl ExtractedTree for FakeTree {
        fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    /// A fake extractor: records calls, optionally fails for given rar file names.
    struct FakeExtractor {
        fail_names: HashSet<String>,
        calls: Arc<AtomicUsize>,
    }
    impl FakeExtractor {
        fn new() -> Self {
            Self {
                fail_names: HashSet::new(),
                calls: Arc::new(AtomicUsize::new(0)),
            }
        }
    }
    impl Extractor for FakeExtractor {
        async fn extract(&self, src: &Path) -> Result<Box<dyn ExtractedTree>, ExtractError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let name = src.file_name().unwrap().to_string_lossy().to_string();
            if self.fail_names.contains(&name) {
                return Err(ExtractError::Backend("extract boom".to_string()));
            }
            Ok(Box::new(FakeTree {
                dir: tempfile::tempdir().unwrap(),
            }))
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
    async fn cancellation_before_compression_cancels_tasks_without_calling_archiver() {
        let job = folder_job(3);
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let fake = Arc::new(FakeArchiver::new());
        let calls = fake.call_count();
        let engine = RunArchiveJob::new(fake, Arc::new(FakeExtractor::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let cancel = CancellationToken::new();
        cancel.cancel();

        let summary = engine
            .execute_with_cancellation(job, &clock, &sink, cancel)
            .await;

        assert_eq!(summary.cancelled, ids);
        assert!(summary.succeeded.is_empty());
        assert!(summary.failed.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn rar_task_cancelled_before_start_emits_cancel_and_does_not_extract() {
        let job = ArchiveJob::plan(
            vec![SourceItem::RarFile(PathBuf::from("a.rar"))],
            NamingRule::parse("f{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let extractor = Arc::new(FakeExtractor::new());
        let calls = extractor.calls.clone();
        let engine = RunArchiveJob::new(Arc::new(FakeArchiver::new()), extractor, nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let cancel = CancellationToken::new();
        cancel.cancel();

        let summary = engine
            .execute_with_cancellation(job, &clock, &sink, cancel)
            .await;

        // The not-started checkpoint short-circuits before `registry.prepare`, so the
        // rar task ends Cancelled (not failed/succeeded) and the extractor is never run.
        assert_eq!(summary.cancelled, ids);
        assert!(summary.succeeded.is_empty());
        assert!(summary.failed.is_empty());
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "extractor must not be called when cancelled before start"
        );
    }

    #[tokio::test]
    async fn all_folders_succeed_and_are_tallied() {
        let job = folder_job(3);
        let mut expected: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        expected.sort_by_key(|i| i.get());
        let engine =
            RunArchiveJob::new(Arc::new(FakeArchiver::new()), Arc::new(FakeExtractor::new()), nz(2));
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
        let engine = RunArchiveJob::new(Arc::new(fake), Arc::new(FakeExtractor::new()), nz(2));
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
    async fn archiver_cancelled_error_is_summarized_as_cancelled_not_failed() {
        let job = folder_job(3); // outputs f1.zip, f2.zip, f3.zip
        let id: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let mut fake = FakeArchiver::new();
        fake.cancel_names.insert("f2.zip".to_string());
        let engine = RunArchiveJob::new(Arc::new(fake), Arc::new(FakeExtractor::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());

        let summary = engine.execute(job, &clock, &sink).await;

        let mut succeeded = summary.succeeded.clone();
        succeeded.sort_by_key(|i| i.get());
        assert_eq!(succeeded, vec![id[0], id[2]]);
        assert_eq!(summary.cancelled, vec![id[1]]);
        assert!(summary.failed.is_empty());
    }

    /// Fires an externally-owned token from inside `compress` for one designated
    /// output, then re-checks `ctx.is_cancelled()` to return `Cancelled` — proving
    /// the live token threads through run_one -> CompressContext -> archiver via
    /// `ctx`, NOT via the engine's pre-start `cancel_names` path.
    ///
    /// To keep the cancelled/succeeded split deterministic, the cancel target waits
    /// on a `Notify` until the sibling has finished compressing before firing the
    /// token. That ordering guarantees the sibling's pre-start cancellation check
    /// (in `run_one`) runs while the token is still un-fired, so the sibling always
    /// reaches `Complete`; only the target observes the live token.
    struct LiveCancelArchiver {
        token: CancellationToken,
        cancel_target: String,
        sibling_done: Arc<tokio::sync::Notify>,
    }
    impl Archiver for LiveCancelArchiver {
        async fn compress(
            &self,
            _src: &Path,
            dest: &Path,
            ctx: &CompressContext,
        ) -> Result<(), ArchiveError> {
            let name = dest.file_name().unwrap().to_string_lossy().to_string();
            if name == self.cancel_target {
                // Wait until the sibling has completed so firing the token cannot
                // race the sibling's pre-start cancellation check.
                self.sibling_done.notified().await;
                // Simulate an external cancel landing after this task has started.
                self.token.cancel();
                // Read cancellation ONLY through the context the engine wired up.
                if ctx.is_cancelled() {
                    return Err(ArchiveError::Cancelled);
                }
                Ok(())
            } else {
                // The sibling ignores cancellation and always succeeds, then signals
                // the target it may fire the token.
                self.sibling_done.notify_one();
                Ok(())
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn live_token_fired_mid_run_cancels_in_progress_task_via_ctx() {
        let job = folder_job(2); // outputs f1.zip (sibling), f2.zip (cancel target)
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let token = CancellationToken::new();
        let archiver = Arc::new(LiveCancelArchiver {
            token: token.clone(),
            cancel_target: "f2.zip".to_string(),
            sibling_done: Arc::new(tokio::sync::Notify::new()),
        });
        // parallelism 2 so the target can be in `compress` (awaiting the sibling)
        // while the sibling runs to completion; `Notify::notify_one` is sticky, so
        // the order in which the two enter `compress` does not matter.
        let engine = RunArchiveJob::new(archiver, Arc::new(FakeExtractor::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());

        let summary = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            engine.execute_with_cancellation(job, &clock, &sink, token),
        )
        .await
        .expect("must not deadlock");

        // The in-progress task that observed the live token via `ctx` is cancelled.
        assert_eq!(summary.cancelled, vec![ids[1]]);
        // A sibling still completes, proving the live token did not tear down the
        // whole job — only the task that read `ctx.is_cancelled()` ended cancelled.
        assert!(
            !summary.succeeded.is_empty(),
            "a sibling task must still complete"
        );
        assert_eq!(summary.succeeded, vec![ids[0]]);
        assert!(summary.failed.is_empty());
    }

    #[tokio::test]
    async fn rar_item_extracts_then_compresses_and_succeeds() {
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
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();

        let extractor = Arc::new(FakeExtractor::new());
        let calls = extractor.calls.clone();
        let engine = RunArchiveJob::new(Arc::new(FakeArchiver::new()), extractor, nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());

        let summary = engine.execute(job, &clock, &sink).await;

        // Both tasks succeed; reaching Completed proves the rar task walked the
        // legal Pending -> Extracting -> Compressing -> Completed sequence (an
        // out-of-order event would trip the engine's debug_assert).
        let mut succeeded = summary.succeeded.clone();
        succeeded.sort_by_key(|i| i.get());
        let mut expected = ids.clone();
        expected.sort_by_key(|i| i.get());
        assert_eq!(succeeded, expected);
        assert!(summary.failed.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 1, "exactly the rar task extracts");
    }

    #[tokio::test]
    async fn rar_extract_failure_fails_only_its_task() {
        let items = vec![
            SourceItem::Folder(PathBuf::from("dir0")),
            SourceItem::RarFile(PathBuf::from("bad.rar")),
        ];
        let job = ArchiveJob::plan(
            items,
            NamingRule::parse("f{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();

        let mut fake_extractor = FakeExtractor::new();
        fake_extractor.fail_names.insert("bad.rar".to_string());
        let engine =
            RunArchiveJob::new(Arc::new(FakeArchiver::new()), Arc::new(fake_extractor), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());

        let summary = engine.execute(job, &clock, &sink).await;

        assert_eq!(summary.succeeded, vec![ids[0]]);
        assert_eq!(summary.failed.len(), 1);
        assert_eq!(summary.failed[0].0, ids[1]);
        assert_eq!(summary.failed[0].1, "unrar error: extract boom");
    }

    #[tokio::test]
    async fn emits_progress_snapshots_tallying_overall() {
        let job = folder_job(2);
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();
        let engine =
            RunArchiveJob::new(Arc::new(FakeArchiver::new()), Arc::new(FakeExtractor::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        engine.execute(job, &clock, &sink).await;
        let snaps = sink.0.lock().unwrap();
        assert!(!snaps.is_empty(), "expected progress snapshots");
        let last = snaps.last().unwrap();
        // Both tasks finish at 10/10 -> overall 20/20.
        assert_eq!(last.overall, TaskProgress::new(20, 20));
        assert_eq!(last.per_task.len(), 2);
        let snap_ids: Vec<TaskId> = last.per_task.iter().map(|(id, _)| *id).collect();
        assert_eq!(snap_ids, ids, "per_task must follow job task order");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn runs_tasks_in_parallel_up_to_the_limit() {
        let job = folder_job(2);
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let mut fake = FakeArchiver::new();
        fake.barrier = Some(barrier.clone());
        let max_live = fake.max_live.clone();
        let engine = RunArchiveJob::new(Arc::new(fake), Arc::new(FakeExtractor::new()), nz(2));
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn parallelism_cap_is_respected() {
        // 4 tasks, limit 2: a Barrier(2) lets exactly two workers rendezvous at a
        // time, so true concurrency reaches the cap; if the engine ignored the
        // limit (e.g. Semaphore sized to the task count) max_live would exceed 2.
        let job = folder_job(4);
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let mut fake = FakeArchiver::new();
        fake.barrier = Some(barrier.clone());
        let max_live = fake.max_live.clone();
        let engine = RunArchiveJob::new(Arc::new(fake), Arc::new(FakeExtractor::new()), nz(2));
        let sink = RecordingSink::default();
        let clock = FixedClock(Instant::now());
        let summary = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            engine.execute(job, &clock, &sink),
        )
        .await
        .expect("must not deadlock");
        assert_eq!(summary.succeeded.len(), 4);
        assert_eq!(
            max_live.load(Ordering::SeqCst),
            2,
            "must never exceed the parallelism limit"
        );
    }
}
