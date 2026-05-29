//! Tauri commands (presentation adapter).

use simple_archiver_core::application::ports::Archiver;
use simple_archiver_core::domain::naming_rule::NamingRule;
use simple_archiver_core::domain::sequence_number::SequenceNumber;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::path::Path;

/// Compress the folder at `src` into a zip file at `out`.
///
/// Errors are surfaced to the frontend as a string so they cross the IPC
/// boundary (the promise rejects with this message).
#[tauri::command]
pub async fn compress_folder(src: String, out: String) -> Result<(), String> {
    ZipArchiver::new()
        .compress(Path::new(&src), Path::new(&out))
        .await
        .map_err(|e| e.to_string())
}

/// Resolve `template` against `seq` and return the output filename.
///
/// Domain errors are surfaced to the frontend as a string so they cross the IPC
/// boundary (the promise rejects with this message).
#[tauri::command]
pub fn preview_output_name(template: String, seq: u32) -> Result<String, String> {
    let seq = SequenceNumber::new(seq).map_err(|e| e.to_string())?;
    let rule = NamingRule::parse(&template).map_err(|e| e.to_string())?;
    let name = rule.resolve(seq).map_err(|e| e.to_string())?;
    Ok(name.as_str().to_string())
}
