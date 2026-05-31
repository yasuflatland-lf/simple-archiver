//! Tauri commands (presentation adapter).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;

use simple_archiver_core::application::compress_context::CompressContext;
use simple_archiver_core::application::ports::Archiver;
use simple_archiver_core::application::run_archive_job::RunArchiveJob;
use simple_archiver_core::domain::archive_job::ArchiveJob;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::sequence_number::SequenceNumber;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::infrastructure::archive_extractor::ArchiveExtractor;
use simple_archiver_core::infrastructure::system_clock::SystemClock;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;

use crate::presentation::dto::{DraftSnapshot, JobSummaryDto};
use crate::presentation::events::{EventSink, ProgressEmitter, TauriEmitter};
use crate::presentation::state::{AppState, RunState};

/// Compress the folder at `src` into a zip file at `out`.
///
/// Errors are surfaced to the frontend as a string so they cross the IPC
/// boundary (the promise rejects with this message).
#[tauri::command]
pub async fn compress_folder(src: String, out: String) -> Result<(), String> {
    ZipArchiver::new()
        .compress(
            Path::new(&src),
            Path::new(&out),
            &CompressContext::detached(),
        )
        .await
        .map_err(|e| e.to_string())
}

/// Resolve `template` against `seq` and return the output filename.
///
/// Domain errors are surfaced to the frontend as a string so they cross the IPC
/// boundary (the promise rejects with this message).
#[tauri::command]
pub fn preview_output_name(template: String, seq: u32) -> Result<String, String> {
    let seq = SequenceNumber::new(seq).map_err(|e| e.to_string())?;
    let rule = NamingRule::parse(&template).map_err(|e| e.to_string())?;
    let name = rule.resolve(seq).map_err(|e| e.to_string())?;
    Ok(name.as_str().to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Path classification
// ─────────────────────────────────────────────────────────────────────────────

/// Probe the filesystem for `path` and delegate to `SourceItem::classify`.
///
/// The `is_dir` probe stays here (presentation) so the domain stays IO-free;
/// the domain error is mapped to a `String` for the IPC boundary.
fn classify_path(path: &Path) -> Result<SourceItem, String> {
    SourceItem::classify(path.to_path_buf(), path.is_dir()).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft commands
// ─────────────────────────────────────────────────────────────────────────────

/// Classify and append the given paths to the draft, returning the new snapshot.
///
/// The first unclassifiable path aborts the whole call with its error, so an
/// invalid drop never mutates the draft.
#[tauri::command]
pub fn add_items(state: State<'_, AppState>, paths: Vec<String>) -> Result<DraftSnapshot, String> {
    let items = paths
        .iter()
        .map(|p| classify_path(Path::new(p)))
        .collect::<Result<Vec<_>, _>>()?;
    let mut draft = state.draft.lock().map_err(|e| e.to_string())?;
    draft.add_items(items);
    Ok(draft.snapshot())
}

/// Move the draft item at `from` to `to`, returning the new snapshot.
#[tauri::command]
pub fn reorder(
    state: State<'_, AppState>,
    from: usize,
    to: usize,
) -> Result<DraftSnapshot, String> {
    let mut draft = state.draft.lock().map_err(|e| e.to_string())?;
    draft.reorder(from, to)?;
    Ok(draft.snapshot())
}

/// Set the draft's naming template, returning the new snapshot.
#[tauri::command]
pub fn set_naming_rule(
    state: State<'_, AppState>,
    template: String,
) -> Result<DraftSnapshot, String> {
    let mut draft = state.draft.lock().map_err(|e| e.to_string())?;
    draft.set_template(template)?;
    Ok(draft.snapshot())
}

/// Clear all queued items from the draft, returning the new snapshot.
///
/// The naming template and output directory are preserved so the user's
/// settings survive a queue reset.
#[tauri::command]
pub fn clear_items(state: State<'_, AppState>) -> Result<DraftSnapshot, String> {
    let mut draft = state.draft.lock().map_err(|e| e.to_string())?;
    draft.clear_items();
    Ok(draft.snapshot())
}

/// Set the draft's output directory, returning the new snapshot.
#[tauri::command]
pub fn set_output_dir(state: State<'_, AppState>, dir: String) -> Result<DraftSnapshot, String> {
    let mut draft = state.draft.lock().map_err(|e| e.to_string())?;
    draft.set_out_dir(PathBuf::from(dir));
    Ok(draft.snapshot())
}

// ─────────────────────────────────────────────────────────────────────────────
// Run commands
// ─────────────────────────────────────────────────────────────────────────────

/// Run the built job to completion, emitting progress through `emitter`.
///
/// This inner function is the IPC-free core of [`run_job`]: it takes a
/// `&dyn ProgressEmitter` instead of an [`AppHandle`] so integration tests can
/// drive a full job without a live Tauri application.
///
/// It is `pub` (not `pub(crate)`) solely so the `tests/` integration crate can
/// reach it.
#[doc(hidden)]
pub async fn run_job_inner(
    emitter: &dyn ProgressEmitter,
    job: ArchiveJob,
    token: CancellationToken,
) -> JobSummaryDto {
    let engine = RunArchiveJob::with_default_parallelism(
        Arc::new(ZipArchiver::new()),
        Arc::new(ArchiveExtractor::new()),
    );
    let clock = SystemClock::new();
    let sink = EventSink::new(emitter);
    let summary = engine
        .execute_with_cancellation(job, &clock, &sink, token)
        .await;
    JobSummaryDto::from(summary)
}

/// RAII guard that clears the active-job slot when dropped.
///
/// This exists for panic/drop safety: if `run_job_inner(...).await` panics or the
/// command future is dropped mid-flight, `Drop` still runs and frees the slot, so
/// a later `run_job` is not stranded returning "a job is already running" forever.
///
/// It holds a *reference* to the mutex (not a live `MutexGuard`) so nothing is
/// held across the `.await`, preserving the "no std `Mutex` across await" rule
/// (and clippy's `await_holding_lock`); it locks only inside `Drop`.
struct RunSlotGuard<'a> {
    run: &'a std::sync::Mutex<RunState>,
}

impl Drop for RunSlotGuard<'_> {
    fn drop(&mut self) {
        // Recover from a poisoned lock so the slot is always cleared: a prior
        // panic must not strand the active-job slot (interim no-silent-failure
        // policy — cleanup must not be silently skipped).
        let mut run = self
            .run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        run.finish();
    }
}

/// Build the current draft into a job and run it, streaming progress events.
///
/// Rejects with an error if a job is already running. No `std::sync::Mutex`
/// guard is ever held across the `.await`: each lock lives in its own scope and
/// is dropped before the engine runs.
#[tauri::command]
pub async fn run_job(app: AppHandle, state: State<'_, AppState>) -> Result<JobSummaryDto, String> {
    // 1. Build the job (lock draft -> build -> drop guard before awaiting).
    //    A fresh job refuses to start on a poisoned lock, so propagate poison as
    //    an IPC error here rather than recovering.
    let job = {
        let draft = state.draft.lock().map_err(|e| e.to_string())?;
        draft.build()?
    };

    // 2. Claim the active-job slot (rejects with the contract message if a job
    //    is already running). Propagate a poisoned lock as an IPC error: a fresh
    //    job should refuse to start when the lock is poisoned.
    let token = CancellationToken::new();
    {
        let mut run = state.run.lock().map_err(|e| e.to_string())?;
        run.try_start(token.clone())?;
    }

    // 3. Arm the clear guard ONLY after a successful claim, so a rejected start
    //    never clears another job's slot. The guard frees the slot on normal
    //    return AND on any unwind/drop of this future.
    let _slot = RunSlotGuard { run: &state.run };

    // 4. Run with no lock held; the guard clears the slot when it drops.
    let emitter = TauriEmitter::new(app);
    let summary = run_job_inner(&emitter, job, token).await;

    Ok(summary)
}

/// Cancel the currently running job, if any. A no-op when idle.
#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>) {
    // Recover from a poisoned lock so a cancellation request is never silently
    // dropped: an abort the user asked for must still reach the active token
    // even if a prior job panicked (interim no-silent-failure policy).
    let run = state
        .run
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    run.request_cancel();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_resolves_explicit_padded_placeholder() {
        assert_eq!(
            preview_output_name("img_{n:03}".to_string(), 1).unwrap(),
            "img_001.zip"
        );
    }

    #[test]
    fn preview_auto_appends_sequence_when_no_placeholder() {
        assert_eq!(
            preview_output_name("photo".to_string(), 3).unwrap(),
            "photo_3.zip"
        );
    }

    #[test]
    fn preview_rejects_zero_sequence() {
        let err = preview_output_name("{n}".to_string(), 0).unwrap_err();
        assert_eq!(err, "sequence number must be 1 or greater");
    }

    #[test]
    fn preview_rejects_malformed_template_with_exact_contract_message() {
        // Frontend asserts /invalid naming template/i (prefix); this test pins the full string so the suffix can't drift unnoticed.
        let err = preview_output_name("img_{x}".to_string(), 1).unwrap_err();
        assert_eq!(err, "invalid naming template: stray or malformed brace");
    }

    #[test]
    fn preview_rejects_width_out_of_range() {
        let err = preview_output_name("{n:010}".to_string(), 1).unwrap_err();
        assert!(
            err.contains("padding width must be between 1 and 9"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn preview_rejects_forbidden_literal_char() {
        let err = preview_output_name("a:b{n}".to_string(), 1).unwrap_err();
        assert!(
            err.contains("forbidden character"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn preview_rejects_name_invalid_only_after_resolution() {
        // A trailing space passes template parsing but fails FileStem at resolve.
        let err = preview_output_name("{n} ".to_string(), 1).unwrap_err();
        assert_eq!(err, "file name must not end with a dot or space");
    }

    // ── classify_path ─────────────────────────────────────────────────────────

    /// Classification is extension-based; FS existence is intentionally deferred
    /// to the engine (consistent with the domain's no-FS-check stance). A
    /// nonexistent path with a `.rar` extension therefore classifies successfully.
    #[test]
    fn classify_path_nonexistent_rar_classifies_by_extension() {
        let path = std::path::Path::new("/nonexistent/path/archive.rar");
        let item = classify_path(path).expect("nonexistent .rar should classify by extension");
        assert_eq!(item, SourceItem::RarFile(path.to_path_buf()));
    }

    #[test]
    fn classify_path_directory_is_folder() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let item = classify_path(dir.path()).expect("a directory should classify");
        assert_eq!(item, SourceItem::Folder(dir.path().to_path_buf()));
    }

    #[test]
    fn classify_path_rar_file_is_rar() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let rar = dir.path().join("foo.rar");
        std::fs::write(&rar, b"").expect("write foo.rar");
        let item = classify_path(&rar).expect("a .rar file should classify");
        assert_eq!(item, SourceItem::RarFile(rar));
    }

    #[test]
    fn classify_path_zip_is_zip() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let zip = dir.path().join("foo.zip");
        std::fs::write(&zip, b"").expect("write foo.zip");
        let item = classify_path(&zip).expect("a .zip file should classify");
        assert_eq!(item, SourceItem::ZipFile(zip));
    }

    #[test]
    fn classify_path_rar_extension_is_case_insensitive() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let rar = dir.path().join("FOO.RAR");
        std::fs::write(&rar, b"").expect("write FOO.RAR");
        let item = classify_path(&rar).expect("an uppercase .RAR file should classify");
        assert_eq!(item, SourceItem::RarFile(rar));
    }

    #[test]
    fn classify_path_other_file_is_err() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let txt = dir.path().join("note.txt");
        std::fs::write(&txt, b"").expect("write note.txt");
        let err = classify_path(&txt).expect_err("a .txt file should not classify");
        assert!(
            err.contains("unsupported item"),
            "unexpected message: {err}"
        );
    }

    // ── AppState-level draft behavior ────────────────────────────────────────

    /// `add_items` is all-or-nothing: a mixed batch containing an unsupported
    /// path (e.g. `.txt`) must return `Err` and leave the draft item count at 0.
    /// Mirrors what the command shell does (classify all, then mutate draft only
    /// on full success), tested through the public `AppState` fields.
    #[test]
    fn add_items_mixed_batch_returns_err_and_draft_stays_empty() {
        let state = AppState::default();
        let dir = tempfile::tempdir().expect("create tempdir");
        let txt = dir.path().join("note.txt");
        std::fs::write(&txt, b"").expect("write note.txt");

        // Classify a valid dir and an invalid .txt — collect must short-circuit.
        let paths = [
            dir.path().to_string_lossy().into_owned(),
            txt.to_string_lossy().into_owned(),
        ];
        let result: Result<Vec<_>, _> = paths
            .iter()
            .map(|p| classify_path(std::path::Path::new(p)))
            .collect();

        // The classification step must fail before we ever touch the draft.
        assert!(
            result.is_err(),
            "mixed batch classification must return Err"
        );

        // Draft must remain untouched — item count stays 0.
        let draft = state.draft.lock().unwrap();
        let snap = draft.snapshot();
        assert_eq!(
            snap.items.len(),
            0,
            "draft must not be mutated when classification fails"
        );
    }

    /// Exercising the draft through `AppState` (whose fields are `pub`) mirrors
    /// what the thin command shells do, without needing a Tauri `State` wrapper.
    #[test]
    fn app_state_draft_builds_after_items_template_and_out_dir() {
        let state = AppState::default();
        {
            let mut draft = state.draft.lock().unwrap();
            draft.add_items(vec![
                SourceItem::RarFile(PathBuf::from("/a.rar")),
                SourceItem::Folder(PathBuf::from("/b")),
            ]);
            draft.set_template("out_{n}".to_string()).unwrap();
            draft.set_out_dir(PathBuf::from("/out"));
        }
        let draft = state.draft.lock().unwrap();
        let job = draft.build().expect("configured draft should build");
        assert_eq!(job.tasks().len(), 2);
    }

    // ── RunState guard / cancel semantics ────────────────────────────────────

    /// The "already running" guard used by `run_job`: once `try_start` claims the
    /// slot, a second `try_start` is rejected with the exact contract message.
    #[test]
    fn run_state_already_running_guard() {
        let state = AppState::default();
        {
            let mut run = state.run.lock().unwrap();
            run.try_start(CancellationToken::new())
                .expect("first claim should succeed on an idle slot");
        }
        let mut run = state.run.lock().unwrap();
        let err = run
            .try_start(CancellationToken::new())
            .expect_err("a second claim must be rejected while a job runs");
        assert_eq!(err, "a job is already running");
    }

    /// `cancel_job` semantics at the token level: `request_cancel` on the stored
    /// token flips its `is_cancelled` flag.
    #[test]
    fn cancel_marks_stored_token_cancelled() {
        let state = AppState::default();
        let token = CancellationToken::new();
        {
            let mut run = state.run.lock().unwrap();
            run.try_start(token.clone())
                .expect("claim should succeed on an idle slot");
        }
        // Mimic `cancel_job`: lock, then request cancellation of the active token.
        {
            let run = state.run.lock().unwrap();
            run.request_cancel();
        }
        assert!(token.is_cancelled(), "token must report cancellation");
    }
}
