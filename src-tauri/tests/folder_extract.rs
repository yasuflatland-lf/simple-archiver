//! Integration: a Folder-mode job extracts each archive into `<out>/<name>/`.

use tokio_util::sync::CancellationToken;

use simple_archiver_core::domain::archive_job::ArchiveJob;
use simple_archiver_core::domain::conflict_policy::ConflictPolicy;
use simple_archiver_core::domain::output_directory::OutputDirectory;
use simple_archiver_core::domain::source_item::SourceItem;

use simple_archiver_lib::presentation::commands::run_job_inner;
use simple_archiver_lib::presentation::dto::ProgressEvent;
use simple_archiver_lib::presentation::events::ProgressEmitter;

/// A no-op progress emitter so the job runs without a live Tauri app.
struct NoopEmitter;
impl ProgressEmitter for NoopEmitter {
    fn emit_progress(&self, _ev: &ProgressEvent) {}
}

#[tokio::test]
async fn folder_mode_extracts_zip_into_named_subfolder() {
    // 1. Build a real input.zip containing greeting.txt.
    let work = tempfile::tempdir().unwrap();
    let zip_path = work.path().join("greetings.zip");
    {
        use std::io::Write as _;
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut w = zip::ZipWriter::new(file);
        w.start_file("greeting.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"hello").unwrap();
        w.finish().unwrap();
    }

    // 2. Plan a Folder job into a fresh output dir.
    let out = tempfile::tempdir().unwrap();
    let job = ArchiveJob::plan_extract(
        vec![SourceItem::ZipFile(zip_path)],
        OutputDirectory::new(out.path().to_path_buf()),
        ConflictPolicy::default(),
    )
    .unwrap();

    // 3. Run it.
    let emitter = NoopEmitter;
    let summary = run_job_inner(&emitter, job, CancellationToken::new()).await;

    // 4. The archive was extracted into <out>/greetings/greeting.txt.
    assert_eq!(summary.succeeded.len(), 1);
    assert!(summary.failed.is_empty());
    let landed = out.path().join("greetings").join("greeting.txt");
    assert_eq!(std::fs::read(landed).unwrap(), b"hello");
}
