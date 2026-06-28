//! `FormatRegistry`: resolves a `SourceItem` into a compressible directory.
//!
//! `Folder` is already a directory; `RarFile` and `ZipFile` are each extracted
//! into a temp guard via the `Extractor` port. The returned `Prepared` owns the
//! extracted-tree guard, so
//! the temp directory lives exactly as long as the value is held by the caller
//! (the engine drops it after compression).

use crate::application::extract_context::ExtractContext;
use crate::application::ports::{ExtractError, ExtractedTree, Extractor};
use crate::domain::source_item::SourceItem;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// A source resolved to a directory ready for compression.
pub(crate) enum Prepared {
    /// A folder source — compressed in place, no temp directory.
    Folder(PathBuf),
    /// An extracted archive source (rar/zip) in a temp guard; dropping the guard removes the dir.
    Extracted(Box<dyn ExtractedTree>),
}

impl Prepared {
    /// The directory to hand to the `Archiver`.
    pub(crate) fn dir(&self) -> &Path {
        match self {
            Prepared::Folder(p) => p,
            Prepared::Extracted(tree) => tree.path(),
        }
    }
}

/// Resolves source items to compressible directories using an `Extractor`.
pub(crate) struct FormatRegistry<E: Extractor> {
    extractor: Arc<E>,
}

// Manual `Clone` so the registry is cloneable for any `E` (it only holds an
// `Arc<E>`). A `#[derive(Clone)]` would wrongly require `E: Clone`, which the
// extractor implementations (and the engine's `E: Extractor` bound) do not provide.
impl<E: Extractor> Clone for FormatRegistry<E> {
    fn clone(&self) -> Self {
        Self {
            extractor: Arc::clone(&self.extractor),
        }
    }
}

impl<E: Extractor> FormatRegistry<E> {
    /// Build a registry over the given extractor.
    pub(crate) fn new(extractor: Arc<E>) -> Self {
        Self { extractor }
    }

    /// Resolve `source` into a `Prepared` directory, extracting rar/zip files.
    /// `ctx` carries the cancellation observation handed to the extractor so a
    /// long extraction can abort mid-stream.
    pub(crate) async fn prepare(
        &self,
        source: &SourceItem,
        ctx: &ExtractContext,
    ) -> Result<Prepared, ExtractError> {
        match source {
            SourceItem::Folder(path) => Ok(Prepared::Folder(path.clone())),
            SourceItem::RarFile(path) | SourceItem::ZipFile(path) => Ok(Prepared::Extracted(
                self.extractor.extract(path, ctx).await?,
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A fake extracted tree backed by a real temp dir (so `path()` is a real dir).
    struct FakeTree {
        dir: tempfile::TempDir,
    }
    impl ExtractedTree for FakeTree {
        fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    /// A fake extractor: records calls, optionally fails for entries whose
    /// filename is in `fail_names`.
    struct FakeExtractor {
        fail_names: HashSet<String>,
        calls: Arc<AtomicUsize>,
    }
    impl FakeExtractor {
        fn new() -> Self {
            Self {
                fail_names: HashSet::new(),
                calls: Arc::new(AtomicUsize::new(0)),
            }
        }
    }
    impl Extractor for FakeExtractor {
        async fn extract(
            &self,
            src: &Path,
            _ctx: &ExtractContext,
        ) -> Result<Box<dyn ExtractedTree>, ExtractError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let name = src.file_name().unwrap().to_string_lossy().to_string();
            if self.fail_names.contains(&name) {
                return Err(ExtractError::Backend("boom".to_string()));
            }
            Ok(Box::new(FakeTree {
                dir: tempfile::tempdir().unwrap(),
            }))
        }
    }

    #[tokio::test]
    async fn folder_is_returned_as_is_without_calling_the_extractor() {
        let fake = FakeExtractor::new();
        let calls = fake.calls.clone();
        let registry = FormatRegistry::new(Arc::new(fake));

        let prepared = registry
            .prepare(
                &SourceItem::Folder(PathBuf::from("/some/dir")),
                &ExtractContext::detached(),
            )
            .await
            .expect("folder prepares");

        assert_eq!(prepared.dir(), Path::new("/some/dir"));
        assert_eq!(calls.load(Ordering::SeqCst), 0, "folder must not extract");
    }

    #[tokio::test]
    async fn rar_is_extracted_and_dir_points_at_the_temp_tree() {
        let fake = FakeExtractor::new();
        let calls = fake.calls.clone();
        let registry = FormatRegistry::new(Arc::new(fake));

        let prepared = registry
            .prepare(
                &SourceItem::RarFile(PathBuf::from("a.rar")),
                &ExtractContext::detached(),
            )
            .await
            .expect("rar prepares");

        assert_eq!(calls.load(Ordering::SeqCst), 1, "rar must extract once");
        assert!(
            prepared.dir().is_dir(),
            "prepared dir should be a real directory"
        );
        assert!(matches!(prepared, Prepared::Extracted(_)));
    }

    #[tokio::test]
    async fn extraction_failure_propagates() {
        let mut fake = FakeExtractor::new();
        fake.fail_names.insert("bad.rar".to_string());
        let registry = FormatRegistry::new(Arc::new(fake));

        let result = registry
            .prepare(
                &SourceItem::RarFile(PathBuf::from("bad.rar")),
                &ExtractContext::detached(),
            )
            .await;

        assert!(matches!(result, Err(ExtractError::Backend(_))));
    }

    #[tokio::test]
    async fn zip_is_extracted_and_dir_points_at_the_temp_tree() {
        let fake = FakeExtractor::new();
        let calls = fake.calls.clone();
        let registry = FormatRegistry::new(Arc::new(fake));

        let prepared = registry
            .prepare(
                &SourceItem::ZipFile(PathBuf::from("a.zip")),
                &ExtractContext::detached(),
            )
            .await
            .expect("zip prepares");

        assert_eq!(calls.load(Ordering::SeqCst), 1, "zip must extract once");
        assert!(
            prepared.dir().is_dir(),
            "prepared dir should be a real directory"
        );
        assert!(matches!(prepared, Prepared::Extracted(_)));
    }

    /// A fake extractor that observes the context and aborts as `Cancelled` when
    /// the token is already tripped — proving the cancellation observation
    /// threads through `prepare` into the extractor.
    struct CancelObservingExtractor;
    impl Extractor for CancelObservingExtractor {
        async fn extract(
            &self,
            _src: &Path,
            ctx: &ExtractContext,
        ) -> Result<Box<dyn ExtractedTree>, ExtractError> {
            if ctx.is_cancelled() {
                return Err(ExtractError::Cancelled);
            }
            Ok(Box::new(FakeTree {
                dir: tempfile::tempdir().unwrap(),
            }))
        }
    }

    #[tokio::test]
    async fn prepare_threads_cancellation_into_the_extractor() {
        let registry = FormatRegistry::new(Arc::new(CancelObservingExtractor));
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();

        let result = registry
            .prepare(
                &SourceItem::ZipFile(PathBuf::from("a.zip")),
                &ExtractContext::new(token),
            )
            .await;

        assert!(
            matches!(result, Err(ExtractError::Cancelled)),
            "a cancelled context must surface as ExtractError::Cancelled"
        );
    }
}
