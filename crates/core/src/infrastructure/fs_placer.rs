//! `FsPlacer`: a `Placer` that recursively copies an extracted tree into the
//! output directory, never overwriting an existing entry (auto-renaming on
//! collision). Blocking filesystem work runs on a `spawn_blocking` thread so the
//! async engine is never blocked.

use crate::application::ports::{PlaceError, Placer};
use std::path::{Path, PathBuf};

/// Copies extracted trees into the output directory without overwriting.
#[derive(Debug, Default)]
pub struct FsPlacer;

impl FsPlacer {
    /// Create a new placer.
    pub fn new() -> Self {
        Self
    }
}

impl Placer for FsPlacer {
    async fn place(&self, src_tree: &Path, desired_dest: &Path) -> Result<PathBuf, PlaceError> {
        let src = src_tree.to_path_buf();
        let desired = desired_dest.to_path_buf();
        // Blocking std::fs work off the async runtime; flatten JoinError into Io.
        tokio::task::spawn_blocking(move || place_blocking(&src, &desired))
            .await
            .map_err(|e| PlaceError::Io(std::io::Error::other(e)))?
    }
}

/// Resolve a non-colliding destination, then recursively copy `src` into it.
fn place_blocking(src: &Path, desired: &Path) -> Result<PathBuf, PlaceError> {
    let dest = non_colliding(desired);
    copy_tree(src, &dest)?;
    Ok(dest)
}

/// Return `desired` if it does not exist, else `desired (2)`, `desired (3)`, …
/// on the final component until a free path is found.
fn non_colliding(desired: &Path) -> PathBuf {
    if !desired.exists() {
        return desired.to_path_buf();
    }
    let parent = desired.parent().unwrap_or_else(|| Path::new("."));
    let base = desired
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".to_string());
    // Counter starts at 2 so the first alternative reads "name (2)".
    for n in 2..=u32::MAX {
        let candidate = parent.join(format!("{base} ({n})"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Astronomically unreachable; fall back to the desired path.
    desired.to_path_buf()
}

/// Recursively copy the directory tree at `src` into a fresh directory `dest`.
fn copy_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a temp source tree: `root/a.txt` + `root/sub/b.txt`.
    fn make_source_tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"alpha").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub").join("b.txt"), b"beta").unwrap();
        dir
    }

    #[tokio::test]
    async fn places_tree_into_fresh_dest_and_copies_all_files() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");

        let final_path = FsPlacer::new().place(src.path(), &dest).await.unwrap();

        assert_eq!(final_path, dest);
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(
            std::fs::read(dest.join("sub").join("b.txt")).unwrap(),
            b"beta"
        );
    }

    #[tokio::test]
    async fn does_not_overwrite_and_auto_renames_on_collision() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");
        // Pre-create the desired dest with a sentinel file.
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep.txt"), b"original").unwrap();

        let final_path = FsPlacer::new().place(src.path(), &dest).await.unwrap();

        // The original is untouched; the new tree landed in "foo (2)".
        assert_eq!(final_path, out.path().join("foo (2)"));
        assert_eq!(std::fs::read(dest.join("keep.txt")).unwrap(), b"original");
        assert_eq!(std::fs::read(final_path.join("a.txt")).unwrap(), b"alpha");
    }
}
