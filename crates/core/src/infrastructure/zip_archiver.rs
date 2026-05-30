//! Zip archiving adapter backed by `async_zip` (tokio).

use crate::application::compress_context::CompressContext;
use crate::application::ports::{ArchiveError, Archiver};
use async_zip::base::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// Compresses directory trees into zip archives using `async_zip` with Deflate.
#[derive(Debug, Default)]
pub struct ZipArchiver;

impl ZipArchiver {
    /// Create a new archiver.
    pub fn new() -> Self {
        Self
    }
}

impl Archiver for ZipArchiver {
    /// Compress every regular file under `src_dir` into the zip at `dest_zip`.
    /// Directory entries are not stored explicitly (empty directories are dropped);
    /// each file is recorded under its `/`-separated path relative to `src_dir`.
    /// The output zip is never included in itself.
    async fn compress(
        &self,
        src_dir: &Path,
        dest_zip: &Path,
        ctx: &CompressContext,
    ) -> Result<(), ArchiveError> {
        // Collect the file list from the walk BEFORE creating the output file.
        // If `dest_zip` lives inside `src_dir`, this guarantees it cannot appear
        // in the walk at all, so it is never archived into itself — regardless
        // of WalkDir ordering, canonicalization success, or platform symlinks.
        let files = collect_files(src_dir)?;

        // Sum the input sizes up front so progress can be reported as a fraction
        // of a known total. Metadata failures (e.g. a file removed mid-walk) fall
        // back to zero rather than aborting the whole task.
        let bytes_total: u64 = files
            .iter()
            .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            .sum();
        ctx.report(0, bytes_total);
        if ctx.is_cancelled() {
            return Err(ArchiveError::Cancelled);
        }

        // Refuse to overwrite an existing destination: a collision fails the task
        // (AlreadyExists surfaces as ArchiveError::Io) rather than clobbering it.
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest_zip)
            .await?;
        let mut writer = ZipFileWriter::with_tokio(file);

        let mut bytes_done: u64 = 0;
        for path in &files {
            if ctx.is_cancelled() {
                // Cleanup asymmetry with the success path: the success path drains
                // the writer with `shutdown().await + sync_all().await` before drop,
                // whereas here we do a plain `drop(writer)` then `remove_file`. On a
                // contended host the dropped writer's queued blocking writes may not
                // be observed before `remove_file`, so the partial zip can transiently
                // survive on disk.
                drop(writer);
                remove_partial_output(dest_zip).await;
                return Err(ArchiveError::Cancelled);
            }

            let name = zip_entry_name(src_dir, path)?;
            let data = tokio::fs::read(path).await?;
            let builder = ZipEntryBuilder::new(name.into(), Compression::Deflate);
            writer
                .write_entry_whole(builder, &data)
                .await
                .map_err(|e| ArchiveError::Backend(e.to_string()))?;
            bytes_done += data.len() as u64;
            ctx.report(bytes_done, bytes_total);

            if ctx.is_cancelled() {
                // Same cleanup asymmetry as the pre-write checkpoint above: plain
                // `drop(writer)` + `remove_file` (no `shutdown`/`sync_all`), so on a
                // contended host the partial zip may transiently survive on disk.
                drop(writer);
                remove_partial_output(dest_zip).await;
                return Err(ArchiveError::Cancelled);
            }
        }

        // `ZipFileWriter::close` writes the central directory + EOCD record and
        // returns the underlying writer. For `with_tokio`, that writer is the
        // `tokio_util` compat wrapper around our `tokio::fs::File`. Recover the
        // raw `tokio::fs::File` via the wrapper's inherent `into_inner` (no extra
        // dependency: the method resolves without naming the compat type).
        //
        // We MUST drain that file before dropping it: `tokio::fs::File` performs
        // its writes on the blocking thread pool, and its `Drop` impl does NOT
        // wait for in-flight writes to complete. So the freshly written EOCD
        // bytes can still be queued (not yet on disk) when the caller reopens
        // the file synchronously and parses it — which fails as
        // `InvalidArchive("Invalid EOCD comment length")` on slower/contended
        // hosts (e.g. CI). `shutdown` flushes and completes all pending writes,
        // and `sync_all` then forces them to durable storage before we return.
        let mut file = writer
            .close()
            .await
            .map_err(|e| ArchiveError::Backend(e.to_string()))?
            .into_inner();
        use tokio::io::AsyncWriteExt as _;
        file.shutdown().await?;
        file.sync_all().await?;
        Ok(())
    }
}

/// Best-effort cleanup for a cancelled compression.
async fn remove_partial_output(dest_zip: &Path) {
    match tokio::fs::remove_file(dest_zip).await {
        Ok(()) => {}
        // The output was never created (cancelled before the first entry was
        // written), so there is nothing to clean up.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        // Any other removal error leaves a partial zip on disk. We deliberately
        // swallow it here: surfacing/logging cleanup failures is deferred to a
        // future logging-infrastructure PR (no logging crate is wired up yet).
        Err(_) => {}
    }
}

/// Walk `root` and return the paths of every regular file it contains.
///
/// The full list is materialized before any output file is created, so a
/// destination written under `root` afterwards can never be picked up by the
/// walk (and thus never archived into itself).
fn collect_files(root: &Path) -> Result<Vec<PathBuf>, ArchiveError> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(|result| match result {
            Ok(entry) if entry.file_type().is_file() => Some(Ok(entry.into_path())),
            Ok(_) => None,
            Err(e) => Some(Err(ArchiveError::Backend(e.to_string()))),
        })
        .collect()
}

/// Build a zip entry name for `path` relative to `root`, using `/` separators
/// on every platform (the zip format mandates forward slashes).
pub(crate) fn zip_entry_name(root: &Path, path: &Path) -> Result<String, ArchiveError> {
    let relative = path.strip_prefix(root).map_err(|_| {
        ArchiveError::Backend(format!(
            "path {} is not under root {}",
            path.display(),
            root.display()
        ))
    })?;
    let name = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::compress_context::{CompressContext, TaskProgressReport};
    use crate::domain::archive_task::TaskId;
    use crate::domain::task_progress::TaskProgress;
    use std::path::PathBuf;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    use tokio_util::sync::CancellationToken;

    struct Capture(Mutex<Vec<TaskProgress>>);
    impl TaskProgressReport for Capture {
        fn report(&self, _task: TaskId, progress: TaskProgress) {
            self.0.lock().unwrap().push(progress);
        }
    }

    /// Cancels the shared token on the Nth `report()` call (1-based), and counts
    /// how many times `report()` was invoked so a test can prove how far the
    /// compression progressed before cancelling.
    struct CancelOnNthReport {
        cancel_on: usize,
        calls: AtomicUsize,
        token: CancellationToken,
    }

    impl CancelOnNthReport {
        fn new(cancel_on: usize, token: CancellationToken) -> Self {
            Self {
                cancel_on,
                calls: AtomicUsize::new(0),
                token,
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl TaskProgressReport for CancelOnNthReport {
        fn report(&self, _task: TaskId, _progress: TaskProgress) {
            // fetch_add returns the previous count; the Nth call has previous N-1.
            if self.calls.fetch_add(1, Ordering::SeqCst) + 1 == self.cancel_on {
                self.token.cancel();
            }
        }
    }

    #[tokio::test]
    async fn reports_monotonic_bytes_up_to_total() {
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hello").unwrap(); // 5 bytes
        std::fs::write(src.path().join("b.txt"), b"world!").unwrap(); // 6 bytes
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");

        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        let ctx = CompressContext::new(TaskId::new(1), capture.clone(), CancellationToken::new());
        ZipArchiver::new()
            .compress(src.path(), &dest, &ctx)
            .await
            .unwrap();

        let reports = capture.0.lock().unwrap().clone();
        assert!(!reports.is_empty(), "expected at least one progress report");
        let total = reports[0].bytes_total();
        assert_eq!(total, 11, "total is the sum of file sizes");
        let mut last = 0;
        for r in &reports {
            assert_eq!(r.bytes_total(), total, "total is constant");
            assert!(r.bytes_done() >= last, "bytes_done is non-decreasing");
            last = r.bytes_done();
        }
        assert_eq!(reports.last().unwrap().bytes_done(), total, "ends at total");
    }

    #[tokio::test]
    async fn refuses_to_overwrite_existing_output() {
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hi").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");
        std::fs::write(&dest, b"pre-existing").unwrap();

        let err = ZipArchiver::new()
            .compress(src.path(), &dest, &CompressContext::detached())
            .await
            .unwrap_err();
        assert!(
            matches!(err, ArchiveError::Io(_)),
            "expected Io(AlreadyExists), got {err:?}"
        );
    }

    #[tokio::test]
    async fn cancels_before_any_write_leaves_no_output() {
        // Cancel on the FIRST report. `compress` reports `(0, total)` BEFORE the
        // destination file is created, so the pre-creation checkpoint trips and the
        // output is never opened. This is the trivial path: nothing to clean up.
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hello").unwrap();
        std::fs::write(src.path().join("b.txt"), b"world").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");

        let token = CancellationToken::new();
        let reporter = Arc::new(CancelOnNthReport::new(1, token.clone()));
        let ctx = CompressContext::new(TaskId::new(1), reporter.clone(), token);

        let err = ZipArchiver::new()
            .compress(src.path(), &dest, &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchiveError::Cancelled), "got {err:?}");
        assert_eq!(reporter.calls(), 1, "cancelled at the very first report");
        assert!(
            !dest.exists(),
            "output is never created on pre-write cancel"
        );
    }

    #[tokio::test]
    async fn cancels_after_a_write_removes_the_partial_output() {
        // Cancel on the SECOND report. Report #1 is `(0, total)` before the file is
        // created; report #2 fires AFTER the writer is created AND the first entry is
        // written, so by then the destination file genuinely exists on disk. The
        // post-write checkpoint then drops the writer and removes the partial output,
        // exercising the real cleanup-delete path (not the vacuous pre-write case).
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hello").unwrap();
        std::fs::write(src.path().join("b.txt"), b"world").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");

        let token = CancellationToken::new();
        let reporter = Arc::new(CancelOnNthReport::new(2, token.clone()));
        let ctx = CompressContext::new(TaskId::new(1), reporter.clone(), token);

        let err = ZipArchiver::new()
            .compress(src.path(), &dest, &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ArchiveError::Cancelled), "got {err:?}");
        // >= 2 reports means report #2 fired, which only happens after the writer was
        // created and at least one entry was written ⇒ the dest file truly existed,
        // so the subsequent `!dest.exists()` proves a real cleanup-delete ran.
        assert!(
            reporter.calls() >= 2,
            "expected >=2 reports (>=1 entry written so the dest existed), got {}",
            reporter.calls()
        );
        assert!(
            !dest.exists(),
            "the partial output that existed on disk must be removed after cancellation"
        );
    }

    #[test]
    fn top_level_file_keeps_its_name() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/x/a.txt");
        assert_eq!(zip_entry_name(&root, &path).unwrap(), "a.txt");
    }

    #[test]
    fn nested_file_uses_forward_slashes() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/x/sub/b.txt");
        assert_eq!(zip_entry_name(&root, &path).unwrap(), "sub/b.txt");
    }

    #[test]
    fn path_outside_root_is_an_error() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/y/c.txt");
        assert!(zip_entry_name(&root, &path).is_err());
    }
}
