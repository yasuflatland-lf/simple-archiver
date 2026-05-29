//! Zip archiving adapter backed by `async_zip` (tokio).

use crate::application::ports::{ArchiveError, Archiver};
use async_zip::base::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// Compresses directory trees into zip archives using `async_zip` with Deflate.
#[derive(Debug, Default)]
pub struct ZipArchiver;

impl ZipArchiver {
    /// Create a new archiver.
    pub fn new() -> Self {
        Self
    }
}

impl Archiver for ZipArchiver {
    /// Compress every regular file under `src_dir` into the zip at `dest_zip`.
    /// Directory entries are not stored explicitly (empty directories are dropped);
    /// each file is recorded under its `/`-separated path relative to `src_dir`.
    /// The output zip is never included in itself.
    async fn compress(&self, src_dir: &Path, dest_zip: &Path) -> Result<(), ArchiveError> {
        // Collect the file list from the walk BEFORE creating the output file.
        // If `dest_zip` lives inside `src_dir`, this guarantees it cannot appear
        // in the walk at all, so it is never archived into itself — regardless
        // of WalkDir ordering, canonicalization success, or platform symlinks.
        let files = collect_files(src_dir)?;

        let file = tokio::fs::File::create(dest_zip).await?;
        let mut writer = ZipFileWriter::with_tokio(file);

        for path in &files {
            let name = zip_entry_name(src_dir, path)?;
            let data = tokio::fs::read(path).await?;
            let builder = ZipEntryBuilder::new(name.into(), Compression::Deflate);
            writer
                .write_entry_whole(builder, &data)
                .await
                .map_err(|e| ArchiveError::Backend(e.to_string()))?;
        }

        writer
            .close()
            .await
            .map_err(|e| ArchiveError::Backend(e.to_string()))?;
        Ok(())
    }
}

/// Walk `root` and return the paths of every regular file it contains.
///
/// The full list is materialized before any output file is created, so a
/// destination written under `root` afterwards can never be picked up by the
/// walk (and thus never archived into itself).
fn collect_files(root: &Path) -> Result<Vec<PathBuf>, ArchiveError> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(|result| match result {
            Ok(entry) if entry.file_type().is_file() => Some(Ok(entry.into_path())),
            Ok(_) => None,
            Err(e) => Some(Err(ArchiveError::Backend(e.to_string()))),
        })
        .collect()
}

/// Build a zip entry name for `path` relative to `root`, using `/` separators
/// on every platform (the zip format mandates forward slashes).
pub(crate) fn zip_entry_name(root: &Path, path: &Path) -> Result<String, ArchiveError> {
    let relative = path.strip_prefix(root).map_err(|_| {
        ArchiveError::Backend(format!(
            "path {} is not under root {}",
            path.display(),
            root.display()
        ))
    })?;
    let name = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn top_level_file_keeps_its_name() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/x/a.txt");
        assert_eq!(zip_entry_name(&root, &path).unwrap(), "a.txt");
    }

    #[test]
    fn nested_file_uses_forward_slashes() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/x/sub/b.txt");
        assert_eq!(zip_entry_name(&root, &path).unwrap(), "sub/b.txt");
    }

    #[test]
    fn path_outside_root_is_an_error() {
        let root = PathBuf::from("/tmp/x");
        let path = PathBuf::from("/tmp/y/c.txt");
        assert!(zip_entry_name(&root, &path).is_err());
    }
}
