//! The source item to archive — either a rar file or a folder (no IO).

use std::path::PathBuf;

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

#[cfg(test)]
mod tests {
    use super::*;

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
