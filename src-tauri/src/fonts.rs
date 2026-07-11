//! System font enumeration for the Text tool's font selector.

/// List unique installed font family names, sorted alphabetically. Runs on the
/// blocking pool so scanning the OS font directories never stalls the UI.
#[tauri::command]
pub async fn list_system_fonts() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names: Vec<String> = db
            .faces()
            .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
            .collect();
        names.sort();
        names.dedup();
        names
    })
    .await
    .unwrap_or_default()
}
