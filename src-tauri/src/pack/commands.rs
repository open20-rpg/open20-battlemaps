//! Thin `#[tauri::command]` handlers exposed to the frontend. Heavy lifting
//! lives in the sibling modules; blocking work runs on the blocking pool.

use std::fs;
use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::install::install_one;
use super::library::{self, clear_library, LibItem, LibrarySearch, ResolvedAsset, SearchFilter};
use super::registry::{
    build_installed, pack_dir, packs_root, read_registry, write_registry, InstalledPack, PackReg,
};
use super::{mime_for, PackError, Result};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    /// Path relative to the pack folder, using `/` separators.
    pub rel_path: String,
    /// Top-level category folder (textures, thumbnails, data, ...).
    pub category: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImage {
    pub mime: String,
    /// Base64-encoded bytes (no data-url prefix).
    pub data: String,
}

/// Resolve a pack-relative path safely inside the pack folder.
fn resolve_in_pack(app: &AppHandle, id: &str, rel_path: &str) -> Result<PathBuf> {
    let dir = pack_dir(app, id)?;
    if !dir.is_dir() {
        return Err(PackError::NotInstalled(id.to_string()));
    }
    let clean = rel_path.replace('\\', "/");
    if clean.split('/').any(|seg| seg == "..") {
        return Err(PackError::UnsafePath);
    }
    let full = dir.join(&clean);
    if !full.starts_with(&dir) {
        return Err(PackError::UnsafePath);
    }
    Ok(full)
}

/// Install (unpack) one or more `.dungeondraft_pack` files. Runs on a blocking
/// thread so the UI stays responsive; emits `pack-install-progress` events.
#[tauri::command]
pub async fn install_packs(app: AppHandle, paths: Vec<String>) -> Result<Vec<InstalledPack>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut installed = Vec::new();
        for p in &paths {
            let pack = install_one(&app, p)?;
            installed.push(pack);
        }
        Ok(installed)
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// List every installed pack (reading its manifest from disk).
#[tauri::command]
pub async fn list_installed(app: AppHandle) -> Result<Vec<InstalledPack>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut reg = read_registry(&app);
        let root = packs_root(&app)?;
        let mut out = Vec::new();
        let mut dirty = false;
        for entry in fs::read_dir(&root)?.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            let reg_entry = reg.get(&id).cloned().unwrap_or_default();
            let had_stats = reg_entry.file_count.is_some() && reg_entry.size_bytes.is_some();
            if let Some(pack) = build_installed(&app, &id, &reg_entry) {
                // Persist stats we had to compute for a legacy pack so the next
                // listing is instant.
                if !had_stats {
                    reg.insert(
                        id.clone(),
                        PackReg {
                            enabled: pack.enabled,
                            file_count: Some(pack.file_count),
                            size_bytes: Some(pack.size_bytes),
                        },
                    );
                    dirty = true;
                }
                out.push(pack);
            }
        }
        if dirty {
            let _ = write_registry(&app, &reg);
        }
        out.sort_by_cached_key(|a| a.name.to_lowercase());
        Ok(out)
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// Reveal the folder where packs are unpacked in the system file manager.
/// Creates the folder first so it always opens to a valid location.
#[tauri::command]
pub fn open_packs_dir(app: AppHandle) -> Result<()> {
    let dir = packs_root(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| PackError::Other(e.to_string()))?;
    Ok(())
}

/// Delete a pack from disk and free its resources. Runs on a blocking thread
/// because removing a large pack (hundreds of thousands of files) is slow.
#[tauri::command]
pub async fn uninstall_pack(app: AppHandle, id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pack_dir(&app, &id)?;
        if dir.is_dir() {
            fs::remove_dir_all(&dir)?;
        }
        let mut reg = read_registry(&app);
        reg.remove(&id);
        write_registry(&app, &reg)?;
        clear_library(&app);
        Ok(())
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// Enable or disable a pack (toggles a flag; files stay on disk).
#[tauri::command]
pub fn set_pack_enabled(app: AppHandle, id: String, enabled: bool) -> Result<()> {
    if !pack_dir(&app, &id)?.is_dir() {
        return Err(PackError::NotInstalled(id));
    }
    let mut reg = read_registry(&app);
    // Preserve cached stats when toggling.
    reg.entry(id).or_default().enabled = enabled;
    write_registry(&app, &reg)?;
    clear_library(&app);
    Ok(())
}

/// List the extracted contents of a pack (for the future asset browser).
#[tauri::command]
pub fn list_pack_contents(app: AppHandle, id: String) -> Result<Vec<AssetInfo>> {
    let dir = pack_dir(&app, &id)?;
    if !dir.is_dir() {
        return Err(PackError::NotInstalled(id));
    }
    let mut out = Vec::new();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for entry in fs::read_dir(&d)?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(&dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let category = rel.split('/').next().unwrap_or("").to_string();
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(AssetInfo {
                rel_path: rel,
                category,
                size_bytes,
            });
        }
    }
    Ok(out)
}

/// Load a single asset/thumbnail on demand as base64. The bytes are read,
/// encoded and returned; nothing is cached, so memory is freed immediately.
#[tauri::command]
pub async fn load_asset(app: AppHandle, id: String, rel_path: String) -> Result<LoadedImage> {
    tauri::async_runtime::spawn_blocking(move || {
        let full = resolve_in_pack(&app, &id, &rel_path)?;
        let bytes = fs::read(&full)?;
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(LoadedImage {
            mime: mime_for(&full),
            data,
        })
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// Pick a representative cover image for a pack, returned as base64.
/// Prefers the pack's own `preview.png`, otherwise falls back to the first
/// per-texture thumbnail. Returns None if the pack has no images at all.
#[tauri::command]
pub fn load_pack_thumbnail(app: AppHandle, id: String) -> Result<Option<LoadedImage>> {
    let dir = pack_dir(&app, &id)?;

    // 1. The pack's own preview/cover image, if present.
    let preview = dir.join("preview.png");
    let chosen = if preview.is_file() {
        Some(preview)
    } else {
        // 2. Fall back to the first per-texture thumbnail.
        let thumbs = dir.join("thumbnails");
        if thumbs.is_dir() {
            let mut pngs: Vec<PathBuf> = fs::read_dir(&thumbs)?
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("png"))
                .collect();
            pngs.sort();
            pngs.into_iter().next()
        } else {
            None
        }
    };

    let Some(path) = chosen else {
        return Ok(None);
    };
    let bytes = fs::read(&path)?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(LoadedImage {
        mime: "image/png".to_string(),
        data,
    }))
}

/// Run a library search (all enabled packs, or one when `pack_id` is set).
#[tauri::command]
pub async fn search_library(
    app: AppHandle,
    key: String,
    category: String,
    filter: SearchFilter,
) -> Result<LibrarySearch> {
    tauri::async_runtime::spawn_blocking(move || library::search(&app, key, &category, &filter))
        .await
        .map_err(|e| PackError::Other(e.to_string()))?
}

/// List enabled packs that ship textures for a category (per-pack browsers).
#[tauri::command]
pub async fn packs_with_category(app: AppHandle, category: String) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || library::packs_with_category(&app, &category))
        .await
        .map_err(|e| PackError::Other(e.to_string()))
}

/// Fetch a window of a browser instance's search results, resolving thumbnails.
#[tauri::command]
pub fn get_library_items(
    app: AppHandle,
    key: String,
    offset: usize,
    limit: usize,
) -> Result<Vec<LibItem>> {
    library::get_items(&app, &key, offset, limit)
}

/// Drop a browser instance's cached results (call when the browser unmounts).
#[tauri::command]
pub fn release_library_search(app: AppHandle, key: String) {
    library::release(&app, &key);
}

/// Tag names available for a category across enabled packs (Library Tags tab).
#[tauri::command]
pub async fn library_tags(app: AppHandle, category: String) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || super::tags::tags_for_category(&app, &category))
        .await
        .map_err(|e| PackError::Other(e.to_string()))
}

/// Resolve placed asset ids to texture files (for drawing map entities).
#[tauri::command]
pub async fn resolve_assets(app: AppHandle, ids: Vec<String>) -> Result<Vec<ResolvedAsset>> {
    tauri::async_runtime::spawn_blocking(move || library::resolve(&app, &ids))
        .await
        .map_err(|e| PackError::Other(e.to_string()))
}
