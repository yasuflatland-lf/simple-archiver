//! Presentation layer — Tauri commands and event wiring (adapter).
//! Real commands (add_items / run_job, etc.) will be added in PR6 (issue #6).

/// Scaffold command to verify that the core crate is linked.
#[tauri::command]
pub fn core_layer() -> String {
    simple_archiver_core::domain::layer_name().to_string()
}
