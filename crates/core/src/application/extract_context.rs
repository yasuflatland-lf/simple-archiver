//! Per-extraction cancellation context handed to the `Extractor`.

use tokio_util::sync::CancellationToken;

/// Context passed to `Extractor::extract`, carrying a read-only view of the
/// job's cancellation signal so a long per-archive extraction can abort
/// promptly between entries instead of running the current file to completion.
///
/// Mirrors [`crate::application::compress_context::CompressContext`]'s
/// cancellation design: an extractor may only OBSERVE cancellation via
/// [`ExtractContext::is_cancelled`]. Exposing the token itself would let an
/// adapter call `.cancel()` and tear down the whole job, so only this read-only
/// predicate is exposed.
///
/// `Clone` so the synchronous `unrar` adapter can move an observer into its
/// `spawn_blocking` closure and poll it between entries.
#[derive(Clone)]
pub struct ExtractContext {
    cancellation_token: CancellationToken,
}

impl ExtractContext {
    /// Build a context observing `cancellation_token`.
    pub(crate) fn new(cancellation_token: CancellationToken) -> Self {
        Self { cancellation_token }
    }

    /// Build a context not tied to any job; the token is freshly created and
    /// never cancelled, so `is_cancelled()` is always `false`. Used by callers
    /// (and tests) that extract outside a cancellable run.
    pub fn detached() -> Self {
        Self::new(CancellationToken::new())
    }

    /// Observe whether the owning job has been cancelled. Extractors may only
    /// OBSERVE cancellation — exposing the token itself would let an adapter
    /// call `.cancel()` and tear down the whole job, so only this read-only
    /// predicate is exposed.
    pub fn is_cancelled(&self) -> bool {
        self.cancellation_token.is_cancelled()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detached_is_never_cancelled() {
        let ctx = ExtractContext::detached();
        assert!(!ctx.is_cancelled());
    }

    #[test]
    fn is_cancelled_observes_the_shared_token() {
        let token = CancellationToken::new();
        let ctx = ExtractContext::new(token.clone());

        assert!(!ctx.is_cancelled());
        token.cancel();
        assert!(ctx.is_cancelled());
    }

    #[test]
    fn a_clone_observes_the_same_cancellation() {
        // The `unrar` adapter clones the context into its blocking closure, so a
        // clone MUST see a cancel fired through the original token.
        let token = CancellationToken::new();
        let ctx = ExtractContext::new(token.clone());
        let moved = ctx.clone();

        assert!(!moved.is_cancelled());
        token.cancel();
        assert!(moved.is_cancelled());
    }
}
