//! Per-extraction cancellation context handed to the `Extractor`.

use tokio_util::sync::CancellationToken;

/// Context passed to `Extractor::extract`, carrying a read-only view of the
/// job's cancellation signal so a long per-archive extraction can abort
/// promptly (between entries, and mid-entry for the zip adapter's chunked read)
/// instead of running the current file to completion.
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
    observer: CancellationObserver,
}

/// The cancellation signal an [`ExtractContext`] observes. Production and
/// detached contexts watch a real [`CancellationToken`]; tests can additionally
/// fire cancellation at a precise, deterministic point in a work loop.
#[derive(Clone)]
enum CancellationObserver {
    /// Observe a real cancellation token (production and detached contexts).
    Token(CancellationToken),
    /// Test-only deterministic observer: reports "not cancelled" for the first
    /// `fire_after` polls, then "cancelled" for every poll thereafter. This lets
    /// a test fire cancellation at an exact point in a loop (e.g. after the
    /// first read chunk, or between specific entries) WITHOUT any wall-clock
    /// timing, so the resulting test is deterministic and cross-platform.
    #[cfg(test)]
    AfterPolls {
        polls: std::sync::Arc<std::sync::atomic::AtomicUsize>,
        fire_after: usize,
    },
}

impl ExtractContext {
    /// Build a context observing `cancellation_token`.
    pub(crate) fn new(cancellation_token: CancellationToken) -> Self {
        Self {
            observer: CancellationObserver::Token(cancellation_token),
        }
    }

    /// Build a context not tied to any job; the token is freshly created and
    /// never cancelled, so `is_cancelled()` is always `false`.
    ///
    /// This is a convenience for extracting outside a cancellable run. No
    /// production job path currently constructs one (the engine always threads a
    /// live token via [`ExtractContext::new`]); it is used by tests and is kept
    /// available for any future non-cancellable caller.
    pub fn detached() -> Self {
        Self::new(CancellationToken::new())
    }

    /// Build a test-only context that observes "not cancelled" for the first
    /// `fire_after` polls of [`is_cancelled`](Self::is_cancelled), then
    /// "cancelled" for every poll after that. Used to fire cancellation
    /// deterministically at a known point in an extractor work loop.
    #[cfg(test)]
    pub(crate) fn cancel_after_polls(fire_after: usize) -> Self {
        Self {
            observer: CancellationObserver::AfterPolls {
                polls: std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0)),
                fire_after,
            },
        }
    }

    /// Observe whether the owning job has been cancelled. Extractors may only
    /// OBSERVE cancellation — exposing the token itself would let an adapter
    /// call `.cancel()` and tear down the whole job, so only this read-only
    /// predicate is exposed.
    pub fn is_cancelled(&self) -> bool {
        match &self.observer {
            CancellationObserver::Token(token) => token.is_cancelled(),
            #[cfg(test)]
            CancellationObserver::AfterPolls { polls, fire_after } => {
                // `fetch_add` returns the count BEFORE this poll, so poll #0..
                // (the first `fire_after` polls) report `false` and every poll
                // from the `fire_after`-th onward reports `true`.
                let seen = polls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                seen >= *fire_after
            }
        }
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

    #[test]
    fn cancel_after_polls_fires_on_the_nth_poll() {
        // The deterministic test seam reports `false` for the first `fire_after`
        // polls, then `true` forever after — letting a work-loop test fire a
        // cancel at an exact iteration with no timing.
        let ctx = ExtractContext::cancel_after_polls(2);
        assert!(!ctx.is_cancelled(), "poll #0 must be false");
        assert!(!ctx.is_cancelled(), "poll #1 must be false");
        assert!(ctx.is_cancelled(), "poll #2 must fire");
        assert!(ctx.is_cancelled(), "poll #3 stays cancelled");
    }

    #[test]
    fn cancel_after_polls_shares_the_count_across_clones() {
        // Clones must share the poll counter (the `unrar` adapter polls a clone),
        // so a cancel point is observed regardless of which clone polls.
        let ctx = ExtractContext::cancel_after_polls(1);
        let moved = ctx.clone();
        assert!(!ctx.is_cancelled(), "first poll (via original) is false");
        assert!(moved.is_cancelled(), "second poll (via clone) fires");
    }
}
