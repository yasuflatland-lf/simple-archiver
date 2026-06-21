//! Infrastructure layer — adapter implementations.
//! `ZipArchiver` (PR2) compresses folders via `async_zip`.
//! `UnrarExtractor` (unrar) extracts rar into a `TempWorkspace`; `FormatRegistry`
//! (application) routes rar -> temp extraction -> zip.

// The zip adapter uses `tokio::fs`, which is unavailable under `--cfg loom`
// (tokio disables fs for loom model-checking). The IO adapter has no concurrency
// code to model-check, so the IO adapter is excluded from loom builds.
// Loom-tested concurrency code lives in application/loom_nucleus.rs (PR-5b).
#[cfg(not(loom))]
pub mod archive_extractor;
#[cfg(not(loom))]
pub mod fs_placer;
#[cfg(not(loom))]
mod path_utils;
pub mod system_clock;
#[cfg(not(loom))]
pub mod temp_workspace;
#[cfg(not(loom))]
pub mod unrar_extractor;
#[cfg(not(loom))]
pub mod zip_archiver;
#[cfg(not(loom))]
pub mod zip_extractor;
