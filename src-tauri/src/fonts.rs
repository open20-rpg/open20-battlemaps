//! Fonts for the Text tool: the installed system families, and Google Fonts
//! downloaded on demand into `<app data>/fonts/<Family>-<Style>.ttf` (a
//! cached file is never fetched again, so cached fonts work offline).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Only the google/fonts repository is ever fetched from.
const FONTS_ORIGIN: &str = "https://raw.githubusercontent.com/google/fonts/";

/// Largest font file accepted (the biggest variable families are ~20 MB).
const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;

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

/// A cache file name the frontend may ask for: `Name-Style.ttf`, nothing
/// that could leave the fonts folder.
fn valid_file_name(name: &str) -> bool {
    name.ends_with(".ttf")
        && name.len() <= 200
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The cached font `file_name` (in the fonts folder), if it's there.
fn cached(dir: &Path, file_name: &str) -> Result<Option<PathBuf>, String> {
    if !valid_file_name(file_name) {
        return Err(format!("invalid font file name: {file_name}"));
    }
    let path = dir.join(file_name);
    Ok(path.is_file().then_some(path))
}

/// The path of the cached font `file_name`, or None when it isn't downloaded.
#[tauri::command]
pub fn cached_font(app: AppHandle, file_name: String) -> Result<Option<String>, String> {
    let dir = fonts_dir(&app)?;
    Ok(cached(&dir, &file_name)?.map(|p| p.to_string_lossy().into_owned()))
}

/// Download the font at `url` into the cache as `file_name` (unless it's
/// already there) and return its path. Off the main thread.
#[tauri::command]
pub async fn download_font(
    app: AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let dir = fonts_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || fetch_into(&dir, &url, &file_name, http_get))
        .await
        .map_err(|e| e.to_string())?
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let mut body = ureq::get(url)
        .call()
        .map_err(|e| e.to_string())?
        .into_body();
    let mut bytes = Vec::new();
    body.as_reader()
        .take(MAX_FONT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FONT_BYTES {
        return Err("font file too large".into());
    }
    Ok(bytes)
}

/// The cache logic, with the download injected (tests run offline).
fn fetch_into(
    dir: &Path,
    url: &str,
    file_name: &str,
    get: impl Fn(&str) -> Result<Vec<u8>, String>,
) -> Result<String, String> {
    if let Some(path) = cached(dir, file_name)? {
        return Ok(path.to_string_lossy().into_owned());
    }
    if !url.starts_with(FONTS_ORIGIN) {
        return Err(format!("fonts are only downloaded from {FONTS_ORIGIN}"));
    }
    let bytes = get(url)?;
    // TrueType (0x00010000 / "true") or OpenType ("OTTO"): never cache an
    // error page under a font's name.
    let magic = bytes.get(..4).unwrap_or_default();
    if !matches!(magic, [0, 1, 0, 0] | b"true" | b"OTTO") {
        return Err("the download isn't a font file".into());
    }
    let path = dir.join(file_name);
    // Written aside and renamed, so a cut download never looks cached.
    let partial = dir.join(format!("{file_name}.part"));
    fs::write(&partial, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("otbm-fonts-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const URL: &str = "https://raw.githubusercontent.com/google/fonts/main/ofl/x/X.ttf";
    const TTF: [u8; 6] = [0, 1, 0, 0, 9, 9];

    #[test]
    fn file_names_stay_in_the_folder() {
        assert!(valid_file_name("LibreBaskerville-BoldItalic.ttf"));
        assert!(!valid_file_name("../evil.ttf"));
        assert!(!valid_file_name("a/b.ttf"));
        assert!(!valid_file_name("font.exe"));
        assert!(!valid_file_name(".ttf"));
    }

    #[test]
    fn downloads_once_then_uses_the_cache() {
        let dir = temp_dir("once");
        let calls = Cell::new(0);
        let get = |_: &str| {
            calls.set(calls.get() + 1);
            Ok(TTF.to_vec())
        };
        let a = fetch_into(&dir, URL, "X-Regular.ttf", get).unwrap();
        let b = fetch_into(&dir, URL, "X-Regular.ttf", get).unwrap();
        assert_eq!(a, b);
        assert_eq!(calls.get(), 1);
        assert_eq!(fs::read(&a).unwrap(), TTF);
        // Offline: what's cached still loads.
        let offline = |_: &str| Err("no network".to_string());
        assert!(fetch_into(&dir, URL, "X-Regular.ttf", offline).is_ok());
        assert!(fetch_into(&dir, URL, "X-Bold.ttf", offline).is_err());
    }

    #[test]
    fn refuses_other_hosts_and_non_fonts() {
        let dir = temp_dir("refuse");
        let ok = |_: &str| Ok(TTF.to_vec());
        assert!(fetch_into(&dir, "https://example.com/x.ttf", "X-Regular.ttf", ok).is_err());
        let html = |_: &str| Ok(b"<html>404</html>".to_vec());
        assert!(fetch_into(&dir, URL, "X-Regular.ttf", html).is_err());
        assert!(!dir.join("X-Regular.ttf").exists());
    }
}
