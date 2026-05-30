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
    pub(crate) fn apply_event(&mut self, event: TaskEvent) -> Result<(), IllegalTransition> {
        self.status = self.status.clone().apply(event)?;
        Ok(())
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
