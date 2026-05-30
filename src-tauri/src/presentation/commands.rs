//! Tauri commands (presentation adapter).

use simple_archiver_core::application::compress_context::CompressContext;
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
        .compress(
            Path::new(&src),
            Path::new(&out),
            &CompressContext::detached(),
        )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_resolves_explicit_padded_placeholder() {
        assert_eq!(
            preview_output_name("img_{n:03}".to_string(), 1).unwrap(),
            "img_001.zip"
        );
    }

    #[test]
    fn preview_auto_appends_sequence_when_no_placeholder() {
        assert_eq!(
            preview_output_name("photo".to_string(), 3).unwrap(),
            "photo_3.zip"
        );
    }

    #[test]
    fn preview_rejects_zero_sequence() {
        let err = preview_output_name("{n}".to_string(), 0).unwrap_err();
        assert_eq!(err, "sequence number must be 1 or greater");
    }

    #[test]
    fn preview_rejects_malformed_template_with_exact_contract_message() {
        // This exact string is also asserted by the frontend test; keep them in sync.
        let err = preview_output_name("img_{x}".to_string(), 1).unwrap_err();
        assert_eq!(err, "invalid naming template: stray or malformed brace");
    }

    #[test]
    fn preview_rejects_width_out_of_range() {
        let err = preview_output_name("{n:010}".to_string(), 1).unwrap_err();
        assert!(
            err.contains("padding width must be between 1 and 9"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn preview_rejects_forbidden_literal_char() {
        let err = preview_output_name("a:b{n}".to_string(), 1).unwrap_err();
        assert!(
            err.contains("forbidden character"),
            "unexpected message: {err}"
        );
    }

    #[test]
    fn preview_rejects_name_invalid_only_after_resolution() {
        // A trailing space passes template parsing but fails FileStem at resolve.
        let err = preview_output_name("{n} ".to_string(), 1).unwrap_err();
        assert_eq!(err, "file name must not end with a dot or space");
    }
}
