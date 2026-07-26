//! Output ports for the application layer.
//!
//! Defines the `OutputStrategy`, `Archiver`, `Extractor`, `Placer`, and `Clock`
//! ports used by the execution engine. `Archiver::compress` takes a
//! `CompressContext` for per-task byte-progress reporting; `Clock` lets the
//! engine run against a controllable time source in tests.
//! `ArchiveError::Cancelled` is returned when the caller cancels via the
//! `CancellationToken` carried by `CompressContext`.

use crate::application::compress_context::CompressContext;
use crate::application::extract_context::ExtractContext;
use crate::domain::conflict_policy::ConflictPolicy;
use std::future::Future;
use std::path::{Path, PathBuf};

/// Produces one task's output from a prepared source directory.
///
/// The mirror image of the `Extractor` port: `Extractor` absorbs the variation
/// in INPUT container formats, `OutputStrategy` absorbs the variation in what a
/// run PRODUCES (a re-zipped archive, an extracted folder, and whatever comes
/// next). The engine drives implementations across `tokio::spawn`, so the trait
/// is `Send + Sync` and the future is `Send`, matching `Archiver`/`Extractor`.
pub trait OutputStrategy: Send + Sync {
    /// Produce the output for one task.
    ///
    /// `desired` is `None` when this task's `OutputName` yields no destination
    /// (a folder source in Folder mode), in which case the implementation
    /// returns `Produced::Nothing`.
    fn produce(
        &self,
        prepared: &Path,
        desired: Option<&Path>,
        policy: ConflictPolicy,
        ctx: &CompressContext,
    ) -> impl Future<Output = Result<Produced, ProduceError>> + Send;
}

/// What producing a task's output actually did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Produced {
    /// Output was written at this path.
    At(PathBuf),
    /// The destination already existed and was kept (ConflictPolicy::Skip).
    KeptExisting(PathBuf),
    /// There was nothing to produce.
    Nothing,
}

/// Error returned by an [`OutputStrategy`].
///
/// This preserves the stable error surface of the lower-level [`Archiver`] and
/// [`Placer`] ports while letting the engine handle every output mode uniformly.
#[derive(Debug, thiserror::Error)]
pub enum ProduceError {
    /// Filesystem I/O failed while preparing the output.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// The archiving backend reported a failure.
    #[error("archive backend error: {0}")]
    Backend(String),
    /// The output operation was cancelled by the caller.
    #[error("cancelled")]
    Cancelled,
}

/// What a write attempt produced.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Written {
    /// Bytes were written at this path.
    At(PathBuf),
    /// Nothing was written; this path already existed and was kept
    /// (ConflictPolicy::Skip).
    KeptExisting(PathBuf),
}

/// Error returned by an [`Archiver`].
///
/// `Backend` carries a stringified message from the concrete archiving library
/// so the port stays decoupled from any specific backend (e.g. `async_zip`).
#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    /// Filesystem I/O failed while reading inputs or writing the archive.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// The archiving backend reported a failure.
    #[error("archive backend error: {0}")]
    Backend(String),
    /// The archive operation was cancelled by the caller.
    #[error("cancelled")]
    Cancelled,
}

/// Compresses a directory tree into a zip archive.
///
/// The future is `Send` (and the trait `Send + Sync`) so the engine can run
/// implementations across `tokio::spawn`. Progress is reported through `ctx`.
pub trait Archiver: Send + Sync {
    /// Compress every regular file under `src_dir` into the zip at `dest_zip`,
    /// reporting cumulative byte progress through `ctx`. Each file is recorded
    /// under its `/`-separated path relative to `src_dir`; empty directories are
    /// dropped; the output zip is never included in itself.
    ///
    /// When `dest_zip` already exists, the collision is resolved by `policy`
    /// (mirroring [`Placer::place`] for Folder mode):
    /// - [`ConflictPolicy::AutoRename`]: write a sibling `name (2).zip`,
    ///   `name (3).zip`, … (the ` (n)` is inserted before the extension), leaving
    ///   the existing file untouched.
    /// - [`ConflictPolicy::Skip`]: leave the existing file untouched and write
    ///   nothing.
    /// - [`ConflictPolicy::Overwrite`]: remove the existing file, then write.
    ///
    /// Returns whether bytes were written and at which path. The path differs
    /// from `dest_zip` when [`ConflictPolicy::AutoRename`] resolved a collision.
    fn compress(
        &self,
        src_dir: &Path,
        dest_zip: &Path,
        policy: ConflictPolicy,
        ctx: &CompressContext,
    ) -> impl Future<Output = Result<Written, ArchiveError>> + Send;
}

/// A source of monotonic time, behind a port so the application can be tested
/// with a controllable clock instead of the real wall clock.
pub trait Clock: Send + Sync {
    /// Return the current instant.
    fn now(&self) -> std::time::Instant;
}

/// Error returned by an [`Extractor`].
///
/// `Backend` carries a stringified message from the underlying extraction library
/// (e.g. `unrar` or `async_zip`) so the port stays decoupled from any specific
/// extraction backend. `Cancelled` is returned when the caller cancels via the
/// [`ExtractContext`] carried into [`Extractor::extract`]: the work loop polls
/// the token between entries and aborts the current archive promptly. The
/// partially-extracted temp directory is always reclaimed by [`ExtractedTree`]'s
/// drop (the guard is never returned on a cancelled extraction).
#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    /// Filesystem I/O failed while creating the temp dir or writing entries.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// The extraction backend reported a failure (corrupt/encrypted/unsupported-compression
    /// rar or zip, etc.).
    #[error("extract error: {0}")]
    Backend(String),
    /// The extraction was cancelled by the caller (observed mid-stream via the
    /// [`ExtractContext`] token between entries).
    #[error("cancelled")]
    Cancelled,
}

/// A handle to an extracted directory tree.
///
/// The concrete implementation (in `infrastructure`) owns a temporary directory
/// and removes it when dropped, so the application layer can hold a tree without
/// naming an infrastructure type. `Send` so it can live in a `tokio::spawn`ed task.
pub trait ExtractedTree: Send {
    /// The directory containing the extracted contents (ready to be compressed).
    fn path(&self) -> &Path;
}

/// Extracts an archive (rar or zip) into a freshly-created temporary directory.
///
/// Mirrors [`Archiver`]: the future is `Send` (and the trait `Send + Sync`) so the
/// engine can run implementations across `tokio::spawn`. The adapter owns temp
/// creation **and** cleanup — it returns a boxed [`ExtractedTree`] guard.
pub trait Extractor: Send + Sync {
    /// Extract every entry of `src_archive` (a rar or zip archive) into a new temp
    /// directory and return a guard whose `path()` holds the extracted tree;
    /// dropping it removes the dir.
    ///
    /// `ctx` carries a read-only cancellation observation: the implementation
    /// MUST poll [`ExtractContext::is_cancelled`] between entries and return
    /// [`ExtractError::Cancelled`] when it trips, so a long extraction aborts
    /// promptly instead of running the current archive to completion. On a
    /// cancelled (or otherwise failed) extraction no guard is returned, so the
    /// partially-written temp directory is reclaimed by its `Drop`.
    fn extract(
        &self,
        src_archive: &Path,
        ctx: &ExtractContext,
    ) -> impl Future<Output = Result<Box<dyn ExtractedTree>, ExtractError>> + Send;
}

/// Error returned by a [`Placer`].
#[derive(Debug, thiserror::Error)]
pub enum PlaceError {
    /// Filesystem I/O failed while copying the tree into the destination.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

/// Places an extracted directory tree at a destination, never overwriting.
///
/// Mirrors [`Archiver`] / [`Extractor`]: the future is `Send` (and the trait is
/// `Send + Sync`) so the engine can run implementations across `tokio::spawn`.
pub trait Placer: Send + Sync {
    /// Recursively copy the tree at `src_tree` to `desired_dest`, resolving any
    /// collision according to `policy`:
    /// - [`ConflictPolicy::AutoRename`]: if `desired_dest` already exists, append
    ///   ` (2)`, ` (3)`, … to its final component until a free path is found.
    /// - [`ConflictPolicy::Skip`]: if `desired_dest` already exists, leave it
    ///   untouched (no copy) and return that existing path.
    /// - [`ConflictPolicy::Overwrite`]: if `desired_dest` already exists, remove
    ///   it first, then copy the tree to `desired_dest`.
    ///
    /// Returns whether bytes were written and at which path.
    fn place(
        &self,
        src_tree: &Path,
        desired_dest: &Path,
        policy: ConflictPolicy,
    ) -> impl Future<Output = Result<Written, PlaceError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::ArchiveError;
    use super::ExtractError;
    use super::{OutputStrategy, ProduceError, Produced};

    #[test]
    fn cancelled_displays_as_cancelled_and_has_no_source() {
        let err = ArchiveError::Cancelled;

        assert_eq!(err.to_string(), "cancelled");
        assert!(std::error::Error::source(&err).is_none());
    }

    #[test]
    fn extract_error_display_strings_are_stable() {
        let backend = ExtractError::Backend("bad header".to_string());
        assert_eq!(backend.to_string(), "extract error: bad header");

        let io = ExtractError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"));
        assert_eq!(io.to_string(), "I/O error: missing");
    }

    #[test]
    fn placer_is_object_safe_via_generic_bound() {
        // Compile-time assertion that the bound is usable as a generic constraint.
        fn assert_placer<P: super::Placer>() {}
        // FsPlacer (infrastructure) will satisfy this; here we only prove the
        // trait + error type compile and that PlaceError Displays as expected.
        let err = super::PlaceError::Io(std::io::Error::other("boom"));
        assert_eq!(err.to_string(), "I/O error: boom");
        let _ = assert_placer::<Noop>;
    }

    #[test]
    fn output_strategy_is_usable_via_generic_bound() {
        fn assert_strategy<S: OutputStrategy>() {}

        let _ = assert_strategy::<NoopStrategy>;
    }

    #[test]
    fn produce_error_display_strings_are_stable() {
        let io = ProduceError::Io(std::io::Error::other("boom"));
        assert_eq!(io.to_string(), "I/O error: boom");

        let backend = ProduceError::Backend("bad header".to_string());
        assert_eq!(backend.to_string(), "archive backend error: bad header");

        let cancelled = ProduceError::Cancelled;
        assert_eq!(cancelled.to_string(), "cancelled");
    }

    struct Noop;
    impl super::Placer for Noop {
        async fn place(
            &self,
            _src_tree: &std::path::Path,
            desired_dest: &std::path::Path,
            _policy: crate::domain::conflict_policy::ConflictPolicy,
        ) -> Result<super::Written, super::PlaceError> {
            Ok(super::Written::At(desired_dest.to_path_buf()))
        }
    }

    struct NoopStrategy;
    impl OutputStrategy for NoopStrategy {
        async fn produce(
            &self,
            _prepared: &std::path::Path,
            desired: Option<&std::path::Path>,
            _policy: crate::domain::conflict_policy::ConflictPolicy,
            _ctx: &crate::application::compress_context::CompressContext,
        ) -> Result<Produced, ProduceError> {
            Ok(desired
                .map(|path| Produced::At(path.to_path_buf()))
                .unwrap_or(Produced::Nothing))
        }
    }
}
