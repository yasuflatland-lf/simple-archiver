//! The single source of truth for the archive extension -> format mapping (no IO).
//!
//! `.rar`/`.zip` classification lives here so that both `SourceItem::classify`
//! (domain) and the `ArchiveExtractor` router (infrastructure) consume one rule
//! instead of hand-syncing duplicated extension lists.

/// Supported archive container formats (extension-classified).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArchiveFormat {
    Rar,
    Zip,
}

impl ArchiveFormat {
    /// Classify by file extension (ASCII case-insensitive); `None` if unsupported.
    pub fn from_extension(ext: &str) -> Option<ArchiveFormat> {
        if ext.eq_ignore_ascii_case("rar") {
            Some(ArchiveFormat::Rar)
        } else if ext.eq_ignore_ascii_case("zip") {
            Some(ArchiveFormat::Zip)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_extension_rar_lowercase_is_rar() {
        assert_eq!(
            ArchiveFormat::from_extension("rar"),
            Some(ArchiveFormat::Rar)
        );
    }

    #[test]
    fn from_extension_rar_uppercase_is_rar() {
        assert_eq!(
            ArchiveFormat::from_extension("RAR"),
            Some(ArchiveFormat::Rar)
        );
    }

    #[test]
    fn from_extension_zip_lowercase_is_zip() {
        assert_eq!(
            ArchiveFormat::from_extension("zip"),
            Some(ArchiveFormat::Zip)
        );
    }

    #[test]
    fn from_extension_zip_uppercase_is_zip() {
        assert_eq!(
            ArchiveFormat::from_extension("ZIP"),
            Some(ArchiveFormat::Zip)
        );
    }

    #[test]
    fn from_extension_zip_mixed_case_is_zip() {
        assert_eq!(
            ArchiveFormat::from_extension("Zip"),
            Some(ArchiveFormat::Zip)
        );
    }

    #[test]
    fn from_extension_unknown_is_none() {
        assert_eq!(ArchiveFormat::from_extension("txt"), None);
    }

    #[test]
    fn from_extension_empty_is_none() {
        assert_eq!(ArchiveFormat::from_extension(""), None);
    }
}
