#[cfg(target_os = "android")]
mod android_fs;
mod export;
mod fonts;
mod map;
mod pack;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pack::LibraryState::default())
        .manage(export::ExportState::default())
        .register_asynchronous_uri_scheme_protocol("recolor", pack::recolor_protocol)
        .setup(|app| {
            // Extracted once per version of the pack; read from the bundled resource only then.
            if let Err(e) = pack::ensure_builtin_pack(app.handle()) {
                eprintln!("built-in pack: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pack::install_packs,
            pack::list_installed,
            pack::open_packs_dir,
            pack::uninstall_pack,
            pack::set_packs_enabled,
            pack::list_pack_contents,
            pack::load_asset,
            pack::load_pack_thumbnail,
            pack::search_library,
            pack::packs_with_category,
            pack::get_library_items,
            pack::release_library_search,
            pack::library_tags,
            pack::resolve_assets,
            pack::asset_thumbnails,
            fonts::list_system_fonts,
            storage::storage_usage,
            storage::clear_storage,
            fonts::cached_font,
            fonts::download_font,
            map::save_map,
            map::load_map,
            export::export_begin,
            export::export_rows,
            export::export_end,
            export::export_estimate,
            map::read_image_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
