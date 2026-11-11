//! Map document persistence.
//!
//! The `.otbm` map file is a plain UTF-8 JSON document built entirely on the
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

/// Write `contents` to `path`, replacing any existing file (off the main thread).
#[tauri::command]
pub async fn save_map(path: String, contents: String) -> Result<(), String> {
    blocking(move || write_text(&path, &contents)).await
}

fn write_text(path: &str, contents: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(path, "w")?;
        return file
            .write_all(contents.as_bytes())
            .map_err(|e| e.to_string());
    }
    fs::write(path, contents).map_err(|e| e.to_string())
}

/// Read the map file at `path` and return its raw JSON text (off the main thread).
#[tauri::command]
pub async fn load_map(path: String) -> Result<String, String> {
    blocking(move || read_text(&path)).await
}

fn read_text(path: &str) -> Result<String, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(path, "r")?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)
            .map_err(|e| e.to_string())?;
        return Ok(contents);
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Run `f` on a blocking worker thread: file IO never stalls the UI.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// An image file read from disk, as a ready-to-use `data:` URL.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub data_url: String,
}

fn image_mime(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/png"
    }
}

/// Read an image the user picked (Reference Image tool). It can live anywhere
/// on disk, outside the asset-protocol scope, so it travels as a data URL.
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<ImageData, String> {
    blocking(move || read_image(&path)).await
}

fn read_image(path: &str) -> Result<ImageData, String> {
    use base64::Engine;
    #[cfg(target_os = "android")]
    let bytes = if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(path, "r")?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        buf
    } else {
        fs::read(path).map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "android"))]
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ImageData {
        data_url: format!("data:{};base64,{data}", image_mime(path)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_image_mime_by_extension() {
        assert_eq!(image_mime("a/b.JPG"), "image/jpeg");
        assert_eq!(image_mime("x.webp"), "image/webp");
        assert_eq!(image_mime("x.png"), "image/png");
    }

    #[test]
    fn write_and_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("battle-maps-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("img.png");
        let p = path.to_string_lossy().into_owned();
        write_text(&p, "hi").unwrap();
        assert_eq!(read_text(&p).unwrap(), "hi");
        let img = read_image(&p).unwrap();
        assert_eq!(img.data_url, "data:image/png;base64,aGk=");
        fs::remove_dir_all(&dir).unwrap();
    }
}
