//! Output filename value objects with Windows-superset validation.
//!
//! A `FileStem` that constructs successfully is a valid filename on both macOS
//! and Windows; `OutputFileName` appends the `.zip` extension.

/// Characters forbidden in a filename on Windows (a superset of macOS rules).
/// Path separators `/` and `\` are included here.
pub(crate) fn is_forbidden_filename_char(c: char) -> bool {
    matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || (c as u32) <= 0x1F
}

/// Windows reserved device names (checked case-insensitively against the stem).
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A validated filename stem (no extension).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStem(String);

/// A validated output filename ending in `.zip`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputFileName(String);

/// Reasons a filename stem is invalid.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NameError {
    /// The stem is empty.
    #[error("file name must not be empty")]
    Empty,
    /// The stem contains a forbidden character.
    #[error("file name contains a forbidden character: {ch:?}")]
    ForbiddenChar { ch: char },
    /// The stem ends with a dot or space (invalid on Windows).
    #[error("file name must not end with a dot or space")]
    TrailingDotOrSpace,
    /// The stem matches a Windows reserved device name.
    #[error("file name is a reserved device name: {name}")]
    ReservedName { name: String },
}

impl FileStem {
    /// Validate `value` as a cross-platform-safe filename stem.
    pub fn new(value: &str) -> Result<Self, NameError> {
        if value.is_empty() {
            return Err(NameError::Empty);
        }
        if let Some(ch) = value.chars().find(|&c| is_forbidden_filename_char(c)) {
            return Err(NameError::ForbiddenChar { ch });
        }
        if value.ends_with('.') || value.ends_with(' ') {
            return Err(NameError::TrailingDotOrSpace);
        }
        if RESERVED_NAMES
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(value))
        {
            return Err(NameError::ReservedName {
                name: value.to_string(),
            });
        }
        Ok(Self(value.to_string()))
    }

    /// The validated stem text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl OutputFileName {
    /// Build an output filename by appending `.zip` to a validated stem.
    pub fn from_stem(stem: FileStem) -> Self {
        Self(format!("{}.zip", stem.0))
    }

    /// The full filename (always ends in `.zip`).
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_stem_is_valid_and_gets_zip_extension() {
        let stem = FileStem::new("photo_001").unwrap();
        assert_eq!(stem.as_str(), "photo_001");
        assert_eq!(OutputFileName::from_stem(stem).as_str(), "photo_001.zip");
    }

    #[test]
    fn empty_stem_is_rejected() {
        assert_eq!(FileStem::new(""), Err(NameError::Empty));
    }

    #[test]
    fn forbidden_characters_are_rejected() {
        for ch in ['<', '>', ':', '"', '/', '\\', '|', '?', '*'] {
            let value = format!("a{ch}b");
            assert_eq!(
                FileStem::new(&value),
                Err(NameError::ForbiddenChar { ch }),
                "char {ch:?} should be rejected"
            );
        }
    }

    #[test]
    fn control_characters_are_rejected() {
        assert_eq!(
            FileStem::new("a\u{0001}b"),
            Err(NameError::ForbiddenChar { ch: '\u{0001}' })
        );
    }

    #[test]
    fn trailing_dot_or_space_is_rejected() {
        assert_eq!(FileStem::new("name."), Err(NameError::TrailingDotOrSpace));
        assert_eq!(FileStem::new("name "), Err(NameError::TrailingDotOrSpace));
    }

    #[test]
    fn reserved_names_are_rejected_case_insensitively() {
        assert_eq!(
            FileStem::new("CON"),
            Err(NameError::ReservedName {
                name: "CON".to_string()
            })
        );
        assert_eq!(
            FileStem::new("com1"),
            Err(NameError::ReservedName {
                name: "com1".to_string()
            })
        );
    }
}
