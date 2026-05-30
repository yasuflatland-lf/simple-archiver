//! Bridge between the core [`ProgressSink`] port and Tauri frontend events.
//!
//! The [`ProgressEmitter`] trait is a testability seam: production code uses
//! [`TauriEmitter`] (which wraps an [`AppHandle`]), while tests use
//! [`RecordingEmitter`] (or any other double) without needing a live Tauri
//! application. `TauriEmitter` is intentionally NOT tested directly here — it
//! requires a real `AppHandle`, and the seam is exactly what lets callers
//! avoid that coupling in unit tests.

use crate::presentation::dto::{ProgressEvent, PROGRESS_EVENT};
use simple_archiver_core::application::progress::{JobProgress, ProgressSink};
use tauri::{AppHandle, Emitter};

// ─────────────────────────────────────────────────────────────────────────────
// ProgressEmitter (seam)
// ─────────────────────────────────────────────────────────────────────────────

/// A testability seam for emitting progress events to the frontend.
///
/// Production code uses [`TauriEmitter`]; tests use a recording double. The
/// seam decouples [`EventSink`] from the Tauri runtime so unit tests do not
/// need a live [`AppHandle`].
pub trait ProgressEmitter: Send + Sync {
    /// Emit a single progress snapshot to the frontend.
    fn emit_progress(&self, ev: &ProgressEvent);
}

// ─────────────────────────────────────────────────────────────────────────────
// TauriEmitter
// ─────────────────────────────────────────────────────────────────────────────

/// Production [`ProgressEmitter`] that forwards events to the Tauri frontend
/// via [`AppHandle::emit`].
///
/// Emit failures are silently discarded — a missed progress tick must never
/// abort the running archive job.
pub struct TauriEmitter {
    app: AppHandle,
}

impl TauriEmitter {
    /// Wrap an [`AppHandle`] into a [`TauriEmitter`].
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl ProgressEmitter for TauriEmitter {
    fn emit_progress(&self, ev: &ProgressEvent) {
        // Best-effort: a failed emit must not propagate to the caller.
        let _ = self.app.emit(PROGRESS_EVENT, ev);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EventSink
// ─────────────────────────────────────────────────────────────────────────────

/// Adapts a [`ProgressEmitter`] into the core [`ProgressSink`] port.
///
/// [`EventSink`] bridges the boundary between the engine's outbound progress
/// port and whatever emission strategy the presentation layer provides.
pub struct EventSink<'a> {
    emitter: &'a dyn ProgressEmitter,
}

impl<'a> EventSink<'a> {
    /// Create a new sink that delegates to `emitter`.
    pub fn new(emitter: &'a dyn ProgressEmitter) -> Self {
        Self { emitter }
    }
}

impl ProgressSink for EventSink<'_> {
    fn report(&self, snapshot: JobProgress) {
        self.emitter.emit_progress(&ProgressEvent::from(&snapshot));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use simple_archiver_core::domain::task_progress::TaskProgress;
    use std::sync::Mutex;
    use std::time::Duration;

    // ── RecordingEmitter (test double) ────────────────────────────────────────

    /// A [`ProgressEmitter`] test double that records every emitted event.
    ///
    /// Used in place of [`TauriEmitter`] so tests never need a real
    /// [`AppHandle`].
    #[derive(Default)]
    struct RecordingEmitter(Mutex<Vec<ProgressEvent>>);

    impl ProgressEmitter for RecordingEmitter {
        fn emit_progress(&self, ev: &ProgressEvent) {
            self.0.lock().unwrap().push(ev.clone());
        }
    }

    // ── EventSink → ProgressEmitter wiring ───────────────────────────────────

    /// `EventSink::report` converts a [`JobProgress`] snapshot into a
    /// [`ProgressEvent`] and forwards it to the underlying emitter exactly once.
    #[test]
    fn event_sink_report_emits_one_progress_event_with_correct_fields() {
        let recorder = RecordingEmitter::default();
        let sink = EventSink::new(&recorder);

        sink.report(JobProgress {
            overall: TaskProgress::new(5, 10),
            per_task: vec![],
            elapsed: Duration::from_millis(42),
        });

        let recorded = recorder.0.lock().unwrap();
        assert_eq!(recorded.len(), 1, "exactly one event must be emitted");

        let ev = &recorded[0];
        assert_eq!(ev.overall.bytes_done, 5);
        assert_eq!(ev.overall.bytes_total, 10);
        assert_eq!(ev.elapsed_ms, 42);
        assert!(ev.per_task.is_empty(), "per_task must be empty");
    }
}
