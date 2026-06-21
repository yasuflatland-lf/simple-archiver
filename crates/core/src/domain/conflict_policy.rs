//! How a Folder-mode extraction resolves a name collision at the destination.

/// What to do when `Destination/<name>/` already exists.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ConflictPolicy {
    /// Write to `name (2)`, `name (3)`, … — never destroy existing data (default).
    #[default]
    AutoRename,
    /// Leave the existing folder; do not extract this item.
    Skip,
    /// Remove the existing folder, then extract.
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
