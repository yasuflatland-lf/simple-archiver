//! The event-driven status state machine for a single archive task.

/// Represents the current lifecycle state of a single archive task.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    /// Task is queued but has not started yet.
    Pending,
    /// Source archive is being extracted.
    Extracting,
    /// Extracted contents (or the folder directly) are being compressed.
    Compressing,
    /// Task finished successfully.
    Completed,
    /// Task failed with the given reason.
    Failed { reason: String },
    /// Task was cancelled before completion.
    Cancelled,
}

/// Events that drive state transitions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskEvent {
    /// Begin extraction of a source archive.
    StartExtracting,
    /// Begin compression (may come directly from Pending for the folder fast-path).
    StartCompressing,
    /// The compression step finished successfully.
    Complete,
    /// An error occurred; carries a human-readable description.
    Fail { reason: String },
    /// The user (or the system) cancelled the task.
    Cancel,
}

/// Error returned when an event is applied to a state that does not accept it.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("illegal task transition from {from:?} on {event:?}")]
pub struct IllegalTransition {
    /// The state the task was in when the illegal event arrived.
    pub from: TaskStatus,
    /// The event that was rejected.
    pub event: TaskEvent,
}

impl TaskStatus {
    /// Apply `event` to the current state, returning the next state or an
    /// [`IllegalTransition`] error if the combination is not permitted.
    ///
    /// Terminal states (`Completed`, `Failed`, `Cancelled`) reject every event.
    pub fn apply(self, event: TaskEvent) -> Result<TaskStatus, IllegalTransition> {
        match (self, event) {
            // ── Legal forward transitions ──────────────────────────────────
            (TaskStatus::Pending, TaskEvent::StartExtracting) => Ok(TaskStatus::Extracting),
            // Folder fast-path: a folder needs no extraction.
            (TaskStatus::Pending, TaskEvent::StartCompressing) => Ok(TaskStatus::Compressing),
            (TaskStatus::Extracting, TaskEvent::StartCompressing) => Ok(TaskStatus::Compressing),
            (TaskStatus::Compressing, TaskEvent::Complete) => Ok(TaskStatus::Completed),

            // ── Fail from any non-terminal state ──────────────────────────
            (
                TaskStatus::Pending | TaskStatus::Extracting | TaskStatus::Compressing,
                TaskEvent::Fail { reason },
            ) => Ok(TaskStatus::Failed { reason }),

            // ── Cancel from any non-terminal state ────────────────────────
            (
                TaskStatus::Pending | TaskStatus::Extracting | TaskStatus::Compressing,
                TaskEvent::Cancel,
            ) => Ok(TaskStatus::Cancelled),

            // ── Everything else is illegal ────────────────────────────────
            (from, event) => Err(IllegalTransition { from, event }),
        }
    }

    /// Returns `true` when no further transitions are possible.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            TaskStatus::Completed | TaskStatus::Failed { .. } | TaskStatus::Cancelled
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Assert that `state.apply(event)` succeeds and equals `expected`.
    fn assert_transition(state: TaskStatus, event: TaskEvent, expected: TaskStatus) {
        let result = state.apply(event.clone());
        assert_eq!(
            result,
            Ok(expected),
            "expected Ok transition from state via {event:?}"
        );
    }

    /// Assert that `state.apply(event)` returns the matching `IllegalTransition`.
    fn assert_illegal(state: TaskStatus, event: TaskEvent) {
        let from = state.clone();
        let ev = event.clone();
        let result = state.apply(event);
        assert_eq!(
            result,
            Err(IllegalTransition {
                from: from.clone(),
                event: ev.clone()
            }),
            "expected Err(IllegalTransition) from {from:?} on {ev:?}"
        );
    }

    // ── Legal transitions ─────────────────────────────────────────────────────

    #[test]
    fn pending_start_extracting_goes_to_extracting() {
        assert_transition(
            TaskStatus::Pending,
            TaskEvent::StartExtracting,
            TaskStatus::Extracting,
        );
    }

    #[test]
    fn pending_start_compressing_goes_to_compressing_folder_fast_path() {
        // Folder fast-path: no extraction needed.
        assert_transition(
            TaskStatus::Pending,
            TaskEvent::StartCompressing,
            TaskStatus::Compressing,
        );
    }

    #[test]
    fn extracting_start_compressing_goes_to_compressing() {
        assert_transition(
            TaskStatus::Extracting,
            TaskEvent::StartCompressing,
            TaskStatus::Compressing,
        );
    }

    #[test]
    fn compressing_complete_goes_to_completed() {
        assert_transition(
            TaskStatus::Compressing,
            TaskEvent::Complete,
            TaskStatus::Completed,
        );
    }

    // ── Fail transitions (reason is carried through) ──────────────────────────

    #[test]
    fn pending_fail_goes_to_failed_with_reason() {
        let reason = "disk full".to_string();
        assert_transition(
            TaskStatus::Pending,
            TaskEvent::Fail {
                reason: reason.clone(),
            },
            TaskStatus::Failed { reason },
        );
    }

    #[test]
    fn extracting_fail_goes_to_failed_with_reason() {
        let reason = "corrupt archive".to_string();
        assert_transition(
            TaskStatus::Extracting,
            TaskEvent::Fail {
                reason: reason.clone(),
            },
            TaskStatus::Failed { reason },
        );
    }

    #[test]
    fn compressing_fail_goes_to_failed_with_reason() {
        let reason = "permission denied".to_string();
        assert_transition(
            TaskStatus::Compressing,
            TaskEvent::Fail {
                reason: reason.clone(),
            },
            TaskStatus::Failed { reason },
        );
    }

    #[test]
    fn fail_reason_is_preserved_exactly() {
        let reason = "some very specific error message".to_string();
        let result = TaskStatus::Pending
            .apply(TaskEvent::Fail {
                reason: reason.clone(),
            })
            .expect("Fail from Pending should succeed");
        assert_eq!(result, TaskStatus::Failed { reason });
    }

    // ── Cancel transitions ────────────────────────────────────────────────────

    #[test]
    fn pending_cancel_goes_to_cancelled() {
        assert_transition(
            TaskStatus::Pending,
            TaskEvent::Cancel,
            TaskStatus::Cancelled,
        );
    }

    #[test]
    fn extracting_cancel_goes_to_cancelled() {
        assert_transition(
            TaskStatus::Extracting,
            TaskEvent::Cancel,
            TaskStatus::Cancelled,
        );
    }

    #[test]
    fn compressing_cancel_goes_to_cancelled() {
        assert_transition(
            TaskStatus::Compressing,
            TaskEvent::Cancel,
            TaskStatus::Cancelled,
        );
    }

    // ── Illegal transitions from non-terminal states ──────────────────────────

    #[test]
    fn pending_complete_is_illegal() {
        assert_illegal(TaskStatus::Pending, TaskEvent::Complete);
    }

    #[test]
    fn extracting_start_extracting_is_illegal() {
        assert_illegal(TaskStatus::Extracting, TaskEvent::StartExtracting);
    }

    #[test]
    fn compressing_start_extracting_is_illegal() {
        assert_illegal(TaskStatus::Compressing, TaskEvent::StartExtracting);
    }

    #[test]
    fn compressing_start_compressing_is_illegal() {
        assert_illegal(TaskStatus::Compressing, TaskEvent::StartCompressing);
    }

    // ── Terminal states reject ALL five events ────────────────────────────────

    fn all_events() -> Vec<TaskEvent> {
        vec![
            TaskEvent::StartExtracting,
            TaskEvent::StartCompressing,
            TaskEvent::Complete,
            TaskEvent::Fail {
                reason: "irrelevant".to_string(),
            },
            TaskEvent::Cancel,
        ]
    }

    #[test]
    fn completed_rejects_all_events() {
        for event in all_events() {
            assert_illegal(TaskStatus::Completed, event);
        }
    }

    #[test]
    fn failed_rejects_all_events() {
        for event in all_events() {
            assert_illegal(
                TaskStatus::Failed {
                    reason: "prior failure".to_string(),
                },
                event,
            );
        }
    }

    #[test]
    fn cancelled_rejects_all_events() {
        for event in all_events() {
            assert_illegal(TaskStatus::Cancelled, event);
        }
    }

    // ── is_terminal ───────────────────────────────────────────────────────────

    #[test]
    fn pending_is_not_terminal() {
        assert!(!TaskStatus::Pending.is_terminal());
    }

    #[test]
    fn extracting_is_not_terminal() {
        assert!(!TaskStatus::Extracting.is_terminal());
    }

    #[test]
    fn compressing_is_not_terminal() {
        assert!(!TaskStatus::Compressing.is_terminal());
    }

    #[test]
    fn completed_is_terminal() {
        assert!(TaskStatus::Completed.is_terminal());
    }

    #[test]
    fn failed_is_terminal() {
        assert!(TaskStatus::Failed {
            reason: "err".to_string()
        }
        .is_terminal());
    }

    #[test]
    fn cancelled_is_terminal() {
        assert!(TaskStatus::Cancelled.is_terminal());
    }

    // ── IllegalTransition error message ──────────────────────────────────────

    #[test]
    fn illegal_transition_display_contains_from_and_event() {
        let err = IllegalTransition {
            from: TaskStatus::Pending,
            event: TaskEvent::Complete,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("Pending"),
            "error message should mention the source state"
        );
        assert!(
            msg.contains("Complete"),
            "error message should mention the rejected event"
        );
    }
}
