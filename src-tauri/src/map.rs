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

/// Write `bytes` to `path`, replacing any existing file.
fn write_bytes(path: &str, bytes: &[u8]) -> Result<(), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(path, "w")?;
        return file.write_all(bytes).map_err(|e| e.to_string());
    }
    fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Header carrying the destination path of a raw-bytes save (percent-encoded,
/// since header values must be ASCII).
const PATH_HEADER: &str = "x-path";

/// Read the percent-encoded destination path from a raw save request's header.
fn path_from_header(value: Option<&str>) -> Result<String, String> {
    let encoded = value.ok_or("missing destination path")?;
    urlencoding::decode(encoded)
        .map(|p| p.into_owned())
        .map_err(|e| e.to_string())
}

/// Write binary data sent as the raw request body (no JSON/base64 detour, so
/// a large PNG export doesn't have to be encoded and parsed as text). The
/// destination path comes in the `x-path` header.
#[tauri::command]
pub fn save_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let header = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|v| v.to_str().ok());
    write_bytes(&path_from_header(header)?, bytes)
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
pub fn read_image_file(path: String) -> Result<ImageData, String> {
    use base64::Engine;
    #[cfg(target_os = "android")]
    let bytes = if path.starts_with("content://") {
        let mut file = crate::android_fs::open_content_uri(&path, "r")?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        buf
    } else {
        fs::read(&path).map_err(|e| e.to_string())?
    };
    #[cfg(not(target_os = "android"))]
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(ImageData {
        data_url: format!("data:{};base64,{data}", image_mime(&path)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_the_destination_path_header() {
        assert_eq!(
            path_from_header(Some("%2Ftmp%2Fmi%20mapa.png")).unwrap(),
            "/tmp/mi mapa.png"
        );
        assert!(path_from_header(None).is_err());
    }

    #[test]
    fn picks_image_mime_by_extension() {
        assert_eq!(image_mime("a/b.JPG"), "image/jpeg");
        assert_eq!(image_mime("x.webp"), "image/webp");
        assert_eq!(image_mime("x.png"), "image/png");
    }

    #[test]
    fn write_bytes_and_read_image_roundtrip() {
        let dir = std::env::temp_dir().join(format!("battle-maps-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("img.png");
        let p = path.to_string_lossy().into_owned();
        write_bytes(&p, b"hi").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hi");
        let img = read_image_file(p).unwrap();
        assert_eq!(img.data_url, "data:image/png;base64,aGk=");
        fs::remove_dir_all(&dir).unwrap();
    }
}
