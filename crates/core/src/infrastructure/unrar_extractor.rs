//! `UnrarExtractor`: the `Extractor` adapter backed by the `unrar` crate.
//! `unrar`'s API is synchronous and bundles the UnRAR C++ sources, so extraction
//! runs on `tokio::task::spawn_blocking`. Extraction target is a fresh
//! `TempWorkspace`, returned as a boxed `ExtractedTree` guard.

use crate::application::ports::{ExtractError, ExtractedTree, Extractor};
use crate::infrastructure::temp_workspace::TempWorkspace;
use std::path::Path;
use unrar::Archive;

/// Extracts rar archives into a temporary directory via the `unrar` crate.
#[derive(Debug, Default)]
pub struct UnrarExtractor;

impl UnrarExtractor {
    /// Create a new extractor (stateless).
    pub fn new() -> Self {
        Self
    }
}

impl Extractor for UnrarExtractor {
    async fn extract(&self, src_rar: &Path) -> Result<Box<dyn ExtractedTree>, ExtractError> {
        let src = src_rar.to_path_buf();
        // `unrar` is blocking and CPU/IO-bound; run it off the async runtime.
        let workspace = tokio::task::spawn_blocking(move || -> Result<TempWorkspace, ExtractError> {
            let workspace = TempWorkspace::new()?; // io::Error -> ExtractError::Io
            let dest = workspace.path().to_path_buf();

            let mut archive = Archive::new(&src)
                .open_for_processing()
                .map_err(|e| ExtractError::Backend(e.to_string()))?;
            // Stream entries: extract files under `dest` (preserving relative paths),
            // skip directory headers. `extract_with_base`/`skip` consume and return
            // the next cursor, so reassign `archive` each iteration.
            while let Some(header) = archive
                .read_header()
                .map_err(|e| ExtractError::Backend(e.to_string()))?
            {
                archive = if header.entry().is_file() {
                    header
                        .extract_with_base(&dest)
                        .map_err(|e| ExtractError::Backend(e.to_string()))?
                } else {
                    header
                        .skip()
                        .map_err(|e| ExtractError::Backend(e.to_string()))?
                };
            }
            Ok(workspace)
        })
        .await
        .map_err(|e| ExtractError::Backend(format!("extraction task panicked: {e}")))??;

        Ok(Box::new(workspace))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn non_rar_input_fails_with_backend_error() {
        // A file whose bytes are not a valid rar signature must surface as a
        // backend error (the task will fail, not panic).
        let mut tmp = tempfile::NamedTempFile::new().expect("temp file");
        tmp.write_all(b"this is definitely not a rar archive")
            .expect("write bytes");

        let extractor = UnrarExtractor::new();
        let result = extractor.extract(tmp.path()).await;

        // `Result` itself is not `Debug` (its `Ok` payload is a `dyn ExtractedTree`
        // trait object), so map it to a `Debug`-able marker before asserting.
        let kind = result.map(|_| "ok");
        assert!(
            matches!(kind, Err(ExtractError::Backend(_))),
            "expected Backend error, got {kind:?}"
        );
    }
}
