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
    /// Samples older than `now - window` are evicted, but at least the most
    /// recent two are always retained, so a stall longer than `window` still
    /// leaves an interval to measure (its throughput simply trends toward zero).
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

    /// Estimate time remaining to process `bytes_remaining`, or `None` when
    /// throughput cannot be determined (fewer than two samples, zero elapsed
    /// across the window, or no byte progress across the window).
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
    use crate::application::progress::JobProgress;
    use crate::domain::task_progress::TaskProgress;

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
