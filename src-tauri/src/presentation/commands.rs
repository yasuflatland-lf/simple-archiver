//! Tauri commands (presentation adapter).

use simple_archiver_core::application::ports::Archiver;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::path::PathBuf;

/// Compress the folder at `src` into a zip file at `out`.
///
/// Errors are surfaced to the frontend as a string so they cross the IPC
/// boundary (the promise rejects with this message).
#[tauri::command]
pub async fn compress_folder(src: String, out: String) -> Result<(), String> {
    ZipArchiver::new()
        .compress(&PathBuf::from(src), &PathBuf::from(out))
        .await
        .map_err(|e| e.to_string())
}
