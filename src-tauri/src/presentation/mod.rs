//! Presentation layer — Tauri コマンドとイベント配線（アダプタ）。
//! 実コマンド (add_items / run_job 等) は PR6 (issue #6) で追加する。

/// core crate がリンクされていることを示すスキャフォルドコマンド。
#[tauri::command]
pub fn core_layer() -> String {
    simple_archiver_core::domain::layer_name().to_string()
}
