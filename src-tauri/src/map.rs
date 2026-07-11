//! Map document persistence.
//!
//! The `.opdr` map file is a plain UTF-8 JSON document built entirely on the
//! JS side (see `src/features/map/io.ts`). The backend only handles the actual
//! filesystem read/write so we don't need the `fs` plugin/permission — the
//! path itself is chosen through the dialog plugin. Errors are surfaced to JS
//! as plain strings.
//!
//! On Android the SAF save/open dialog returns a `content://` URI (no real
//! filesystem path), resolved through `crate::android_fs` — same approach as
//! pack installation.

use std::fs;

#[cfg(target_os = "android")]
use std::io::{Read, Write};

/// Write `contents` to `path`, replacing any existing file.
#[tauri::command]
pub fn save_map(path: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(&path, "w")?;
        return file
            .write_all(contents.as_bytes())
            .map_err(|e| e.to_string());
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Read the map file at `path` and return its raw JSON text.
#[tauri::command]
pub fn load_map(path: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(&path, "r")?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| e.to_string())?;
        return Ok(contents);
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}
