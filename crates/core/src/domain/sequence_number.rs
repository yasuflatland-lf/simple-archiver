//! The 1-based sequence number assigned to each output file.

use std::num::NonZeroU32;

/// A 1-based sequence number. Zero is rejected at construction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SequenceNumber(NonZeroU32);

/// Returned when a sequence number fails its invariant.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SequenceError {
    /// Sequence numbers are 1-based; zero is not allowed.
    #[error("sequence number must be 1 or greater")]
    Zero,
}

impl SequenceNumber {
    /// Create a sequence number from a raw value; `0` is rejected.
    pub fn new(value: u32) -> Result<Self, SequenceError> {
        NonZeroU32::new(value).map(Self).ok_or(SequenceError::Zero)
    }

    /// The underlying value (always >= 1).
    pub fn get(self) -> u32 {
        self.0.get()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_is_valid() {
        assert_eq!(SequenceNumber::new(1).unwrap().get(), 1);
    }

    #[test]
    fn zero_is_rejected() {
        assert_eq!(SequenceNumber::new(0), Err(SequenceError::Zero));
    }

    #[test]
    fn max_u32_is_valid() {
        assert_eq!(SequenceNumber::new(u32::MAX).unwrap().get(), u32::MAX);
    }
}
