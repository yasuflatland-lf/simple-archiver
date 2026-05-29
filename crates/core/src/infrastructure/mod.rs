//! Infrastructure layer — adapter implementations.
//! `ZipArchiver` (PR2) compresses folders via `async_zip`.
//! `UnrarExtractor` (rar support) is added in PR8.

// The zip adapter uses `tokio::fs`, which is unavailable under `--cfg loom`
// (tokio disables fs for loom model-checking). PR2 has no concurrency code to
// model-check, so the IO adapter is excluded from loom builds. PR5 will add
// loom-tested concurrency code separately.
#[cfg(not(loom))]
pub mod zip_archiver;
