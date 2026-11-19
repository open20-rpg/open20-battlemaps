//! Packs the user creates in the app: their manifest, importing images into
//! them (optimized, see `optimize.rs`), editing or deleting what's in them and
//! exporting them as `.dungeondraft_pack` for Dungeondraft.
//!
//! A user pack lives unpacked under `app_data/packs/<id>/` exactly like an
//! installed one (so the library, renderer and recolor read it the same way),
//! with the Dungeondraft layout: `pack.json`, `textures/<category>/…`,
//! `data/{tilesets,walls}/*` definitions, `data/default.dungeondraft_tags` and
//! `thumbnails/<md5>.png`. Its registry entry is flagged `user`: only those
//! are editable — installed packs never are, even one exported from here.
//!
//! Every function here runs on the blocking pool (see `commands.rs`) and
//! processes images one at a time, so memory stays bounded by one image.

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::assetdefs::{def_for, pack_asset_defs};
use super::format::{write_pck, PckFile};
use super::install::open_pack_source;
use super::library::{clear_library, split_asset_id};
use super::optimize::{self, Adjust, Quality};
use super::recolor::{pack_colorable_set, strip_trailing_commas};
use super::registry::{
    build_installed, dir_stats, pack_dir, read_installed_manifest, read_registry, update_registry,
    InstalledPack, PackReg,
};
use super::tags::parse_tags;
use super::thumbs;
use super::{PackError, Result};

/// Serializes every change to user packs' files (imports, edits, exports run
/// on the blocking pool, several at a time).
static USER_PACK_LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    USER_PACK_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

const TAGS_FILE: &str = "data/default.dungeondraft_tags";
const COLORABLE_TAG: &str = "Colorable";

// ---------------------------------------------------------------------------
// Categories and their file layout
// ---------------------------------------------------------------------------

/// Where a category's items live and which extra textures ("parts") come with
/// each. All of an item's parts share the main texture's extension: the
/// renderer derives their paths from it (see `relatedPath` in the frontend).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Layout {
    /// `textures/<cat>/[folder/]<name>.<ext>`.
    Flat,
    /// Walls: `<name>.<ext>` + optional `<name>_end.<ext>` end cap.
    Wall,
    /// Materials: `<name>_tile.<ext>` + optional `<name>_border.<ext>`.
    Material,
    /// Caves and roofs: `<name>/<main>.<ext>` + `<name>/<part>.<ext>`.
    Folder(&'static str, &'static [&'static str]),
}

pub(crate) fn base_dir(category: &str) -> Option<&'static str> {
    Some(match category {
        "objects" => "textures/objects",
        "portals" => "textures/portals",
        "paths" => "textures/paths",
        "lights" => "textures/lights",
        "terrain" => "textures/terrain",
        "walls" => "textures/walls",
        "tilesets" => "textures/tilesets/simple",
        "materials" => "textures/materials",
        "caves" => "textures/caves",
        "roofs" => "textures/roofs",
        _ => return None,
    })
}

pub(crate) fn layout(category: &str) -> Layout {
    match category {
        "walls" => Layout::Wall,
        "materials" => Layout::Material,
        "caves" => Layout::Folder("floor", &["wall"]),
        "roofs" => Layout::Folder("tiles", &["edge", "hip", "ridge"]),
        _ => Layout::Flat,
    }
}

/// The extra parts a category's items may have.
pub(crate) fn part_names(category: &str) -> Vec<&'static str> {
    match layout(category) {
        Layout::Wall => vec!["end"],
        Layout::Material => vec!["border"],
        Layout::Folder(_, parts) => parts.to_vec(),
        Layout::Flat => vec![],
    }
}

/// A name usable as a file or folder name on every OS.
pub(crate) fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = joined.trim_matches('.').trim().to_string();
    if trimmed.is_empty() {
        "Asset".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// An objects subfolder, cleaned segment by segment (`a/b` keeps its nesting).
fn clean_folder(folder: &str) -> String {
    folder
        .split(['/', '\\'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .map(clean_name)
        .collect::<Vec<_>>()
        .join("/")
}

/// Main texture's path inside the pack.
pub(crate) fn main_rel(category: &str, folder: &str, name: &str, ext: &str) -> Option<String> {
    let base = base_dir(category)?;
    Some(match layout(category) {
        Layout::Flat if category == "objects" && !folder.is_empty() => {
            format!("{base}/{folder}/{name}.{ext}")
        }
        Layout::Flat | Layout::Wall => format!("{base}/{name}.{ext}"),
        Layout::Material => format!("{base}/{name}_tile.{ext}"),
        Layout::Folder(main, _) => format!("{base}/{name}/{main}.{ext}"),
    })
}

/// A part's path, derived from the main texture's.
pub(crate) fn part_rel(category: &str, main: &str, part: &str) -> String {
    let (dir, file) = main.rsplit_once('/').unwrap_or(("", main));
    let (stem, ext) = file.rsplit_once('.').unwrap_or((file, "png"));
    let file = match layout(category) {
        Layout::Wall => format!("{stem}_end.{ext}"),
        Layout::Material => format!("{}.{ext}", stem.replacen("_tile", "_border", 1)),
        _ => format!("{part}.{ext}"),
    };
    format!("{dir}/{file}")
}

/// An item's category, name and objects subfolder, from its main path.
pub(crate) fn parse_main_rel(rel: &str) -> Option<(&'static str, String, String)> {
    let category = [
        "objects",
        "portals",
        "paths",
        "lights",
        "terrain",
        "walls",
        "tilesets",
        "materials",
        "caves",
        "roofs",
    ]
    .into_iter()
    .find(|c| base_dir(c).is_some_and(|b| rel.starts_with(&format!("{b}/"))))?;
    let rest = &rel[base_dir(category)?.len() + 1..];
    let stem_of = |file: &str| file.rsplit_once('.').map_or(file, |(s, _)| s).to_string();
    Some(match layout(category) {
        Layout::Folder(_, _) => {
            let (name, _) = rest.split_once('/')?;
            (category, name.to_string(), String::new())
        }
        Layout::Material => {
            let stem = stem_of(rest);
            let name = stem.replacen("_tile", "", 1);
            (category, name, String::new())
        }
        _ => {
            let (folder, file) = rest.rsplit_once('/').unwrap_or(("", rest));
            (category, stem_of(file), folder.to_string())
        }
    })
}

/// Every file of an item (main first), relative to the pack, that exists.
fn item_files(dir: &Path, category: &str, main: &str) -> Vec<String> {
    let mut out = vec![main.to_string()];
    for part in part_names(category) {
        let rel = part_rel(category, main, part);
        if dir.join(&rel).is_file() {
            out.push(rel);
        }
    }
    out
}

/// The item's own folder (caves, roofs), removed with it.
fn item_folder(category: &str, main: &str) -> Option<String> {
    matches!(layout(category), Layout::Folder(..))
        .then(|| main.rsplit_once('/').map(|(d, _)| d.to_string()))
        .flatten()
}

fn res_path(pack_id: &str, rel: &str) -> String {
    format!("res://packs/{pack_id}/{rel}")
}

fn thumb_path(dir: &Path, pack_id: &str, rel: &str) -> PathBuf {
    let hash = format!("{:x}", md5::compute(res_path(pack_id, rel).as_bytes()));
    dir.join("thumbnails").join(format!("{hash}.png"))
}

const IMAGE_EXTS: [&str; 4] = ["webp", "png", "jpg", "jpeg"];

/// Whether an item named `name` already exists (with any image extension).
fn name_taken(dir: &Path, category: &str, folder: &str, name: &str) -> bool {
    match layout(category) {
        Layout::Folder(..) => base_dir(category).is_some_and(|b| dir.join(b).join(name).exists()),
        _ => IMAGE_EXTS.iter().any(|ext| {
            main_rel(category, folder, name, ext).is_some_and(|rel| dir.join(rel).exists())
        }),
    }
}

/// `name`, or `name 2`, `name 3`… until it's free.
fn unique_name(dir: &Path, category: &str, folder: &str, name: &str) -> String {
    if !name_taken(dir, category, folder, name) {
        return name.to_string();
    }
    (2..)
        .map(|n| format!("{name} {n}"))
        .find(|n| !name_taken(dir, category, folder, n))
        .expect("an unused name")
}

// ---------------------------------------------------------------------------
// Manifest & creation
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMeta {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub keywords: Vec<String>,
}

fn write_manifest(dir: &Path, id: &str, meta: &PackMeta) -> Result<()> {
    let keywords = meta
        .keywords
        .iter()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let version = if meta.version.trim().is_empty() {
        "1.0.0"
    } else {
        meta.version.trim()
    };
    let name = meta.name.trim();
    let manifest = serde_json::json!({
        "name": if name.is_empty() { id } else { name },
        "id": id,
        "version": version,
        "author": meta.author.trim(),
        "keywords": keywords,
        // Lets other map software (like this app) read the exported pack.
        "allow_3rd_party_mapping_software_to_read": true,
    });
    fs::write(dir.join("pack.json"), serde_json::to_vec_pretty(&manifest)?)?;
    Ok(())
}

/// A fresh pack id: 8 hex chars, like Dungeondraft's random ones.
fn new_id(app: &AppHandle) -> Result<String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    for salt in 0u32.. {
        let hash = format!("{:x}", md5::compute(format!("{nanos}-{salt}").as_bytes()));
        let id = hash[..8].to_string();
        if !pack_dir(app, &id)?.exists() {
            return Ok(id);
        }
    }
    unreachable!()
}

/// Refresh a user pack's cached stats and return it as listed.
fn finish(app: &AppHandle, id: &str, enable: bool) -> Result<InstalledPack> {
    let dir = pack_dir(app, id)?;
    let (count, bytes) = dir_stats(&dir);
    let reg = update_registry(app, |reg| {
        let e = reg.entry(id.to_string()).or_default();
        e.user = true;
        e.file_count = Some(count);
        e.size_bytes = Some(bytes);
        if enable {
            e.enabled = true;
        }
        e.clone()
    })?;
    clear_library(app);
    build_installed(app, id, &reg).ok_or_else(|| PackError::NotInstalled(id.to_string()))
}

pub(crate) fn create(app: &AppHandle, meta: &PackMeta) -> Result<InstalledPack> {
    let _g = lock();
    let id = new_id(app)?;
    let dir = pack_dir(app, &id)?;
    fs::create_dir_all(dir.join("textures"))?;
    fs::create_dir_all(dir.join("data"))?;
    write_manifest(&dir, &id, meta)?;
    update_registry(app, |reg| {
        reg.insert(
            id.clone(),
            PackReg {
                user: true,
                ..PackReg::default()
            },
        )
    })?;
    finish(app, &id, true)
}

/// The pack's folder, if it's a user pack (anything else is read-only).
fn editable_dir(app: &AppHandle, id: &str) -> Result<PathBuf> {
    if !read_registry(app).get(id).is_some_and(|r| r.user) {
        return Err(PackError::Other(format!("pack '{id}' is not editable")));
    }
    let dir = pack_dir(app, id)?;
    if !dir.is_dir() {
        return Err(PackError::NotInstalled(id.to_string()));
    }
    Ok(dir)
}

pub(crate) fn update_meta(app: &AppHandle, id: &str, meta: &PackMeta) -> Result<InstalledPack> {
    let _g = lock();
    let dir = editable_dir(app, id)?;
    write_manifest(&dir, id, meta)?;
    finish(app, id, false)
}

// ---------------------------------------------------------------------------
// Tags & definitions
// ---------------------------------------------------------------------------

/// Read a pack's tags file as tag → paths (order kept for stable output).
fn read_tags(dir: &Path, pack_id: &str) -> HashMap<String, BTreeSet<String>> {
    let text = fs::read_to_string(dir.join(TAGS_FILE)).unwrap_or_default();
    let mut map: HashMap<String, BTreeSet<String>> = parse_tags(pack_id, &text)
        .into_iter()
        .map(|(k, v)| (k, v.into_iter().collect()))
        .collect();
    // parse_tags leaves Colorable out (it isn't a browsable group): read it too.
    let colorable = colorable_paths(&text);
    if !colorable.is_empty() {
        map.insert(COLORABLE_TAG.to_string(), colorable);
    }
    map
}

fn colorable_paths(text: &str) -> BTreeSet<String> {
    serde_json::from_str::<serde_json::Value>(&strip_trailing_commas(text))
        .ok()
        .and_then(|v| v.get("tags")?.get(COLORABLE_TAG)?.as_array().cloned())
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn write_tags(dir: &Path, tags: &HashMap<String, BTreeSet<String>>) -> Result<()> {
    let mut obj = serde_json::Map::new();
    let mut names: Vec<&String> = tags.keys().collect();
    names.sort();
    for name in names {
        let paths = &tags[name];
        if !paths.is_empty() {
            obj.insert(name.clone(), serde_json::json!(paths));
        }
    }
    let file = serde_json::json!({ "tags": obj, "sets": {} });
    fs::create_dir_all(dir.join("data"))?;
    fs::write(dir.join(TAGS_FILE), serde_json::to_vec_pretty(&file)?)?;
    Ok(())
}

/// Set an asset's tags (and Colorable flag), replacing what it had.
fn set_asset_tags(
    tags: &mut HashMap<String, BTreeSet<String>>,
    rel: &str,
    names: &[String],
    colorable: bool,
) {
    for paths in tags.values_mut() {
        paths.remove(rel);
    }
    for name in names {
        let name = name.trim();
        if name.is_empty() || name == COLORABLE_TAG {
            continue;
        }
        tags.entry(name.to_string())
            .or_default()
            .insert(rel.to_string());
    }
    if colorable {
        tags.entry(COLORABLE_TAG.to_string())
            .or_default()
            .insert(rel.to_string());
    }
    tags.retain(|_, p| !p.is_empty());
}

fn tags_of(tags: &HashMap<String, BTreeSet<String>>, rel: &str) -> Vec<String> {
    let mut out: Vec<String> = tags
        .iter()
        .filter(|(n, p)| n.as_str() != COLORABLE_TAG && p.contains(rel))
        .map(|(n, _)| n.clone())
        .collect();
    out.sort();
    out
}

fn def_dir(category: &str) -> Option<(&'static str, &'static str)> {
    match category {
        "tilesets" => Some(("data/tilesets", "dungeondraft_tileset")),
        "walls" => Some(("data/walls", "dungeondraft_wall")),
        _ => None,
    }
}

/// Godot's `AARRGGBB` from `#rrggbb[aa]` (white when missing or invalid).
pub(crate) fn to_godot_color(color: Option<&str>) -> String {
    let h = color
        .map(|c| c.trim().trim_start_matches('#').to_ascii_lowercase())
        .filter(|h| h.chars().all(|c| c.is_ascii_hexdigit()));
    match h.as_deref() {
        Some(h) if h.len() == 6 => format!("ff{h}"),
        Some(h) if h.len() == 8 => format!("{}{}", &h[6..], &h[..6]),
        _ => "ffffffff".to_string(),
    }
}

/// Remove the definitions (tileset/wall) that point at `rel`.
fn remove_defs(dir: &Path, pack_id: &str, category: &str, rel: &str) {
    let Some((sub, ext)) = def_dir(category) else {
        return;
    };
    let target = res_path(pack_id, rel);
    let Ok(rd) = fs::read_dir(dir.join(sub)) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some(ext) {
            continue;
        }
        let points_here = fs::read_to_string(&path)
            .ok()
            .and_then(|t| {
                serde_json::from_str::<serde_json::Value>(&strip_trailing_commas(&t)).ok()
            })
            .and_then(|v| v.get("path")?.as_str().map(|p| p == target || p == rel))
            .unwrap_or(false);
        if points_here {
            let _ = fs::remove_file(path);
        }
    }
}

/// Write a tileset's or wall's definition (replacing an older one).
fn write_def(
    dir: &Path,
    pack_id: &str,
    category: &str,
    rel: &str,
    name: &str,
    color: Option<&str>,
    custom_color: bool,
) -> Result<()> {
    let Some((sub, ext)) = def_dir(category) else {
        return Ok(());
    };
    remove_defs(dir, pack_id, category, rel);
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    let mut file = dir.join(sub).join(format!("{slug}.{ext}"));
    let mut n = 2;
    while file.exists() {
        file = dir.join(sub).join(format!("{slug}_{n}.{ext}"));
        n += 1;
    }
    let mut def = serde_json::json!({
        "path": res_path(pack_id, rel),
        "color": to_godot_color(color),
    });
    if category == "tilesets" {
        def["name"] = serde_json::json!(name);
        def["type"] = serde_json::json!(if custom_color {
            "custom_color"
        } else {
            "normal"
        });
    }
    fs::create_dir_all(dir.join(sub))?;
    fs::write(file, serde_json::to_vec_pretty(&def)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Import previews
// ---------------------------------------------------------------------------

/// Where import previews are written (served through the asset protocol, so
/// the webview loads and frees them natively instead of holding data URLs).
fn previews_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PackError::Other(e.to_string()))?
        .join("import-previews");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Longest side of an import preview.
const PREVIEW_SIDE: u32 = 384;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    /// Absolute path of the small preview PNG.
    path: String,
    width: u32,
    height: u32,
    /// Opaque content inside the image (x, y, w, h), for trimming.
    bounds: Option<[u32; 4]>,
    /// No transparent pixel at all.
    opaque: bool,
    /// Size of the source file.
    size_bytes: u64,
}

pub(crate) fn preview(app: &AppHandle, source: &str) -> Result<ImportPreview> {
    let file = open_pack_source(source)?;
    let size_bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
    let img = optimize::decode_file(file)?;
    let (width, height) = img.dimensions();
    let bounds = optimize::opaque_bounds(&img).map(|(x, y, w, h)| [x, y, w, h]);
    let opaque = optimize::is_opaque(&img);
    let small = optimize::shrink(&img, PREVIEW_SIDE);
    drop(img);
    let hash = format!("{:x}", md5::compute(source.as_bytes()));
    let path = previews_dir(app)?.join(format!("{hash}.png"));
    small
        .save(&path)
        .map_err(|e| PackError::Other(e.to_string()))?;
    Ok(ImportPreview {
        path: path.to_string_lossy().into_owned(),
        width,
        height,
        bounds,
        opaque,
        size_bytes,
    })
}

pub(crate) fn clear_previews(app: &AppHandle) {
    if let Ok(dir) = previews_dir(app) {
        let _ = fs::remove_dir_all(&dir);
    }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    /// Main image (a path, or a `content://` URI on Android).
    pub source: String,
    pub category: String,
    pub name: String,
    /// Objects only: subfolder inside `textures/objects`.
    #[serde(default)]
    pub folder: String,
    /// Extra part → its image (a wall's "end", a cave's "wall"…).
    #[serde(default)]
    pub parts: HashMap<String, String>,
    #[serde(default)]
    pub adjust: Adjust,
    #[serde(default)]
    pub colorable: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Default tint (walls, tilesets).
    pub color: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    name: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Asset ids (`<pack>|<rel>`) of what was imported, in order.
    imported: Vec<String>,
    failed: Vec<ImportFailure>,
    pack: InstalledPack,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress<'a> {
    name: &'a str,
    index: usize,
    total: usize,
}

/// Emits at most a few progress events a second (each one is a webview task).
struct Throttle(Option<Instant>);

impl Throttle {
    fn due(&mut self, last: bool) -> bool {
        let now = Instant::now();
        if last
            || self
                .0
                .is_none_or(|t| now.duration_since(t) >= Duration::from_millis(120))
        {
            self.0 = Some(now);
            return true;
        }
        false
    }
}

/// Decode, adjust and encode one image (each part goes through here).
fn process(source: &str, adjust: &Adjust) -> Result<image::RgbaImage> {
    let img = optimize::decode_file(open_pack_source(source)?)?;
    Ok(optimize::apply(img, adjust))
}

fn import_one(
    dir: &Path,
    pack_id: &str,
    item: &ImportItem,
    quality: Quality,
    tags: &mut HashMap<String, BTreeSet<String>>,
) -> Result<String> {
    let category = item.category.as_str();
    if base_dir(category).is_none() {
        return Err(PackError::Other(format!("unknown category '{category}'")));
    }
    let folder = if category == "objects" {
        clean_folder(&item.folder)
    } else {
        String::new()
    };
    let name = unique_name(dir, category, &folder, &clean_name(&item.name));
    // Parts in a fixed order, main first; each decoded and dropped in turn
    // before encoding keeps at most one item's images in memory.
    let parts: Vec<&str> = part_names(category)
        .into_iter()
        .filter(|p| item.parts.get(*p).is_some_and(|s| !s.is_empty()))
        .collect();
    let mut images = vec![process(&item.source, &item.adjust)?];
    for p in &parts {
        images.push(process(&item.parts[*p], &item.adjust)?);
    }
    let colorable =
        item.colorable && matches!(category, "objects" | "portals" | "paths" | "tilesets");
    // All WebP: the parts share the main texture's extension, as the
    // renderer derives their paths from it.
    let encoded = images
        .iter()
        .map(|img| optimize::encode(img, quality, colorable))
        .collect::<Result<Vec<_>>>()?;
    drop(images);
    let ext = encoded[0].ext;
    let main = main_rel(category, &folder, &name, ext)
        .ok_or_else(|| PackError::Other("bad path".into()))?;
    let rels: Vec<String> = std::iter::once(main.clone())
        .chain(parts.iter().map(|p| part_rel(category, &main, p)))
        .collect();
    for (rel, enc) in rels.iter().zip(&encoded) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, &enc.bytes)?;
    }
    let full = dir.join(&main);
    thumbs::generate(
        &full,
        &thumb_path(dir, pack_id, &main),
        thumbs::rule_for(&main),
    );
    // Tilesets are colorable through their definition, not the tag.
    set_asset_tags(tags, &main, &item.tags, colorable && category != "tilesets");
    write_def(
        dir,
        pack_id,
        category,
        &main,
        &name,
        item.color.as_deref(),
        colorable && category == "tilesets",
    )?;
    Ok(format!("{pack_id}|{main}"))
}

pub(crate) fn import(
    app: &AppHandle,
    pack_id: &str,
    items: &[ImportItem],
    quality: Quality,
) -> Result<ImportReport> {
    let _g = lock();
    let dir = editable_dir(app, pack_id)?;
    let mut tags = read_tags(&dir, pack_id);
    let mut imported = Vec::new();
    let mut failed = Vec::new();
    let mut throttle = Throttle(None);
    let total = items.len();
    for (i, item) in items.iter().enumerate() {
        if throttle.due(i + 1 == total) {
            let _ = app.emit(
                "user-pack-import-progress",
                ImportProgress {
                    name: &item.name,
                    index: i + 1,
                    total,
                },
            );
        }
        match import_one(&dir, pack_id, item, quality, &mut tags) {
            Ok(id) => imported.push(id),
            Err(e) => failed.push(ImportFailure {
                name: item.name.clone(),
                error: e.to_string(),
            }),
        }
    }
    write_tags(&dir, &tags)?;
    // Importing into a pack is to use it: turn it on if it was off.
    let pack = finish(app, pack_id, true)?;
    Ok(ImportReport {
        imported,
        failed,
        pack,
    })
}

// ---------------------------------------------------------------------------
// Inspecting & editing assets
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAssetInfo {
    id: String,
    category: String,
    name: String,
    folder: String,
    /// Absolute path of the main texture (for its preview).
    path: String,
    /// Main texture size in px (256 px = one cell).
    width: u32,
    height: u32,
    /// Bytes on disk, all parts together.
    size_bytes: u64,
    /// Parts present besides the main texture.
    parts: Vec<String>,
    colorable: bool,
    tags: Vec<String>,
    color: Option<String>,
}

/// Split an asset id of an editable pack, checking it exists.
fn locate_asset(app: &AppHandle, id: &str) -> Result<(String, PathBuf, String, &'static str)> {
    let (pack_id, rel) = split_asset_id(id).ok_or(PackError::UnsafePath)?;
    let dir = editable_dir(app, pack_id)?;
    let (category, _, _) = parse_main_rel(rel).ok_or(PackError::UnsafePath)?;
    if !dir.join(rel).is_file() || !dir.join(rel).starts_with(&dir) {
        return Err(PackError::Other(format!("asset '{id}' not found")));
    }
    Ok((pack_id.to_string(), dir, rel.to_string(), category))
}

pub(crate) fn asset_info(app: &AppHandle, id: &str) -> Result<UserAssetInfo> {
    let (pack_id, dir, rel, category) = locate_asset(app, id)?;
    let (_, name, folder) = parse_main_rel(&rel).ok_or(PackError::UnsafePath)?;
    let (width, height) =
        image::image_dimensions(dir.join(&rel)).map_err(|e| PackError::Other(e.to_string()))?;
    let files = item_files(&dir, category, &rel);
    let size_bytes = files
        .iter()
        .filter_map(|f| fs::metadata(dir.join(f)).ok())
        .map(|m| m.len())
        .sum();
    let tags = read_tags(&dir, &pack_id);
    let def = def_for(&pack_asset_defs(app, &pack_id), &rel);
    Ok(UserAssetInfo {
        id: id.to_string(),
        category: category.to_string(),
        name,
        folder,
        path: dir.join(&rel).to_string_lossy().into_owned(),
        width,
        height,
        size_bytes,
        parts: files[1..]
            .iter()
            .filter_map(|f| {
                part_names(category)
                    .into_iter()
                    .find(|p| part_rel(category, &rel, p) == *f)
                    .map(str::to_string)
            })
            .collect(),
        colorable: def.custom_color || pack_colorable_set(app, &pack_id).contains(&rel),
        tags: tags_of(&tags, &rel),
        color: def.default_color,
    })
}

/// What an edit changes (absent fields stay as they are).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetEdit {
    pub name: Option<String>,
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub colorable: Option<bool>,
    /// Some(None) clears the default color.
    #[serde(default, with = "double_option")]
    pub color: Option<Option<String>>,
    /// Re-process the stored textures (resize, rotate…).
    pub adjust: Option<Adjust>,
}

/// Tells "absent" from `null` for `color`.
mod double_option {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<String>>, D::Error> {
        Option::<String>::deserialize(d).map(Some)
    }
}

/// Re-encode an adjusted texture in its own format, so its path (and every
/// map that uses it) stays the same. WebP (what imports write) is optimized
/// again; other formats are kept as they are named.
fn reencode_in_place(path: &Path, adjust: &Adjust, exact: bool) -> Result<()> {
    let img = optimize::apply(optimize::decode_file(fs::File::open(path)?)?, adjust);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let saved = match ext.as_str() {
        "webp" => {
            fs::write(
                path,
                optimize::encode(&img, Quality::Balanced, exact)?.bytes,
            )?;
            Ok(())
        }
        "jpg" | "jpeg" => image::DynamicImage::ImageRgba8(img)
            .into_rgb8()
            .save_with_format(path, image::ImageFormat::Jpeg),
        _ => img.save_with_format(path, image::ImageFormat::Png),
    };
    saved.map_err(|e| PackError::Other(e.to_string()))
}

/// Result of an edit: the asset's (maybe new) id and the files rewritten in
/// place, whose cached images the frontend must reload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    id: String,
    changed_files: Vec<String>,
    pack: InstalledPack,
}

pub(crate) fn edit(app: &AppHandle, id: &str, edit: &AssetEdit) -> Result<EditResult> {
    let _g = lock();
    let (pack_id, dir, mut rel, category) = locate_asset(app, id)?;
    let (_, old_name, old_folder) = parse_main_rel(&rel).ok_or(PackError::UnsafePath)?;
    let mut tags = read_tags(&dir, &pack_id);
    let defs = pack_asset_defs(app, &pack_id);
    let def = def_for(&defs, &rel);
    let old_tags = tags_of(&tags, &rel);
    let was_colorable =
        def.custom_color || tags.get(COLORABLE_TAG).is_some_and(|s| s.contains(&rel));
    let mut changed_files = Vec::new();

    if let Some(adjust) = &edit.adjust {
        for f in item_files(&dir, category, &rel) {
            let path = dir.join(&f);
            reencode_in_place(&path, adjust, edit.colorable.unwrap_or(was_colorable))?;
            changed_files.push(path.to_string_lossy().into_owned());
        }
        let thumb = thumb_path(&dir, &pack_id, &rel);
        let _ = fs::remove_file(&thumb);
        thumbs::generate(&dir.join(&rel), &thumb, thumbs::rule_for(&rel));
        changed_files.push(thumb.to_string_lossy().into_owned());
    }

    // Rename / move: every file of the item goes to its new path.
    let name = edit
        .name
        .as_deref()
        .map(clean_name)
        .unwrap_or(old_name.clone());
    let folder = match (&edit.folder, category) {
        (Some(f), "objects") => clean_folder(f),
        _ => old_folder.clone(),
    };
    if name != old_name || folder != old_folder {
        let ext = rel.rsplit_once('.').map_or("png", |(_, e)| e).to_string();
        let free = unique_name(&dir, category, &folder, &name);
        let new_main = main_rel(category, &folder, &free, &ext).ok_or(PackError::UnsafePath)?;
        let old_files = item_files(&dir, category, &rel);
        for f in &old_files {
            let target = if *f == rel {
                new_main.clone()
            } else {
                let part = part_names(category)
                    .into_iter()
                    .find(|p| part_rel(category, &rel, p) == *f)
                    .unwrap_or("");
                part_rel(category, &new_main, part)
            };
            let to = dir.join(&target);
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(dir.join(f), &to)?;
        }
        if let Some(old_dir) = item_folder(category, &rel) {
            let _ = fs::remove_dir(dir.join(old_dir));
        }
        let _ = fs::remove_file(thumb_path(&dir, &pack_id, &rel));
        thumbs::generate(
            &dir.join(&new_main),
            &thumb_path(&dir, &pack_id, &new_main),
            thumbs::rule_for(&new_main),
        );
        // Tags and definitions follow the new path.
        for paths in tags.values_mut() {
            if paths.remove(&rel) {
                paths.insert(new_main.clone());
            }
        }
        remove_defs(&dir, &pack_id, category, &rel);
        remove_empty_dirs(&dir.join("textures"));
        rel = new_main;
    }

    let colorable = edit.colorable.unwrap_or(was_colorable)
        && matches!(category, "objects" | "portals" | "paths" | "tilesets");
    let new_tags = edit.tags.clone().unwrap_or(old_tags);
    set_asset_tags(
        &mut tags,
        &rel,
        &new_tags,
        colorable && category != "tilesets",
    );
    write_tags(&dir, &tags)?;
    let color = match &edit.color {
        Some(c) => c.clone(),
        None => def.default_color.clone(),
    };
    write_def(
        &dir,
        &pack_id,
        category,
        &rel,
        &name,
        color.as_deref(),
        colorable && category == "tilesets",
    )?;
    let pack = finish(app, &pack_id, false)?;
    Ok(EditResult {
        id: format!("{pack_id}|{rel}"),
        changed_files,
        pack,
    })
}

/// Remove folders left empty (after moving or deleting assets).
fn remove_empty_dirs(dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(dir) else {
        return false;
    };
    let mut empty = true;
    for entry in rd.flatten() {
        let p = entry.path();
        if !(p.is_dir() && remove_empty_dirs(&p) && fs::remove_dir(&p).is_ok()) {
            empty = false;
        }
    }
    empty
}

pub(crate) fn delete(app: &AppHandle, ids: &[String]) -> Result<Option<InstalledPack>> {
    let _g = lock();
    let mut touched: Option<String> = None;
    let mut by_pack: HashMap<String, Vec<String>> = HashMap::new();
    for id in ids {
        if let Some((p, rel)) = split_asset_id(id) {
            by_pack
                .entry(p.to_string())
                .or_default()
                .push(rel.to_string());
        }
    }
    for (pack_id, rels) in by_pack {
        let dir = editable_dir(app, &pack_id)?;
        let mut tags = read_tags(&dir, &pack_id);
        for rel in rels {
            let Some((category, _, _)) = parse_main_rel(&rel) else {
                continue;
            };
            if !dir.join(&rel).starts_with(&dir) {
                continue;
            }
            for f in item_files(&dir, category, &rel) {
                let _ = fs::remove_file(dir.join(f));
            }
            if let Some(d) = item_folder(category, &rel) {
                let _ = fs::remove_dir(dir.join(d));
            }
            let _ = fs::remove_file(thumb_path(&dir, &pack_id, &rel));
            for paths in tags.values_mut() {
                paths.remove(&rel);
            }
            remove_defs(&dir, &pack_id, category, &rel);
        }
        tags.retain(|_, p| !p.is_empty());
        write_tags(&dir, &tags)?;
        remove_empty_dirs(&dir.join("textures"));
        touched = Some(pack_id);
    }
    touched.map(|id| finish(app, &id, false)).transpose()
}

/// What the editor offers to reuse: the pack's objects subfolders and tags.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPackInfo {
    folders: Vec<String>,
    tags: Vec<String>,
    /// Items per category.
    counts: HashMap<String, usize>,
}

pub(crate) fn pack_info(app: &AppHandle, id: &str) -> Result<UserPackInfo> {
    let dir = editable_dir(app, id)?;
    let mut folders = BTreeSet::new();
    let mut counts = HashMap::new();
    for category in [
        "objects",
        "portals",
        "paths",
        "lights",
        "terrain",
        "walls",
        "tilesets",
        "materials",
        "caves",
        "roofs",
    ] {
        let Some(base) = base_dir(category) else {
            continue;
        };
        let mut n = 0;
        let mut stack = vec![dir.join(base)];
        while let Some(d) = stack.pop() {
            let Ok(rd) = fs::read_dir(&d) else { continue };
            for entry in rd.flatten() {
                let p = entry.path();
                let rel = p
                    .strip_prefix(&dir)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                if p.is_dir() {
                    if category == "objects" {
                        folders.insert(rel[base.len() + 1..].to_string());
                    }
                    stack.push(p);
                } else if parse_main_rel(&rel).is_some_and(|(_, name, _)| {
                    // Count main textures only (not parts).
                    is_main(category, &rel, &name)
                }) {
                    n += 1;
                }
            }
        }
        counts.insert(category.to_string(), n);
    }
    let tags = read_tags(&dir, id)
        .into_keys()
        .filter(|t| t != COLORABLE_TAG)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(UserPackInfo {
        folders: folders.into_iter().collect(),
        tags,
        counts,
    })
}

/// Whether `rel` is an item's main texture (not one of its parts).
fn is_main(category: &str, rel: &str, name: &str) -> bool {
    let ext = rel.rsplit_once('.').map_or("", |(_, e)| e);
    let folder = parse_main_rel(rel).map(|(_, _, f)| f).unwrap_or_default();
    main_rel(category, &folder, name, ext).as_deref() == Some(rel)
        && !(category == "walls" && name.to_ascii_lowercase().ends_with("_end"))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportProgress {
    index: usize,
    total: usize,
}

/// Every file of the pack as it goes into the `.dungeondraft_pack`.
fn export_files(dir: &Path, id: &str) -> Vec<PckFile> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let rel = p
                .strip_prefix(dir)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(PckFile {
                res_path: res_path(id, &rel),
                source: p,
                size,
            });
        }
    }
    out.sort_by(|a, b| a.res_path.cmp(&b.res_path));
    // Dungeondraft also reads the manifest from `res://packs/<id>.json`.
    if let Some(m) = out.iter().find(|f| f.res_path.ends_with("/pack.json")) {
        let root = PckFile {
            res_path: format!("res://packs/{id}.json"),
            source: m.source.clone(),
            size: m.size,
        };
        out.insert(0, root);
    }
    out
}

/// Make the thumbnail of every texture that lacks one (Dungeondraft lists
/// assets by them).
fn ensure_thumbnails(dir: &Path, id: &str) {
    let mut stack = vec![dir.join("textures")];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let rel = p
                .strip_prefix(dir)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            let thumb = thumb_path(dir, id, &rel);
            if !thumb.is_file() {
                thumbs::generate(&p, &thumb, thumbs::rule_for(&rel));
            }
        }
    }
}

fn open_dest(dest: &str) -> Result<fs::File> {
    #[cfg(target_os = "android")]
    {
        if dest.starts_with("content://") {
            return crate::android_fs::open_content_uri(dest, "w").map_err(PackError::Other);
        }
    }
    Ok(fs::File::create(dest)?)
}

pub(crate) fn export(app: &AppHandle, id: &str, dest: &str) -> Result<()> {
    let _g = lock();
    let dir = editable_dir(app, id)?;
    ensure_thumbnails(&dir, id);
    // The manifest must say who may read it; older ones may not.
    let meta = read_installed_manifest(&dir);
    let keywords = super::format::split_keywords(&meta.keywords);
    write_manifest(
        &dir,
        id,
        &PackMeta {
            name: meta.name.unwrap_or_else(|| id.to_string()),
            author: meta.author.unwrap_or_default(),
            version: meta.version.unwrap_or_default(),
            keywords,
        },
    )?;
    let files = export_files(&dir, id);
    let mut out = std::io::BufWriter::new(open_dest(dest)?);
    let mut throttle = Throttle(None);
    write_pck(&mut out, &files, |index, total| {
        if throttle.due(index == total) {
            let _ = app.emit("user-pack-export-progress", ExportProgress { index, total });
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::assetdefs::godot_color;

    #[test]
    fn lays_out_every_category() {
        assert_eq!(
            main_rel("objects", "Furniture", "Chair", "webp").unwrap(),
            "textures/objects/Furniture/Chair.webp"
        );
        assert_eq!(
            main_rel("portals", "ignored", "Door", "png").unwrap(),
            "textures/portals/Door.png"
        );
        assert_eq!(
            main_rel("tilesets", "", "Wood", "jpg").unwrap(),
            "textures/tilesets/simple/Wood.jpg"
        );
        let wall = main_rel("walls", "", "Stone", "webp").unwrap();
        assert_eq!(
            part_rel("walls", &wall, "end"),
            "textures/walls/Stone_end.webp"
        );
        let mat = main_rel("materials", "", "Grass", "webp").unwrap();
        assert_eq!(mat, "textures/materials/Grass_tile.webp");
        assert_eq!(
            part_rel("materials", &mat, "border"),
            "textures/materials/Grass_border.webp"
        );
        let cave = main_rel("caves", "", "Rock", "png").unwrap();
        assert_eq!(cave, "textures/caves/Rock/floor.png");
        assert_eq!(
            part_rel("caves", &cave, "wall"),
            "textures/caves/Rock/wall.png"
        );
        let roof = main_rel("roofs", "", "Slate", "webp").unwrap();
        assert_eq!(
            part_rel("roofs", &roof, "ridge"),
            "textures/roofs/Slate/ridge.webp"
        );
        assert!(main_rel("nope", "", "x", "png").is_none());
    }

    #[test]
    fn parses_main_paths_back() {
        assert_eq!(
            parse_main_rel("textures/objects/Furniture/Big/Chair.webp"),
            Some(("objects", "Chair".into(), "Furniture/Big".into()))
        );
        assert_eq!(
            parse_main_rel("textures/tilesets/simple/Wood.jpg"),
            Some(("tilesets", "Wood".into(), String::new()))
        );
        assert_eq!(
            parse_main_rel("textures/materials/Grass_tile.webp"),
            Some(("materials", "Grass".into(), String::new()))
        );
        assert_eq!(
            parse_main_rel("textures/roofs/Slate/tiles.webp"),
            Some(("roofs", "Slate".into(), String::new()))
        );
        assert_eq!(parse_main_rel("data/x.json"), None);
    }

    #[test]
    fn cleans_names() {
        assert_eq!(clean_name("  my/cool:chair?.png "), "my cool chair .png");
        assert_eq!(clean_name("..."), "Asset");
        assert_eq!(clean_folder("a/../b//c "), "a/b/c");
    }

    #[test]
    fn converts_colors_to_godot() {
        assert_eq!(to_godot_color(Some("#605F58")), "ff605f58");
        assert_eq!(to_godot_color(Some("#11223380")), "80112233");
        assert_eq!(to_godot_color(None), "ffffffff");
        assert_eq!(to_godot_color(Some("zz")), "ffffffff");
        // And back, as the library reads them.
        assert_eq!(
            godot_color(&to_godot_color(Some("#11223380"))),
            Some("#11223380".into())
        );
    }

    #[test]
    fn tags_replace_and_keep_colorable() {
        let mut tags = HashMap::new();
        let rel = "textures/objects/a.webp";
        set_asset_tags(&mut tags, rel, &["Furniture".into(), " ".into()], true);
        assert_eq!(tags_of(&tags, rel), vec!["Furniture"]);
        assert!(tags[COLORABLE_TAG].contains(rel));
        set_asset_tags(&mut tags, rel, &["Plants".into()], false);
        assert_eq!(tags_of(&tags, rel), vec!["Plants"]);
        assert!(!tags.contains_key(COLORABLE_TAG));
        assert!(!tags.contains_key("Furniture"));
    }

    #[test]
    fn tags_file_roundtrips_with_colorable() {
        let dir = std::env::temp_dir().join(format!("o20-tags-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut tags = HashMap::new();
        set_asset_tags(&mut tags, "textures/objects/a.webp", &["X".into()], true);
        write_tags(&dir, &tags).unwrap();
        let back = read_tags(&dir, "p");
        assert_eq!(back, tags);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_are_made_unique_and_defs_follow_paths() {
        let dir = std::env::temp_dir().join(format!("o20-unique-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("textures/walls")).unwrap();
        fs::write(dir.join("textures/walls/Stone.png"), b"x").unwrap();
        assert_eq!(unique_name(&dir, "walls", "", "Stone"), "Stone 2");
        assert_eq!(unique_name(&dir, "walls", "", "Brick"), "Brick");

        let rel = "textures/walls/Stone.png";
        write_def(&dir, "p1", "walls", rel, "Stone", Some("#808080"), false).unwrap();
        let defs: Vec<_> = fs::read_dir(dir.join("data/walls"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(defs.len(), 1);
        let text = fs::read_to_string(defs[0].path()).unwrap();
        assert!(text.contains("res://packs/p1/textures/walls/Stone.png"));
        assert!(text.contains("ff808080"));
        // Rewriting replaces it; removing deletes it.
        write_def(&dir, "p1", "walls", rel, "Stone", None, false).unwrap();
        assert_eq!(fs::read_dir(dir.join("data/walls")).unwrap().count(), 1);
        remove_defs(&dir, "p1", "walls", rel);
        assert_eq!(fs::read_dir(dir.join("data/walls")).unwrap().count(), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn imports_an_item_with_parts() {
        let dir = std::env::temp_dir().join(format!("o20-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src");
        fs::create_dir_all(&src).unwrap();
        let wall = src.join("wall.png");
        let cap = src.join("cap.png");
        image::RgbaImage::from_pixel(512, 64, image::Rgba([90, 90, 90, 255]))
            .save(&wall)
            .unwrap();
        image::RgbaImage::from_pixel(64, 64, image::Rgba([90, 90, 90, 128]))
            .save(&cap)
            .unwrap();
        let pack = dir.join("pack");
        fs::create_dir_all(&pack).unwrap();
        let item = ImportItem {
            source: wall.to_string_lossy().into_owned(),
            category: "walls".into(),
            name: "Grey".into(),
            folder: String::new(),
            parts: HashMap::from([("end".to_string(), cap.to_string_lossy().into_owned())]),
            adjust: Adjust {
                scale: 0.5,
                ..Default::default()
            },
            colorable: false,
            tags: vec!["Stone".into()],
            color: Some("#aabbcc".into()),
        };
        let mut tags = HashMap::new();
        let id = import_one(&pack, "pk", &item, Quality::Balanced, &mut tags).unwrap();
        // The cap has alpha, so both are WebP (one shared extension).
        assert_eq!(id, "pk|textures/walls/Grey.webp");
        let main = pack.join("textures/walls/Grey.webp");
        assert_eq!(image::image_dimensions(&main).unwrap(), (256, 32));
        assert!(pack.join("textures/walls/Grey_end.webp").is_file());
        assert!(thumb_path(&pack, "pk", "textures/walls/Grey.webp").is_file());
        assert_eq!(tags_of(&tags, "textures/walls/Grey.webp"), vec!["Stone"]);
        assert_eq!(
            item_files(&pack, "walls", "textures/walls/Grey.webp").len(),
            2
        );
        assert!(is_main("walls", "textures/walls/Grey.webp", "Grey"));
        assert!(!is_main(
            "walls",
            "textures/walls/Grey_end.webp",
            "Grey_end"
        ));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn export_lists_the_root_manifest_first() {
        let dir = std::env::temp_dir().join(format!("o20-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("textures/objects")).unwrap();
        fs::write(dir.join("pack.json"), b"{}").unwrap();
        fs::write(dir.join("textures/objects/a.webp"), b"xx").unwrap();
        let files = export_files(&dir, "id1");
        let paths: Vec<&str> = files.iter().map(|f| f.res_path.as_str()).collect();
        assert_eq!(
            paths,
            vec![
                "res://packs/id1.json",
                "res://packs/id1/pack.json",
                "res://packs/id1/textures/objects/a.webp"
            ]
        );
        fs::remove_dir_all(&dir).unwrap();
    }
}
