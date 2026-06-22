//! Zip archiving adapter backed by `async_zip` (tokio).

use crate::application::compress_context::CompressContext;
use crate::application::ports::{ArchiveError, Archiver};
use crate::domain::conflict_policy::ConflictPolicy;
use crate::infrastructure::path_utils::{classified_components, next_free_path, PathPart};
use async_zip::base::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use std::path::{Path, PathBuf};
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
        policy: ConflictPolicy,
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

        // Resolve the output path according to the conflict policy, symmetric to
        // `FsPlacer` for Folder mode. `Skip` short-circuits with no write when the
        // destination already exists; `Overwrite` has removed the old file here;
        // `AutoRename` has chosen a free `name (n).zip`. Resolved after the cancel
        // checkpoint so a cancelled `Overwrite` never deletes the existing file.
        let dest = match resolve_destination(dest_zip, policy).await? {
            Some(path) => path,
            None => return Ok(()),
        };

        // `create_new` still guarantees we never clobber: the policy resolution
        // above has already freed the path (renamed or removed), so the only
        // collision left is a concurrent writer, which should fail the task.
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .await?;
        let mut writer = ZipFileWriter::with_tokio(file);

        let mut bytes_done: u64 = 0;
        for path in &files {
            if ctx.is_cancelled() {
                close_and_remove(writer, &dest).await;
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
                close_and_remove(writer, &dest).await;
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
        drain_to_disk(&mut file).await?;
        Ok(())
    }
}

/// Cancel cleanup shared by both cancel checkpoints: finalize and drain the
/// writer via `drain_to_disk` (close -> recover the file -> shutdown + sync_all)
/// BEFORE removing it, so the common cancel path does not leave a partial zip
/// racing the delete. Best-effort: if `close()` errors the file is dropped
/// without an explicit drain and we still fall through to the removal (a rare,
/// platform-dependent window; see `drain_to_disk`).
async fn close_and_remove(
    writer: async_zip::tokio::write::ZipFileWriter<tokio::fs::File>,
    dest_zip: &Path,
) {
    if let Ok(mut file) = writer.close().await.map(|w| w.into_inner()) {
        let _ = drain_to_disk(&mut file).await;
    }
    remove_partial_output(dest_zip).await;
}

/// Flush and fsync a recovered zip file so all queued blocking writes complete
/// and reach durable storage before the caller proceeds. `tokio::fs::File`
/// performs writes on the blocking pool and its `Drop` does NOT wait for them,
/// so without this drain a freshly written file can be read back incomplete
/// (success path) or race a removal (cancel path).
///
/// Both paths share this drain but invoke it differently: the success path
/// propagates a drain error (`?`), while each cancel checkpoint calls it
/// best-effort and proceeds to delete regardless. The common cancel path is
/// therefore fully drained; only a rare `close()` IO error leaves the file
/// dropped without an explicit drain before removal — an accepted,
/// platform-dependent limitation rather than an absolute guarantee.
async fn drain_to_disk(file: &mut tokio::fs::File) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt as _;
    file.shutdown().await?;
    file.sync_all().await?;
    Ok(())
}

/// Best-effort cleanup for a cancelled compression.
async fn remove_partial_output(dest_zip: &Path) {
    match tokio::fs::remove_file(dest_zip).await {
        Ok(()) => {}
        // Already gone — e.g. removed externally between the drain and this call.
        // (Both callers create the output before the loop, so the "never created"
        // case does not reach here.)
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        // Any other removal error leaves a partial zip on disk. We deliberately
        // swallow it here: surfacing/logging cleanup failures is deferred to a
        // future logging-infrastructure PR (no logging crate is wired up yet).
        Err(_) => {}
    }
}

/// Resolve `dest_zip` into the path to actually write, applying `policy`:
///
/// - [`ConflictPolicy::AutoRename`]: never clobber — return the first free
///   `name (2).zip`, `name (3).zip`, … (or `dest_zip` itself if free).
/// - [`ConflictPolicy::Skip`]: return `None` (a successful no-op) when `dest_zip`
///   already exists, leaving it untouched; otherwise write at `dest_zip`.
/// - [`ConflictPolicy::Overwrite`]: remove an existing `dest_zip`, then write at
///   the same path. A missing file is not an error.
///
/// Mirrors `FsPlacer`'s collision handling for Folder mode. Returns `Some(path)`
/// to write at `path`, or `None` to skip writing entirely.
async fn resolve_destination(
    dest_zip: &Path,
    policy: ConflictPolicy,
) -> Result<Option<PathBuf>, ArchiveError> {
    match policy {
        ConflictPolicy::AutoRename => Ok(Some(non_colliding_zip(dest_zip))),
        ConflictPolicy::Skip => {
            if dest_zip.exists() {
                Ok(None)
            } else {
                Ok(Some(dest_zip.to_path_buf()))
            }
        }
        ConflictPolicy::Overwrite => {
            match tokio::fs::remove_file(dest_zip).await {
                Ok(()) => {}
                // Nothing to overwrite — proceed to write at the desired path.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(ArchiveError::Io(e)),
            }
            Ok(Some(dest_zip.to_path_buf()))
        }
    }
}

/// Return `desired` if free, else `stem (2).ext`, `stem (3).ext`, … inserting the
/// ` (n)` BEFORE the extension so the `.zip` suffix is preserved (e.g.
/// `photo_01.zip` → `photo_01 (2).zip`). The Folder placer appends ` (n)` to the
/// whole final component; a file keeps its extension, so the suffix goes before it.
fn non_colliding_zip(desired: &Path) -> PathBuf {
    let parent = desired.parent().unwrap_or_else(|| Path::new("."));
    let stem = desired
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".to_string());
    let ext = desired
        .extension()
        .map(|e| e.to_string_lossy().into_owned());
    // Zip mode: insert ` (n)` before the extension so the suffix is preserved.
    next_free_path(desired, |n| {
        let file_name = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        parent.join(file_name)
    })
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
    // Policy: silently FILTER every non-normal component, keeping only normal
    // segments joined with `/`.
    let name = classified_components(relative)
        .filter_map(|part| match part {
            PathPart::Normal(segment) => Some(segment.to_string_lossy().into_owned()),
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
            .compress(src.path(), &dest, ConflictPolicy::AutoRename, &ctx)
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

    /// Read and sort every entry name in a zip archive, draining each entry so a
    /// truncated/corrupt body surfaces as a panic. Proves a real archive (not
    /// arbitrary bytes) was written at `path`.
    fn zip_entry_names(path: &Path) -> Vec<String> {
        use std::io::Read as _;
        let file = std::fs::File::open(path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut names = Vec::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            let mut body = Vec::new();
            entry.read_to_end(&mut body).unwrap();
            names.push(entry.name().to_string());
        }
        names.sort();
        names
    }

    #[tokio::test]
    async fn auto_rename_writes_a_sibling_and_leaves_the_existing_zip_untouched() {
        // AutoRename must never clobber: an existing o.zip is left byte-for-byte
        // intact and the new archive lands in the extension-aware sibling
        // "o (2).zip" (the ` (2)` is inserted before the .zip extension).
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hi").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");
        std::fs::write(&dest, b"pre-existing").unwrap();

        ZipArchiver::new()
            .compress(
                src.path(),
                &dest,
                ConflictPolicy::AutoRename,
                &CompressContext::detached(),
            )
            .await
            .unwrap();

        assert_eq!(
            std::fs::read(&dest).unwrap(),
            b"pre-existing",
            "the pre-existing zip must be left untouched"
        );
        let sibling = out.path().join("o (2).zip");
        assert!(sibling.exists(), "auto-rename must write o (2).zip");
        assert_eq!(zip_entry_names(&sibling), vec!["a.txt".to_string()]);
    }

    #[tokio::test]
    async fn auto_rename_without_a_collision_writes_the_desired_name() {
        // With no existing output, AutoRename writes the desired path unchanged
        // (and creates no sibling) — i.e. the default policy is a no-op here.
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hi").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");

        ZipArchiver::new()
            .compress(
                src.path(),
                &dest,
                ConflictPolicy::AutoRename,
                &CompressContext::detached(),
            )
            .await
            .unwrap();

        assert_eq!(zip_entry_names(&dest), vec!["a.txt".to_string()]);
        assert!(!out.path().join("o (2).zip").exists());
    }

    #[tokio::test]
    async fn skip_leaves_the_existing_zip_untouched_and_writes_no_sibling() {
        // Skip is a successful no-op when the destination exists: the existing
        // file is untouched and no auto-rename sibling is created.
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hi").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");
        std::fs::write(&dest, b"pre-existing").unwrap();

        ZipArchiver::new()
            .compress(
                src.path(),
                &dest,
                ConflictPolicy::Skip,
                &CompressContext::detached(),
            )
            .await
            .unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"pre-existing");
        assert!(!out.path().join("o (2).zip").exists());
    }

    #[tokio::test]
    async fn overwrite_replaces_the_existing_zip_in_place() {
        // Overwrite removes the existing file then writes the archive at the same
        // path — the original bytes are gone and no sibling is created.
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"hi").unwrap();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("o.zip");
        std::fs::write(&dest, b"pre-existing").unwrap();

        ZipArchiver::new()
            .compress(
                src.path(),
                &dest,
                ConflictPolicy::Overwrite,
                &CompressContext::detached(),
            )
            .await
            .unwrap();

        assert_eq!(zip_entry_names(&dest), vec!["a.txt".to_string()]);
        assert!(!out.path().join("o (2).zip").exists());
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
            .compress(src.path(), &dest, ConflictPolicy::AutoRename, &ctx)
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
            .compress(src.path(), &dest, ConflictPolicy::AutoRename, &ctx)
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
