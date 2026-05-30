//! Real wall-clock adapter for the `Clock` port.

use crate::application::ports::Clock;
use std::time::Instant;

/// A `Clock` backed by `std::time::Instant::now`.
#[derive(Debug, Default)]
pub struct SystemClock;

impl SystemClock {
    /// Create a new system clock.
    pub fn new() -> Self {
        Self
    }
}

impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_is_monotonic_non_decreasing() {
        let clock = SystemClock::new();
        let a = clock.now();
        let b = clock.now();
        assert!(b >= a);
    }
}
