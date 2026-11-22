//! Extensions on disk (`<app data>/extensions/`) and the few native services
//! the extension host needs: installed files, per-extension storage, the
//! network (for extensions granted a host) and a folder the user picked.
//!
//! The permission checks happen in the frontend host (only it calls these
//! commands; extension code runs sandboxed and can't reach `invoke`). These
//! commands still refuse anything outside their own directories, so a bug
//! up there can't turn into reading or writing arbitrary files.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Most bytes one extension's storage may hold.
pub const STORAGE_QUOTA: usize = 10 * 1024 * 1024;
/// Most bytes a fetch may return.
const FETCH_MAX: u64 = 20 * 1024 * 1024;
/// Limits for a development folder.
const DEV_MAX_FILES: usize = 500;
const DEV_MAX_BYTES: u64 = 100 * 1024 * 1024;

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Serialize, Deserialize)]
pub struct ExtFile {
    path: String,
    /// Base64 contents.
    data: String,
}

/// Extension ids: lowercase dot-separated segments (as the manifest requires).
pub(crate) fn valid_id(id: &str) -> bool {
    let segs: Vec<&str> = id.split('.').collect();
    id.len() <= 100
        && segs.len() >= 2
        && segs.iter().all(|s| {
            !s.is_empty()
                && !s.starts_with('-')
                && !s.ends_with('-')
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

/// A relative path that stays inside its base: no root, no `..`, no drive.
pub(crate) fn safe_rel(path: &str) -> Option<PathBuf> {
    if path.is_empty() {
        return Some(PathBuf::new());
    }
    if path.contains('\\') || path.contains('\0') || path.len() > 300 {
        return None;
    }
    let p = Path::new(path);
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions"))
}

fn ext_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("invalid extension id {id}"));
    }
    Ok(root(app)?.join("installed").join(id))
}

fn data_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("invalid extension id {id}"));
    }
    Ok(root(app)?.join("data").join(id))
}

#[tauri::command]
pub fn extensions_registry(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = root(&app)?.join("registry.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(_) => Ok(serde_json::Value::Array(vec![])),
    }
}

#[tauri::command]
pub fn extensions_save_registry(app: AppHandle, entries: serde_json::Value) -> Result<(), String> {
    if !entries.is_array() {
        return Err("the registry is a list".into());
    }
    let dir = root(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("registry.json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("registry.json")).map_err(|e| e.to_string())
}

/// Install (or replace) an extension's files: written to a fresh folder,
/// then swapped in, so a failed install leaves the old version intact.
#[tauri::command]
pub async fn extension_install(
    app: AppHandle,
    id: String,
    files: Vec<ExtFile>,
) -> Result<(), String> {
    let dest = ext_dir(&app, &id)?;
    let staging = dest.with_extension("installing");
    let _ = fs::remove_dir_all(&staging);
    for f in &files {
        let rel = safe_rel(&f.path).ok_or_else(|| format!("unsafe path {}", f.path))?;
        let bytes = B64.decode(&f.data).map_err(|e| e.to_string())?;
        let target = staging.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    let old = dest.with_extension("old");
    let _ = fs::remove_dir_all(&old);
    if dest.exists() {
        fs::rename(&dest, &old).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

#[tauri::command]
pub fn extension_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    let _ = fs::remove_dir_all(ext_dir(&app, &id)?);
    let _ = fs::remove_dir_all(data_dir(&app, &id)?);
    Ok(())
}

#[tauri::command]
pub fn extension_read_file(app: AppHandle, id: String, path: String) -> Result<String, String> {
    let rel = safe_rel(&path).ok_or("unsafe path")?;
    let bytes = fs::read(ext_dir(&app, &id)?.join(rel)).map_err(|e| e.to_string())?;
    Ok(B64.encode(bytes))
}

/// Every file of a development folder (bounded; skips VCS and dependencies).
#[tauri::command]
pub async fn extension_read_dir(path: String) -> Result<Vec<ExtFile>, String> {
    let base = PathBuf::from(&path);
    if !base.is_dir() {
        return Err("not a folder".into());
    }
    let mut out = Vec::new();
    let mut total = 0u64;
    let mut stack = vec![base.clone()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let p = entry.path();
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            if meta.is_dir() {
                stack.push(p);
                continue;
            }
            total += meta.len();
            if out.len() >= DEV_MAX_FILES || total > DEV_MAX_BYTES {
                return Err("the folder is too big for an extension".into());
            }
            let rel = p.strip_prefix(&base).map_err(|e| e.to_string())?;
            let rel = rel.to_string_lossy().replace('\\', "/");
            out.push(ExtFile {
                path: rel,
                data: B64.encode(fs::read(&p).map_err(|e| e.to_string())?),
            });
        }
    }
    Ok(out)
}

// -- storage -------------------------------------------------------------------

type Store = BTreeMap<String, serde_json::Value>;

fn read_store(app: &AppHandle, id: &str) -> Result<Store, String> {
    match fs::read_to_string(data_dir(app, id)?.join("storage.json")) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(Store::new()),
    }
}

/// The store as it would be saved, or an error if it doesn't fit the quota.
pub(crate) fn encode_store(store: &Store) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(store).map_err(|e| e.to_string())?;
    if bytes.len() > STORAGE_QUOTA {
        return Err("the extension's storage is full".into());
    }
    Ok(bytes)
}

fn write_store(app: &AppHandle, id: &str, store: &Store) -> Result<(), String> {
    let bytes = encode_store(store)?;
    let dir = data_dir(app, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("storage.json.tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("storage.json")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn extension_storage_get(
    app: AppHandle,
    id: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    Ok(read_store(&app, &id)?.remove(&key))
}

#[tauri::command]
pub fn extension_storage_set(
    app: AppHandle,
    id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let mut store = read_store(&app, &id)?;
    store.insert(key, value);
    write_store(&app, &id, &store)
}

#[tauri::command]
pub fn extension_storage_delete(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let mut store = read_store(&app, &id)?;
    if store.remove(&key).is_some() {
        write_store(&app, &id, &store)?;
    }
    Ok(())
}

#[tauri::command]
pub fn extension_storage_keys(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    Ok(read_store(&app, &id)?.into_keys().collect())
}

// -- network -------------------------------------------------------------------

#[derive(Serialize)]
pub struct FetchResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    /// Base64 body.
    body: String,
}

/// Only https, no credentials in the URL, no explicit port (as the host checks too).
pub(crate) fn fetchable(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.contains('@') && !authority.contains(':')
}

#[tauri::command]
pub async fn extension_fetch(
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
) -> Result<FetchResponse, String> {
    if !fetchable(&url) {
        return Err("only https URLs".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .into();
    let body = match body {
        Some(b) => Some(B64.decode(b).map_err(|e| e.to_string())?),
        None => None,
    };
    let mut res = match method.as_str() {
        "GET" | "DELETE" | "HEAD" => {
            let mut req = match method.as_str() {
                "GET" => agent.get(&url),
                "HEAD" => agent.head(&url),
                _ => agent.delete(&url),
            };
            for (k, v) in &headers {
                req = req.header(k, v);
            }
            req.call()
        }
        "POST" | "PUT" | "PATCH" => {
            let mut req = match method.as_str() {
                "POST" => agent.post(&url),
                "PUT" => agent.put(&url),
                _ => agent.patch(&url),
            };
            for (k, v) in &headers {
                req = req.header(k, v);
            }
            req.send(body.unwrap_or_default())
        }
        _ => return Err(format!("method {method} isn't allowed")),
    }
    .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.to_string())))
        .collect();
    let mut bytes = Vec::new();
    res.body_mut()
        .as_reader()
        .take(FETCH_MAX)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(FetchResponse {
        status,
        headers,
        body: B64.encode(bytes),
    })
}

// -- a folder the user picked ---------------------------------------------------

fn in_folder(root: &str, path: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(root);
    if !base.is_absolute() || !base.is_dir() {
        return Err("the folder isn't available".into());
    }
    let rel = safe_rel(path).ok_or("paths must stay inside the folder")?;
    Ok(base.join(rel))
}

#[derive(Serialize)]
pub struct FolderEntry {
    name: String,
    dir: bool,
    size: u64,
}

#[tauri::command]
pub fn extension_folder_list(root: String, path: String) -> Result<Vec<FolderEntry>, String> {
    let dir = in_folder(&root, &path)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        out.push(FolderEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            dir: meta.is_dir(),
            size: meta.len(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn extension_folder_read(root: String, path: String) -> Result<String, String> {
    let p = in_folder(&root, &path)?;
    if fs::symlink_metadata(&p)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("links aren't followed".into());
    }
    Ok(B64.encode(fs::read(p).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn extension_folder_write(root: String, path: String, data: String) -> Result<(), String> {
    let p = in_folder(&root, &path)?;
    if path.is_empty() {
        return Err("a file name is needed".into());
    }
    if let Ok(meta) = fs::symlink_metadata(&p) {
        if meta.file_type().is_symlink() {
            return Err("links aren't followed".into());
        }
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, B64.decode(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Write bytes an extension handed over (images to import into a pack) to
/// its temporary folder, returning the file's path for the importer.
#[tauri::command]
pub fn extension_temp_write(
    app: AppHandle,
    id: String,
    name: String,
    data: String,
) -> Result<String, String> {
    let rel = safe_rel(&name).ok_or("unsafe name")?;
    if rel.components().count() != 1 {
        return Err("a plain file name".into());
    }
    let dir = root(&app)?.join("tmp").join(&id);
    if !valid_id(&id) {
        return Err("invalid extension id".into());
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(rel);
    fs::write(&path, B64.decode(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Remove the extensions' temporary files (at start: they're only needed during an import).
pub fn clear_temp(app: &AppHandle) {
    if let Ok(dir) = root(app) {
        let _ = fs::remove_dir_all(dir.join("tmp"));
    }
}

/// Open an https link an extension asked for, after the user confirmed it.
#[tauri::command]
pub fn extension_open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !fetchable(&url) {
        return Err("only https links".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_ids() {
        assert!(valid_id("open20.ejemplo"));
        assert!(valid_id("a.b-c.d2"));
        assert!(!valid_id("solo"));
        assert!(!valid_id("Open20.x"));
        assert!(!valid_id("a..b"));
        assert!(!valid_id("a.-b"));
        assert!(!valid_id("../x.y"));
    }

    #[test]
    fn keeps_paths_inside() {
        assert_eq!(safe_rel("a/b.js"), Some(PathBuf::from("a/b.js")));
        assert_eq!(safe_rel("./a"), Some(PathBuf::from("a")));
        assert_eq!(safe_rel("../a"), None);
        assert_eq!(safe_rel("a/../../b"), None);
        assert_eq!(safe_rel("/etc/passwd"), None);
        assert_eq!(safe_rel("a\\b"), None);
    }

    #[test]
    fn bounds_storage() {
        let mut store = Store::new();
        store.insert("a".into(), serde_json::json!(1));
        assert!(encode_store(&store).is_ok());
        store.insert("big".into(), serde_json::json!("x".repeat(STORAGE_QUOTA)));
        assert!(encode_store(&store).is_err());
    }

    #[test]
    fn fetches_only_plain_https() {
        assert!(fetchable("https://api.example.com/a?b=1"));
        assert!(!fetchable("http://api.example.com/"));
        assert!(!fetchable("https://user@api.example.com/"));
        assert!(!fetchable("https://api.example.com:8080/"));
        assert!(!fetchable("file:///etc/passwd"));
    }
}
