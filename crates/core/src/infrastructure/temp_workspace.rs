//! A RAII temporary working directory used as the extraction target for rar files.
//! Wraps `tempfile::TempDir`; the directory is removed when the value is dropped,
//! which is what guarantees temp cleanup on success, error return, and cancellation.
//! Cleanup also holds for stack-unwind panics under the default `panic = "unwind"`
//! strategy (Drop runs during unwinding); it would NOT hold under `panic = "abort"`,
//! since aborting skips destructors.

use crate::application::ports::ExtractedTree;
use std::path::Path;

/// An owned temporary directory. `Drop` removes it (and its contents) recursively.
#[derive(Debug)]
pub(crate) struct TempWorkspace {
    dir: tempfile::TempDir,
}

impl TempWorkspace {
    /// Create a fresh temporary directory under the OS temp location.
    pub(crate) fn new() -> std::io::Result<Self> {
        Ok(Self {
            dir: tempfile::tempdir()?,
        })
    }

    /// The path of the temporary directory.
    pub(crate) fn path(&self) -> &Path {
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
    fn drop_removes_a_populated_directory() {
        // The "no half-written tree" guarantee on a cancelled or failed
        // extraction relies on RAII removing the temp dir *with its contents*:
        // both extractors return `Err` without handing back the guard, so a
        // partially-written workspace is reclaimed by this `Drop`. Write a nested
        // file and a top-level file to mimic a half-written extraction, then prove
        // the whole tree is gone after the workspace drops.
        let (root, nested, top) = {
            let ws = TempWorkspace::new().expect("create temp workspace");
            let nested_dir = ws.path().join("a").join("b");
            std::fs::create_dir_all(&nested_dir).expect("create nested dirs");
            let nested = nested_dir.join("deep.txt");
            std::fs::write(&nested, b"partial").expect("write nested file");
            let top = ws.path().join("top.txt");
            std::fs::write(&top, b"partial").expect("write top file");
            assert!(
                nested.exists() && top.exists(),
                "files written into the tree"
            );
            (ws.path().to_path_buf(), nested, top)
        };
        assert!(
            !root.exists() && !nested.exists() && !top.exists(),
            "a populated temp dir (a partially-written tree) must be removed on drop"
        );
    }

    #[test]
    fn extracted_tree_path_matches_inherent_path() {
        let ws = TempWorkspace::new().expect("create temp workspace");
        let via_trait: &dyn ExtractedTree = &ws;
        assert_eq!(via_trait.path(), ws.path());
    }
}
