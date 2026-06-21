//! Session state shared across Tauri commands.
//!
//! `AppState` is held in Tauri's managed state and accessed by each command
//! handler. All fields are wrapped in `std::sync::Mutex` so they are
//! `Send + Sync` without async locks — no lock must be held across an
//! `.await` point (run_job in commands.rs holds no std lock across .await).

use std::path::PathBuf;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use simple_archiver_core::domain::archive_job::ArchiveJob;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::output_directory::OutputDirectory;
use simple_archiver_core::domain::output_mode::OutputMode;
use simple_archiver_core::domain::source_item::SourceItem;

use crate::presentation::dto::{draft_item_from_source, DraftSnapshot};

// ─────────────────────────────────────────────────────────────────────────────
// JobDraft
// ─────────────────────────────────────────────────────────────────────────────

/// A naming template that has already been validated by [`NamingRule::parse`].
///
/// Holds both the parsed [`NamingRule`] and the original `raw` string so the
/// template is parsed exactly once: [`build`] reuses `rule` directly while
/// [`snapshot`] reuses `raw` for the wire shape. `NamingRule` exposes no
/// accessor to recover its source string, so the raw string is kept alongside.
///
/// [`build`]: JobDraft::build
/// [`snapshot`]: JobDraft::snapshot
struct ParsedTemplate {
    /// The original, validated template string (needed for the snapshot).
    raw: String,
    /// The rule parsed from `raw`, reused by `build` without re-parsing.
    rule: NamingRule,
}

/// Mutable draft of the next archive job, accumulated from UI interactions.
///
/// The draft is built up incrementally: items are added, optionally reordered,
/// and a naming template and output directory are set before the user starts the
/// job. [`build`] validates the completed draft and converts it into a planned
/// [`ArchiveJob`].
///
/// [`build`]: JobDraft::build
pub struct JobDraft {
    items: Vec<SourceItem>,
    template: Option<ParsedTemplate>,
    out_dir: Option<PathBuf>,
    output_mode: OutputMode,
}

impl JobDraft {
    /// Create an empty draft with no items, template, or output directory.
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            template: None,
            out_dir: None,
            output_mode: OutputMode::default(), // Zip
        }
    }

    /// Append `items` to the draft in the order given.
    pub fn add_items(&mut self, items: Vec<SourceItem>) {
        self.items.extend(items);
    }

    /// Move the item at `from` to `to` (both 0-based indices).
    ///
    /// Returns an error message if either index is out of range.
    pub fn reorder(&mut self, from: usize, to: usize) -> Result<(), String> {
        let len = self.items.len();
        if from >= len {
            return Err(format!(
                "reorder: `from` index {from} is out of range (len = {len})"
            ));
        }
        if to >= len {
            return Err(format!(
                "reorder: `to` index {to} is out of range (len = {len})"
            ));
        }
        let item = self.items.remove(from);
        self.items.insert(to, item);
        Ok(())
    }

    /// Set the naming template, validating it with [`NamingRule::parse`].
    ///
    /// On success the validated template string and its parsed [`NamingRule`]
    /// are stored together so the template is parsed exactly once (reused later
    /// by [`build`]). On failure the existing template (if any) is left
    /// unchanged and an error message is returned.
    ///
    /// [`build`]: JobDraft::build
    pub fn set_template(&mut self, template: String) -> Result<(), String> {
        let rule = NamingRule::parse(&template).map_err(|e| e.to_string())?;
        self.template = Some(ParsedTemplate {
            raw: template,
            rule,
        });
        Ok(())
    }

    /// Remove all queued items from the draft.
    ///
    /// Invariant: the naming template and output directory are left unchanged so
    /// the user's settings are preserved when they drop a fresh batch of files.
    pub fn clear_items(&mut self) {
        self.items.clear();
    }

    /// Set the output directory.
    pub fn set_out_dir(&mut self, dir: PathBuf) {
        self.out_dir = Some(dir);
    }

    /// Set the output mode (re-zip vs extract-to-folder).
    pub fn set_output_mode(&mut self, mode: OutputMode) {
        self.output_mode = mode;
    }

    /// Return a serialisable snapshot of the current draft for the frontend.
    pub fn snapshot(&self) -> DraftSnapshot {
        DraftSnapshot {
            items: self.items.iter().map(draft_item_from_source).collect(),
            naming_template: self.template.as_ref().map(|t| t.raw.clone()),
            output_dir: self
                .out_dir
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// Validate the draft and plan an [`ArchiveJob`].
    ///
    /// Branches on [`output_mode`]:
    /// - [`OutputMode::Zip`]: requires both a naming template and an output
    ///   directory, then calls [`ArchiveJob::plan`].
    /// - [`OutputMode::Folder`]: requires only an output directory (no template),
    ///   then calls [`ArchiveJob::plan_extract`].
    ///
    /// Returns an error string if required fields are missing, if there are no
    /// items, or if the underlying plan call fails.
    ///
    /// [`output_mode`]: JobDraft::output_mode
    pub fn build(&self) -> Result<ArchiveJob, String> {
        let out_dir = self
            .out_dir
            .as_ref()
            .ok_or_else(|| "output directory not set".to_string())?;

        match self.output_mode {
            OutputMode::Zip => {
                let template = self
                    .template
                    .as_ref()
                    .ok_or_else(|| "naming rule not set".to_string())?;
                // Reuse the rule parsed in `set_template`; the template is
                // never re-parsed here.
                ArchiveJob::plan(
                    self.items.clone(),
                    template.rule.clone(),
                    OutputDirectory::new(out_dir.clone()),
                )
                .map_err(|e| e.to_string())
            }
            OutputMode::Folder => {
                ArchiveJob::plan_extract(
                    self.items.clone(),
                    OutputDirectory::new(out_dir.clone()),
                )
                .map_err(|e| e.to_string())
            }
        }
    }
}

impl Default for JobDraft {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// RunState
// ─────────────────────────────────────────────────────────────────────────────

/// State for the currently running job (if any).
///
/// Holds a [`CancellationToken`] that the presentation layer can cancel when
/// the user requests an abort. The slot is `None` when no job is running.
///
/// The token is **private** so the "single active job" invariant is owned by
/// this type, not by any caller: only [`try_start`] may occupy the slot (and it
/// rejects a second job), [`request_cancel`] only observes-and-cancels, and
/// [`finish`] is the sole way to clear it. A caller cannot bypass the guard by
/// poking the field directly.
///
/// [`try_start`]: RunState::try_start
/// [`request_cancel`]: RunState::request_cancel
/// [`finish`]: RunState::finish
#[derive(Debug, Default)]
pub struct RunState {
    /// The cancellation token for the active job, or `None` when idle.
    token: Option<CancellationToken>,
}

impl RunState {
    /// Claim the active-job slot with `token`.
    ///
    /// Returns `Ok(())` if the slot was idle (and stores the token). If a job is
    /// already running, leaves the existing token untouched and returns
    /// `Err("a job is already running")`. This exact message is part of the IPC
    /// contract — the frontend depends on it, so do not change it.
    pub fn try_start(&mut self, token: CancellationToken) -> Result<(), String> {
        if self.token.is_some() {
            return Err("a job is already running".to_string());
        }
        self.token = Some(token);
        Ok(())
    }

    /// Cancel the active job's token if one is present; a no-op when idle.
    ///
    /// Only observes-and-cancels: it never clears the slot (that is [`finish`]'s
    /// job, run by the owning command once the job future settles).
    ///
    /// [`finish`]: RunState::finish
    pub fn request_cancel(&self) {
        if let Some(token) = self.token.as_ref() {
            token.cancel();
        }
    }

    /// Clear the active-job slot so a later [`try_start`] can succeed again.
    ///
    /// [`try_start`]: RunState::try_start
    pub fn finish(&mut self) {
        self.token = None;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AppState
// ─────────────────────────────────────────────────────────────────────────────

/// Top-level Tauri managed state, holding the draft and the active run state.
///
/// Both inner fields are wrapped in `std::sync::Mutex` so the struct is
/// `Send + Sync` and can be registered with `tauri::Builder::manage`. No lock
/// should be held across an `.await` point.
pub struct AppState {
    /// The pending job draft accumulated from UI interactions.
    pub draft: Mutex<JobDraft>,
    /// State for the currently running job (if any).
    pub run: Mutex<RunState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            draft: Mutex::new(JobDraft::default()),
            run: Mutex::new(RunState::default()),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presentation::dto::SourceKind;
    use std::path::PathBuf;

    // ── add_items / snapshot ──────────────────────────────────────────────────

    /// Items added to the draft appear in the snapshot in order with the correct
    /// `SourceKind` (Folder → folder, RarFile → rar).
    #[test]
    fn add_items_then_snapshot_preserves_order_and_kinds() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![
            SourceItem::Folder(PathBuf::from("/a")),
            SourceItem::RarFile(PathBuf::from("/b.rar")),
        ]);
        let snap = draft.snapshot();
        assert_eq!(snap.items.len(), 2);
        assert_eq!(snap.items[0].path, "/a");
        assert_eq!(snap.items[0].kind, SourceKind::Folder);
        assert_eq!(snap.items[1].path, "/b.rar");
        assert_eq!(snap.items[1].kind, SourceKind::Rar);
    }

    // ── reorder ───────────────────────────────────────────────────────────────

    /// Moving an item in range changes the order as expected.
    #[test]
    fn reorder_in_range_moves_item() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![
            SourceItem::Folder(PathBuf::from("/first")),
            SourceItem::Folder(PathBuf::from("/second")),
            SourceItem::Folder(PathBuf::from("/third")),
        ]);
        // Move item at index 0 to index 2.
        draft.reorder(0, 2).expect("reorder should succeed");
        let snap = draft.snapshot();
        assert_eq!(snap.items[0].path, "/second");
        assert_eq!(snap.items[1].path, "/third");
        assert_eq!(snap.items[2].path, "/first");
    }

    /// A `from` index that equals the length is out of range.
    #[test]
    fn reorder_from_out_of_range_returns_err() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![SourceItem::Folder(PathBuf::from("/a"))]);
        let result = draft.reorder(1, 0); // len is 1, index 1 is OOB
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("from"), "error should mention `from`: {msg}");
    }

    /// A `to` index that equals the length is out of range.
    #[test]
    fn reorder_to_out_of_range_returns_err() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![SourceItem::Folder(PathBuf::from("/a"))]);
        let result = draft.reorder(0, 1); // len is 1, index 1 is OOB
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("to"), "error should mention `to`: {msg}");
    }

    /// `reorder(from == to)` on a 3-item draft returns `Ok(())` and leaves order
    /// unchanged (the remove + insert at the same index is a no-op in practice).
    #[test]
    fn reorder_same_index_is_ok_and_order_unchanged() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![
            SourceItem::Folder(PathBuf::from("/first")),
            SourceItem::Folder(PathBuf::from("/second")),
            SourceItem::Folder(PathBuf::from("/third")),
        ]);
        assert!(
            draft.reorder(1, 1).is_ok(),
            "reorder with from == to should succeed"
        );
        let snap = draft.snapshot();
        assert_eq!(snap.items[0].path, "/first");
        assert_eq!(snap.items[1].path, "/second");
        assert_eq!(snap.items[2].path, "/third");
    }

    /// `reorder` on an empty (freshly-`new()`) draft returns `Err` whose message
    /// mentions "from" (the `from` index check fires first).
    #[test]
    fn reorder_on_empty_draft_returns_err_mentioning_from() {
        let mut draft = JobDraft::new();
        let err = draft
            .reorder(0, 0)
            .expect_err("reorder on empty draft must fail");
        assert!(
            err.contains("from"),
            "error on empty draft should mention `from`: {err}"
        );
    }

    // ── set_template ──────────────────────────────────────────────────────────

    /// A valid template is stored and appears in the snapshot.
    #[test]
    fn set_template_valid_stores_and_appears_in_snapshot() {
        let mut draft = JobDraft::new();
        draft
            .set_template("photo_{n:03}".to_string())
            .expect("valid template should be accepted");
        let snap = draft.snapshot();
        assert_eq!(snap.naming_template, Some("photo_{n:03}".to_string()));
    }

    /// A valid template is accepted, surfaces verbatim in the snapshot, and lets
    /// `build` succeed — exercising the stored parsed rule end to end so the
    /// template is parsed exactly once.
    #[test]
    fn set_template_valid_appears_in_snapshot_and_build_succeeds() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![SourceItem::RarFile(PathBuf::from("/a.rar"))]);
        draft
            .set_template("photo_{n:03}".to_string())
            .expect("valid template should be accepted");
        draft.set_out_dir(PathBuf::from("/out"));

        let snap = draft.snapshot();
        assert_eq!(snap.naming_template, Some("photo_{n:03}".to_string()));

        let job = draft
            .build()
            .expect("draft with a valid template should plan OK");
        assert_eq!(job.tasks().len(), 1, "job should have one task per item");
    }

    /// An empty-string template is rejected and `snapshot().naming_template` stays
    /// `None` — an empty string must not overwrite a previously valid template.
    #[test]
    fn set_template_empty_string_returns_err_and_does_not_store() {
        let mut draft = JobDraft::new();
        let result = draft.set_template(String::new());
        assert!(result.is_err(), "empty template string should return Err");
        let snap = draft.snapshot();
        assert_eq!(
            snap.naming_template, None,
            "empty template must not be stored"
        );
    }

    /// An invalid template is rejected and the stored template is left unchanged.
    #[test]
    fn set_template_invalid_returns_err_and_does_not_store() {
        let mut draft = JobDraft::new();
        // `{x}` is not a recognised placeholder, so the parse fails.
        let result = draft.set_template("img_{x}".to_string());
        assert!(result.is_err(), "invalid template should return Err");
        let snap = draft.snapshot();
        assert_eq!(
            snap.naming_template, None,
            "invalid template must not be stored"
        );
    }

    // ── set_out_dir / snapshot.output_dir ────────────────────────────────────

    /// The output directory set on the draft appears as a string in the snapshot.
    #[test]
    fn set_out_dir_appears_in_snapshot() {
        let mut draft = JobDraft::new();
        draft.set_out_dir(PathBuf::from("/output/dir"));
        let snap = draft.snapshot();
        assert_eq!(snap.output_dir, Some("/output/dir".to_string()));
    }

    // ── build ─────────────────────────────────────────────────────────────────

    /// `build` returns an error when no naming template has been set.
    #[test]
    fn build_errs_when_template_missing() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![SourceItem::RarFile(PathBuf::from("/a.rar"))]);
        draft.set_out_dir(PathBuf::from("/out"));
        let result = draft.build();
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("naming rule not set"),
            "error must mention missing naming rule"
        );
    }

    /// `build` returns an error when no output directory has been set.
    #[test]
    fn build_errs_when_out_dir_missing() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![SourceItem::RarFile(PathBuf::from("/a.rar"))]);
        draft.set_template("file{n}".to_string()).unwrap();
        let result = draft.build();
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("output directory not set"),
            "error must mention missing output directory"
        );
    }

    /// `build` surfaces the `PlanError::Empty` message when the item list is empty.
    #[test]
    fn build_errs_when_no_items() {
        let mut draft = JobDraft::new();
        draft.set_template("file{n}".to_string()).unwrap();
        draft.set_out_dir(PathBuf::from("/out"));
        let result = draft.build();
        assert!(result.is_err());
        // PlanError::Empty displays as "an archive job needs at least one item"
        let msg = result.unwrap_err();
        assert!(
            msg.contains("at least one item"),
            "error should mention empty item list: {msg}"
        );
    }

    /// A fully configured draft with at least one item produces a valid job.
    #[test]
    fn build_succeeds_with_template_and_out_dir_and_items() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![
            SourceItem::RarFile(PathBuf::from("/a.rar")),
            SourceItem::Folder(PathBuf::from("/b")),
        ]);
        draft.set_template("file{n}".to_string()).unwrap();
        draft.set_out_dir(PathBuf::from("/out"));
        let job = draft
            .build()
            .expect("fully configured draft should plan OK");
        assert_eq!(job.tasks().len(), 2, "job should have one task per item");
    }

    // ── clear_items ───────────────────────────────────────────────────────────

    /// `clear_items` empties the item list while preserving the naming template
    /// and output directory that were already configured.
    #[test]
    fn clear_items_empties_items_and_preserves_template_and_out_dir() {
        let mut draft = JobDraft::new();
        draft.add_items(vec![
            SourceItem::RarFile(PathBuf::from("/a.rar")),
            SourceItem::Folder(PathBuf::from("/b")),
        ]);
        draft
            .set_template("photo_{n:03}".to_string())
            .expect("valid template should be accepted");
        draft.set_out_dir(PathBuf::from("/output"));

        draft.clear_items();

        let snap = draft.snapshot();
        assert_eq!(snap.items.len(), 0, "items must be empty after clear_items");
        assert_eq!(
            snap.naming_template,
            Some("photo_{n:03}".to_string()),
            "naming_template must be preserved"
        );
        assert_eq!(
            snap.output_dir,
            Some("/output".to_string()),
            "output_dir must be preserved"
        );
    }

    // ── set_output_mode / build branching ────────────────────────────────────

    /// A fresh draft defaults to Zip mode; `build` without a template must fail.
    #[test]
    fn default_draft_is_zip_mode() {
        let draft = JobDraft::new();
        // build still requires a template in Zip mode.
        let mut d = draft;
        d.add_items(vec![SourceItem::RarFile(PathBuf::from("/a.rar"))]);
        d.set_out_dir(PathBuf::from("/out"));
        assert!(
            d.build().is_err(),
            "Zip mode without a template must not build"
        );
    }

    /// In Folder mode a naming template is not required; items + out_dir suffice.
    #[test]
    fn folder_mode_builds_without_a_template() {
        let mut draft = JobDraft::new();
        draft.set_output_mode(OutputMode::Folder);
        draft.add_items(vec![SourceItem::RarFile(PathBuf::from("/in/a.rar"))]);
        draft.set_out_dir(PathBuf::from("/out"));

        let job = draft
            .build()
            .expect("Folder mode needs no template, only items + out dir");
        assert_eq!(job.output_mode(), OutputMode::Folder);
        assert_eq!(job.tasks().len(), 1);
    }

    /// In Folder mode the output directory is still mandatory.
    #[test]
    fn folder_mode_still_requires_output_dir() {
        let mut draft = JobDraft::new();
        draft.set_output_mode(OutputMode::Folder);
        draft.add_items(vec![SourceItem::RarFile(PathBuf::from("/in/a.rar"))]);
        let err = draft.build().expect_err("missing out dir must fail");
        assert!(err.contains("output directory not set"), "got: {err}");
    }

    // ── RunState ──────────────────────────────────────────────────────────────

    /// `try_start` succeeds on a fresh (idle) state.
    #[test]
    fn try_start_succeeds_on_fresh_state() {
        let mut run = RunState::default();
        assert!(
            run.try_start(CancellationToken::new()).is_ok(),
            "claiming an idle slot should succeed"
        );
    }

    /// A second `try_start` is rejected with the exact contract message while a
    /// job is already running.
    #[test]
    fn second_try_start_returns_already_running_err() {
        let mut run = RunState::default();
        run.try_start(CancellationToken::new())
            .expect("first claim should succeed");
        let err = run
            .try_start(CancellationToken::new())
            .expect_err("second claim must be rejected");
        // This exact string is part of the IPC contract (frontend depends on it).
        assert_eq!(err, "a job is already running");
    }

    /// `request_cancel` on an idle state is a no-op (and must not panic).
    #[test]
    fn request_cancel_on_idle_state_is_noop() {
        let run = RunState::default();
        run.request_cancel(); // must not panic with no token present
    }

    /// After `try_start`, `request_cancel` cancels the stored token.
    #[test]
    fn request_cancel_after_try_start_cancels_token() {
        let mut run = RunState::default();
        let token = CancellationToken::new();
        run.try_start(token.clone()).expect("claim should succeed");
        assert!(!token.is_cancelled(), "token starts uncancelled");
        run.request_cancel();
        assert!(
            token.is_cancelled(),
            "request_cancel must cancel the active token"
        );
    }

    /// `finish` clears the slot so a later `try_start` succeeds again.
    #[test]
    fn finish_clears_slot_so_try_start_succeeds_again() {
        let mut run = RunState::default();
        run.try_start(CancellationToken::new())
            .expect("first claim should succeed");
        run.finish();
        assert!(
            run.try_start(CancellationToken::new()).is_ok(),
            "after finish the slot is free for a new job"
        );
    }
}
