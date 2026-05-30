//! Application layer — use-case orchestration and port definitions.
//! RunArchiveJob (the parallel/cancellation use case) is added in PR5 (issue #5).

pub mod compress_context;
#[cfg(not(loom))]
pub mod format_registry;
#[cfg(loom)]
pub(crate) mod loom_nucleus;
pub mod ports;
pub mod progress;
pub mod progress_aggregator;
#[cfg(not(loom))]
pub mod eta_estimator;
#[cfg(not(loom))]
pub mod run_archive_job;
