//! Infrastructure layer — adapter implementations.
//! `ZipArchiver` (PR2) compresses folders via `async_zip`.
//! `UnrarExtractor` (rar support) is added in PR8.

pub mod zip_archiver;
