//! `EtaEstimator`: a pure, sliding-time-window throughput estimator, plus
//! `EtaTracker` which owns one estimator per progress track (overall + each
//! task) and annotates a `JobProgress` snapshot with ETAs.
//!
//! The estimator is clock-agnostic — the caller supplies `now` (the engine reads
//! it from the `Clock` port), so tests drive it deterministically with
//! hand-built `Instant`s. Throughput is averaged over the last `window` only
//! (a true moving average), which keeps the ETA responsive to the irregular
//! per-zip-entry tick cadence rather than a whole-run average.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::application::progress::JobProgress;
use crate::domain::archive_task::TaskId;

/// Window over which throughput is averaged for ETA. Tunable.
pub const ETA_WINDOW: Duration = Duration::from_secs(3);

/// Sliding-window moving-average throughput estimator.
#[derive(Debug)]
pub struct EtaEstimator {
    window: Duration,
    /// `(observed_at, cumulative_bytes_done)`, oldest at the front.
    samples: VecDeque<(Instant, u64)>,
}

impl EtaEstimator {
    /// Create an estimator that averages throughput over the last `window`.
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            samples: VecDeque::new(),
        }
    }

    /// Record a cumulative `bytes_done` reading observed at `now`.
    ///
    /// Callers must pass monotonically non-decreasing `now` and `bytes_done`;
    /// out-of-order input is tolerated (saturating arithmetic) but yields a
    /// conservative or `None` estimate.
    ///
    /// Samples older than `now - window` are evicted, but at least the two most
    /// recent samples are always retained. While progress is merely *slowing*,
    /// throughput drops and ETA grows; once progress *fully stalls* (no byte
    /// delta across the retained interval), `eta()` returns `None`.
    pub fn observe(&mut self, now: Instant, bytes_done: u64) {
        self.samples.push_back((now, bytes_done));
        if let Some(cutoff) = now.checked_sub(self.window) {
            // Drop a stale front sample only while the next one is still old
            // enough to anchor the window start; never shrink below two samples.
            while self.samples.len() > 2 && self.samples[1].0 <= cutoff {
                self.samples.pop_front();
            }
        }
    }

    /// Estimate time remaining to process `bytes_remaining`.
    ///
    /// Returns `Some(Duration::ZERO)` immediately when `bytes_remaining == 0`.
    /// Otherwise returns `None` when throughput cannot be determined: fewer than
    /// two samples, zero elapsed across the window, or no byte progress across
    /// the window (full stall).
    pub fn eta(&self, bytes_remaining: u64) -> Option<Duration> {
        if bytes_remaining == 0 {
            return Some(Duration::ZERO);
        }
        if self.samples.len() < 2 {
            return None;
        }
        let (t0, b0) = *self.samples.front().unwrap();
        let (t1, b1) = *self.samples.back().unwrap();
        let dt = t1.saturating_duration_since(t0).as_secs_f64();
        let db = b1.saturating_sub(b0);
        if dt <= 0.0 || db == 0 {
            return None;
        }
        let throughput = db as f64 / dt; // bytes per second
        let secs = bytes_remaining as f64 / throughput;
        // Guard NaN / inf / negative / overflow — Duration::try_from_secs_f64
        // returns Err for non-finite or out-of-range values.
        if !secs.is_finite() || secs < 0.0 {
            return None;
        }
        Duration::try_from_secs_f64(secs).ok()
    }
}

/// Owns one `EtaEstimator` per track (overall + each task) and annotates a
/// `JobProgress` snapshot with ETAs in place. Created fresh per job run (it lives
/// on the engine's `execute` stack), so estimator state resets automatically.
pub struct EtaTracker {
    window: Duration,
    overall: EtaEstimator,
    per_task: HashMap<TaskId, EtaEstimator>,
}

impl EtaTracker {
    /// Create a tracker whose estimators all average over `window`.
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            overall: EtaEstimator::new(window),
            per_task: HashMap::new(),
        }
    }

    /// Observe `progress` as of `now`, filling `overall_eta` and each entry's `eta`.
    pub fn enrich(&mut self, progress: &mut JobProgress, now: Instant) {
        self.overall.observe(now, progress.overall.bytes_done());
        progress.overall_eta = self.overall.eta(progress.overall.remaining());
        for entry in &mut progress.per_task {
            let est = self
                .per_task
                .entry(entry.id)
                .or_insert_with(|| EtaEstimator::new(self.window));
            est.observe(now, entry.progress.bytes_done());
            entry.eta = est.eta(entry.progress.remaining());
        }
    }
}

#[cfg(test)]
mod tracker_tests {
    use super::*;
    use crate::application::progress::{JobProgress, TaskProgressEntry};
    use crate::domain::archive_job::ArchiveJob;
    use crate::domain::naming_rule::NamingRule;
    use crate::domain::output_directory::OutputDirectory;
    use crate::domain::source_item::SourceItem;
    use crate::domain::task_progress::TaskProgress;
    use std::path::PathBuf;

    /// Build a two-task job; return the job and the two task ids in plan order.
    fn two_task_job() -> (ArchiveJob, [crate::domain::archive_task::TaskId; 2]) {
        let items = vec![
            SourceItem::Folder(PathBuf::from("dir0")),
            SourceItem::Folder(PathBuf::from("dir1")),
        ];
        let job = ArchiveJob::plan(
            items,
            NamingRule::parse("f{n}").unwrap(),
            OutputDirectory::new(PathBuf::from("/out")),
        )
        .unwrap();
        let ids = [job.tasks()[0].id(), job.tasks()[1].id()];
        (job, ids)
    }

    /// Build a `JobProgress` snapshot with two per-task entries at the given
    /// byte counters (total is fixed at 100 for each task).
    fn snapshot_with(
        ids: &[crate::domain::archive_task::TaskId; 2],
        done0: u64,
        done1: u64,
    ) -> JobProgress {
        JobProgress {
            overall: TaskProgress::new(done0 + done1, 200),
            overall_eta: None,
            per_task: vec![
                TaskProgressEntry {
                    id: ids[0],
                    progress: TaskProgress::new(done0, 100),
                    eta: None,
                },
                TaskProgressEntry {
                    id: ids[1],
                    progress: TaskProgress::new(done1, 100),
                    eta: None,
                },
            ],
            elapsed: Duration::ZERO,
        }
    }

    #[cfg(not(loom))]
    #[test]
    fn per_task_etas_are_independent_and_reflect_each_tasks_rate() {
        // Task 0 advances slowly (5 B/s) and task 1 advances quickly (20 B/s).
        // After two enrich calls with distinct `now` values and distinct byte
        // counts, each entry's `eta` must be `Some` and they must DIFFER,
        // proving the per-task estimators are independent (not sharing the
        // overall estimator).
        let (_job, ids) = two_task_job();
        let base = Instant::now();
        let mut tracker = EtaTracker::new(Duration::from_secs(60));

        // First observation: both tasks at 0 bytes done.
        let mut first = snapshot_with(&ids, 0, 0);
        tracker.enrich(&mut first, base);
        // Only one sample per estimator -> no ETA yet.
        assert!(
            first.per_task[0].eta.is_none(),
            "one sample: no per-task ETA yet"
        );
        assert!(
            first.per_task[1].eta.is_none(),
            "one sample: no per-task ETA yet"
        );

        // Second observation 1 second later:
        //   task 0: 5 bytes done  -> 5 B/s, 95 remaining -> 19 s ETA
        //   task 1: 20 bytes done -> 20 B/s, 80 remaining -> 4 s ETA
        let t1 = base + Duration::from_secs(1);
        let mut second = snapshot_with(&ids, 5, 20);
        tracker.enrich(&mut second, t1);

        let eta0 = second.per_task[0].eta;
        let eta1 = second.per_task[1].eta;
        assert!(
            eta0.is_some(),
            "task 0 must have a per-task ETA after two observations"
        );
        assert!(
            eta1.is_some(),
            "task 1 must have a per-task ETA after two observations"
        );
        assert_ne!(
            eta0, eta1,
            "per-task ETAs must differ when tasks advance at different rates"
        );
        // Sanity-check the magnitudes: task 0 should be slower (larger ETA).
        assert!(
            eta0.unwrap() > eta1.unwrap(),
            "task 0 (5 B/s) must have a larger ETA than task 1 (20 B/s)"
        );
    }

    #[test]
    fn enrich_fills_overall_eta_from_advancing_observations() {
        let base = Instant::now();
        let mut tracker = EtaTracker::new(Duration::from_secs(60));

        let mut first = JobProgress {
            overall: TaskProgress::new(0, 100),
            overall_eta: None,
            per_task: Vec::new(),
            elapsed: Duration::ZERO,
        };
        tracker.enrich(&mut first, base);
        assert_eq!(first.overall_eta, None, "one sample -> no ETA yet");

        let mut second = JobProgress {
            overall: TaskProgress::new(10, 100),
            overall_eta: None,
            per_task: Vec::new(),
            elapsed: Duration::from_secs(1),
        };
        tracker.enrich(&mut second, base + Duration::from_secs(1));
        // 10 B/s, 90 remaining -> 9s.
        assert_eq!(second.overall_eta, Some(Duration::from_secs(9)));
    }
}

#[cfg(test)]
mod estimator_tests {
    use super::*;

    fn at(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn fewer_than_two_samples_has_no_eta() {
        let mut e = EtaEstimator::new(ETA_WINDOW);
        assert_eq!(e.eta(100), None);
        e.observe(Instant::now(), 0);
        assert_eq!(e.eta(100), None);
    }

    #[test]
    fn constant_throughput_yields_remaining_over_rate() {
        // 10 bytes over 1s = 10 B/s; 100 remaining -> 10s.
        let base = Instant::now();
        let mut e = EtaEstimator::new(Duration::from_secs(60));
        e.observe(at(base, 0), 0);
        e.observe(at(base, 1000), 10);
        assert_eq!(e.eta(100), Some(Duration::from_secs(10)));
    }

    #[test]
    fn sliding_window_reflects_recent_rate_not_whole_history() {
        // Slow first second (1 B/s), then fast (100 B/s) inside a 1s window.
        // After eviction, only the fast tail anchors the rate.
        let base = Instant::now();
        let mut e = EtaEstimator::new(Duration::from_secs(1));
        e.observe(at(base, 0), 0); // evicted once the window slides
        e.observe(at(base, 1000), 1);
        e.observe(at(base, 1500), 51);
        e.observe(at(base, 2000), 101); // window now [1000ms..2000ms]
                                        // Recent window: 100 bytes over 1s = 100 B/s; 200 remaining -> 2s.
        assert_eq!(e.eta(200), Some(Duration::from_secs(2)));
    }

    #[test]
    fn flat_progress_has_no_eta() {
        let base = Instant::now();
        let mut e = EtaEstimator::new(Duration::from_secs(60));
        e.observe(at(base, 0), 42);
        e.observe(at(base, 1000), 42);
        assert_eq!(e.eta(100), None);
    }

    #[test]
    fn zero_elapsed_between_samples_has_no_eta() {
        let now = Instant::now();
        let mut e = EtaEstimator::new(Duration::from_secs(60));
        e.observe(now, 0);
        e.observe(now, 50);
        assert_eq!(e.eta(100), None);
    }

    #[test]
    fn zero_remaining_is_zero_eta() {
        let mut e = EtaEstimator::new(ETA_WINDOW);
        e.observe(Instant::now(), 0);
        assert_eq!(e.eta(0), Some(Duration::ZERO));
    }
}
