//! Output ports for the application layer.
//!
//! The minimal `Archiver` contract for the walking skeleton (PR2): compress a
//! source directory into a single zip file. Progress reporting and cancellation
//! are intentionally absent here and are introduced in PR5 (issue #5).

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
// A bare `async fn` in a trait is sufficient for PR2: every caller (the Tauri
// command and the smoke test) uses the concrete `ZipArchiver`, never a
// `dyn Archiver` or a `T: Archiver` bound, so the compiler sees the concrete
// future type and infers its `Send`-ness automatically. PR5 revisits this when
// parallelism needs `Send` futures across `tokio::spawn`.
#[allow(async_fn_in_trait)]
pub trait Archiver {
    /// Compress every regular file under `src_dir` into the zip at `dest_zip`.
    /// Directory entries are not stored explicitly (empty directories are dropped);
    /// each file is recorded under its `/`-separated path relative to `src_dir`.
    /// The output zip is never included in itself.
    async fn compress(&self, src_dir: &Path, dest_zip: &Path) -> Result<(), ArchiveError>;
}

/// A source of monotonic time, behind a port so the application can be tested
/// with a controllable clock instead of the real wall clock.
pub trait Clock: Send + Sync {
    /// Return the current instant.
    fn now(&self) -> std::time::Instant;
}
