#![cfg(not(loom))]
//! Acceptance: a real `.rar` is extracted and recompressed into a `.zip` through
//! the full execution engine (real UnrarExtractor + real ZipArchiver).

use simple_archiver_core::application::progress::{JobProgress, ProgressSink};
use simple_archiver_core::application::run_archive_job::RunArchiveJob;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::output_directory::OutputDirectory;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::infrastructure::system_clock::SystemClock;
use simple_archiver_core::infrastructure::unrar_extractor::UnrarExtractor;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::path::Path;
use std::sync::Arc;

struct NullSink;
impl ProgressSink for NullSink {
    fn report(&self, _snapshot: JobProgress) {}
}

fn fixture() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.rar")
}

#[tokio::test]
async fn rar_is_extracted_and_recompressed_to_zip() {
    let out = tempfile::tempdir().expect("output dir");
    let job = simple_archiver_core::domain::archive_job::ArchiveJob::plan(
        vec![SourceItem::RarFile(fixture())],
        NamingRule::parse("out{n}").unwrap(),
        OutputDirectory::new(out.path().to_path_buf()),
    )
    .unwrap();

    let engine = RunArchiveJob::with_default_parallelism(
        Arc::new(ZipArchiver::new()),
        Arc::new(UnrarExtractor::new()),
    );
    let summary = engine.execute(job, &SystemClock::new(), &NullSink).await;

    assert_eq!(
        summary.succeeded.len(),
        1,
        "the rar task should succeed: {summary:?}"
    );
    assert!(summary.failed.is_empty());

    // The output zip exists and contains the fixture's file.
    let zip_path = out.path().join("out1.zip");
    assert!(zip_path.is_file(), "expected {zip_path:?} to exist");

    let bytes = std::fs::read(&zip_path).expect("read zip");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("open zip");
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();
    assert!(
        names.iter().any(|n| n.ends_with("hello world.txt")),
        "zip should contain hello world.txt, got {names:?}"
    );
}

#[tokio::test]
async fn mixed_folder_and_rar_both_produce_zips() {
    let out = tempfile::tempdir().expect("output dir");
    let src_folder = tempfile::tempdir().expect("source folder");
    std::fs::write(src_folder.path().join("file.txt"), b"from folder").expect("write folder file");

    // Two items in order: a folder (out1.zip) then a rar fixture (out2.zip).
    let job = simple_archiver_core::domain::archive_job::ArchiveJob::plan(
        vec![
            SourceItem::Folder(src_folder.path().to_path_buf()),
            SourceItem::RarFile(fixture()),
        ],
        NamingRule::parse("out{n}").unwrap(),
        OutputDirectory::new(out.path().to_path_buf()),
    )
    .unwrap();

    let engine = RunArchiveJob::with_default_parallelism(
        Arc::new(ZipArchiver::new()),
        Arc::new(UnrarExtractor::new()),
    );
    let summary = engine.execute(job, &SystemClock::new(), &NullSink).await;

    assert_eq!(
        summary.succeeded.len(),
        2,
        "both tasks should succeed: {summary:?}"
    );
    assert!(summary.failed.is_empty());

    // Folder → out1.zip (position 0); rar → out2.zip (position 1).
    let folder_zip = out.path().join("out1.zip");
    let rar_zip = out.path().join("out2.zip");
    assert!(folder_zip.is_file(), "expected {folder_zip:?} to exist");
    assert!(rar_zip.is_file(), "expected {rar_zip:?} to exist");
}
