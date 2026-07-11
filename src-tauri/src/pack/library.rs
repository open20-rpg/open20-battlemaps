//! Library (asset browser for the Object/Scatter tools, etc.)
//!
//! Packs can hold >100k objects, so the library never ships the whole list over
//! IPC. A search filters an in-memory, cached per-pack index and stores the
//! result set in `LibraryState`; the frontend then pulls only the visible window
//! via `get_library_items`. Thumbnails are served through Tauri's asset protocol
//! (convertFileSrc) so the webview loads/frees the images natively.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::recolor::{pack_color_cfg, pack_colorable_set, ColorCfg};
use super::registry::{pack_dir, read_registry};
use super::Result;

/// One indexed asset (kept lightweight; the thumbnail path is derived on demand).
#[derive(Clone)]
struct CacheItem {
    rel_path: String,
    name: String,
    name_lower: String,
}

/// A filtered search hit, before its thumbnail path is resolved.
#[derive(Clone)]
struct LibItemLite {
    pack_id: String,
    rel_path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibItem {
    id: String,
    name: String,
    /// Absolute path to the thumbnail PNG (use convertFileSrc on the frontend).
    thumb: String,
    /// Absolute path to the full-size texture (for the hover preview panel).
    full: String,
    /// Whether this asset can be recolored (tagged Colorable + pack enables it).
    colorable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearch {
    total: usize,
}

/// Session-scoped library caches. Cleared when packs change.
#[derive(Default)]
pub struct LibraryState {
    /// key = "<packId>/<category>" -> indexed items for that pack folder.
    indexes: Mutex<HashMap<String, Arc<Vec<CacheItem>>>>,
    /// Cached search results per browser instance (caller-provided key), served
    /// in windows. Keyed so multiple asset browsers can be open at once (e.g.
    /// the Building tool's Floor and Wall selectors) without clobbering.
    results: Mutex<HashMap<String, Vec<LibItemLite>>>,
    /// packId -> colorable texture rel-paths (from data/default.dungeondraft_tags).
    pub(crate) colorable: Mutex<HashMap<String, Arc<HashSet<String>>>>,
    /// packId -> parsed `custom_color_overrides` (None once loaded = pack has none).
    pub(crate) color_cfg: Mutex<HashMap<String, Option<ColorCfg>>>,
}

/// Drop all cached indexes/results (call when packs are added/removed/toggled).
pub(crate) fn clear_library(app: &AppHandle) {
    let state = app.state::<LibraryState>();
    if let Ok(mut idx) = state.indexes.lock() {
        idx.clear();
    }
    if let Ok(mut res) = state.results.lock() {
        res.clear();
    }
    if let Ok(mut c) = state.colorable.lock() {
        c.clear();
    }
    if let Ok(mut c) = state.color_cfg.lock() {
        c.clear();
    };
}

/// Some categories group several part textures per item inside a subfolder
/// (e.g. `caves/<name>/{floor,wall}.png`, `roofs/<name>/{tiles,edge,hip,ridge}.png`).
/// For those we list only the main part, named after its subfolder. Returns the
/// main part's file stem, or `None` for flat categories that list every file.
fn main_part(category: &str) -> Option<&'static str> {
    match category {
        "caves" => Some("floor"),
        "roofs" => Some("tiles"),
        _ => None,
    }
}

/// Walk `textures/<category>` of a pack and collect its files.
fn build_category_index(app: &AppHandle, pack_id: &str, category: &str) -> Vec<CacheItem> {
    let Ok(dir) = pack_dir(app, pack_id) else {
        return Vec::new();
    };
    let main = main_part(category);
    let base = dir.join("textures").join(category);
    let mut out = Vec::new();
    let mut stack = vec![base];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Grouped categories: keep only the main part, named after its folder.
            let name = if let Some(part) = main {
                if !stem.eq_ignore_ascii_case(part) {
                    continue;
                }
                path.parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or(stem)
            } else {
                stem
            };
            let rel = path
                .strip_prefix(&dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let name_lower = name.to_lowercase();
            out.push(CacheItem {
                rel_path: rel,
                name,
                name_lower,
            });
        }
    }
    out
}

/// Does a pack ship at least one file under `textures/<category>`?
fn pack_has_category(app: &AppHandle, pack_id: &str, category: &str) -> bool {
    let Ok(dir) = pack_dir(app, pack_id) else {
        return false;
    };
    let mut stack = vec![dir.join("textures").join(category)];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                return true;
            }
        }
    }
    false
}

/// Enabled pack ids that ship textures for `category` (for per-pack browsers).
pub(crate) fn packs_with_category(app: &AppHandle, category: &str) -> Vec<String> {
    let reg = read_registry(app);
    let mut out: Vec<String> = reg
        .iter()
        .filter(|(id, r)| r.enabled && pack_has_category(app, id, category))
        .map(|(id, _)| id.clone())
        .collect();
    out.sort();
    out
}

/// Is `q` a subsequence of `s` (its chars appear in order, gaps allowed)?
fn is_subsequence(q: &str, s: &str) -> bool {
    let mut chars = s.chars();
    q.chars().all(|c| chars.any(|x| x == c))
}

/// Match `name` against `query` with an exactness in [0,1]. Near the exact end
/// only substring matches count; lower down, subsequence (fuzzy) matches too.
fn matches(name_lower: &str, query_lower: &str, exactness: f32) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    if name_lower.contains(query_lower) {
        return true;
    }
    if exactness >= 0.85 {
        return false;
    }
    is_subsequence(query_lower, name_lower)
}

/// Run a library search over all enabled packs and cache the results.
pub(crate) fn search(
    app: &AppHandle,
    key: String,
    category: &str,
    query: &str,
    exactness: f32,
    pack_id: Option<&str>,
) -> Result<LibrarySearch> {
    let state = app.state::<LibraryState>();
    let reg = read_registry(app);
    let mut enabled: Vec<String> = reg
        .iter()
        .filter(|(_, r)| r.enabled)
        .map(|(id, _)| id.clone())
        .collect();
    // Optionally scope the search to a single pack (e.g. the terrain picker).
    if let Some(pid) = pack_id {
        enabled.retain(|id| id == pid);
    }
    enabled.sort();

    let q = query.to_lowercase();
    let mut results: Vec<LibItemLite> = Vec::new();

    for pack_id in &enabled {
        let key = format!("{pack_id}/{category}");
        let index = {
            let mut idx = state.indexes.lock().unwrap();
            if let Some(existing) = idx.get(&key) {
                existing.clone()
            } else {
                let built = Arc::new(build_category_index(app, pack_id, category));
                idx.insert(key, built.clone());
                built
            }
        };
        for item in index.iter() {
            if matches(&item.name_lower, &q, exactness) {
                results.push(LibItemLite {
                    pack_id: pack_id.clone(),
                    rel_path: item.rel_path.clone(),
                    name: item.name.clone(),
                });
            }
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let total = results.len();
    state.results.lock().unwrap().insert(key, results);
    Ok(LibrarySearch { total })
}

/// Fetch a window of a browser instance's search results, resolving thumbnails.
pub(crate) fn get_items(
    app: &AppHandle,
    key: &str,
    offset: usize,
    limit: usize,
) -> Result<Vec<LibItem>> {
    let state = app.state::<LibraryState>();
    let map = state.results.lock().unwrap();
    let results = match map.get(key) {
        Some(r) => r,
        None => return Ok(Vec::new()),
    };
    if offset >= results.len() {
        return Ok(Vec::new());
    }
    let end = (offset + limit).min(results.len());
    let mut out = Vec::with_capacity(end - offset);
    for lite in &results[offset..end] {
        let dir = pack_dir(app, &lite.pack_id)?;
        let res_path = format!("res://packs/{}/{}", lite.pack_id, lite.rel_path);
        let hash = format!("{:x}", md5::compute(res_path.as_bytes()));
        let full = dir.join(&lite.rel_path);
        let thumb = dir.join("thumbnails").join(format!("{hash}.png"));
        // Some packs ship no pre-baked thumbnails; fall back to the texture
        // itself (the webview scales it down to the cell size).
        let image = if thumb.is_file() { thumb } else { full.clone() };
        let colorable = pack_color_cfg(app, &lite.pack_id).is_some()
            && pack_colorable_set(app, &lite.pack_id).contains(&lite.rel_path);
        out.push(LibItem {
            id: format!("{}|{}", lite.pack_id, lite.rel_path),
            name: lite.name.clone(),
            thumb: image.to_string_lossy().into_owned(),
            full: full.to_string_lossy().into_owned(),
            colorable,
        });
    }
    Ok(out)
}

/// Drop a browser instance's cached results (call when the browser unmounts).
pub(crate) fn release(app: &AppHandle, key: &str) {
    let state = app.state::<LibraryState>();
    state.results.lock().unwrap().remove(key);
}
