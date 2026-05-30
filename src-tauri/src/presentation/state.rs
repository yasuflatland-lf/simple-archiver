//! Session state shared across Tauri commands.
//!
//! `AppState` is held in Tauri's managed state and accessed by each command
//! handler. All fields are wrapped in `std::sync::Mutex` so they are
//! `Send + Sync` without async locks — no lock must be held across an
//! `.await` point (Wave 3 enforces that rule in the command layer).

use std::path::PathBuf;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use simple_archiver_core::domain::archive_job::ArchiveJob;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::output_directory::OutputDirectory;
use simple_archiver_core::domain::source_item::SourceItem;

use crate::presentation::dto::{draft_item_from_source, DraftSnapshot};

// ─────────────────────────────────────────────────────────────────────────────
// JobDraft
// ─────────────────────────────────────────────────────────────────────────────

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
    template: Option<String>,
    out_dir: Option<PathBuf>,
}

impl JobDraft {
    /// Create an empty draft with no items, template, or output directory.
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            template: None,
            out_dir: None,
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
    /// On success the validated template string is stored. On failure the
    /// existing template (if any) is left unchanged and an error message is
    /// returned.
    pub fn set_template(&mut self, template: String) -> Result<(), String> {
        NamingRule::parse(&template).map_err(|e| e.to_string())?;
        self.template = Some(template);
        Ok(())
    }

    /// Set the output directory.
    pub fn set_out_dir(&mut self, dir: PathBuf) {
        self.out_dir = Some(dir);
    }

    /// Return a serialisable snapshot of the current draft for the frontend.
    pub fn snapshot(&self) -> DraftSnapshot {
        DraftSnapshot {
            items: self.items.iter().map(draft_item_from_source).collect(),
            naming_template: self.template.clone(),
            output_dir: self
                .out_dir
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// Validate the draft and plan an [`ArchiveJob`].
    ///
    /// Returns an error string if the template or output directory is missing,
    /// if there are no items, or if [`ArchiveJob::plan`] fails.
    pub fn build(&self) -> Result<ArchiveJob, String> {
        let template = self
            .template
            .as_deref()
            .ok_or_else(|| "naming rule not set".to_string())?;

        let out_dir = self
            .out_dir
            .as_ref()
            .ok_or_else(|| "output directory not set".to_string())?;

        let rule = NamingRule::parse(template).map_err(|e| e.to_string())?;

        ArchiveJob::plan(
            self.items.clone(),
            rule,
            OutputDirectory::new(out_dir.clone()),
        )
        .map_err(|e| e.to_string())
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
/// the user requests an abort. `token` is `None` when no job is running.
#[derive(Default)]
pub struct RunState {
    /// The cancellation token for the active job, or `None` when idle.
    pub token: Option<CancellationToken>,
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
}
