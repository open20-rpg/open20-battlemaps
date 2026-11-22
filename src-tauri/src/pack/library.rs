//! Library (asset browser for the Object/Scatter tools, etc.)
//!
//! Packs can hold >100k objects, so the library never ships the whole list over
//! IPC. A search filters an in-memory, cached per-pack index and stores the
//! result set in `LibraryState`; the frontend then pulls only the visible window
//! via `get_library_items`. Thumbnails are served through Tauri's asset protocol
//! (convertFileSrc) so the webview loads/frees the images natively.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::assetdefs::{def_for, pack_asset_defs};
use super::recolor::{pack_colorable_set, ColorCfg};
use super::registry::{pack_dir, read_registry};
use super::Result;

/// One indexed asset (kept lightweight; the thumbnail path is derived on demand).
#[derive(Clone)]
struct CacheItem {
    rel_path: String,
    name: String,
    /// The words of its name, lowercase ("Table_Round_Wood" → table, round, wood).
    words: Vec<String>,
    /// The words of the folders it sits in, below its category (weaker matches).
    folder_words: Vec<String>,
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
    /// Whether this asset is recolored by its red regions (tagged Colorable,
    /// or a "custom_color" tileset) instead of tinted.
    colorable: bool,
    /// Its default tint (walls and tilesets, from the pack's definitions).
    default_color: Option<String>,
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
    /// packId -> tag name -> texture rel-paths (see `tags.rs`).
    pub(crate) tags: Mutex<HashMap<String, Arc<super::tags::TagMap>>>,
    /// "packId/category" -> that pack's tag names for the category, sorted.
    pub(crate) tag_names: Mutex<HashMap<String, Arc<Vec<String>>>>,
    /// packId -> tileset/wall definitions (see `assetdefs.rs`).
    pub(crate) defs: Mutex<HashMap<String, Arc<super::assetdefs::AssetDefs>>>,
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
    if let Ok(mut t) = state.tags.lock() {
        t.clear();
    };
    if let Ok(mut t) = state.tag_names.lock() {
        t.clear();
    };
    if let Ok(mut d) = state.defs.lock() {
        d.clear();
    };
    // Packs changed: read the new set's tags ahead of the Tags tab.
    super::tags::prewarm(app);
}

/// How an asset takes a color (see `recolor.rs`): its default tint from the
/// pack's definitions, and whether it's recolored by its red regions (a
/// Colorable-tagged object, or a "custom_color" tileset) rather than tinted.
fn color_info(app: &AppHandle, pack_id: &str, rel: &str) -> (bool, Option<String>) {
    let def = def_for(&pack_asset_defs(app, pack_id), rel);
    let colorable = def.custom_color || pack_colorable_set(app, pack_id).contains(rel);
    (colorable, def.default_color)
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

/// Companion textures that belong to another item instead of being one: a
/// wall's `<name>_end` end cap is drawn by the editor at the wall's open ends,
/// and a material's `<name>_border` along the edge of its `<name>_tile` (any
/// material file naming "border" is one), so
/// neither shows up as an item of its own.
fn is_companion_texture(category: &str, stem: &str) -> bool {
    let lower = stem.to_ascii_lowercase();
    match category {
        "walls" => lower.ends_with("_end"),
        "materials" => lower.contains("border"),
        _ => false,
    }
}

/// A material's name from its tile texture's file stem: `grass_tile_1` →
/// `grass_1`, `Lush Grass_tile` → `Lush Grass` (a stem without `_tile` as is).
fn material_name(stem: &str) -> String {
    match stem.find("_tile") {
        Some(i) => format!("{}{}", &stem[..i], &stem[i + 5..]),
        None => stem.to_string(),
    }
}

/// Folders under `textures/` that also hold a category's assets. Tilesets
/// include Dungeondraft's `patterns` (Forgotten Adventures ships its pattern
/// textures there): the Pattern tool and floors pick from both.
fn extra_folders(category: &str) -> &'static [&'static str] {
    match category {
        "tilesets" => &["patterns"],
        _ => &[],
    }
}

/// Walk `textures/<category>` of a pack (and its [`extra_folders`]) and
/// collect its files.
fn build_category_index(app: &AppHandle, pack_id: &str, category: &str) -> Vec<CacheItem> {
    let Ok(dir) = pack_dir(app, pack_id) else {
        return Vec::new();
    };
    let main = main_part(category);
    let mut out = Vec::new();
    let mut stack: Vec<PathBuf> = std::iter::once(category)
        .chain(extra_folders(category).iter().copied())
        .map(|f| dir.join("textures").join(f))
        .collect();
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
            if is_companion_texture(category, &stem) {
                continue;
            }
            // Grouped categories: keep only the main part, named after its folder.
            let name = if let Some(part) = main {
                if !stem.eq_ignore_ascii_case(part) {
                    continue;
                }
                path.parent()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or(stem)
            } else if category == "materials" {
                // A material's `<name>_tile` (+ `<name>_border`): list it as `<name>`.
                material_name(&stem)
            } else {
                stem
            };
            let rel = path
                .strip_prefix(&dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let words = split_words(&name);
            // Folders below textures/<category>/ (the file name itself excluded).
            let folder_words = rel
                .split('/')
                .skip(2)
                .collect::<Vec<_>>()
                .split_last()
                .map(|(_, dirs)| dirs.iter().flat_map(|d| split_words(d)).collect())
                .unwrap_or_default();
            out.push(CacheItem {
                rel_path: rel,
                name,
                words,
                folder_words,
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
    let mut stack: Vec<PathBuf> = std::iter::once(category)
        .chain(extra_folders(category).iter().copied())
        .map(|f| dir.join("textures").join(f))
        .collect();
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

/// The words of a name or a query: split on anything that isn't a letter or a
/// digit (underscores, spaces, dashes) and at camelCase humps, lowercase.
fn split_words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if c.is_uppercase() && prev_lower && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        prev_lower = c.is_lowercase();
        cur.extend(c.to_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// A word without its plural ending ("tables" → "table", "boxes" → "box").
fn singular(w: &str) -> &str {
    w.strip_suffix("es")
        .filter(|s| s.ends_with(['s', 'x', 'z']) || s.ends_with("ch") || s.ends_with("sh"))
        .or_else(|| w.strip_suffix('s').filter(|s| s.len() >= 3))
        .unwrap_or(w)
}

/// How well one typed word matches one word of a name (lower is better):
/// the same word, the same in singular/plural, its beginning, or (3+ letters)
/// anywhere inside it.
fn word_score(word: &str, typed: &str) -> Option<u32> {
    if word == typed {
        return Some(0);
    }
    if singular(word) == singular(typed) {
        return Some(1);
    }
    if word.starts_with(typed) {
        return Some(2);
    }
    if typed.chars().count() >= 3 && word.contains(typed) {
        return Some(5);
    }
    None
}

/// Ranks an asset for a query (lower is better), or `None` when it doesn't
/// match. Every typed word must match a word of the name, in any order, or,
/// less strongly, a word of its folders ("round table", "table round" and
/// "tables" all find Table_Round_…). Names whose words come in the typed
/// order and shorter names rank first.
fn rank(item: &CacheItem, typed: &[String]) -> Option<u32> {
    if typed.is_empty() {
        return Some(0);
    }
    let mut total = 0u32;
    let mut last_pos: Option<usize> = None;
    for t in typed {
        let in_name = item
            .words
            .iter()
            .enumerate()
            .filter_map(|(i, w)| word_score(w, t).map(|s| (s * 10 + i.min(9) as u32, i)))
            .min();
        let score = match in_name {
            Some((s, i)) => {
                if last_pos.is_some_and(|p| i < p) {
                    total += 3;
                }
                last_pos = Some(i);
                s
            }
            None => item
                .folder_words
                .iter()
                .filter_map(|w| word_score(w, t))
                .min()
                .map(|s| 40 + s * 10)?,
        };
        total += score;
    }
    Some(total * 100 + item.words.len().min(99) as u32)
}

/// What a library search matches. Deserialized straight from the frontend
/// (`searchLibrary` in `features/library/api.ts`).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFilter {
    #[serde(default)]
    pub query: String,
    /// Scope to a single pack (e.g. the terrain picker).
    pub pack_id: Option<String>,
    /// Only textures in this pack tag (Library "Tags" tab).
    pub tag: Option<String>,
    /// Only these asset ids (Library "Used" tab).
    pub ids: Option<HashSet<String>>,
}

/// Run a library search over all enabled packs and cache the results.
pub(crate) fn search(
    app: &AppHandle,
    key: String,
    category: &str,
    filter: &SearchFilter,
) -> Result<LibrarySearch> {
    let state = app.state::<LibraryState>();
    let reg = read_registry(app);
    // Scoped to one pack (the terrain picker, a user pack's editor), it's
    // searched even while off: the editor lists a disabled pack's assets too.
    let mut enabled: Vec<String> = reg
        .iter()
        .filter(|(id, r)| match &filter.pack_id {
            Some(pid) => *id == pid,
            None => r.enabled,
        })
        .map(|(id, _)| id.clone())
        .collect();
    enabled.sort();

    let typed = split_words(&filter.query);
    let mut results: Vec<(u32, LibItemLite)> = Vec::new();

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
        // Restrict to one tag's textures (Library "Tags" tab) when requested.
        let tagged = filter
            .tag
            .as_deref()
            .map(|t| super::tags::pack_tags(app, pack_id).get(t).cloned());
        for item in index.iter() {
            if let Some(allowed) = &tagged {
                if !allowed
                    .as_ref()
                    .is_some_and(|set| set.contains(&item.rel_path))
                {
                    continue;
                }
            }
            // Restrict to explicit asset ids (Library "Used" tab).
            if let Some(ids) = &filter.ids {
                if !ids.contains(&format!("{pack_id}|{}", item.rel_path)) {
                    continue;
                }
            }
            if let Some(score) = rank(item, &typed) {
                results.push((
                    score,
                    LibItemLite {
                        pack_id: pack_id.clone(),
                        rel_path: item.rel_path.clone(),
                        name: item.name.clone(),
                    },
                ));
            }
        }
    }

    // Best matches first; ties (and an empty search) in name order.
    results.sort_by_cached_key(|(score, a)| (*score, a.name.to_lowercase()));
    let results: Vec<LibItemLite> = results.into_iter().map(|(_, a)| a).collect();
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
    let window = &results[offset..end];
    // Packs ship thumbnails named by the md5 of the texture's res:// path;
    // for the ones missing, make them (in parallel: decoding big textures is
    // the slow part) cut the same way, next to the shipped ones.
    let mut paths = Vec::with_capacity(window.len());
    for lite in window {
        let dir = pack_dir(app, &lite.pack_id)?;
        paths.push(thumb_paths(&dir, &lite.pack_id, &lite.rel_path));
    }
    let thumb_of =
        |(full, shipped): &(PathBuf, PathBuf), rel: &str| thumb_or_full(full, shipped, rel);
    // A few at a time: each big texture is decoded whole.
    let workers = std::thread::available_parallelism().map_or(4, |n| n.get());
    let jobs: Vec<_> = paths.iter().zip(window).collect();
    let mut images: Vec<PathBuf> = Vec::with_capacity(jobs.len());
    for batch in jobs.chunks(workers) {
        std::thread::scope(|scope| {
            let handles: Vec<_> = batch
                .iter()
                .map(|(p, lite)| scope.spawn(|| thumb_of(p, &lite.rel_path)))
                .collect();
            for (h, (p, _)) in handles.into_iter().zip(batch) {
                images.push(h.join().unwrap_or_else(|_| p.0.clone()));
            }
        });
    }
    let mut out = Vec::with_capacity(window.len());
    for ((lite, (full, _)), image) in window.iter().zip(&paths).zip(images) {
        let (colorable, default_color) = color_info(app, &lite.pack_id, &lite.rel_path);
        out.push(LibItem {
            id: format!("{}|{}", lite.pack_id, lite.rel_path),
            name: lite.name.clone(),
            thumb: image.to_string_lossy().into_owned(),
            full: full.to_string_lossy().into_owned(),
            colorable,
            default_color,
        });
    }
    Ok(out)
}

/// A texture's file and its library thumbnail's (`thumbnails/<md5 of its
/// res:// path>.png` in the pack, made if the pack ships none).
fn thumb_paths(dir: &Path, pack_id: &str, rel: &str) -> (PathBuf, PathBuf) {
    let res_path = format!("res://packs/{pack_id}/{rel}");
    let hash = format!("{:x}", md5::compute(res_path.as_bytes()));
    (
        dir.join(rel),
        dir.join("thumbnails").join(format!("{hash}.png")),
    )
}

/// The thumbnail, made if missing; the texture itself if it can't be read.
fn thumb_or_full(full: &Path, shipped: &Path, rel: &str) -> PathBuf {
    if shipped.is_file() || super::thumbs::generate(full, shipped, super::thumbs::rule_for(rel)) {
        shipped.to_path_buf()
    } else {
        full.to_path_buf()
    }
}

/// Library thumbnails of placed asset ids (None when missing): what a picker
/// shows for them, e.g. a terrain slot filled without the Library (terrain
/// textures' alpha is blend height, which their thumbnails leave out).
pub(crate) fn thumbnails(app: &AppHandle, ids: &[String]) -> Vec<Option<String>> {
    ids.iter()
        .map(|id| {
            let (pack_id, rel) = split_asset_id(id)?;
            let dir = pack_dir(app, pack_id).ok()?;
            let rel = locate(&dir, rel)?;
            let (full, shipped) = thumb_paths(&dir, pack_id, &rel);
            if !full.starts_with(&dir) {
                return None;
            }
            Some(
                thumb_or_full(&full, &shipped, &rel)
                    .to_string_lossy()
                    .into_owned(),
            )
        })
        .collect()
}

/// A placed asset resolved to its file on disk (for rendering map entities).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    id: String,
    /// Absolute path to the texture, or None if the pack/file is missing.
    path: Option<String>,
    colorable: bool,
}

/// Split a library item id (`{packId}|{relPath}`) into its parts.
pub(crate) fn split_asset_id(id: &str) -> Option<(&str, &str)> {
    let (pack, rel) = id.split_once('|')?;
    if pack.is_empty() || rel.is_empty() || rel.split('/').any(|seg| seg == "..") {
        return None;
    }
    Some((pack, rel))
}

/// Image extensions a texture may have been re-encoded to between pack versions.
const IMAGE_EXTS: [&str; 4] = ["png", "webp", "jpg", "jpeg"];

/// Find `rel` inside `dir`, tolerating what differs between pack versions and
/// the map that references them: the image extension (a `.png` re-released
/// as `.webp`) and letter case. Returns the path relative to `dir` as found.
pub(crate) fn locate(dir: &Path, rel: &str) -> Option<String> {
    let mut candidates = vec![rel.to_string()];
    if let Some((stem, ext)) = rel.rsplit_once('.') {
        if IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            for alt in IMAGE_EXTS {
                if !alt.eq_ignore_ascii_case(ext) {
                    candidates.push(format!("{stem}.{alt}"));
                }
            }
        }
    }
    for c in &candidates {
        if dir.join(c).is_file() {
            return Some(c.clone());
        }
    }
    candidates.iter().find_map(|c| locate_ignoring_case(dir, c))
}

/// Walk `rel` one component at a time, matching names case-insensitively.
fn locate_ignoring_case(dir: &Path, rel: &str) -> Option<String> {
    let mut path = dir.to_path_buf();
    let mut found = Vec::new();
    for part in rel.split('/').filter(|p| !p.is_empty()) {
        let name = fs::read_dir(&path)
            .ok()?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.eq_ignore_ascii_case(part))?;
        path.push(&name);
        found.push(name);
    }
    path.is_file().then(|| found.join("/"))
}

/// Resolve asset ids to their texture files (missing packs/files resolve to None).
pub(crate) fn resolve(app: &AppHandle, ids: &[String]) -> Vec<ResolvedAsset> {
    ids.iter()
        .map(|id| {
            let found = split_asset_id(id).and_then(|(pack_id, rel)| {
                let dir = pack_dir(app, pack_id).ok()?;
                let rel = locate(&dir, rel)?;
                let full = dir.join(&rel);
                if !full.starts_with(&dir) {
                    return None;
                }
                let (colorable, _) = color_info(app, pack_id, &rel);
                Some((full.to_string_lossy().into_owned(), colorable))
            });
            ResolvedAsset {
                id: id.clone(),
                path: found.as_ref().map(|(p, _)| p.clone()),
                colorable: found.is_some_and(|(_, c)| c),
            }
        })
        .collect()
}

/// Drop a browser instance's cached results (call when the browser unmounts).
pub(crate) fn release(app: &AppHandle, key: &str) {
    let state = app.state::<LibraryState>();
    state.results.lock().unwrap().remove(key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnails_are_named_by_the_md5_of_the_res_path() {
        let (full, thumb) = thumb_paths(Path::new("/p"), "pk", "textures/terrain/a.png");
        assert_eq!(full, Path::new("/p/textures/terrain/a.png"));
        let hash = format!(
            "{:x}",
            md5::compute(b"res://packs/pk/textures/terrain/a.png")
        );
        assert_eq!(
            thumb,
            Path::new("/p/thumbnails").join(format!("{hash}.png"))
        );
    }

    #[test]
    fn splits_asset_ids() {
        assert_eq!(
            split_asset_id("pack1|textures/objects/a.png"),
            Some(("pack1", "textures/objects/a.png"))
        );
        assert_eq!(split_asset_id("no-separator"), None);
        assert_eq!(split_asset_id("|textures/a.png"), None);
        assert_eq!(split_asset_id("p|../../etc/passwd"), None);
    }

    #[test]
    fn locates_textures_across_extensions_and_case() {
        let dir = std::env::temp_dir().join(format!("battle-maps-locate-{}", std::process::id()));
        let sub = dir.join("textures").join("Terrain");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("Grass.webp"), b"x").unwrap();
        fs::write(sub.join("Dirt.png"), b"x").unwrap();
        assert_eq!(
            locate(&dir, "textures/Terrain/Grass.webp").as_deref(),
            Some("textures/Terrain/Grass.webp")
        );
        // Re-encoded between pack versions.
        assert_eq!(
            locate(&dir, "textures/Terrain/Grass.png").as_deref(),
            Some("textures/Terrain/Grass.webp")
        );
        // Different letter case (and extension) than on disk.
        assert_eq!(
            locate(&dir, "textures/terrain/dirt.webp").as_deref(),
            Some("textures/Terrain/Dirt.png")
        );
        assert_eq!(locate(&dir, "textures/Terrain/Rock.png"), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn wall_end_caps_are_companions_not_items() {
        assert!(is_companion_texture("walls", "stone_wall_end"));
        assert!(is_companion_texture("walls", "Stone_END"));
        assert!(!is_companion_texture("walls", "stone_wall"));
        assert!(!is_companion_texture("objects", "chair_end"));
        assert_eq!(material_name("grass_tile_1"), "grass_1");
        assert_eq!(material_name("Lush Grass_tile"), "Lush Grass");
        assert_eq!(material_name("plain"), "plain");
        assert!(is_companion_texture("materials", "cobblestone_border"));
        assert!(is_companion_texture("materials", "grass_border_1"));
        assert!(!is_companion_texture("materials", "cobblestone_tile"));
        assert!(!is_companion_texture("tilesets", "stone_border"));
    }

    fn item(rel: &str) -> CacheItem {
        let name = rel
            .rsplit('/')
            .next()
            .unwrap()
            .trim_end_matches(".webp")
            .to_string();
        let folder_words = rel
            .split('/')
            .skip(2)
            .collect::<Vec<_>>()
            .split_last()
            .map(|(_, dirs)| dirs.iter().flat_map(|d| split_words(d)).collect())
            .unwrap_or_default();
        CacheItem {
            rel_path: rel.into(),
            words: split_words(&name),
            name,
            folder_words,
        }
    }

    #[test]
    fn words_split_on_separators_and_camel_case() {
        assert_eq!(
            split_words("Table_Round_Wood_A1_2x2"),
            ["table", "round", "wood", "a1", "2x2"]
        );
        assert_eq!(split_words("  round   TABLE "), ["round", "table"]);
        assert_eq!(split_words("Dirty Snow"), ["dirty", "snow"]);
        assert_eq!(split_words("woodenChair"), ["wooden", "chair"]);
        assert!(split_words("   ").is_empty());
    }

    #[test]
    fn every_word_must_match_in_any_order() {
        let t = item("textures/objects/Furniture/Tables/Table_Round_Wood_Walnut_A1_2x2.webp");
        let q = |s: &str| rank(&t, &split_words(s));
        assert!(q("round table").is_some());
        assert!(q("table round").is_some());
        assert!(q("tables").is_some());
        assert!(q("walnut").is_some());
        assert!(q("tab rou").is_some());
        assert!(q("furniture").is_some());
        assert!(q("round chair").is_none());
        assert!(q("").is_some());
    }

    #[test]
    fn better_matches_rank_first() {
        let round = item("textures/objects/Furniture/Tables/Table_Round_Wood_A1_2x2.webp");
        let coffee =
            item("textures/objects/Furniture/Tables/Coffee_Table_Fancy_Wood_Round_A1_1x1.webp");
        let rounded = item("textures/objects/Misc/Roundel_Table_Cloth_A1_1x1.webp");
        let folder = item("textures/objects/Furniture/Tables/Bench_Wood_A1_2x1.webp");
        let typed = split_words("round table");
        let r = |i: &CacheItem| rank(i, &typed).unwrap();
        assert!(r(&round) < r(&coffee), "typed order and fewer words first");
        assert!(
            r(&round) < r(&rounded),
            "a whole word before a word's beginning"
        );
        assert!(
            rank(&folder, &split_words("table")).unwrap()
                > rank(&round, &split_words("table")).unwrap()
        );
    }
}
