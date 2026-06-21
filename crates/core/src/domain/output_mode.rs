//! The batch output mode: re-zip every item, or extract archives to folders.

/// What the run produces for every queued item.
///
/// `Zip` re-archives each source into a `.zip` (the original behavior); `Folder`
/// extracts each archive into its own sub-directory under the output directory.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum OutputMode {
    /// Re-archive each source into a `.zip` file (default).
    #[default]
    Zip,
    /// Extract each archive into `Destination/<archive-name>/`.
    Folder,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_output_mode_is_zip() {
        assert_eq!(OutputMode::default(), OutputMode::Zip);
    }

    #[test]
    fn output_mode_is_copy_and_eq() {
        let m = OutputMode::Folder;
        let copied = m; // Copy
        assert_eq!(m, copied);
        assert_ne!(OutputMode::Zip, OutputMode::Folder);
    }
}
