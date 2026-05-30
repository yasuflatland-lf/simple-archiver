//! Output ports for the application layer.
//!
//! Defines the `Archiver` and `Clock` ports used by the execution engine.
//! `Archiver::compress` takes a `CompressContext` for per-task byte-progress
//! reporting; `Clock` lets the engine run against a controllable time source
//! in tests. (Cancellation is added in PR-5b.)

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
