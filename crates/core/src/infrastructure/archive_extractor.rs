//! `ArchiveExtractor`: an `Extractor` adapter that dispatches by file extension.
//! `.rar` routes to `UnrarExtractor`, `.zip` routes to `ZipExtractor`, and any
//! other (or missing) extension fails with a `Backend` error. The match is
//! ASCII-case-insensitive so `.ZIP`/`.Rar` are accepted.

use crate::application::ports::{ExtractError, ExtractedTree, Extractor};
use crate::infrastructure::unrar_extractor::UnrarExtractor;
use crate::infrastructure::zip_extractor::ZipExtractor;
use std::path::Path;

/// Routes extraction to the rar or zip adapter based on the file extension.
#[derive(Debug, Default)]
pub struct ArchiveExtractor {
    rar: UnrarExtractor,
    zip: ZipExtractor,
}

impl ArchiveExtractor {
    /// Create a new router wrapping the rar and zip adapters.
    pub fn new() -> Self {
        Self::default()
    }
}

impl Extractor for ArchiveExtractor {
    async fn extract(&self, src_archive: &Path) -> Result<Box<dyn ExtractedTree>, ExtractError> {
        match src_archive.extension().and_then(|e| e.to_str()) {
            Some(e) if e.eq_ignore_ascii_case("rar") => self.rar.extract(src_archive).await,
            Some(e) if e.eq_ignore_ascii_case("zip") => self.zip.extract(src_archive).await,
            _ => Err(ExtractError::Backend(format!(
                "unsupported archive: {}",
                src_archive.display()
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// Build a tiny zip inside a `TempDir` at a path ending in `.zip` so the
    /// router selects the zip adapter, returning both the dir guard and path.
    fn zip_in_tempdir(entries: &[(&str, &[u8])]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("input.zip");
        let file = std::fs::File::create(&path).expect("create zip file");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(bytes).expect("write zip entry bytes");
        }
        writer.finish().expect("finalize zip");
        (dir, path)
    }

    #[tokio::test]
    async fn zip_extension_routes_to_zip_adapter_and_succeeds() {
        let (_dir, path) = zip_in_tempdir(&[("a.txt", b"alpha")]);

        let tree = ArchiveExtractor::new()
            .extract(&path)
            .await
            .expect("zip route should succeed");

        let contents = std::fs::read(tree.path().join("a.txt")).expect("extracted file");
        assert_eq!(contents, b"alpha");
    }

    #[tokio::test]
    async fn uppercase_zip_extension_is_routed_case_insensitively() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("INPUT.ZIP");
        let file = std::fs::File::create(&path).expect("create zip file");
        let mut writer = ZipWriter::new(file);
        writer
            .start_file("a.txt", SimpleFileOptions::default())
            .expect("start entry");
        writer.write_all(b"beta").expect("write bytes");
        writer.finish().expect("finalize zip");

        let tree = ArchiveExtractor::new()
            .extract(&path)
            .await
            .expect("uppercase .ZIP should route to zip adapter");
        let contents = std::fs::read(tree.path().join("a.txt")).expect("extracted file");
        assert_eq!(contents, b"beta");
    }

    #[tokio::test]
    async fn unknown_extension_fails_with_unsupported_archive() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("foo.txt");
        std::fs::write(&path, b"plain text").expect("write file");

        let result = ArchiveExtractor::new().extract(&path).await;
        let kind = result.map(|_| "ok");
        match kind {
            Err(ExtractError::Backend(ref msg)) => {
                assert!(
                    msg.contains("unsupported archive"),
                    "expected unsupported-archive error, got {msg:?}"
                );
            }
            other => panic!("expected unsupported-archive Backend error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn no_extension_fails_with_unsupported_archive() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("archive");
        std::fs::write(&path, b"whatever").expect("write file");

        let result = ArchiveExtractor::new().extract(&path).await;
        let kind = result.map(|_| "ok");
        match kind {
            Err(ExtractError::Backend(ref msg)) => {
                assert!(
                    msg.contains("unsupported archive"),
                    "expected unsupported-archive error, got {msg:?}"
                );
            }
            other => panic!("expected unsupported-archive Backend error, got {other:?}"),
        }
    }
}
