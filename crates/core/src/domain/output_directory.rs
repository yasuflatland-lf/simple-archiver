//! The output directory newtype — pure value object, no filesystem existence check.

use std::path::{Path, PathBuf};

/// The output directory for archived files.
///
/// This is a value object that wraps a path. It performs no filesystem checks,
/// delegating existence validation to the application/infrastructure layer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputDirectory(PathBuf);

impl OutputDirectory {
    /// Create a new output directory from a path.
    ///
    /// No filesystem existence check is performed; the path is accepted as-is.
    pub fn new(path: PathBuf) -> Self {
        OutputDirectory(path)
    }

    /// Get a reference to the inner path.
    pub fn path(&self) -> &Path {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_method_returns_same_path_passed_to_new() {
        let path = PathBuf::from("/output/dir");
        let output_dir = OutputDirectory::new(path.clone());
        assert_eq!(output_dir.path(), &path);
    }

    #[test]
    fn equal_output_directories_from_same_path() {
        let path = PathBuf::from("/output/dir");
        let dir1 = OutputDirectory::new(path.clone());
        let dir2 = OutputDirectory::new(path);
        assert_eq!(dir1, dir2);
    }

    #[test]
    fn different_paths_are_not_equal() {
        let path1 = PathBuf::from("/output/dir1");
        let path2 = PathBuf::from("/output/dir2");
        let dir1 = OutputDirectory::new(path1);
        let dir2 = OutputDirectory::new(path2);
        assert_ne!(dir1, dir2);
    }

    #[test]
    fn clone_produces_equal_value() {
        let path = PathBuf::from("/output/dir");
        let original = OutputDirectory::new(path);
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn construction_works_for_nonexistent_path() {
        let path = PathBuf::from("/nonexistent/output/dir");
        let output_dir = OutputDirectory::new(path.clone());
        assert_eq!(output_dir.path(), &path);
    }
}
