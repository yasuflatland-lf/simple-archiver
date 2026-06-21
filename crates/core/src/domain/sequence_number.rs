//! The sequence number assigned to each output file.
//!
//! A sequence number renders the `{n}` / `{n:0W}` placeholder in a naming
//! template. Any `u32` is valid, including `0`, so a batch can number its files
//! from an arbitrary starting point (see `ArchiveJob::plan_with_start`).

/// A sequence number used to render a naming template. Any `u32` value is valid,
/// including `0`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SequenceNumber(u32);

impl SequenceNumber {
    /// Create a sequence number from a raw value. Every `u32` is valid.
    pub fn new(value: u32) -> Self {
        Self(value)
    }

    /// The underlying value.
    pub fn get(self) -> u32 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_is_valid() {
        // Zero is allowed so templates can start numbering from 0 (e.g. "00").
        assert_eq!(SequenceNumber::new(0).get(), 0);
    }

    #[test]
    fn one_is_valid() {
        assert_eq!(SequenceNumber::new(1).get(), 1);
    }

    #[test]
    fn max_u32_is_valid() {
        assert_eq!(SequenceNumber::new(u32::MAX).get(), u32::MAX);
    }
}
