//! Map document persistence.
//!
//! The `.opdr` map file is a plain UTF-8 JSON document built entirely on the
//! JS side (see `src/features/map/io.ts`). The backend only handles the actual
//! filesystem read/write so we don't need the `fs` plugin/permission — the
//! path itself is chosen through the dialog plugin. Errors are surfaced to JS
//! as plain strings.

use std::fs;

/// Write `contents` to `path`, replacing any existing file.
#[tauri::command]
pub fn save_map(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read the map file at `path` and return its raw JSON text.
#[tauri::command]
pub fn load_map(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
