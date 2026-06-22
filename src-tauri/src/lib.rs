pub mod presentation;

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// Build the application menu so the macOS menu bar shows only the app-name
/// menu ("simple-archiver") and none of Tauri's default File/Edit/View/Window/
/// Help entries. On macOS the first (and here only) submenu always renders as
/// the application menu, taking its title from the bundle name.
///
/// The Cut/Copy/Paste/Select All predefined items are nested inside this single
/// submenu on purpose: AppKit registers their `Cmd+X/C/V/A` key equivalents for
/// every item in the menu tree regardless of nesting, so the text inputs
/// (naming rule, start number) keep working without exposing a separate "Edit"
/// menu in the bar.
fn make_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        handle,
        "simple-archiver",
        true,
        &[
            &PredefinedMenuItem::about(handle, None, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;
    Menu::with_items(handle, &[&app_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(make_menu)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(presentation::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            presentation::commands::preview_output_name,
            presentation::commands::add_items,
            presentation::commands::reorder,
            presentation::commands::remove_item,
            presentation::commands::set_naming_rule,
            presentation::commands::set_start_number,
            presentation::commands::set_output_dir,
            presentation::commands::set_output_mode,
            presentation::commands::set_conflict_policy,
            presentation::commands::clear_items,
            presentation::commands::run_job,
            presentation::commands::cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
