//! Byte progress counters for a single archive task.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct TaskProgress {
    bytes_done: u64,
    bytes_total: u64,
}

impl TaskProgress {
    /// Create a task progress from explicit byte counters.
    pub fn new(bytes_done: u64, bytes_total: u64) -> Self {
        Self {
            bytes_done,
            bytes_total,
        }
    }

    /// Create a task progress at zero bytes.
    pub fn zero() -> Self {
        Self::default()
    }

    /// Return bytes processed so far.
    pub fn bytes_done(&self) -> u64 {
        self.bytes_done
    }

    /// Return total bytes in the task.
    pub fn bytes_total(&self) -> u64 {
        self.bytes_total
    }

    /// Bytes still to process (`bytes_total - bytes_done`, saturating at 0).
    pub fn remaining(&self) -> u64 {
        self.bytes_total.saturating_sub(self.bytes_done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_has_zero_bytes_done() {
        let progress = TaskProgress::zero();
        assert_eq!(progress.bytes_done(), 0);
    }

    #[test]
    fn zero_has_zero_bytes_total() {
        let progress = TaskProgress::zero();
        assert_eq!(progress.bytes_total(), 0);
    }

    #[test]
    fn default_equals_zero() {
        let default_progress = TaskProgress::default();
        let zero_progress = TaskProgress::zero();
        assert_eq!(default_progress, zero_progress);
    }

    #[test]
    fn copy_produces_equal_value() {
        let original = TaskProgress::zero();
        let copied = original;
        assert_eq!(original, copied);
    }

    #[test]
    fn clone_produces_equal_value() {
        let original = TaskProgress::zero();
        // Clone via trait method (Copy also implements Clone semantics)
        #[allow(clippy::clone_on_copy)]
        let cloned = original.clone();
        assert_eq!(original, cloned);
    }

    #[test]
    fn new_sets_both_counters() {
        let p = TaskProgress::new(3, 10);
        assert_eq!(p.bytes_done(), 3);
        assert_eq!(p.bytes_total(), 10);
    }

    #[test]
    fn remaining_is_total_minus_done_saturating() {
        assert_eq!(TaskProgress::new(3, 10).remaining(), 7);
        assert_eq!(TaskProgress::new(10, 10).remaining(), 0);
        // Done exceeding total never underflows.
        assert_eq!(TaskProgress::new(12, 10).remaining(), 0);
    }
}
