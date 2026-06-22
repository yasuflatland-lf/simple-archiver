//! How an output collision is resolved at the destination, for both Zip-mode
//! (`Destination/<name>.zip`) and Folder-mode (`Destination/<name>/`) runs.

/// What to do when the destination output already exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ConflictPolicy {
    /// Write to `name (2)`, `name (3)`, … — never destroy existing data (default).
    #[default]
    AutoRename,
    /// Leave the existing output; do not write this item.
    Skip,
    /// Remove the existing output, then write.
    Overwrite,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_auto_rename() {
        assert_eq!(ConflictPolicy::default(), ConflictPolicy::AutoRename);
    }
}
