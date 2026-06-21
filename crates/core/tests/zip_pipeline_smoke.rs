#![cfg(not(loom))]
//! Acceptance: a real `.zip` is extracted and recompressed into a `.zip` through
//! the full execution engine (real ArchiveExtractor router + real ZipArchiver).

use simple_archiver_core::application::progress::{JobProgress, ProgressSink};
use simple_archiver_core::application::run_archive_job::RunArchiveJob;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::output_directory::OutputDirectory;
use simple_archiver_core::domain::source_item::SourceItem;
use simple_archiver_core::infrastructure::archive_extractor::ArchiveExtractor;
use simple_archiver_core::infrastructure::fs_placer::FsPlacer;
use simple_archiver_core::infrastructure::system_clock::SystemClock;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::io::Write as _;
use std::sync::Arc;

struct NullSink;
impl ProgressSink for NullSink {
    fn report(&self, _snapshot: JobProgress) {}
}

/// Build a small zip with a single text entry, returning the temp dir guard and
/// the path to the written zip file.
fn build_input_zip() -> (tempfile::TempDir, std::path::PathBuf) {
    let in_dir = tempfile::tempdir().expect("input temp dir");
    let zip_path = in_dir.path().join("sample.zip");
    let f = std::fs::File::create(&zip_path).expect("create input zip");
    let mut w = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default();
    w.start_file("hello world.txt", opts).expect("start entry");
    w.write_all(b"hello from zip").expect("write entry bytes");
    w.finish().expect("finalize input zip");
    (in_dir, zip_path)
}

#[tokio::test]
async fn zip_is_extracted_and_recompressed_to_zip() {
    let (_in_dir, zip_path) = build_input_zip();
    let out = tempfile::tempdir().expect("output dir");

    let job = simple_archiver_core::domain::archive_job::ArchiveJob::plan(
        vec![SourceItem::ZipFile(zip_path)],
        NamingRule::parse("out{n}").unwrap(),
        OutputDirectory::new(out.path().to_path_buf()),
    )
    .unwrap();

    let engine = RunArchiveJob::with_default_parallelism(
        Arc::new(ZipArchiver::new()),
        Arc::new(ArchiveExtractor::new()),
        Arc::new(FsPlacer::new()),
    );
    let summary = engine.execute(job, &SystemClock::new(), &NullSink).await;

    assert_eq!(
        summary.succeeded.len(),
        1,
        "the zip task should succeed: {summary:?}"
    );
    assert!(summary.failed.is_empty());

    // The output zip exists and contains the original entry.
    let zip_path = out.path().join("out1.zip");
    assert!(zip_path.is_file(), "expected {zip_path:?} to exist");

    let bytes = std::fs::read(&zip_path).expect("read output zip");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("open output zip");
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();
    assert!(
        names.iter().any(|n| n.ends_with("hello world.txt")),
        "output zip should contain hello world.txt, got {names:?}"
    );
}
