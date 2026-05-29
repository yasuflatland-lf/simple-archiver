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
// `async fn` in a trait is sufficient for PR2: the only caller (the Tauri
// command) uses the concrete `ZipArchiver`, so the returned future's `Send`-ness
// is inferred. PR5 revisits this when parallelism needs `Send` futures across
// `tokio::spawn`.
#[allow(async_fn_in_trait)]
pub trait Archiver {
    /// Compress everything under `src_dir` into the zip file at `dest_zip`.
    async fn compress(&self, src_dir: &Path, dest_zip: &Path) -> Result<(), ArchiveError>;
}
