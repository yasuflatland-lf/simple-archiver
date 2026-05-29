//! Naming rule parsing and resolution (pure domain).
//!
//! Templates are tokenized with `logos` and assembled into an ordered list of
//! `Segment`s by the `LALRPOP` grammar in `template.lalrpop`. Semantic
//! validation and resolution are added in later tasks.

use logos::Logos;

lalrpop_util::lalrpop_mod!(
    #[allow(clippy::all)]
    pub template,
    "/domain/template.rs"
);

/// A token produced by the template lexer.
#[derive(Logos, Clone, Debug, PartialEq)]
pub enum Token {
    /// `{n}` — the sequence number, no padding.
    #[token("{n}")]
    Plain,
    /// `{n:0W}` — zero-padded to width W (the raw width is validated later).
    #[regex(r"\{n:0[0-9]+\}", width_of)]
    Padded(u32),
    /// A run of literal characters (anything that is not a brace).
    #[regex(r"[^{}]+", |lex| lex.slice().to_owned())]
    Literal(String),
}

/// Extract the width digits from a `{n:0W}` slice, e.g. `"{n:03}"` -> `3`.
fn width_of(lex: &mut logos::Lexer<Token>) -> Option<u32> {
    // `slice` is the matched run, e.g. "{n:03}".
    let slice = lex.slice();
    // Strip the leading "{n:0" (4 bytes, all ASCII) and the trailing "}" (1 byte).
    let digits = &slice[4..slice.len() - 1];
    digits.parse::<u32>().ok()
}

/// Lexing failed: the template contains a stray or malformed brace.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LexError;

/// Adapts the `logos` spanned iterator into the `(start, token, end)` triples
/// that the LALRPOP-generated parser consumes.
pub struct Lexer<'input> {
    inner: logos::SpannedIter<'input, Token>,
}

impl<'input> Lexer<'input> {
    pub fn new(input: &'input str) -> Self {
        Self {
            inner: Token::lexer(input).spanned(),
        }
    }
}

impl Iterator for Lexer<'_> {
    type Item = Result<(usize, Token, usize), LexError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.inner.next().map(|(token, span)| match token {
            Ok(token) => Ok((span.start, token, span.end)),
            Err(()) => Err(LexError),
        })
    }
}

/// One piece of a parsed template.
#[derive(Clone, Debug, PartialEq)]
pub enum Segment {
    /// Literal text copied verbatim into the output.
    Literal(String),
    /// The sequence number. `None` = plain `{n}`; `Some(w)` = zero-padded to `w`.
    Placeholder { pad_width: Option<u32> },
}

/// Tokenize and parse a template into ordered segments (structure only — no
/// width-range, emptiness, or character validation; that happens in `parse`).
// Currently only exercised by tests; later tasks consume it from `parse`.
#[allow(dead_code)]
pub(crate) fn parse_segments(template: &str) -> Result<Vec<Segment>, ()> {
    template::TemplateParser::new()
        .parse(Lexer::new(template))
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_literal_plain_and_padded_in_order() {
        let segments = parse_segments("img_{n}_{n:03}").unwrap();
        assert_eq!(
            segments,
            vec![
                Segment::Literal("img_".to_string()),
                Segment::Placeholder { pad_width: None },
                Segment::Literal("_".to_string()),
                Segment::Placeholder { pad_width: Some(3) },
            ]
        );
    }

    #[test]
    fn stray_brace_is_a_parse_error() {
        assert!(parse_segments("img_{x}").is_err());
        assert!(parse_segments("img_{n").is_err());
        assert!(parse_segments("img_{n:3}").is_err()); // missing leading 0
    }
}
