//! Integration test that crosses the Tauri `run_job` command seam.
//!
//! `run_job` itself needs a live `AppHandle`, so we drive its IPC-free core,
//! [`run_job_inner`], with a recording emitter standing in for the Tauri event
//! bridge. The job is built through the public `AppState`/`JobDraft` API exactly
//! as the draft commands do, so this exercises the whole presentation→core path
//! end to end against a real `ZipArchiver` and `SystemClock`.

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

use simple_archiver_core::domain::archive_job::ArchiveJob;
use simple_archiver_core::domain::source_item::SourceItem;

use simple_archiver_lib::presentation::commands::run_job_inner;
use simple_archiver_lib::presentation::dto::ProgressEvent;
use simple_archiver_lib::presentation::events::ProgressEmitter;
use simple_archiver_lib::presentation::state::AppState;

/// A [`ProgressEmitter`] test double that records every emitted event.
#[derive(Default)]
struct RecordingEmitter(Mutex<Vec<ProgressEvent>>);

impl ProgressEmitter for RecordingEmitter {
    fn emit_progress(&self, ev: &ProgressEvent) {
        self.0.lock().unwrap().push(ev.clone());
    }
}

/// Create a temp source folder containing one file, returning its handle.
fn source_folder_with_file(contents: &[u8]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("create source tempdir");
    fs::write(dir.path().join("data.bin"), contents).expect("write data.bin");
    dir
}

/// Build a two-folder [`ArchiveJob`] through the public draft API, writing the
/// output zips into `out_dir`.
fn build_two_folder_job(src_a: &Path, src_b: &Path, out_dir: &Path) -> ArchiveJob {
    let state = AppState::default();
    {
        let mut draft = state.draft.lock().unwrap();
        draft.add_items(vec![
            SourceItem::Folder(src_a.to_path_buf()),
            SourceItem::Folder(src_b.to_path_buf()),
        ]);
        draft
            .set_template("out_{n}".to_string())
            .expect("valid template");
        draft.set_out_dir(out_dir.to_path_buf());
    }
    let draft = state.draft.lock().unwrap();
    draft.build().expect("draft should build into a job")
}

#[tokio::test]
async fn run_job_inner_happy_path_archives_every_item() {
    let src_a = source_folder_with_file(b"alpha");
    let src_b = source_folder_with_file(b"beta");
    let out_dir = tempfile::tempdir().expect("create out tempdir");

    let job = build_two_folder_job(src_a.path(), src_b.path(), out_dir.path());

    let emitter = RecordingEmitter::default();
    let token = CancellationToken::new();
    let summary = run_job_inner(&emitter, job, token).await;

    assert_eq!(summary.succeeded.len(), 2, "both tasks should succeed");
    assert!(summary.failed.is_empty(), "no task should fail");
    assert!(summary.cancelled.is_empty(), "no task should be cancelled");

    // At least one progress event must have crossed the emitter seam, and the
    // final recorded event must carry real byte data (non-zero bytes_done),
    // confirming the engine reported actual I/O progress through the seam.
    let recorded = emitter.0.lock().unwrap();
    assert!(
        !recorded.is_empty(),
        "at least one progress event should be emitted"
    );
    assert!(
        recorded.last().unwrap().overall.bytes_done > 0,
        "last progress event must report non-zero bytes_done"
    );
    drop(recorded);

    // The two output zips must exist on disk.
    assert!(
        out_dir.path().join("out_1.zip").is_file(),
        "out_1.zip should exist"
    );
    assert!(
        out_dir.path().join("out_2.zip").is_file(),
        "out_2.zip should exist"
    );
}

/// Path to the committed real RAR5 fixture in the core crate's test tree.
fn rar_fixture() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../crates/core/tests/fixtures/sample.rar")
}

/// Build a two-item job (folder at position 0, rar at position 1) through the
/// public draft API, writing the output zips into `out_dir`.
fn build_mixed_job(src_folder: &Path, rar: &Path, out_dir: &Path) -> ArchiveJob {
    let state = AppState::default();
    {
        let mut draft = state.draft.lock().unwrap();
        draft.add_items(vec![
            SourceItem::Folder(src_folder.to_path_buf()),
            SourceItem::RarFile(rar.to_path_buf()),
        ]);
        draft
            .set_template("out_{n}".to_string())
            .expect("valid template");
        draft.set_out_dir(out_dir.to_path_buf());
    }
    let draft = state.draft.lock().unwrap();
    draft.build().expect("draft should build into a job")
}

#[tokio::test]
async fn run_job_inner_mixed_folder_and_rar_produce_both_zips() {
    let src_folder = source_folder_with_file(b"from folder");
    let out_dir = tempfile::tempdir().expect("create out tempdir");

    let job = build_mixed_job(src_folder.path(), &rar_fixture(), out_dir.path());

    let emitter = RecordingEmitter::default();
    let token = CancellationToken::new();
    let summary = run_job_inner(&emitter, job, token).await;

    assert_eq!(
        summary.succeeded.len(),
        2,
        "both tasks should succeed: {summary:?}"
    );
    assert!(
        summary.failed.is_empty(),
        "no task should fail: {summary:?}"
    );
    assert!(summary.cancelled.is_empty(), "no task should be cancelled");

    // Folder → out_1.zip (position 0); rar → out_2.zip (position 1).
    assert!(
        out_dir.path().join("out_1.zip").is_file(),
        "out_1.zip should exist"
    );
    assert!(
        out_dir.path().join("out_2.zip").is_file(),
        "out_2.zip should exist"
    );
}

#[tokio::test]
async fn run_job_inner_pre_cancelled_archives_nothing() {
    let src_a = source_folder_with_file(b"alpha");
    let src_b = source_folder_with_file(b"beta");
    let out_dir = tempfile::tempdir().expect("create out tempdir");

    let job = build_two_folder_job(src_a.path(), src_b.path(), out_dir.path());

    let emitter = RecordingEmitter::default();
    let token = CancellationToken::new();
    token.cancel();
    let summary = run_job_inner(&emitter, job, token).await;

    // The engine's fast-path classifies every task as cancelled before touching
    // the filesystem, so nothing succeeds, nothing fails, and exactly two tasks
    // are cancelled. The order of task ids in `cancelled` is non-deterministic
    // (tasks run on a thread pool), so check the count rather than an exact vec.
    assert_eq!(
        summary.cancelled.len(),
        2,
        "both tasks must be reported as cancelled: {:?}",
        summary.cancelled
    );
    assert!(
        summary.succeeded.is_empty(),
        "a pre-cancelled job must not succeed any task, got: {:?}",
        summary.succeeded
    );
    assert!(
        summary.failed.is_empty(),
        "a pre-cancelled job must not fail any task, got: {:?}",
        summary.failed
    );

    // No partial output zip may remain on disk.
    assert!(
        !out_dir.path().join("out_1.zip").exists(),
        "out_1.zip must not exist after cancellation"
    );
    assert!(
        !out_dir.path().join("out_2.zip").exists(),
        "out_2.zip must not exist after cancellation"
    );
}
