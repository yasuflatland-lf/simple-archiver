//! `ZipExtractor`: the `Extractor` adapter backed by `async_zip` (tokio).
//! `async_zip` is already async, so extraction runs directly on the runtime
//! (no `spawn_blocking`, unlike the synchronous `unrar` adapter). Extraction
//! target is a fresh `TempWorkspace`, returned as a boxed `ExtractedTree` guard.
//!
//! `async_zip` does NOT validate entry names, so this adapter applies its own
//! zip-slip guard: any entry whose path escapes the workspace (via `..`, an
//! absolute root, or a Windows drive/UNC prefix) rejects the whole extraction.

use crate::application::ports::{ExtractError, ExtractedTree, Extractor};
use crate::infrastructure::temp_workspace::TempWorkspace;
use async_zip::tokio::read::seek::ZipFileReader;
use std::path::{Component, Path, PathBuf};

/// Extracts zip archives into a temporary directory via `async_zip`.
#[derive(Debug, Default)]
pub struct ZipExtractor;

impl ZipExtractor {
    /// Create a new extractor (stateless).
    pub fn new() -> Self {
        Self
    }
}

impl Extractor for ZipExtractor {
    async fn extract(&self, src_archive: &Path) -> Result<Box<dyn ExtractedTree>, ExtractError> {
        let workspace = TempWorkspace::new()?; // io::Error -> ExtractError::Io

        // Open the archive with tokio and wrap in a buffered reader: the seek
        // reader (`ZipFileReader::with_tokio`) requires `AsyncBufRead + AsyncSeek`.
        // `tokio::fs::File` implements `AsyncSeek` but NOT `AsyncBufRead`, so the
        // `BufReader` adds the missing buffered-read layer.
        let file = tokio::fs::File::open(src_archive).await?; // io::Error -> ExtractError::Io
        let buf = tokio::io::BufReader::new(file);
        let mut reader = ZipFileReader::with_tokio(buf)
            .await
            .map_err(|e| ExtractError::Backend(e.to_string()))?;

        let count = reader.file().entries().len();
        for i in 0..count {
            // Read the metadata into OWNED values FIRST so the immutable borrow of
            // `reader.file()` is released before the `&mut self` entry reader call.
            let (is_dir, name) = {
                let entry = &reader.file().entries()[i];
                let is_dir = entry
                    .dir()
                    .map_err(|e| ExtractError::Backend(e.to_string()))?;
                let name = entry
                    .filename()
                    .as_str()
                    .map_err(|e| {
                        ExtractError::Backend(format!("entry {i} has a non-UTF-8 name: {e}"))
                    })?
                    .to_owned();
                (is_dir, name)
            };
            if is_dir {
                continue;
            }

            // Zip-slip guard + relative-path computation. A rejected entry aborts
            // the whole extraction (nothing is written for it).
            let rel = safe_relative_path(&name)?;
            let Some(rel) = rel else {
                // Empty after filtering (e.g. `.` only): nothing to write.
                continue;
            };

            // Now take the entry-bearing reader (`&mut self`); the metadata borrow
            // is gone. `reader_with_entry` returns a `ZipEntryReader<WithEntry>`,
            // whose `read_to_end_checked` validates the entry's CRC32 (and rejects
            // encrypted/corrupt/truncated entries) — surfacing `CRC32CheckError`
            // and friends as `Err` so the task fails instead of writing garbage.
            let mut entry_reader = reader
                .reader_with_entry(i)
                .await
                .map_err(|e| ExtractError::Backend(e.to_string()))?;
            let mut bytes = Vec::new();
            entry_reader
                .read_to_end_checked(&mut bytes)
                .await
                .map_err(|e| ExtractError::Backend(e.to_string()))?;

            let dest = workspace.path().join(&rel);
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await?; // io::Error -> ExtractError::Io
            }
            tokio::fs::write(&dest, &bytes).await?; // io::Error -> ExtractError::Io
        }

        Ok(Box::new(workspace))
    }
}

/// Validate a zip entry name and reduce it to a safe relative path.
///
/// Returns `Ok(Some(rel))` for a path built only from normal components,
/// `Ok(None)` when nothing remains after filtering (e.g. an entry of only `.`),
/// and `Err(ExtractError::Backend(_))` for any unsafe component (`..`, an
/// absolute root, or a Windows drive/UNC prefix). Rejecting an unsafe name
/// aborts the whole extraction so nothing escapes the workspace.
fn safe_relative_path(name: &str) -> Result<Option<PathBuf>, ExtractError> {
    let mut rel = PathBuf::new();
    for component in Path::new(name).components() {
        match component {
            Component::Normal(part) => rel.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ExtractError::Backend(format!("unsafe entry path: {name}")));
            }
        }
    }
    if rel.as_os_str().is_empty() {
        Ok(None)
    } else {
        Ok(Some(rel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// Build an in-memory zip on disk from `(name, bytes)` pairs using the sync
    /// `zip` dev-dependency. `start_file` accepts arbitrary names (including
    /// traversal sequences), which is exactly what the zip-slip test needs.
    fn make_zip(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let tmp = tempfile::NamedTempFile::new().expect("temp zip file");
        let mut writer = ZipWriter::new(tmp.reopen().expect("reopen temp zip"));
        let options = SimpleFileOptions::default();
        for (name, bytes) in entries {
            writer.start_file(*name, options).expect("start zip entry");
            writer.write_all(bytes).expect("write zip entry bytes");
        }
        writer.finish().expect("finalize zip");
        tmp
    }

    /// Build a zip that contains an explicit directory entry plus a file.
    fn make_zip_with_dir() -> tempfile::NamedTempFile {
        let tmp = tempfile::NamedTempFile::new().expect("temp zip file");
        let mut writer = ZipWriter::new(tmp.reopen().expect("reopen temp zip"));
        let options = SimpleFileOptions::default();
        writer
            .add_directory("emptydir/", options)
            .expect("dir entry");
        writer
            .start_file("emptydir/inside.txt", options)
            .expect("start zip entry");
        writer.write_all(b"deep").expect("write bytes");
        writer.finish().expect("finalize zip");
        tmp
    }

    #[tokio::test]
    async fn extracts_flat_and_nested_files_with_exact_contents() {
        let zip = make_zip(&[("hello.txt", b"hi"), ("nested/world.txt", b"world")]);

        let tree = ZipExtractor::new()
            .extract(zip.path())
            .await
            .expect("extraction should succeed");

        let root = tree.path();
        let hello = std::fs::read(root.join("hello.txt")).expect("hello.txt exists");
        assert_eq!(hello, b"hi");
        let world =
            std::fs::read(root.join("nested").join("world.txt")).expect("nested file exists");
        assert_eq!(world, b"world");
    }

    #[tokio::test]
    async fn directory_entries_are_skipped_and_parents_created() {
        let zip = make_zip_with_dir();

        let tree = ZipExtractor::new()
            .extract(zip.path())
            .await
            .expect("extraction should succeed");

        let root = tree.path();
        // The directory entry itself is not materialized as a file; only the
        // nested file is written, and its parent directory is auto-created.
        let inside = std::fs::read(root.join("emptydir").join("inside.txt")).expect("nested file");
        assert_eq!(inside, b"deep");
        assert!(
            root.join("emptydir").is_dir(),
            "parent directory should have been created"
        );
    }

    #[tokio::test]
    async fn rejects_zip_slip_entry_and_writes_nothing_outside_tree() {
        // An entry literally named `../escape.txt` must be rejected before any
        // bytes are written outside the extraction tree.
        let zip = make_zip(&[("../escape.txt", b"pwned")]);

        let result = ZipExtractor::new().extract(zip.path()).await;
        let kind = result.map(|_| "ok");
        match kind {
            Err(ExtractError::Backend(ref msg)) => {
                assert!(
                    msg.contains("unsafe entry path"),
                    "expected zip-slip rejection, got {msg:?}"
                );
            }
            other => panic!("expected Backend zip-slip error, got {other:?}"),
        }

        // The zip file lives in the OS temp dir; assert no `escape.txt` was
        // written into that parent directory (i.e. nothing escaped the tree).
        let parent = zip.path().parent().expect("temp parent");
        assert!(
            !parent.join("escape.txt").exists(),
            "zip-slip must not write any file outside the extraction tree"
        );
    }

    #[tokio::test]
    async fn corrupt_input_fails_with_backend_error() {
        let mut tmp = tempfile::NamedTempFile::new().expect("temp file");
        tmp.write_all(b"not a zip").expect("write bytes");

        let result = ZipExtractor::new().extract(tmp.path()).await;
        let kind = result.map(|_| "ok");
        assert!(
            matches!(kind, Err(ExtractError::Backend(_))),
            "expected Backend error for non-zip bytes, got {kind:?}"
        );
    }

    #[tokio::test]
    async fn encrypted_zip_entry_fails_with_backend_error() {
        use zip::unstable::write::FileOptionsExt as _;

        // Build an ENCRYPTED Stored entry: this is the silently-corrupting case
        // the seek path used to accept. The checked reader decrypts to garbage,
        // whose CRC32 fails to match, so extraction MUST fail.
        let tmp = tempfile::NamedTempFile::new().expect("temp zip file");
        let mut writer = ZipWriter::new(tmp.reopen().expect("reopen temp zip"));
        let opts = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored)
            .with_deprecated_encryption(b"secret");
        writer
            .start_file("secret.txt", opts)
            .expect("start encrypted entry");
        writer
            .write_all(b"top secret bytes")
            .expect("write encrypted entry bytes");
        writer.finish().expect("finalize zip");

        let result = ZipExtractor::new().extract(tmp.path()).await;
        let kind = result.map(|_| "ok");
        assert!(
            matches!(kind, Err(ExtractError::Backend(_))),
            "expected Backend error for an encrypted entry, got {kind:?}"
        );
    }

    #[tokio::test]
    async fn empty_zip_extracts_to_empty_directory() {
        // A zip with ZERO entries is valid; the design allows it to extract into
        // an empty output directory.
        let zip = make_zip(&[]);

        let tree = ZipExtractor::new()
            .extract(zip.path())
            .await
            .expect("empty zip should extract successfully");

        let root = tree.path();
        assert!(root.is_dir(), "extraction tree directory should exist");
        let mut entries = std::fs::read_dir(root).expect("read extraction tree");
        assert!(
            entries.next().is_none(),
            "an empty zip must extract to an empty directory"
        );
    }
}
