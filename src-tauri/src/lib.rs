pub mod presentation;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(presentation::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            presentation::commands::compress_folder,
            presentation::commands::preview_output_name,
            presentation::commands::add_items,
            presentation::commands::reorder,
            presentation::commands::set_naming_rule,
            presentation::commands::set_output_dir,
            presentation::commands::clear_items,
            presentation::commands::run_job,
            presentation::commands::cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
