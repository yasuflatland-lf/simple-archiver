//! The source item to archive — either a rar file or a folder (no IO).

use std::path::PathBuf;

/// Error returned when a dropped item is neither a folder nor a `.rar` file.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("unsupported item: {}", .0.display())]
pub struct UnsupportedSourceItem(pub PathBuf);

/// A source item to archive: either a rar file or a folder.
///
/// This is a value object. The caller (application layer) classifies the input
/// and constructs the appropriate variant; the domain does not inspect the filesystem.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SourceItem {
    /// A rar file to be extracted and re-archived as a zip.
    RarFile(PathBuf),
    /// A folder to be archived as a zip.
    Folder(PathBuf),
}

impl SourceItem {
    /// Classify a dropped path into a `SourceItem`.
    ///
    /// `is_dir` is injected by the caller so the domain never touches the
    /// filesystem (layer purity). A `.rar` file (case-insensitive extension)
    /// becomes `RarFile`, a directory becomes `Folder`, anything else is
    /// `UnsupportedSourceItem`.
    pub fn classify(path: PathBuf, is_dir: bool) -> Result<Self, UnsupportedSourceItem> {
        if is_dir {
            return Ok(SourceItem::Folder(path));
        }
        let is_rar = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("rar"));
        if is_rar {
            Ok(SourceItem::RarFile(path))
        } else {
            Err(UnsupportedSourceItem(path))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn classify_folder_is_folder() {
        let p = PathBuf::from("/some/dir");
        assert_eq!(
            SourceItem::classify(p.clone(), true),
            Ok(SourceItem::Folder(p))
        );
    }

    #[test]
    fn classify_rar_file_is_rar() {
        let p = PathBuf::from("/some/archive.rar");
        assert_eq!(
            SourceItem::classify(p.clone(), false),
            Ok(SourceItem::RarFile(p))
        );
    }

    #[test]
    fn classify_rar_extension_is_case_insensitive() {
        let p = PathBuf::from("/some/ARCHIVE.RAR");
        assert_eq!(
            SourceItem::classify(p.clone(), false),
            Ok(SourceItem::RarFile(p))
        );
    }

    #[test]
    fn classify_non_rar_file_is_unsupported() {
        let p = PathBuf::from("/some/note.txt");
        assert_eq!(
            SourceItem::classify(p.clone(), false),
            Err(UnsupportedSourceItem(p))
        );
    }

    #[test]
    fn unsupported_source_item_display_matches_ipc_contract() {
        // The Display string crosses the IPC boundary as-is; keep "unsupported item: <path>"
        // so the frontend's substring check ("unsupported item") keeps working.
        let path = PathBuf::from("note.txt");
        let e = UnsupportedSourceItem(path.clone());
        assert_eq!(
            e.to_string(),
            format!("unsupported item: {}", path.display())
        );
    }

    #[test]
    fn construct_rar_file_variant() {
        let path = PathBuf::from("/path/to/file.rar");
        let item = SourceItem::RarFile(path.clone());
        match item {
            SourceItem::RarFile(p) => assert_eq!(p, path),
            SourceItem::Folder(_) => panic!("Expected RarFile variant"),
        }
    }

    #[test]
    fn construct_folder_variant() {
        let path = PathBuf::from("/path/to/folder");
        let item = SourceItem::Folder(path.clone());
        match item {
            SourceItem::Folder(p) => assert_eq!(p, path),
            SourceItem::RarFile(_) => panic!("Expected Folder variant"),
        }
    }

    #[test]
    fn equal_rar_files_are_equal() {
        let path = PathBuf::from("/path/to/file.rar");
        let item1 = SourceItem::RarFile(path.clone());
        let item2 = SourceItem::RarFile(path);
        assert_eq!(item1, item2);
    }

    #[test]
    fn equal_folders_are_equal() {
        let path = PathBuf::from("/path/to/folder");
        let item1 = SourceItem::Folder(path.clone());
        let item2 = SourceItem::Folder(path);
        assert_eq!(item1, item2);
    }

    #[test]
    fn rar_file_and_folder_with_same_path_are_not_equal() {
        let path = PathBuf::from("/path/to/item");
        let rar_file = SourceItem::RarFile(path.clone());
        let folder = SourceItem::Folder(path);
        assert_ne!(rar_file, folder);
    }

    #[test]
    fn clone_rar_file_produces_equal_value() {
        let path = PathBuf::from("/path/to/file.rar");
        let original = SourceItem::RarFile(path);
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn clone_folder_produces_equal_value() {
        let path = PathBuf::from("/path/to/folder");
        let original = SourceItem::Folder(path);
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }
}
