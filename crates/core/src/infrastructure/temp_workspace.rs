//! A RAII temporary working directory used as the extraction target for rar files.
//! Wraps `tempfile::TempDir`; the directory is removed when the value is dropped,
//! which is what guarantees temp cleanup on success, failure, cancellation, and panic.

use crate::application::ports::ExtractedTree;
use std::path::Path;

/// An owned temporary directory. `Drop` removes it (and its contents) recursively.
#[derive(Debug)]
pub struct TempWorkspace {
    dir: tempfile::TempDir,
}

impl TempWorkspace {
    /// Create a fresh temporary directory under the OS temp location.
    pub fn new() -> std::io::Result<Self> {
        Ok(Self {
            dir: tempfile::tempdir()?,
        })
    }

    /// The path of the temporary directory.
    pub fn path(&self) -> &Path {
        self.dir.path()
    }
}

impl ExtractedTree for TempWorkspace {
    fn path(&self) -> &Path {
        self.dir.path()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_creates_a_directory_that_exists() {
        let ws = TempWorkspace::new().expect("create temp workspace");
        assert!(ws.path().is_dir(), "temp dir should exist after creation");
    }

    #[test]
    fn drop_removes_the_directory() {
        let path = {
            let ws = TempWorkspace::new().expect("create temp workspace");
            ws.path().to_path_buf()
        };
        assert!(!path.exists(), "temp dir must be removed when dropped");
    }

    #[test]
    fn extracted_tree_path_matches_inherent_path() {
        let ws = TempWorkspace::new().expect("create temp workspace");
        let via_trait: &dyn ExtractedTree = &ws;
        assert_eq!(via_trait.path(), ws.path());
    }
}
