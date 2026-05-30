//! Output ports for the application layer.
//!
//! Defines the `Archiver` and `Clock` ports used by the execution engine.
//! `Archiver::compress` takes a `CompressContext` for per-task byte-progress
//! reporting; `Clock` lets the engine run against a controllable time source
//! in tests. `ArchiveError::Cancelled` is returned when the caller cancels
//! via the `CancellationToken` carried by `CompressContext`.

use crate::application::compress_context::CompressContext;
use std::future::Future;
use std::path::Path;

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
    /// dropped; the output zip is never included in itself. Implementations must
    /// **not** overwrite an existing `dest_zip`.
    fn compress(
        &self,
        src_dir: &Path,
        dest_zip: &Path,
        ctx: &CompressContext,
    ) -> impl Future<Output = Result<(), ArchiveError>> + Send;
}

/// A source of monotonic time, behind a port so the application can be tested
/// with a controllable clock instead of the real wall clock.
pub trait Clock: Send + Sync {
    /// Return the current instant.
    fn now(&self) -> std::time::Instant;
}

/// Error returned by an [`Extractor`].
///
/// `Backend` carries a stringified message from the `unrar` library so the port
/// stays decoupled from any specific extraction backend. There is no `Cancelled`
/// variant: extraction is not interrupted mid-stream in the MVP — cancellation is
/// observed *before* extraction starts (in the engine) and the temp directory is
/// always reclaimed by [`ExtractedTree`]'s drop.
#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    /// Filesystem I/O failed while creating the temp dir or writing entries.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// The extraction backend reported a failure (corrupt/encrypted/multi-volume rar, etc.).
    #[error("unrar error: {0}")]
    Backend(String),
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

/// Extracts a rar archive into a freshly-created temporary directory.
///
/// Mirrors [`Archiver`]: the future is `Send` (and the trait `Send + Sync`) so the
/// engine can run implementations across `tokio::spawn`. The adapter owns temp
/// creation **and** cleanup — it returns a boxed [`ExtractedTree`] guard.
pub trait Extractor: Send + Sync {
    /// Extract every entry of `src_rar` into a new temp directory and return a
    /// guard whose `path()` holds the extracted tree; dropping it removes the dir.
    fn extract(
        &self,
        src_rar: &Path,
    ) -> impl Future<Output = Result<Box<dyn ExtractedTree>, ExtractError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::ArchiveError;
    use super::ExtractError;

    #[test]
    fn cancelled_displays_as_cancelled_and_has_no_source() {
        let err = ArchiveError::Cancelled;

        assert_eq!(err.to_string(), "cancelled");
        assert!(std::error::Error::source(&err).is_none());
    }

    #[test]
    fn extract_error_display_strings_are_stable() {
        let backend = ExtractError::Backend("bad header".to_string());
        assert_eq!(backend.to_string(), "unrar error: bad header");

        let io = ExtractError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "missing",
        ));
        assert_eq!(io.to_string(), "I/O error: missing");
    }
}
