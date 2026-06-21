//! The ArchiveJob aggregate root — planning, reordering, and event application.

use std::collections::HashSet;

use crate::domain::archive_task::{ArchiveTask, TaskId};
use crate::domain::file_name::{FileStem, NameError, OutputFileName};
use crate::domain::naming_rule::NamingRule;
use crate::domain::output_directory::OutputDirectory;
use crate::domain::output_mode::OutputMode;
use crate::domain::sequence_number::SequenceNumber;
use crate::domain::source_item::SourceItem;
use crate::domain::task_status::{IllegalTransition, TaskEvent, TaskStatus};

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/// Reasons an [`ArchiveJob`] cannot be planned from a set of source items.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum PlanError {
    /// The caller supplied no items to archive.
    #[error("an archive job needs at least one item")]
    Empty,
    /// The naming rule could not resolve a valid name for item `#seq`.
    ///
    /// The field named `source` is treated by `thiserror` as the underlying
    /// error source, so `{source}` in the message Displays the inner
    /// [`NameError`]. This is intended.
    #[error("could not resolve a name for item #{seq}: {source}")]
    Resolve {
        /// The 1-based sequence number of the offending item.
        seq: u32,
        /// The underlying naming failure.
        source: NameError,
    },
    /// Two items resolved to the same output filename.
    #[error("two items resolve to the same output name: {name}")]
    DuplicateName {
        /// The colliding filename.
        name: String,
    },
}

/// Reasons a reorder operation cannot be performed.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ReorderError {
    /// No task in the job has the given id.
    #[error("no task with id {0:?}")]
    TaskNotFound(TaskId),
}

/// Reasons applying a lifecycle event to a task in the job fails.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum JobError {
    /// No task in the job has the given id.
    #[error("no task with id {0:?}")]
    TaskNotFound(TaskId),
    /// The event was rejected by the targeted task's state machine.
    #[error(transparent)]
    Illegal(#[from] IllegalTransition),
}

// ─────────────────────────────────────────────────────────────────────────────
// TaskOutcome
// ─────────────────────────────────────────────────────────────────────────────

/// The terminal classification of a single task within a finished job.
///
/// This is the domain projection of a task's final [`TaskStatus`] onto the three
/// buckets a run summary cares about: success, cancellation, and failure. It is a
/// pure value type with full structural equality.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskOutcome {
    /// The task completed successfully.
    Succeeded(TaskId),
    /// The task was cancelled before completion (not a failure).
    Cancelled(TaskId),
    /// The task failed, carrying its reason.
    Failed {
        /// The identity of the failed task.
        id: TaskId,
        /// The human-readable failure reason.
        reason: String,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// ArchiveJob
// ─────────────────────────────────────────────────────────────────────────────

/// Convert a 0-based item index to a 1-based `u32` sequence number.
///
/// Uses `try_from` rather than `as` to make the "no truncation" intent explicit.
/// Any realistic job fits within `u32::MAX` items — allocating that many items
/// would exhaust memory first.
fn seq_index(i: usize) -> u32 {
    u32::try_from(i)
        .expect("job item count fits in u32; allocating that many items exhausts memory first")
        + 1
}

/// The aggregate root coordinating a batch of [`ArchiveTask`]s.
///
/// The job owns the ordered list of tasks, the [`NamingRule`] used to derive
/// their output names, and the [`OutputDirectory`] they will be written to.
///
/// **Position/identity invariant:** the task at position `p` always holds the
/// name `rule.resolve(p + 1)`. This is established by [`ArchiveJob::plan`] and
/// preserved by every reorder: names are position-derived and stay with the
/// position, while each task's id and status travel with the task.
///
/// `ArchiveJob` is a value type with full structural equality: it derives both
/// `PartialEq` and `Eq`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveJob {
    tasks: Vec<ArchiveTask>,
    rule: NamingRule,
    out_dir: OutputDirectory,
    mode: OutputMode,
}

impl ArchiveJob {
    /// Plan a new job from `items`, deriving each task's output name from `rule`.
    ///
    /// Items are numbered 1-based in the order given: item at index `i` gets
    /// `TaskId(i + 1)`, its output name `rule.resolve(SequenceNumber::new(i + 1))`,
    /// and starts `Pending`. The `SequenceNumber` is a transient
    /// argument to name resolution — it is derived from position and is NOT stored
    /// on the task.
    ///
    /// Returns [`PlanError::Empty`] when `items` is empty, [`PlanError::Resolve`]
    /// when the rule cannot produce a valid name for some item, and
    /// [`PlanError::DuplicateName`] when two items collide (a defensive guard;
    /// see [`ArchiveJob::check_unique`]).
    pub fn plan(
        items: Vec<SourceItem>,
        rule: NamingRule,
        out_dir: OutputDirectory,
    ) -> Result<Self, PlanError> {
        if items.is_empty() {
            return Err(PlanError::Empty);
        }

        // Resolve a name for every item, propagating the first resolution error.
        let mut names: Vec<OutputFileName> = Vec::with_capacity(items.len());
        for i in 0..items.len() {
            let seq_n = seq_index(i);
            let seq = SequenceNumber::new(seq_n).expect("seq_n >= 1 because i is 0-based");
            let name = rule
                .resolve(seq)
                .map_err(|source| PlanError::Resolve { seq: seq_n, source })?;
            names.push(name);
        }

        // Defensive uniqueness guard. Via this path names cannot collide (the
        // numbers 1..=N are distinct and rendering is injective), but we still
        // assert it so any future rule change that breaks injectivity surfaces
        // as an error instead of a silent overwrite.
        Self::check_unique(&names)?;

        // Build the tasks, pairing each item with its id and resolved name.
        let tasks = items
            .into_iter()
            .zip(names)
            .enumerate()
            .map(|(i, (source, name))| ArchiveTask::new(TaskId::new(seq_index(i)), source, name))
            .collect();

        Ok(ArchiveJob {
            tasks,
            rule,
            out_dir,
            mode: OutputMode::Zip,
        })
    }

    /// Plan a Folder-mode (extraction) job from `items`.
    ///
    /// Unlike [`plan`], there is no naming rule: each task's output directory is
    /// named after the source (see [`SourceItem::output_stem`]). The task's
    /// `output_name` here is an internal `.zip`-suffixed label, used only by the
    /// shared [`check_unique`] guard; the execution engine derives the real
    /// folder path from the source, not from this label.
    ///
    /// Returns [`PlanError::Empty`] for no items, [`PlanError::Resolve`] when a
    /// source's base name is not a valid cross-platform filename, and
    /// [`PlanError::DuplicateName`] when two sources share a base name.
    ///
    /// [`plan`]: ArchiveJob::plan
    /// [`check_unique`]: ArchiveJob::check_unique
    pub fn plan_extract(
        items: Vec<SourceItem>,
        out_dir: OutputDirectory,
    ) -> Result<Self, PlanError> {
        if items.is_empty() {
            return Err(PlanError::Empty);
        }

        let mut names: Vec<OutputFileName> = Vec::with_capacity(items.len());
        for (i, item) in items.iter().enumerate() {
            let seq = seq_index(i);
            let stem = FileStem::new(&item.output_stem())
                .map_err(|source| PlanError::Resolve { seq, source })?;
            names.push(OutputFileName::from_stem(stem));
        }

        Self::check_unique(&names)?;

        // Folder mode has no naming rule; store a stable identity rule so the
        // struct invariant (a rule is always present) holds without affecting
        // behavior. `plan_extract` never resolves names through it.
        let rule = NamingRule::parse("{n}").expect("'{n}' is a valid template");

        let tasks = items
            .into_iter()
            .zip(names)
            .enumerate()
            .map(|(i, (source, name))| ArchiveTask::new(TaskId::new(seq_index(i)), source, name))
            .collect();

        Ok(ArchiveJob {
            tasks,
            rule,
            out_dir,
            mode: OutputMode::Folder,
        })
    }

    /// Move the task with `id` one position toward the head of the list.
    ///
    /// Moving the head task is a no-op (idempotent and UI-button-friendly).
    /// Returns [`ReorderError::TaskNotFound`] if no task has `id`.
    pub fn move_up(&mut self, id: TaskId) -> Result<(), ReorderError> {
        let pos = self.position_of(id)?;
        if pos == 0 {
            return Ok(()); // already at the head — nothing to do.
        }
        self.swap_and_rebind(pos, pos - 1);
        Ok(())
    }

    /// Move the task with `id` one position toward the tail of the list.
    ///
    /// Moving the tail task is a no-op (idempotent and UI-button-friendly).
    /// Returns [`ReorderError::TaskNotFound`] if no task has `id`.
    pub fn move_down(&mut self, id: TaskId) -> Result<(), ReorderError> {
        let pos = self.position_of(id)?;
        if pos + 1 == self.tasks.len() {
            return Ok(()); // already at the tail — nothing to do.
        }
        self.swap_and_rebind(pos, pos + 1);
        Ok(())
    }

    /// Apply a lifecycle `event` to the task identified by `id`.
    ///
    /// Only the targeted task is affected. Returns
    /// [`JobError::TaskNotFound`] if no task has `id`, or [`JobError::Illegal`]
    /// (via `IllegalTransition`) if the task's state machine rejects the event
    /// (in which case that task is left unchanged).
    pub fn apply_event(&mut self, id: TaskId, event: TaskEvent) -> Result<(), JobError> {
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id() == id)
            .ok_or(JobError::TaskNotFound(id))?;
        task.apply_event(event)?;
        Ok(())
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    /// Return the tasks in this job in current execution order.
    ///
    /// The slice index is the task's POSITION, which is NOT the same as the
    /// `TaskId`. A `TaskId` is a stable identity that does not change under
    /// reordering; a task's position does.
    pub fn tasks(&self) -> &[ArchiveTask] {
        &self.tasks
    }

    /// Classify every task into a terminal [`TaskOutcome`], in job order.
    ///
    /// This is the domain's run-summary policy: `Completed` is a success,
    /// `Cancelled` is its own bucket (NOT a failure), and `Failed { reason }`
    /// carries its reason. Non-terminal tasks (e.g. a worker that panicked before
    /// emitting `Complete`/`Fail`) are reconciled as `Failed` with a synthesized
    /// reason so the result is total — every task is always accounted for.
    ///
    /// Outcomes are returned in job/task order, matching [`ArchiveJob::tasks`].
    pub fn outcomes(&self) -> Vec<TaskOutcome> {
        self.tasks
            .iter()
            .map(|t| match t.status() {
                TaskStatus::Completed => TaskOutcome::Succeeded(t.id()),
                TaskStatus::Cancelled => TaskOutcome::Cancelled(t.id()),
                TaskStatus::Failed { reason } => TaskOutcome::Failed {
                    id: t.id(),
                    reason: reason.clone(),
                },
                other => TaskOutcome::Failed {
                    id: t.id(),
                    reason: format!("task did not reach a terminal state (status: {other:?})"),
                },
            })
            .collect()
    }

    /// Return this job's output mode (re-zip vs extract-to-folder).
    pub fn output_mode(&self) -> OutputMode {
        self.mode
    }

    /// Return the directory archives will be written to.
    pub fn output_directory(&self) -> &OutputDirectory {
        &self.out_dir
    }

    /// Return the naming rule used to derive task output names.
    pub fn naming_rule(&self) -> &NamingRule {
        &self.rule
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Find the list position of the task with `id`, or `TaskNotFound`.
    fn position_of(&self, id: TaskId) -> Result<usize, ReorderError> {
        self.tasks
            .iter()
            .position(|task| task.id() == id)
            .ok_or(ReorderError::TaskNotFound(id))
    }

    /// Swap the task objects at positions `a` and `b`, keeping each position's
    /// output name bound to that position.
    ///
    /// Reordering only changes which task object occupies a position; the output
    /// name stays bound to the POSITION while the task's id and status travel
    /// with the task. The implementation therefore (1) saves the current
    /// name at each position before the swap, (2) calls `self.tasks.swap(a, b)`
    /// to move the task objects, then (3) restores each position's saved name via
    /// `set_output_name`. This is infallible — it never calls `rule.resolve` and
    /// never panics — and it maintains the invariant "the task at position `p`
    /// holds the name `rule.resolve(p + 1)`" inductively (plan establishes it;
    /// each move preserves it).
    fn swap_and_rebind(&mut self, a: usize, b: usize) {
        let name_a = self.tasks[a].output_name().clone();
        let name_b = self.tasks[b].output_name().clone();
        self.tasks.swap(a, b);
        self.tasks[a].set_output_name(name_a);
        self.tasks[b].set_output_name(name_b);
    }

    /// Verify that all `names` are distinct, returning the first duplicate.
    ///
    /// A pure, list-level uniqueness check used defensively by [`plan`]. The
    /// current naming rule guarantees injectivity over distinct sequence numbers,
    /// so collisions cannot arise via `plan` today; the guard is kept so any
    /// future rule change that breaks injectivity surfaces as a typed error rather
    /// than a silent overwrite. It is also exercised directly by tests with a
    /// hand-built duplicate list.
    ///
    /// [`plan`]: ArchiveJob::plan
    pub(crate) fn check_unique(names: &[OutputFileName]) -> Result<(), PlanError> {
        // Case-insensitive filesystems (Windows / default macOS) resolve names that
        // differ only in ASCII case to the same file, so uniqueness is checked after
        // ASCII-lowercasing; otherwise a later task could silently overwrite an
        // earlier one's output. Non-ASCII case pairs (e.g. É/é) are not folded here:
        // the current naming rule emits ASCII-only output, and Unicode folding is
        // deferred to a future issue. This guard is primarily defensive.
        let mut seen: HashSet<String> = HashSet::with_capacity(names.len());
        for name in names {
            if !seen.insert(name.as_str().to_ascii_lowercase()) {
                return Err(PlanError::DuplicateName {
                    // Report the original (non-folded) name for a faithful message.
                    name: name.as_str().to_string(),
                });
            }
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::file_name::{FileStem, OutputFileName};
    use crate::domain::source_item::SourceItem;
    use crate::domain::task_status::TaskStatus;
    use std::path::PathBuf;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Parse a naming rule template that is known-valid in tests.
    fn rule(template: &str) -> NamingRule {
        NamingRule::parse(template).expect("test template should be valid")
    }

    /// A throwaway output directory for tests.
    fn out_dir() -> OutputDirectory {
        OutputDirectory::new(PathBuf::from("/tmp/out"))
    }

    /// `n` distinct rar-file source items.
    fn sources(n: usize) -> Vec<SourceItem> {
        (0..n)
            .map(|i| SourceItem::RarFile(PathBuf::from(format!("input{i}.rar"))))
            .collect()
    }

    /// Build an `OutputFileName` from a plain stem (test convenience).
    fn name(stem: &str) -> OutputFileName {
        OutputFileName::from_stem(FileStem::new(stem).unwrap())
    }

    /// Snapshot the (id, output-name) of each task in list order.
    fn id_name_pairs(job: &ArchiveJob) -> Vec<(u32, String)> {
        job.tasks()
            .iter()
            .map(|t| (t.id().get(), t.output_name().as_str().to_string()))
            .collect()
    }

    // ── plan: happy path ──────────────────────────────────────────────────────

    #[test]
    fn plan_assigns_ids_in_list_order() {
        let job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let ids: Vec<u32> = job.tasks().iter().map(|t| t.id().get()).collect();
        assert_eq!(ids, vec![1, 2, 3]);
    }

    #[test]
    fn plan_resolves_names_in_list_order() {
        let job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let names: Vec<&str> = job
            .tasks()
            .iter()
            .map(|t| t.output_name().as_str())
            .collect();
        assert_eq!(names, vec!["file1.zip", "file2.zip", "file3.zip"]);
    }

    #[test]
    fn plan_starts_every_task_pending() {
        let job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        for task in job.tasks() {
            assert_eq!(task.status(), &TaskStatus::Pending);
        }
    }

    #[test]
    fn plan_preserves_each_source_item_with_its_position() {
        let items = sources(3);
        let expected = items.clone();
        let job = ArchiveJob::plan(items, rule("file{n}"), out_dir()).unwrap();
        let actual: Vec<&SourceItem> = job.tasks().iter().map(|t| t.source()).collect();
        assert_eq!(actual, expected.iter().collect::<Vec<_>>());
    }

    // ── plan: empty ───────────────────────────────────────────────────────────

    #[test]
    fn plan_with_no_items_is_empty_error() {
        let result = ArchiveJob::plan(Vec::new(), rule("file{n}"), out_dir());
        assert_eq!(result, Err(PlanError::Empty));
    }

    // ── plan: resolve error (reserved device name) ────────────────────────────

    #[test]
    fn plan_propagates_reserved_name_resolve_error_for_first_item() {
        // `COM{n}` resolves item #1 to stem `COM1`, a Windows reserved device
        // name that PR3's `FileStem` rejects (confirmed against RESERVED_NAMES).
        let result = ArchiveJob::plan(sources(1), rule("COM{n}"), out_dir());
        match result {
            Err(PlanError::Resolve { seq, source }) => {
                assert_eq!(seq, 1);
                assert_eq!(
                    source,
                    NameError::ReservedName {
                        name: "COM1".to_string()
                    }
                );
            }
            other => panic!("expected PlanError::Resolve, got {other:?}"),
        }
    }

    // ── check_unique (direct) ─────────────────────────────────────────────────

    #[test]
    fn check_unique_rejects_a_duplicated_name() {
        let names = vec![name("a"), name("b"), name("a")];
        let result = ArchiveJob::check_unique(&names);
        assert_eq!(
            result,
            Err(PlanError::DuplicateName {
                name: "a.zip".to_string()
            })
        );
    }

    #[test]
    fn check_unique_rejects_names_differing_only_in_case() {
        // On case-insensitive filesystems (Windows / default macOS) "A.zip" and
        // "a.zip" resolve to the same file, so the check must reject the pair.
        let names = [name("A"), name("a")];
        assert_eq!(
            ArchiveJob::check_unique(&names),
            Err(PlanError::DuplicateName {
                name: "a.zip".to_string()
            })
        );
    }

    #[test]
    fn check_unique_reports_second_occurrence_regardless_of_case_order() {
        // The reported name is always the second (colliding) occurrence in list
        // order, in its original casing — here the uppercase entry comes second.
        let names = [name("a"), name("A")];
        assert_eq!(
            ArchiveJob::check_unique(&names),
            Err(PlanError::DuplicateName {
                name: "A.zip".to_string()
            })
        );
    }

    #[test]
    fn check_unique_accepts_a_distinct_list() {
        let names = vec![name("a"), name("b"), name("c")];
        assert_eq!(ArchiveJob::check_unique(&names), Ok(()));
    }

    #[test]
    fn check_unique_accepts_an_empty_list() {
        assert_eq!(ArchiveJob::check_unique(&[]), Ok(()));
    }

    // ── move_up / move_down: invariant ────────────────────────────────────────

    #[test]
    fn move_up_rebinds_names_to_positions_and_keeps_ids_with_tasks() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id3 = job.tasks()[2].id();

        job.move_up(id3).unwrap();

        // The task that was id=3 is now at position 1 and took position 1's name.
        assert_eq!(
            id_name_pairs(&job),
            vec![
                (1, "file1.zip".to_string()),
                (3, "file2.zip".to_string()),
                (2, "file3.zip".to_string()),
            ]
        );

        // The moved task's status is preserved.
        let moved = job.tasks().iter().find(|t| t.id().get() == 3).unwrap();
        assert_eq!(moved.status(), &TaskStatus::Pending);
    }

    #[test]
    fn move_down_rebinds_names_to_positions_and_keeps_ids_with_tasks() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id1 = job.tasks()[0].id();

        job.move_down(id1).unwrap();

        assert_eq!(
            id_name_pairs(&job),
            vec![
                (2, "file1.zip".to_string()),
                (1, "file2.zip".to_string()),
                (3, "file3.zip".to_string()),
            ]
        );
    }

    // ── move_up / move_down: boundary no-ops ──────────────────────────────────

    #[test]
    fn move_up_on_head_is_a_no_op() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let before = id_name_pairs(&job);
        let head_id = job.tasks()[0].id();

        assert_eq!(job.move_up(head_id), Ok(()));
        assert_eq!(id_name_pairs(&job), before);
    }

    #[test]
    fn move_down_on_tail_is_a_no_op() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let before = id_name_pairs(&job);
        let tail_id = job.tasks()[2].id();

        assert_eq!(job.move_down(tail_id), Ok(()));
        assert_eq!(id_name_pairs(&job), before);
    }

    // ── move: round-trip ──────────────────────────────────────────────────────

    #[test]
    fn move_up_then_move_down_round_trips_order_and_names() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let before = id_name_pairs(&job);
        let id3 = job.tasks()[2].id();

        job.move_up(id3).unwrap();
        job.move_down(id3).unwrap();

        assert_eq!(id_name_pairs(&job), before);
    }

    // ── TaskId stability across moves ─────────────────────────────────────────

    #[test]
    fn task_ids_are_stable_across_moves_while_names_rebind_to_positions() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();

        // The set of ids present is invariant under reordering.
        let ids_before: HashSet<u32> = job.tasks().iter().map(|t| t.id().get()).collect();

        let id2 = job.tasks()[1].id();
        job.move_up(id2).unwrap();
        job.move_down(id2).unwrap();

        let ids_after: HashSet<u32> = job.tasks().iter().map(|t| t.id().get()).collect();
        assert_eq!(ids_before, ids_after);

        // Names remain position-derived: positions 0..3 -> file1..file3.
        let names: Vec<&str> = job
            .tasks()
            .iter()
            .map(|t| t.output_name().as_str())
            .collect();
        assert_eq!(names, vec!["file1.zip", "file2.zip", "file3.zip"]);
    }

    // ── TaskNotFound across all id-based operations ───────────────────────────

    #[test]
    fn move_up_with_unknown_id_is_task_not_found() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let unknown = TaskId::new(999);
        assert_eq!(
            job.move_up(unknown),
            Err(ReorderError::TaskNotFound(unknown))
        );
    }

    #[test]
    fn move_down_with_unknown_id_is_task_not_found() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let unknown = TaskId::new(999);
        assert_eq!(
            job.move_down(unknown),
            Err(ReorderError::TaskNotFound(unknown))
        );
    }

    #[test]
    fn apply_event_with_unknown_id_is_task_not_found() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let unknown = TaskId::new(999);
        assert_eq!(
            job.apply_event(unknown, TaskEvent::StartExtracting),
            Err(JobError::TaskNotFound(unknown))
        );
    }

    // ── apply_event ───────────────────────────────────────────────────────────

    #[test]
    fn apply_event_transitions_only_the_targeted_task() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id2 = job.tasks()[1].id();

        assert_eq!(job.apply_event(id2, TaskEvent::StartExtracting), Ok(()));

        for task in job.tasks() {
            if task.id() == id2 {
                assert_eq!(task.status(), &TaskStatus::Extracting);
            } else {
                assert_eq!(task.status(), &TaskStatus::Pending);
            }
        }
    }

    #[test]
    fn apply_illegal_event_returns_illegal_and_leaves_task_unchanged() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id1 = job.tasks()[0].id();

        // `Complete` is illegal from `Pending`.
        let result = job.apply_event(id1, TaskEvent::Complete);

        match result {
            Err(JobError::Illegal(IllegalTransition { from, event })) => {
                assert_eq!(from, TaskStatus::Pending);
                assert_eq!(event, TaskEvent::Complete);
            }
            other => panic!("expected JobError::Illegal, got {other:?}"),
        }

        // The targeted task's status is unchanged, and so is every other task.
        for task in job.tasks() {
            assert_eq!(task.status(), &TaskStatus::Pending);
        }
    }

    // ── apply_event targets by stable id, not position ───────────────────────

    #[test]
    fn apply_event_targets_repositioned_task_by_id_not_position() {
        // Plan 3 items; id=3 is initially at position 2 (index 2).
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id3 = job.tasks()[2].id();
        assert_eq!(id3.get(), 3);

        // Move id=3 up so it now occupies position 1 (index 1).
        job.move_up(id3).unwrap();
        assert_eq!(job.tasks()[1].id().get(), 3);

        // Apply StartExtracting to id=3. Lookup must use the stable id, not the
        // old index (2), so the task now at index 1 should become Extracting.
        job.apply_event(id3, TaskEvent::StartExtracting).unwrap();

        for task in job.tasks() {
            if task.id().get() == 3 {
                assert_eq!(task.status(), &TaskStatus::Extracting);
            } else {
                assert_eq!(task.status(), &TaskStatus::Pending);
            }
        }
    }

    // ── swap_and_rebind preserves status, rebinds name to position ──

    #[test]
    fn status_survives_reorder_and_output_name_rebinds_to_new_position() {
        // Plan 3 items; id=2 is initially at index 1 with name "file2.zip".
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let id2 = job.tasks()[1].id();
        assert_eq!(id2.get(), 2);

        // Advance id=2 to Extracting before the move.
        job.apply_event(id2, TaskEvent::StartExtracting).unwrap();

        // Move id=2 up: it should now sit at index 0 with name "file1.zip".
        job.move_up(id2).unwrap();

        let moved = job.tasks().iter().find(|t| t.id().get() == 2).unwrap();
        // Status travels with the task object.
        assert_eq!(moved.status(), &TaskStatus::Extracting);
        // The name is rebound to the new position (index 0 → "file1.zip").
        assert_eq!(moved.output_name().as_str(), "file1.zip");

        // The displaced task (originally id=1, now at index 1) is still Pending
        // and has the name bound to index 1 ("file2.zip").
        let displaced = job.tasks().iter().find(|t| t.id().get() == 1).unwrap();
        assert_eq!(displaced.status(), &TaskStatus::Pending);
        assert_eq!(displaced.output_name().as_str(), "file2.zip");
    }

    // ── Eq bound (compile-time guard) ─────────────────────────────────────────

    #[test]
    fn archive_job_implements_eq() {
        fn assert_eq_bound<T: Eq>() {}
        assert_eq_bound::<ArchiveJob>();
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    #[test]
    fn output_directory_returns_the_configured_directory() {
        let dir = OutputDirectory::new(PathBuf::from("/some/where"));
        let job = ArchiveJob::plan(sources(1), rule("file{n}"), dir.clone()).unwrap();
        assert_eq!(job.output_directory(), &dir);
    }

    #[test]
    fn naming_rule_returns_the_configured_rule() {
        let r = rule("file{n}");
        let job = ArchiveJob::plan(sources(1), r.clone(), out_dir()).unwrap();
        assert_eq!(job.naming_rule(), &r);
    }

    // ── outcomes: terminal classification ─────────────────────────────────────

    #[test]
    fn outcomes_classify_mixed_terminal_statuses_in_job_order() {
        let mut job = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();

        // Drive task 0 -> Completed.
        job.apply_event(ids[0], TaskEvent::StartCompressing)
            .unwrap();
        job.apply_event(ids[0], TaskEvent::Complete).unwrap();
        // Drive task 1 -> Failed { reason: "boom" }.
        job.apply_event(
            ids[1],
            TaskEvent::Fail {
                reason: "boom".to_string(),
            },
        )
        .unwrap();
        // Drive task 2 -> Cancelled.
        job.apply_event(ids[2], TaskEvent::Cancel).unwrap();

        assert_eq!(
            job.outcomes(),
            vec![
                TaskOutcome::Succeeded(ids[0]),
                TaskOutcome::Failed {
                    id: ids[1],
                    reason: "boom".to_string(),
                },
                TaskOutcome::Cancelled(ids[2]),
            ]
        );
    }

    // ── plan output mode ──────────────────────────────────────────────────────

    #[test]
    fn plan_sets_zip_output_mode() {
        let job = ArchiveJob::plan(sources(1), rule("file{n}"), out_dir()).unwrap();
        assert_eq!(
            job.output_mode(),
            crate::domain::output_mode::OutputMode::Zip
        );
    }

    #[test]
    fn plan_extract_sets_folder_mode_and_one_task_per_item() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/a/foo.rar")),
            SourceItem::ZipFile(PathBuf::from("/a/bar.zip")),
        ];
        let job = ArchiveJob::plan_extract(items, out_dir()).unwrap();
        assert_eq!(
            job.output_mode(),
            crate::domain::output_mode::OutputMode::Folder
        );
        assert_eq!(job.tasks().len(), 2);
        // Every task starts Pending, exactly like plan().
        for t in job.tasks() {
            assert_eq!(t.status(), &TaskStatus::Pending);
        }
    }

    #[test]
    fn plan_extract_rejects_empty() {
        assert_eq!(
            ArchiveJob::plan_extract(Vec::new(), out_dir()),
            Err(PlanError::Empty)
        );
    }

    #[test]
    fn plan_extract_rejects_two_sources_with_the_same_base_name() {
        // foo.rar and foo.zip both want folder "foo" → duplicate.
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/a/foo.rar")),
            SourceItem::ZipFile(PathBuf::from("/b/foo.zip")),
        ];
        // `name` is the internal `.zip`-suffixed label the uniqueness guard compares;
        // Folder mode produces no `.zip` — the folder would be named `foo`.
        assert_eq!(
            ArchiveJob::plan_extract(items, out_dir()),
            Err(PlanError::DuplicateName {
                name: "foo.zip".to_string()
            })
        );
    }

    #[test]
    fn outcomes_reconcile_non_terminal_task_as_failed_with_synthesized_reason() {
        let mut job = ArchiveJob::plan(sources(2), rule("file{n}"), out_dir()).unwrap();
        let ids: Vec<TaskId> = job.tasks().iter().map(|t| t.id()).collect();

        // Task 0 reaches a terminal state; task 1 is left in Compressing
        // (mirrors a worker that panicked before emitting Complete/Fail).
        job.apply_event(ids[0], TaskEvent::StartCompressing)
            .unwrap();
        job.apply_event(ids[0], TaskEvent::Complete).unwrap();
        job.apply_event(ids[1], TaskEvent::StartCompressing)
            .unwrap();

        let outcomes = job.outcomes();
        assert_eq!(outcomes[0], TaskOutcome::Succeeded(ids[0]));
        assert_eq!(
            outcomes[1],
            TaskOutcome::Failed {
                id: ids[1],
                reason: format!(
                    "task did not reach a terminal state (status: {:?})",
                    TaskStatus::Compressing
                ),
            }
        );
    }
}
