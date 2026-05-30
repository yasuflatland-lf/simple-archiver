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
            let name = zip_entry_name(src_dir, path)?;
            let data = tokio::fs::read(path).await?;
            let builder = ZipEntryBuilder::new(name.into(), Compression::Deflate);
            writer
                .write_entry_whole(builder, &data)
                .await
                .map_err(|e| ArchiveError::Backend(e.to_string()))?;
            bytes_done += data.len() as u64;
            ctx.report(bytes_done, bytes_total);
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
    use std::sync::{Arc, Mutex};
    use tokio_util::sync::CancellationToken;

    struct Capture(Mutex<Vec<TaskProgress>>);
    impl TaskProgressReport for Capture {
        fn report(&self, _task: TaskId, progress: TaskProgress) {
            self.0.lock().unwrap().push(progress);
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
