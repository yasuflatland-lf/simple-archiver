//! Naming rule parsing and resolution (pure domain).
//!
//! Templates are tokenized with `logos`, assembled into an ordered list of
//! `Segment`s by the `LALRPOP` grammar in `template.lalrpop`, validated and
//! normalized by `NamingRule::parse`, and rendered against a `SequenceNumber`
//! into a validated `OutputFileName` by `NamingRule::resolve`.

use crate::domain::file_name::{is_forbidden_filename_char, FileStem, NameError, OutputFileName};
use crate::domain::sequence_number::SequenceNumber;

mod template_parse;

// Re-export the lexer/parser symbols so existing intra-crate paths stay valid.
// The LALRPOP-generated parser (built from `template.lalrpop`) imports
// `crate::domain::naming_rule::{LexError, Segment, Token}`, so these three must
// remain reachable directly under this module.
pub(crate) use template_parse::{parse_segments, LexError, Segment, Token};

/// The maximum zero-padding width accepted in `{n:0W}`.
const MAX_PAD_WIDTH: u32 = 9;

/// A validated naming template, stored as normalized segments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NamingRule {
    segments: Vec<Segment>,
}

/// Reasons a template is invalid.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum NamingRuleError {
    /// The template is empty or only whitespace.
    #[error("naming template must not be empty")]
    Empty,
    /// The template could not be tokenized/parsed (stray or malformed brace).
    #[error("invalid naming template: {reason}")]
    InvalidTemplate { reason: String },
    /// A `{n:0W}` width is outside the supported 1..=9 range.
    #[error("padding width must be between 1 and 9, got {width}")]
    WidthOutOfRange { width: u32 },
    /// A literal part of the template contains a forbidden filename character.
    #[error("template contains a forbidden character: {ch:?}")]
    ForbiddenLiteralChar { ch: char },
}

impl NamingRule {
    /// Parse and validate a template into a normalized `NamingRule`.
    pub fn parse(template: &str) -> Result<Self, NamingRuleError> {
        if template.trim().is_empty() {
            return Err(NamingRuleError::Empty);
        }

        let mut segments =
            parse_segments(template).map_err(|()| NamingRuleError::InvalidTemplate {
                reason: "stray or malformed brace".to_string(),
            })?;

        let mut has_placeholder = false;
        for segment in &segments {
            match segment {
                Segment::Literal(text) => {
                    if let Some(ch) = text.chars().find(|&c| is_forbidden_filename_char(c)) {
                        return Err(NamingRuleError::ForbiddenLiteralChar { ch });
                    }
                }
                Segment::Placeholder { pad_width } => {
                    has_placeholder = true;
                    if let Some(width) = pad_width {
                        if !(1..=MAX_PAD_WIDTH).contains(width) {
                            return Err(NamingRuleError::WidthOutOfRange { width: *width });
                        }
                    }
                }
            }
        }

        // No placeholder anywhere -> append "_{n}" so every output is numbered.
        if !has_placeholder {
            segments.push(Segment::Literal("_".to_string()));
            segments.push(Segment::Placeholder { pad_width: None });
        }

        Ok(Self { segments })
    }

    /// Resolve this rule against `seq` into a validated output filename.
    pub fn resolve(&self, seq: SequenceNumber) -> Result<OutputFileName, NameError> {
        let number = seq.get();
        let mut stem = String::new();
        for segment in &self.segments {
            match segment {
                Segment::Literal(text) => stem.push_str(text),
                Segment::Placeholder { pad_width: None } => {
                    stem.push_str(&number.to_string());
                }
                Segment::Placeholder {
                    pad_width: Some(width),
                } => {
                    let width = *width as usize;
                    stem.push_str(&format!("{number:0width$}"));
                }
            }
        }
        Ok(OutputFileName::from_stem(FileStem::new(&stem)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(template: &str, seq: u32) -> Result<String, NameError> {
        NamingRule::parse(template)
            .unwrap()
            .resolve(SequenceNumber::new(seq).unwrap())
            .map(|name| name.as_str().to_string())
    }

    #[test]
    fn resolve_plain_placeholder() {
        assert_eq!(resolve("photo{n}", 2).unwrap(), "photo2.zip");
    }

    #[test]
    fn resolve_zero_pads_to_width() {
        assert_eq!(resolve("{n:03}", 1).unwrap(), "001.zip");
        assert_eq!(resolve("{n:01}", 7).unwrap(), "7.zip");
    }

    #[test]
    fn resolve_does_not_truncate_when_number_exceeds_width() {
        assert_eq!(resolve("{n:03}", 1000).unwrap(), "1000.zip");
    }

    #[test]
    fn resolve_appended_placeholder_is_unpadded() {
        assert_eq!(resolve("photo", 3).unwrap(), "photo_3.zip");
    }

    #[test]
    fn resolve_repeats_the_same_number_for_multiple_placeholders() {
        assert_eq!(resolve("{n}-{n}", 2).unwrap(), "2-2.zip");
    }

    #[test]
    fn resolve_rejects_a_resolved_trailing_space() {
        // The literal trailing space survives resolution and fails FileStem.
        let err = NamingRule::parse("{n} ")
            .unwrap()
            .resolve(SequenceNumber::new(1).unwrap())
            .unwrap_err();
        assert_eq!(err, NameError::TrailingDotOrSpace);
    }

    #[test]
    fn parse_keeps_an_explicit_placeholder() {
        let rule = NamingRule::parse("img_{n:03}").unwrap();
        assert_eq!(
            rule.segments,
            vec![
                Segment::Literal("img_".to_string()),
                Segment::Placeholder { pad_width: Some(3) },
            ]
        );
    }

    #[test]
    fn parse_appends_underscore_n_when_no_placeholder() {
        let rule = NamingRule::parse("photo").unwrap();
        assert_eq!(
            rule.segments,
            vec![
                Segment::Literal("photo".to_string()),
                Segment::Literal("_".to_string()),
                Segment::Placeholder { pad_width: None },
            ]
        );
    }

    #[test]
    fn parse_rejects_empty_and_whitespace_only() {
        assert_eq!(NamingRule::parse(""), Err(NamingRuleError::Empty));
        assert_eq!(NamingRule::parse("   "), Err(NamingRuleError::Empty));
    }

    #[test]
    fn parse_rejects_width_out_of_range() {
        assert_eq!(
            NamingRule::parse("{n:00}"),
            Err(NamingRuleError::WidthOutOfRange { width: 0 })
        );
        assert_eq!(
            NamingRule::parse("{n:010}"),
            Err(NamingRuleError::WidthOutOfRange { width: 10 })
        );
    }

    #[test]
    fn parse_rejects_forbidden_literal_char() {
        assert_eq!(
            NamingRule::parse("a:b{n}"),
            Err(NamingRuleError::ForbiddenLiteralChar { ch: ':' })
        );
    }

    #[test]
    fn parse_rejects_malformed_template() {
        assert!(matches!(
            NamingRule::parse("img_{x}"),
            Err(NamingRuleError::InvalidTemplate { .. })
        ));
    }

    #[test]
    fn parse_reports_width_out_of_range_for_overflowing_width() {
        let template = format!("{{n:0{}}}", "9".repeat(20));
        assert_eq!(
            NamingRule::parse(&template),
            Err(NamingRuleError::WidthOutOfRange { width: u32::MAX })
        );
    }

    #[test]
    fn resolve_accepts_max_valid_width_nine() {
        assert_eq!(resolve("{n:09}", 1).unwrap(), "000000001.zip");
    }

    #[test]
    fn resolve_preserves_unicode_literals() {
        assert_eq!(resolve("写真{n}", 1).unwrap(), "写真1.zip");
    }

    #[test]
    fn resolve_adjacent_placeholders_have_no_separator() {
        assert_eq!(resolve("{n}{n}", 2).unwrap(), "22.zip");
    }
}
