//! `UnrarExtractor`: the `Extractor` adapter backed by the `unrar` crate.
//! `unrar`'s API is synchronous and bundles the UnRAR C++ sources, so extraction
//! runs on `tokio::task::spawn_blocking`. Extraction target is a fresh
//! `TempWorkspace`, returned as a boxed `ExtractedTree` guard.

use crate::application::extract_context::ExtractContext;
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
    async fn extract(
        &self,
        src_rar: &Path,
        ctx: &ExtractContext,
    ) -> Result<Box<dyn ExtractedTree>, ExtractError> {
        let src = src_rar.to_path_buf();
        // The blocking extraction polls a cancellation OBSERVER moved into the
        // closure: `ExtractContext` is `Clone` and only exposes `is_cancelled()`,
        // so the off-runtime worker can abort between entries without the ability
        // to cancel the whole job.
        let ctx = ctx.clone();
        // `unrar` is blocking and CPU/IO-bound; run it off the async runtime.
        let workspace =
            tokio::task::spawn_blocking(move || -> Result<TempWorkspace, ExtractError> {
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
                    // Poll the token BETWEEN entries so a long rar extraction aborts
                    // promptly. Returning `Err` drops `workspace`, removing the
                    // partially-extracted temp directory (no half-written tree).
                    //
                    // WHOLE-FILE LIMITATION: unlike the zip adapter (which reads
                    // each entry in bounded, cancellation-polled chunks), the
                    // `unrar` safe API extracts a whole entry in a single
                    // `extract_with_base` call that cannot be interrupted
                    // mid-file. Interrupting an in-flight large rar entry would
                    // require a different (lower-level) unrar API or library,
                    // which is a forbidden library swap. So the finest
                    // cancellation granularity here is per-entry: a cancel landing
                    // inside a large entry is observed only once that entry
                    // finishes and the loop reaches this poll for the next entry.
                    if ctx.is_cancelled() {
                        return Err(ExtractError::Cancelled);
                    }
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
    use tokio_util::sync::CancellationToken;

    /// The committed RAR5 fixture (shared with the integration smoke test): a
    /// single top-level `hello world.txt` = "hello world".
    fn fixture() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.rar")
    }

    #[tokio::test]
    async fn non_rar_input_fails_with_backend_error() {
        // A file whose bytes are not a valid rar signature must surface as a
        // backend error (the task will fail, not panic).
        let mut tmp = tempfile::NamedTempFile::new().expect("temp file");
        tmp.write_all(b"this is definitely not a rar archive")
            .expect("write bytes");

        let extractor = UnrarExtractor::new();
        let result = extractor
            .extract(tmp.path(), &ExtractContext::detached())
            .await;

        // `Result` itself is not `Debug` (its `Ok` payload is a `dyn ExtractedTree`
        // trait object), so map it to a `Debug`-able marker before asserting.
        let kind = result.map(|_| "ok");
        assert!(
            matches!(kind, Err(ExtractError::Backend(_))),
            "expected Backend error, got {kind:?}"
        );
    }

    #[tokio::test]
    async fn cancelled_context_aborts_before_extracting_the_entry() {
        // The committed fixture has a SINGLE entry, so this can only prove the
        // per-entry poll exists on the path and yields `Cancelled` (with the temp
        // dir reclaimed on the early-return drop). It deliberately does NOT claim
        // to distinguish an in-loop poll from a hoisted before-the-loop poll: that
        // would need a multi-entry rar fixture, and `unrar` (extract-only) cannot
        // create one. The per-entry granularity itself is a documented WHOLE-FILE
        // limitation of the `unrar` safe API (see `extract`); finer (mid-entry)
        // cancellation is impossible without a forbidden library swap.
        let token = CancellationToken::new();
        token.cancel();
        let ctx = ExtractContext::new(token);

        let result = UnrarExtractor::new().extract(&fixture(), &ctx).await;

        let kind = result.map(|_| "ok");
        assert!(
            matches!(kind, Err(ExtractError::Cancelled)),
            "a cancelled extraction must return ExtractError::Cancelled, got {kind:?}"
        );
    }
}
