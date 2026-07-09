mod pack;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            pack::install_packs,
            pack::list_installed,
            pack::open_packs_dir,
            pack::uninstall_pack,
            pack::set_pack_enabled,
            pack::list_pack_contents,
            pack::load_asset,
            pack::load_pack_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
