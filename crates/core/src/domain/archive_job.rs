//! The ArchiveJob aggregate root — planning, reordering, and event application.

use std::collections::{HashMap, HashSet};

use crate::domain::archive_task::{ArchiveTask, TaskId};
use crate::domain::conflict_policy::ConflictPolicy;
use crate::domain::file_name::{FileStem, NameError, OutputName};
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
        /// The sequence number of the offending item (`start + index`).
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
    /// The requested numbering range would exceed `u32::MAX`.
    ///
    /// Numbering starts at `start` and runs for `count` items, so the highest
    /// sequence number is `start + count - 1`. When that would exceed `u32::MAX`
    /// the job is rejected rather than wrapping or panicking.
    #[error("numbering from {start} for {count} items exceeds u32::MAX")]
    SequenceOverflow {
        /// The requested starting sequence number.
        start: u32,
        /// The number of items to number.
        count: usize,
    },
}

/// Why a task can never produce output, decided at plan time.
///
/// A defect is a per-task verdict, deliberately kept out of [`PlanError`]: a
/// single unusable source name must fail only its own task, never the batch.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum TaskDefect {
    /// The source's base name is not usable as an output name on this platform.
    ///
    /// The field is named `cause` rather than `source` so `thiserror` does not
    /// treat it as the error source: `source_name` already names the offending
    /// item, and the message renders the inner failure inline.
    #[error("\"{source_name}\" cannot be used as a folder name: {cause}")]
    UnusableSourceName {
        /// The source item's base name, as it appeared on disk.
        source_name: String,
        /// The naming rule that name violates.
        cause: NameError,
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

/// Convert a 0-based item index to a `u32`, asserting it does not truncate.
///
/// Uses `try_from` rather than `as` to make the "no truncation" intent explicit.
/// Any realistic job fits within `u32::MAX` items — allocating that many items
/// would exhaust memory first.
fn index_as_u32(i: usize) -> u32 {
    u32::try_from(i)
        .expect("job item count fits in u32; allocating that many items exhausts memory first")
}

/// Convert a 0-based item index to a 1-based `u32` task id.
///
/// `TaskId` is a stable per-task identity that is always 1-based, independent of
/// the naming start number used to render output filenames.
fn seq_index(i: usize) -> u32 {
    index_as_u32(i) + 1
}

/// The aggregate root coordinating a batch of [`ArchiveTask`]s.
///
/// The job owns the ordered list of tasks, the [`NamingRule`] used to derive
/// their output names, and the [`OutputDirectory`] they will be written to.
///
/// **Position/identity invariant (Zip mode):** the task at position `p` always
/// holds the name `rule.resolve(start + p)`, where `start` is the numbering start
/// passed to [`ArchiveJob::plan_with_start`] (1 for [`ArchiveJob::plan`]). This is
/// established at plan time and preserved by every reorder: a Zip name is
/// position-derived and stays with the position, while each task's id and status
/// travel with the task.
///
/// **Folder mode is the mirror image:** a task's name is derived from its SOURCE
/// ([`SourceItem::output_stem`]), so it travels with the task under a reorder,
/// and a folder source produces no output at all. The two rules are told apart by
/// the [`OutputName`] variant, not by the job's mode flag.
///
/// `ArchiveJob` is a value type with full structural equality: it derives both
/// `PartialEq` and `Eq`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveJob {
    tasks: Vec<ArchiveTask>,
    rule: NamingRule,
    out_dir: OutputDirectory,
    mode: OutputMode,
    policy: ConflictPolicy,
    /// Tasks that were planned but can never run, with the reason. Keyed by
    /// TaskId so a reorder does not invalidate it.
    defects: HashMap<TaskId, TaskDefect>,
}

impl ArchiveJob {
    /// Plan a new job numbering items from 1, using the default
    /// [`ConflictPolicy::AutoRename`].
    ///
    /// Equivalent to [`plan_with_start`] with `start = 1` and the default policy:
    /// item at index `i` gets `TaskId(i + 1)` and output name `rule.resolve(i + 1)`.
    ///
    /// [`plan_with_start`]: ArchiveJob::plan_with_start
    pub fn plan(
        items: Vec<SourceItem>,
        rule: NamingRule,
        out_dir: OutputDirectory,
    ) -> Result<Self, PlanError> {
        Self::plan_with_start(items, rule, out_dir, 1, ConflictPolicy::default())
    }

    /// Plan a new job numbering items from `start`, deriving each task's output
    /// name from `rule`.
    ///
    /// Item at index `i` is numbered `start + i` for naming, and keeps the
    /// 1-based `TaskId(i + 1)` as its stable identity (independent of `start`).
    /// The `SequenceNumber` is a transient argument to name resolution — it is
    /// derived from position and is NOT stored on the task. `start` may be `0`.
    ///
    /// `policy` is the [`ConflictPolicy`] applied when an output zip already
    /// exists at run time (Zip mode resolves collisions through the archiver,
    /// symmetrically to how Folder mode resolves them through the placer).
    ///
    /// Returns [`PlanError::Empty`] when `items` is empty,
    /// [`PlanError::SequenceOverflow`] when the numbering range
    /// `start ..= start + count - 1` would exceed `u32::MAX`, [`PlanError::Resolve`]
    /// when the rule cannot produce a valid name for some item, and
    /// [`PlanError::DuplicateName`] when two items collide (a defensive guard;
    /// see [`ArchiveJob::check_unique`]).
    pub fn plan_with_start(
        items: Vec<SourceItem>,
        rule: NamingRule,
        out_dir: OutputDirectory,
        start: u32,
        policy: ConflictPolicy,
    ) -> Result<Self, PlanError> {
        if items.is_empty() {
            return Err(PlanError::Empty);
        }

        // Guard the whole numbering range up front so per-item addition cannot
        // overflow u32. The highest sequence number is `start + (count - 1)`.
        let count = items.len();
        let last_offset = index_as_u32(count - 1);
        start
            .checked_add(last_offset)
            .ok_or(PlanError::SequenceOverflow { start, count })?;

        // Resolve a name for every item, propagating the first resolution error.
        let mut names: Vec<OutputName> = Vec::with_capacity(count);
        for i in 0..count {
            // Safe: the range guard above proved `start + last_offset` fits in
            // u32, and `i <= count - 1`, so this addition cannot overflow.
            let seq_n = start + index_as_u32(i);
            let seq = SequenceNumber::new(seq_n);
            let name = rule
                .resolve(seq)
                .map_err(|source| PlanError::Resolve { seq: seq_n, source })?;
            // Zip names are position-derived: they rebind when positions change.
            names.push(OutputName::Zip(name));
        }

        // Defensive uniqueness guard. Via this path names cannot collide (the
        // numbers start..=start+count-1 are distinct and rendering is injective),
        // but we still assert it so any future rule change that breaks
        // injectivity surfaces as an error instead of a silent overwrite.
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
            // Zip mode resolves collisions through the archiver at run time.
            policy,
            defects: HashMap::new(),
        })
    }

    /// Plan a Folder-mode (extraction) job from `items`.
    ///
    /// Unlike [`plan`], there is no naming rule: each task's output directory is
    /// named after the source (see [`SourceItem::output_stem`]), so the name is
    /// source-derived and travels with its task. A folder source has no archive
    /// to extract and therefore produces nothing at all — it gets
    /// [`OutputName::None`] rather than a fabricated `.zip` label, which keeps it
    /// out of the [`check_unique`] guard for a collision it cannot cause.
    ///
    /// Returns [`PlanError::Empty`] for no items and [`PlanError::DuplicateName`]
    /// when two producing sources share a base name. An unusable source base name
    /// is recorded as a per-task [`TaskDefect`] so it does not sink the batch.
    ///
    /// [`plan`]: ArchiveJob::plan
    /// [`check_unique`]: ArchiveJob::check_unique
    pub fn plan_extract(
        items: Vec<SourceItem>,
        out_dir: OutputDirectory,
        policy: ConflictPolicy,
    ) -> Result<Self, PlanError> {
        if items.is_empty() {
            return Err(PlanError::Empty);
        }

        let mut names: Vec<OutputName> = Vec::with_capacity(items.len());
        let mut defects = HashMap::new();
        for (i, item) in items.iter().enumerate() {
            let id = TaskId::new(seq_index(i));
            let source_name = item.output_stem();
            match FileStem::new(&source_name) {
                Ok(stem) => names.push(match item {
                    SourceItem::Folder(_) => OutputName::None,
                    SourceItem::RarFile(_) | SourceItem::ZipFile(_) => OutputName::Folder(stem),
                }),
                Err(cause) => {
                    defects.insert(id, TaskDefect::UnusableSourceName { source_name, cause });
                    names.push(OutputName::None);
                }
            }
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
            policy,
            defects,
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

    /// Return the plan-time defect for task `id`, if the task cannot produce output.
    ///
    /// Defects are keyed by stable task identity, so this lookup remains valid
    /// when tasks are reordered.
    pub fn defect(&self, id: TaskId) -> Option<&TaskDefect> {
        self.defects.get(&id)
    }

    /// Classify every task into a terminal [`TaskOutcome`], in job order.
    ///
    /// This is the domain's run-summary policy: `Completed` is a success,
    /// `Cancelled` is its own bucket (NOT a failure), and `Failed { reason }`
    /// carries its reason. Non-terminal tasks (e.g. a worker whose terminal status
    /// was dropped because the aggregator had already torn down) are reconciled as
    /// `Failed` with a synthesized reason so the result is total — every task is
    /// always accounted for. This is the last line of defence: workers report even
    /// a panic as a real `Fail`, so a reconciled reason means the event was lost.
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

    /// Return this job's collision policy (used by Folder-mode placement).
    pub fn conflict_policy(&self) -> ConflictPolicy {
        self.policy
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

    /// Swap the task objects at positions `a` and `b`, rebinding only names that
    /// belong to a position.
    ///
    /// Only a position-derived name belongs to the position. A `Zip` name is
    /// resolved from the naming rule at a list position, so it stays bound to the
    /// POSITION: the implementation (1) saves the current name at each position
    /// before the swap, (2) calls `self.tasks.swap(a, b)` to move the task
    /// objects, then (3) restores each position's saved name via
    /// `set_output_name`. A source-derived `Folder` name — and a `None` name,
    /// which has nothing to rebind — instead travels with its task, so the swap
    /// alone is the whole operation. Rebinding those would detach the label from
    /// the source whose bytes actually land there.
    ///
    /// Both positions are inspected so a hypothetical mixed list could never
    /// rebind a source-derived name onto the wrong task; the factories only ever
    /// build homogeneous jobs, so in practice one variant decides both.
    ///
    /// This is infallible — it never calls `rule.resolve` and never panics — and
    /// in Zip mode it maintains the invariant "the task at position `p` holds the
    /// name `rule.resolve(p + 1)`" inductively (plan establishes it; each move
    /// preserves it).
    fn swap_and_rebind(&mut self, a: usize, b: usize) {
        let rebind = matches!(self.tasks[a].output_name(), OutputName::Zip(_))
            && matches!(self.tasks[b].output_name(), OutputName::Zip(_));
        if !rebind {
            self.tasks.swap(a, b);
            return;
        }
        let name_a = self.tasks[a].output_name().clone();
        let name_b = self.tasks[b].output_name().clone();
        self.tasks.swap(a, b);
        self.tasks[a].set_output_name(name_a);
        self.tasks[b].set_output_name(name_b);
    }

    /// Verify that all producing `names` are distinct, returning the first
    /// duplicate.
    ///
    /// A pure, list-level uniqueness check used defensively by [`plan`]. The
    /// current naming rule guarantees injectivity over distinct sequence numbers,
    /// so collisions cannot arise via `plan` today; the guard is kept so any
    /// future rule change that breaks injectivity surfaces as a typed error rather
    /// than a silent overwrite. It is also exercised directly by tests with a
    /// hand-built duplicate list.
    ///
    /// Entries whose [`OutputName::produces_output`] is `false` are skipped: they
    /// write nothing, so they cannot collide with anything. Counting them would
    /// reject a whole Folder-mode batch of `foo.rar` plus a folder named `foo`
    /// for a filesystem collision that can never happen.
    ///
    /// [`plan`]: ArchiveJob::plan
    pub(crate) fn check_unique(names: &[OutputName]) -> Result<(), PlanError> {
        // Filesystem identity folds Unicode normalization and case, so comparing
        // the same folded key on every platform prevents silent overwrites.
        let mut seen: HashSet<String> = HashSet::with_capacity(names.len());
        for name in names {
            // Entries that produce nothing cannot collide (see OutputName::None).
            let Some(key) = name.fold_key() else { continue };
            if !seen.insert(key) {
                return Err(PlanError::DuplicateName {
                    name: name.as_str().unwrap_or_default().to_string(),
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
    use crate::domain::file_name::{FileStem, OutputFileName, OutputName};
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

    /// The default conflict policy, for `plan_with_start` call sites whose
    /// assertions are independent of the policy.
    fn policy() -> ConflictPolicy {
        ConflictPolicy::default()
    }

    /// Build an `OutputFileName` from a plain stem (test convenience).
    fn name(stem: &str) -> OutputName {
        OutputName::Zip(OutputFileName::from_stem(FileStem::new(stem).unwrap()))
    }

    /// Snapshot the (id, output-name) of each task in list order.
    fn id_name_pairs(job: &ArchiveJob) -> Vec<(u32, String)> {
        job.tasks()
            .iter()
            .map(|t| {
                (
                    t.id().get(),
                    t.output_name()
                        .as_str()
                        .expect("Zip tasks always produce output")
                        .to_string(),
                )
            })
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
            .map(|t| {
                t.output_name()
                    .as_str()
                    .expect("Zip tasks always produce output")
            })
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

    // ── plan_with_start ───────────────────────────────────────────────────────

    #[test]
    fn plan_with_start_numbers_names_from_start_but_keeps_one_based_ids() {
        let job = ArchiveJob::plan_with_start(sources(3), rule("file{n}"), out_dir(), 5, policy())
            .unwrap();
        assert_eq!(
            id_name_pairs(&job),
            vec![
                (1, "file5.zip".to_string()),
                (2, "file6.zip".to_string()),
                (3, "file7.zip".to_string()),
            ]
        );
    }

    #[test]
    fn plan_with_start_allows_zero() {
        let job = ArchiveJob::plan_with_start(sources(3), rule("{n:02}"), out_dir(), 0, policy())
            .unwrap();
        assert_eq!(
            id_name_pairs(&job),
            vec![
                (1, "00.zip".to_string()),
                (2, "01.zip".to_string()),
                (3, "02.zip".to_string()),
            ]
        );
    }

    #[test]
    fn plan_with_start_grows_digits_past_the_pad_width() {
        // printf semantics: {n:02} is a minimum width, so 100 renders as "100".
        let job = ArchiveJob::plan_with_start(sources(3), rule("{n:02}"), out_dir(), 99, policy())
            .unwrap();
        assert_eq!(
            id_name_pairs(&job),
            vec![
                (1, "99.zip".to_string()),
                (2, "100.zip".to_string()),
                (3, "101.zip".to_string()),
            ]
        );
    }

    #[test]
    fn plan_with_start_rejects_u32_overflow() {
        // Numbering 2 items from u32::MAX would need u32::MAX + 1.
        let result =
            ArchiveJob::plan_with_start(sources(2), rule("file{n}"), out_dir(), u32::MAX, policy());
        assert_eq!(
            result,
            Err(PlanError::SequenceOverflow {
                start: u32::MAX,
                count: 2,
            })
        );
    }

    #[test]
    fn plan_numbers_from_one_by_default() {
        let default = ArchiveJob::plan(sources(3), rule("file{n}"), out_dir()).unwrap();
        let explicit =
            ArchiveJob::plan_with_start(sources(3), rule("file{n}"), out_dir(), 1, policy())
                .unwrap();
        assert_eq!(id_name_pairs(&default), id_name_pairs(&explicit));
    }

    #[test]
    fn plan_defaults_zip_conflict_policy_to_auto_rename() {
        let job = ArchiveJob::plan(sources(1), rule("file{n}"), out_dir()).unwrap();
        assert_eq!(job.conflict_policy(), ConflictPolicy::AutoRename);
    }

    #[test]
    fn plan_with_start_stores_the_given_conflict_policy() {
        // A Zip-mode job must carry the caller's chosen policy (not a hardcoded
        // default), so the engine can resolve output collisions accordingly.
        let job = ArchiveJob::plan_with_start(
            sources(1),
            rule("file{n}"),
            out_dir(),
            1,
            ConflictPolicy::Overwrite,
        )
        .unwrap();
        assert_eq!(job.output_mode(), OutputMode::Zip);
        assert_eq!(job.conflict_policy(), ConflictPolicy::Overwrite);
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

    #[test]
    fn check_unique_ignores_entries_that_produce_no_output() {
        // A non-producing entry writes nothing, so it can never collide — not
        // even with another non-producing entry.
        let names = [
            OutputName::Folder(FileStem::new("foo").unwrap()),
            OutputName::None,
            OutputName::None,
        ];
        assert_eq!(ArchiveJob::check_unique(&names), Ok(()));
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
            .map(|t| {
                t.output_name()
                    .as_str()
                    .expect("Zip tasks always produce output")
            })
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
        assert_eq!(moved.output_name().as_str(), Some("file1.zip"));

        // The displaced task (originally id=1, now at index 1) is still Pending
        // and has the name bound to index 1 ("file2.zip").
        let displaced = job.tasks().iter().find(|t| t.id().get() == 1).unwrap();
        assert_eq!(displaced.status(), &TaskStatus::Pending);
        assert_eq!(displaced.output_name().as_str(), Some("file2.zip"));
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
        let job = ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default()).unwrap();
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
    fn plan_defaults_conflict_policy_to_auto_rename() {
        let job = ArchiveJob::plan(sources(1), rule("file{n}"), out_dir()).unwrap();
        assert_eq!(job.conflict_policy(), ConflictPolicy::AutoRename);
    }

    #[test]
    fn plan_extract_stores_the_given_conflict_policy() {
        let items = vec![SourceItem::RarFile(PathBuf::from("/a/foo.rar"))];
        let job = ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::Overwrite).unwrap();
        assert_eq!(job.conflict_policy(), ConflictPolicy::Overwrite);
    }

    #[test]
    fn plan_extract_rejects_empty() {
        assert_eq!(
            ArchiveJob::plan_extract(Vec::new(), out_dir(), ConflictPolicy::default()),
            Err(PlanError::Empty)
        );
    }

    #[test]
    fn plan_extract_assigns_none_output_name_to_folder_source() {
        // A folder source has no archive to extract in Folder mode, so it says so
        // rather than carrying a `.zip` label for output it never writes.
        let job = ArchiveJob::plan_extract(
            vec![SourceItem::Folder(PathBuf::from("/a/foo"))],
            out_dir(),
            ConflictPolicy::default(),
        )
        .unwrap();

        assert_eq!(job.tasks()[0].output_name(), &OutputName::None);
    }

    #[test]
    fn plan_extract_accepts_archive_and_folder_with_the_same_base_name() {
        // Regression: the folder source produces nothing in Folder mode, so it
        // cannot collide with `foo.rar`'s output directory. Before `OutputName`,
        // it carried a fabricated `foo.zip` label and failed the WHOLE batch with
        // `DuplicateName` for a filesystem collision that can never happen.
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/a/foo.rar")),
            SourceItem::Folder(PathBuf::from("/b/foo")),
        ];

        ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default())
            .expect("the folder source produces no output, so there is no collision");
    }

    #[test]
    fn plan_extract_rejects_two_sources_with_the_same_base_name() {
        // foo.rar and foo.zip both want folder "foo" → duplicate. A real
        // collision is still rejected; the reported name is the directory that
        // would be overwritten, not an internal `.zip` label.
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/a/foo.rar")),
            SourceItem::ZipFile(PathBuf::from("/b/foo.zip")),
        ];
        assert_eq!(
            ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default()),
            Err(PlanError::DuplicateName {
                name: "foo".to_string()
            })
        );
    }

    #[test]
    fn plan_extract_rejects_nfc_and_nfd_spellings_of_the_same_name() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("\u{30AC}\u{30A4}\u{30C9}.rar")),
            SourceItem::RarFile(PathBuf::from(
                "\u{30AB}\u{3099}\u{30A4}\u{30C8}\u{3099}.rar",
            )),
        ];

        assert_eq!(
            ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default()),
            Err(PlanError::DuplicateName {
                name: "\u{30AB}\u{3099}\u{30A4}\u{30C8}\u{3099}".to_string(),
            })
        );
    }

    #[test]
    fn plan_extract_rejects_names_differing_only_in_non_ascii_case() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("\u{00C9}tude.rar")),
            SourceItem::RarFile(PathBuf::from("\u{00E9}tude.rar")),
        ];

        assert_eq!(
            ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default()),
            Err(PlanError::DuplicateName {
                name: "\u{00E9}tude".to_string(),
            })
        );
    }

    #[test]
    fn plan_extract_records_an_unusable_source_name_as_a_task_defect() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("good.rar")),
            SourceItem::RarFile(PathBuf::from("bad:name.rar")),
        ];

        let job = ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default())
            .expect("one unusable source name must not sink the batch");

        assert_eq!(job.tasks().len(), 2);
        assert_eq!(
            job.defect(TaskId::new(2)),
            Some(&TaskDefect::UnusableSourceName {
                source_name: "bad:name".to_string(),
                cause: NameError::ForbiddenChar { ch: ':' },
            })
        );
    }

    #[test]
    fn plan_extract_records_a_reserved_source_name_as_a_task_defect() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("foo.rar")),
            SourceItem::RarFile(PathBuf::from("CON.rar")),
        ];

        let job = ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default())
            .expect("a reserved source name must not sink the batch");

        assert_eq!(
            job.defect(TaskId::new(2)),
            Some(&TaskDefect::UnusableSourceName {
                source_name: "CON".to_string(),
                cause: NameError::ReservedName {
                    name: "CON".to_string(),
                },
            })
        );
    }

    #[test]
    fn plan_extract_excludes_a_defective_task_from_uniqueness_check() {
        let items = vec![
            SourceItem::RarFile(PathBuf::from("foo.rar")),
            SourceItem::RarFile(PathBuf::from("foo:.rar")),
        ];

        ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default())
            .expect("a task that cannot produce output cannot collide");
    }

    #[test]
    fn move_up_in_folder_mode_keeps_output_names_with_their_sources() {
        // Regression: a Folder name is derived from the SOURCE, so it must travel
        // with its task. Before `OutputName`, `swap_and_rebind` applied the Zip
        // rule to every mode and left the name with the POSITION, so after one
        // move `foo.rar`'s task claimed the label `bar` while its bytes still
        // landed in `out/foo`.
        let items = vec![
            SourceItem::RarFile(PathBuf::from("/a/foo.rar")),
            SourceItem::ZipFile(PathBuf::from("/b/bar.zip")),
        ];
        let mut job =
            ArchiveJob::plan_extract(items, out_dir(), ConflictPolicy::default()).unwrap();
        let second = job.tasks()[1].id();

        job.move_up(second).unwrap();

        for task in job.tasks() {
            let expected = task.source().output_stem();
            assert_eq!(task.output_name().as_str(), Some(expected.as_str()));
        }
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
