//! Zip archiving adapter backed by `async_zip` (tokio).

use crate::application::ports::ArchiveError;
use std::path::{Component, Path};

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
