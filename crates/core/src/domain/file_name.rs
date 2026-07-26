//! Output filename value objects with Windows-superset validation.
//!
//! A `FileStem` that constructs successfully is a valid filename on both macOS
//! and Windows; `OutputFileName` appends the `.zip` extension. `OutputName` is
//! the sum type a task actually carries: it records both the destination name
//! and where that name came from.

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

/// What a task will be called at the destination, and where that name came from.
///
/// The derivation rule differs by output mode, and reordering must respect that
/// difference: a Zip name is derived from the task's POSITION and rebinds when
/// positions change, whereas a Folder name is derived from the task's SOURCE and
/// travels with the task. Encoding the provenance in the type stops one rebinding
/// rule from being applied to both, and lets a task that produces nothing say so
/// instead of carrying a fabricated `.zip` label.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputName {
    /// A `.zip` filename resolved from the naming rule at a list position.
    Zip(OutputFileName),
    /// A directory name taken from the source item.
    ///
    /// Holds a validated [`FileStem`] rather than a bare `String` so Folder mode
    /// keeps the same cross-platform name validation as Zip mode.
    Folder(FileStem),
    /// This task produces no output at all (a Folder-mode folder source).
    None,
}

impl OutputName {
    /// The name as it appears at the destination, or `None` when nothing is produced.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            OutputName::Zip(name) => Some(name.as_str()),
            OutputName::Folder(stem) => Some(stem.as_str()),
            OutputName::None => Option::None,
        }
    }

    /// The key two outputs are compared by when deciding whether they would
    /// land on the same filesystem entry.
    ///
    /// Folds the two ways a filesystem collapses distinct strings onto one file:
    /// Unicode normalisation (APFS/HFS+ treat NFC and NFD as the same name) and
    /// case (Windows and default-configured macOS are case-insensitive). NFC is
    /// chosen over NFD only because it is the shorter, more common form; the
    /// direction does not matter as long as it is applied to both sides.
    ///
    /// This is deliberately applied on every platform, matching how `FileStem`
    /// already enforces Windows naming rules everywhere: the safest common
    /// denominator, so a batch that plans on one OS plans on all of them.
    pub fn fold_key(&self) -> Option<String> {
        use unicode_normalization::UnicodeNormalization as _;
        self.as_str()
            .map(|s| s.nfc().collect::<String>().to_lowercase())
    }

    /// Whether this task produces an output that can collide with another.
    ///
    /// The job-level uniqueness guard consults this so an item that writes
    /// nothing never takes part in a collision it cannot cause.
    pub fn produces_output(&self) -> bool {
        !matches!(self, OutputName::None)
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

    #[test]
    fn output_name_as_str_returns_destination_name_or_none() {
        let zip = OutputName::Zip(OutputFileName::from_stem(FileStem::new("archive").unwrap()));
        let folder = OutputName::Folder(FileStem::new("photos").unwrap());

        assert_eq!(zip.as_str(), Some("archive.zip"));
        assert_eq!(folder.as_str(), Some("photos"));
        assert_eq!(OutputName::None.as_str(), None);
    }

    #[test]
    fn output_name_produces_output_is_false_only_for_none() {
        let zip = OutputName::Zip(OutputFileName::from_stem(FileStem::new("archive").unwrap()));
        let folder = OutputName::Folder(FileStem::new("photos").unwrap());

        assert!(zip.produces_output());
        assert!(folder.produces_output());
        assert!(!OutputName::None.produces_output());
    }

    #[test]
    fn fold_key_maps_nfc_and_nfd_spellings_to_the_same_key() {
        let nfc = OutputName::Folder(
            FileStem::new("\u{30AC}\u{30A4}\u{30C9}").expect("NFC spelling is a valid stem"),
        );
        let nfd = OutputName::Folder(
            FileStem::new("\u{30AB}\u{3099}\u{30A4}\u{30C8}\u{3099}")
                .expect("NFD spelling is a valid stem"),
        );

        assert_eq!(nfc.fold_key(), nfd.fold_key());
    }

    #[test]
    fn fold_key_maps_non_ascii_case_variants_to_the_same_key() {
        let uppercase = OutputName::Folder(FileStem::new("\u{00C9}tude").expect("name is valid"));
        let lowercase = OutputName::Folder(FileStem::new("\u{00E9}tude").expect("name is valid"));

        assert_eq!(uppercase.fold_key(), lowercase.fold_key());
    }

    #[test]
    fn fold_key_of_none_is_none() {
        assert_eq!(OutputName::None.fold_key(), None);
    }
}
