//! The stable task identity and the archive-task entity.

use crate::domain::file_name::OutputFileName;
use crate::domain::source_item::SourceItem;
use crate::domain::task_progress::TaskProgress;
use crate::domain::task_status::{IllegalTransition, TaskEvent, TaskStatus};

// ─────────────────────────────────────────────────────────────────────────────
// TaskId
// ─────────────────────────────────────────────────────────────────────────────

/// A stable, opaque task identity assigned at plan time by [`crate::domain::archive_job`].
///
/// External callers obtain a `TaskId` from [`ArchiveTask::id`]; only in-crate
/// code (specifically `ArchiveJob`) may construct one directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TaskId(u32);

impl TaskId {
    /// Create a new `TaskId` with the given raw value.
    ///
    /// This constructor is crate-internal so that only `ArchiveJob` assigns ids;
    /// external callers must obtain a `TaskId` from [`ArchiveTask::id`].
    pub(crate) fn new(value: u32) -> Self {
        Self(value)
    }

    /// Return the underlying `u32` value.
    pub fn get(self) -> u32 {
        self.0
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ArchiveTask
// ─────────────────────────────────────────────────────────────────────────────

/// An entity representing a single archive operation within an [`crate::domain::archive_job::ArchiveJob`].
///
/// All fields are private; callers read state through the public accessors and
/// mutate it only through the crate-internal `apply_event` / `set_output_name`
/// methods, ensuring the aggregate root (`ArchiveJob`) controls all writes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveTask {
    id: TaskId,
    source: SourceItem,
    output_name: OutputFileName,
    status: TaskStatus,
    progress: TaskProgress,
}

impl ArchiveTask {
    /// Create a new `ArchiveTask` in the [`TaskStatus::Pending`] state with
    /// zero progress.
    ///
    /// This constructor is crate-internal; only `ArchiveJob` builds tasks.
    pub(crate) fn new(id: TaskId, source: SourceItem, output_name: OutputFileName) -> Self {
        Self {
            id,
            source,
            output_name,
            status: TaskStatus::Pending,
            progress: TaskProgress::zero(),
        }
    }

    // ── Public read-only accessors ────────────────────────────────────────────

    /// Return the stable identity of this task.
    pub fn id(&self) -> TaskId {
        self.id
    }

    /// Return a reference to the source item for this task.
    pub fn source(&self) -> &SourceItem {
        &self.source
    }

    /// Return a reference to the intended output filename.
    pub fn output_name(&self) -> &OutputFileName {
        &self.output_name
    }

    /// Return a reference to the current lifecycle status.
    pub fn status(&self) -> &TaskStatus {
        &self.status
    }

    /// Return a reference to the current byte-level progress.
    pub fn progress(&self) -> &TaskProgress {
        &self.progress
    }

    // ── Crate-internal mutators ───────────────────────────────────────────────

    /// Replace the output filename.
    ///
    /// Used by `ArchiveJob` during reordering to restore each position's output
    /// name after the task objects are swapped between positions.
    pub(crate) fn set_output_name(&mut self, name: OutputFileName) {
        self.output_name = name;
    }

    /// Advance the task status by applying `event`.
    ///
    /// On a legal transition the status is updated and `Ok(())` is returned.
    /// On an illegal transition an [`IllegalTransition`] error is returned and
    /// the status is left **unchanged**.
    ///
    /// Uses `std::mem::replace` so the happy path performs zero heap allocations:
    /// the current status is moved out, consumed by `TaskStatus::apply`, and the
    /// next status is written back directly.  Only the rare error path clones
    /// (to restore `err.from` as the canonical "status unchanged" invariant).
    pub(crate) fn apply_event(&mut self, event: TaskEvent) -> Result<(), IllegalTransition> {
        // Move the current status out without cloning.
        // `Pending` is a throwaway placeholder: both the `Ok` and `Err` match
        // arms overwrite `self.status` before this function returns, so it is
        // never observable as a real state.
        let prev = std::mem::replace(&mut self.status, TaskStatus::Pending);
        match prev.apply(event) {
            Ok(next) => {
                self.status = next;
                Ok(())
            }
            Err(err) => {
                // Restore the original status; clone only on the (rare) error path.
                self.status = err.from.clone();
                Err(err)
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::domain::file_name::{FileStem, OutputFileName};

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Build a minimal `OutputFileName` suitable for tests.
    fn make_output_name(stem: &str) -> OutputFileName {
        OutputFileName::from_stem(FileStem::new(stem).unwrap())
    }

    /// Build a minimal `SourceItem` suitable for tests.
    fn make_source() -> SourceItem {
        SourceItem::RarFile(std::path::PathBuf::from("a.rar"))
    }

    /// Build a minimal `ArchiveTask` with the given id string.
    fn make_task(id: u32) -> ArchiveTask {
        ArchiveTask::new(TaskId::new(id), make_source(), make_output_name("foo"))
    }

    // ── TaskId ────────────────────────────────────────────────────────────────

    #[test]
    fn task_id_get_returns_value_passed_to_new() {
        let id = TaskId::new(42);
        assert_eq!(id.get(), 42);
    }

    #[test]
    fn task_id_equality_based_on_inner_value() {
        let a = TaskId::new(7);
        let b = TaskId::new(7);
        let c = TaskId::new(8);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn task_id_works_as_hash_set_key() {
        let mut set: HashSet<TaskId> = HashSet::new();
        let id1 = TaskId::new(1);
        let id2 = TaskId::new(2);
        let id1_dup = TaskId::new(1);

        set.insert(id1);
        set.insert(id2);
        set.insert(id1_dup); // duplicate — should not increase the count

        assert_eq!(set.len(), 2, "HashSet should deduplicate equal TaskIds");
        assert!(set.contains(&TaskId::new(1)));
        assert!(set.contains(&TaskId::new(2)));
    }

    #[test]
    fn task_id_is_copy() {
        let id = TaskId::new(99);
        let copied = id; // uses Copy
        assert_eq!(id, copied);
    }

    // ── ArchiveTask::new ──────────────────────────────────────────────────────

    #[test]
    fn new_task_status_is_pending() {
        let task = make_task(1);
        assert_eq!(task.status(), &TaskStatus::Pending);
    }

    #[test]
    fn new_task_progress_is_zero() {
        let task = make_task(1);
        assert_eq!(task.progress(), &TaskProgress::zero());
    }

    #[test]
    fn new_task_id_matches_argument() {
        let task = make_task(5);
        assert_eq!(task.id(), TaskId::new(5));
    }

    #[test]
    fn new_task_source_matches_argument() {
        let source = make_source();
        let task = ArchiveTask::new(TaskId::new(1), source.clone(), make_output_name("bar"));
        assert_eq!(task.source(), &source);
    }

    #[test]
    fn new_task_output_name_matches_argument() {
        let name = make_output_name("my_archive");
        let task = ArchiveTask::new(TaskId::new(1), make_source(), name.clone());
        assert_eq!(task.output_name(), &name);
    }

    // ── apply_event — legal transition ────────────────────────────────────────

    #[test]
    fn apply_start_extracting_from_pending_transitions_to_extracting() {
        let mut task = make_task(1);
        let result = task.apply_event(TaskEvent::StartExtracting);
        assert_eq!(result, Ok(()));
        assert_eq!(task.status(), &TaskStatus::Extracting);
    }

    #[test]
    fn apply_start_compressing_from_pending_transitions_to_compressing_folder_fast_path() {
        let mut task = make_task(1);
        let result = task.apply_event(TaskEvent::StartCompressing);
        assert_eq!(result, Ok(()));
        assert_eq!(task.status(), &TaskStatus::Compressing);
    }

    #[test]
    fn apply_complete_from_compressing_transitions_to_completed() {
        let mut task = make_task(1);
        task.apply_event(TaskEvent::StartCompressing).unwrap();
        let result = task.apply_event(TaskEvent::Complete);
        assert_eq!(result, Ok(()));
        assert_eq!(task.status(), &TaskStatus::Completed);
    }

    #[test]
    fn apply_event_from_non_pending_state_reaches_next_state() {
        // Locks in the mem::replace "placeholder never leaks" contract:
        // a second apply_event starting from a non-Pending state must land on
        // the correct next state, not on the Pending placeholder.
        let mut task = make_task(1);
        // First transition: Pending -> Extracting.
        task.apply_event(TaskEvent::StartExtracting).unwrap();
        assert_eq!(task.status(), &TaskStatus::Extracting);

        // Second transition: Extracting -> Compressing (non-Pending start).
        let result = task.apply_event(TaskEvent::StartCompressing);
        assert_eq!(result, Ok(()));
        assert_eq!(
            task.status(),
            &TaskStatus::Compressing,
            "status must be Compressing, not the Pending placeholder"
        );
    }

    // ── apply_event — illegal transition leaves status unchanged ──────────────

    #[test]
    fn apply_complete_from_pending_returns_err_and_leaves_status_unchanged() {
        let mut task = make_task(1);
        assert_eq!(task.status(), &TaskStatus::Pending);

        let result = task.apply_event(TaskEvent::Complete);

        assert!(
            result.is_err(),
            "Complete from Pending should return an error"
        );
        assert_eq!(
            task.status(),
            &TaskStatus::Pending,
            "status must remain Pending after an illegal transition"
        );
    }

    #[test]
    fn apply_illegal_transition_error_carries_correct_from_and_event() {
        let mut task = make_task(1);
        let result = task.apply_event(TaskEvent::Complete);

        match result {
            Err(IllegalTransition { from, event }) => {
                assert_eq!(from, TaskStatus::Pending);
                assert_eq!(event, TaskEvent::Complete);
            }
            Ok(()) => panic!("expected IllegalTransition error"),
        }
    }

    #[test]
    fn apply_start_extracting_from_completed_is_illegal_and_leaves_status_unchanged() {
        let mut task = make_task(1);
        // Drive to Completed.
        task.apply_event(TaskEvent::StartCompressing).unwrap();
        task.apply_event(TaskEvent::Complete).unwrap();
        assert_eq!(task.status(), &TaskStatus::Completed);

        let result = task.apply_event(TaskEvent::StartExtracting);
        assert!(result.is_err());
        assert_eq!(task.status(), &TaskStatus::Completed);
    }

    #[test]
    fn illegal_transition_from_failed_preserves_original_reason() {
        let mut task = make_task(1);
        task.apply_event(TaskEvent::Fail {
            reason: "boom".to_string(),
        })
        .unwrap();
        assert_eq!(
            task.status(),
            &TaskStatus::Failed {
                reason: "boom".to_string()
            }
        );

        // Complete is illegal from a terminal Failed state.
        let result = task.apply_event(TaskEvent::Complete);
        assert!(result.is_err());
        // The original Failed { reason } must be restored exactly on the error path.
        assert_eq!(
            task.status(),
            &TaskStatus::Failed {
                reason: "boom".to_string()
            }
        );
    }

    // ── set_output_name ───────────────────────────────────────────────────────

    #[test]
    fn set_output_name_replaces_output_name() {
        let mut task = make_task(1);
        let new_name = make_output_name("renamed");
        task.set_output_name(new_name.clone());
        assert_eq!(task.output_name(), &new_name);
    }

    #[test]
    fn set_output_name_leaves_id_unchanged() {
        let mut task = make_task(3);
        task.set_output_name(make_output_name("other"));
        assert_eq!(task.id(), TaskId::new(3));
    }

    #[test]
    fn set_output_name_leaves_status_unchanged() {
        let mut task = make_task(1);
        task.apply_event(TaskEvent::StartExtracting).unwrap();
        task.set_output_name(make_output_name("other"));
        assert_eq!(task.status(), &TaskStatus::Extracting);
    }

    #[test]
    fn set_output_name_leaves_progress_unchanged() {
        let mut task = make_task(1);
        task.set_output_name(make_output_name("other"));
        assert_eq!(task.progress(), &TaskProgress::zero());
    }
}
