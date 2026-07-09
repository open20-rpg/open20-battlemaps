//! Reading, installing and querying Dungeondraft asset packs.
//!
//! A `.dungeondraft_pack` file is a Godot 3.x PCK archive (magic `GDPC`,
//! pack format version 1, little-endian). Layout:
//!
//! ```text
//! Header (88 bytes):
//!   0x00  u32   magic = "GDPC" (0x43504447)
//!   0x04  u32   pack_format_version (1)
//!   0x08  u32   version_major
//!   0x0C  u32   version_minor
//!   0x10  u32   version_patch
//!   0x14  u32[16] reserved (zeroed)
//!   0x54  u32   file_count
//! Per file entry (repeated file_count times):
//!   u32        path_length (exact, no padding in format v1)
//!   u8[len]    path, e.g. "res://packs/<ID>/textures/objects/foo.tex"
//!   u64        offset (absolute, into this same file)
//!   u64        size
//!   u8[16]     md5 (may be all zero)
//! ```
//!
//! Packs can be several GB, so file data is always streamed through a fixed
//! buffer — the whole archive is never held in memory. Only the small index
//! and individual small assets (manifest, thumbnails) are ever fully read.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const MAGIC: u32 = 0x4350_4447; // "GDPC"
const HEADER_SIZE: u64 = 88; // where the file index begins
const COPY_BUF: usize = 1 << 20; // 1 MiB streaming buffer

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum PackError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("not a valid dungeondraft pack (bad magic)")]
    BadMagic,
    #[error("pack has no manifest (pack.json)")]
    NoManifest,
    #[error("could not parse manifest: {0}")]
    Manifest(String),
    #[error("pack '{0}' is not installed")]
    NotInstalled(String),
    #[error("path escapes pack directory")]
    UnsafePath,
    #[error("{0}")]
    Other(String),
}

// Tauri commands need the error serializable.
impl serde::Serialize for PackError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl From<serde_json::Error> for PackError {
    fn from(e: serde_json::Error) -> Self {
        PackError::Other(e.to_string())
    }
}

type Result<T> = std::result::Result<T, PackError>;

// ---------------------------------------------------------------------------
// Data types shared with the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
pub struct Manifest {
    pub name: Option<String>,
    pub id: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    /// Dungeondraft stores keywords as a single comma-separated string.
    pub keywords: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub keywords: Vec<String>,
    pub enabled: bool,
    /// Absolute path of the unpacked pack folder.
    pub path: String,
    /// Number of extracted files.
    pub file_count: usize,
    /// Total size on disk in bytes.
    pub size_bytes: u64,
}

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

/// One entry of the PCK file index.
struct PackEntry {
    path: String,
    offset: u64,
    size: u64,
}

// ---------------------------------------------------------------------------
// Low-level PCK reading
// ---------------------------------------------------------------------------

fn read_u32<R: Read>(r: &mut R) -> io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

/// Parse the header + file index of a pack. Does NOT read any file data.
fn read_index(reader: &mut BufReader<File>) -> Result<Vec<PackEntry>> {
    reader.seek(SeekFrom::Start(0))?;
    if read_u32(reader)? != MAGIC {
        return Err(PackError::BadMagic);
    }
    // pack_format_version + version_major/minor/patch + 16 reserved u32.
    // Skip straight to the file count at offset 0x54.
    reader.seek(SeekFrom::Start(HEADER_SIZE - 4))?;
    let file_count = read_u32(reader)? as usize;

    let mut entries = Vec::with_capacity(file_count);
    for _ in 0..file_count {
        let path_len = read_u32(reader)? as usize;
        let mut path_buf = vec![0u8; path_len];
        reader.read_exact(&mut path_buf)?;
        // Trim any accidental trailing NULs, just in case.
        while path_buf.last() == Some(&0) {
            path_buf.pop();
        }
        let path = String::from_utf8_lossy(&path_buf).into_owned();
        let offset = read_u64(reader)?;
        let size = read_u64(reader)?;
        let mut md5 = [0u8; 16];
        reader.read_exact(&mut md5)?; // consumed but unused
        entries.push(PackEntry { path, offset, size });
    }
    Ok(entries)
}

/// Read a single small entry fully into memory (manifest / thumbnails only).
fn read_entry_bytes(reader: &mut BufReader<File>, entry: &PackEntry) -> Result<Vec<u8>> {
    reader.seek(SeekFrom::Start(entry.offset))?;
    let mut buf = vec![0u8; entry.size as usize];
    reader.read_exact(&mut buf)?;
    Ok(buf)
}

/// Normalise a `res://packs/<id>/...` path into a folder-relative path.
///
/// - `res://packs/<id>.json`   -> `pack.json`
/// - `res://packs/<id>/foo/bar` -> `foo/bar`
/// - anything else: strip a leading `res://`.
fn normalize_res_path(res_path: &str, id: &str) -> String {
    let p = res_path.replace('\\', "/");
    let p = p.strip_prefix("res://").unwrap_or(&p);
    if p == format!("packs/{id}.json") {
        return "pack.json".to_string();
    }
    let folder = format!("packs/{id}/");
    if let Some(rest) = p.strip_prefix(&folder) {
        return rest.to_string();
    }
    // Fallback: some packs may not nest under the id folder.
    p.strip_prefix("packs/").unwrap_or(p).to_string()
}

/// Locate and parse the pack manifest from the index. Prefers the in-folder
/// `pack.json`, falling back to the root `res://packs/<id>.json`.
fn read_manifest(reader: &mut BufReader<File>, entries: &[PackEntry]) -> Result<Manifest> {
    let manifest_entry = entries
        .iter()
        .find(|e| e.path.ends_with("/pack.json"))
        .or_else(|| {
            entries
                .iter()
                .find(|e| e.path.starts_with("res://packs/") && e.path.ends_with(".json"))
        })
        .ok_or(PackError::NoManifest)?;

    let bytes = read_entry_bytes(reader, manifest_entry)?;
    let text = String::from_utf8_lossy(&bytes);
    // Dungeondraft manifests are lenient (JSON5/HuJSON): try strict JSON first,
    // then fall back to json5 for comments / trailing commas.
    let manifest: Manifest = serde_json::from_str(&text)
        .or_else(|_| json5::from_str(&text))
        .map_err(|e| PackError::Manifest(e.to_string()))?;
    Ok(manifest)
}

fn split_keywords(kw: &Option<String>) -> Vec<String> {
    kw.as_deref()
        .map(|s| {
            s.split(',')
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// On-disk layout & registry
// ---------------------------------------------------------------------------

fn packs_root(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PackError::Other(e.to_string()))?
        .join("packs");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn pack_dir(app: &AppHandle, id: &str) -> Result<PathBuf> {
    // `id` comes from a manifest; guard against path traversal.
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(PackError::UnsafePath);
    }
    Ok(packs_root(app)?.join(id))
}

fn registry_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(packs_root(app)?.join("registry.json"))
}

/// registry.json maps pack id -> whether it is enabled.
fn read_registry(app: &AppHandle) -> std::collections::HashMap<String, bool> {
    let path = match registry_path(app) {
        Ok(p) => p,
        Err(_) => return Default::default(),
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_registry(app: &AppHandle, reg: &std::collections::HashMap<String, bool>) -> Result<()> {
    let path = registry_path(app)?;
    fs::write(path, serde_json::to_vec_pretty(reg)?)?;
    Ok(())
}

/// Recursively sum size and count of files under `dir`.
fn dir_stats(dir: &Path) -> (usize, u64) {
    let mut count = 0usize;
    let mut bytes = 0u64;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(md) = entry.metadata() {
                count += 1;
                bytes += md.len();
            }
        }
    }
    (count, bytes)
}

fn read_installed_manifest(dir: &Path) -> Manifest {
    fs::read_to_string(dir.join("pack.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).or_else(|_| json5::from_str(&s)).ok())
        .unwrap_or_default()
}

fn build_installed(app: &AppHandle, id: &str, enabled: bool) -> Option<InstalledPack> {
    let dir = pack_dir(app, id).ok()?;
    if !dir.is_dir() {
        return None;
    }
    let manifest = read_installed_manifest(&dir);
    let (file_count, size_bytes) = dir_stats(&dir);
    Some(InstalledPack {
        id: id.to_string(),
        name: manifest.name.clone().unwrap_or_else(|| id.to_string()),
        version: manifest.version.clone(),
        author: manifest.author.clone(),
        keywords: split_keywords(&manifest.keywords),
        enabled,
        path: dir.to_string_lossy().into_owned(),
        file_count,
        size_bytes,
    })
}

// ---------------------------------------------------------------------------
// Installation (streaming extraction)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    pack: &'a str,
    file_name: &'a str,
    index: usize,
    total: usize,
    percent: u8,
}

/// Extract a single pack file into `app_data/packs/<id>/`, streaming every
/// file through a fixed buffer so memory stays bounded regardless of pack size.
fn install_one(app: &AppHandle, pack_path: &Path) -> Result<InstalledPack> {
    let file = File::open(pack_path)?;
    let mut reader = BufReader::new(file);
    let entries = read_index(&mut reader)?;

    let manifest = read_manifest(&mut reader, &entries)?;
    let id = manifest
        .id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PackError::Manifest("manifest has no id".into()))?;

    let dest = pack_dir(app, &id)?;
    // Reinstall cleanly.
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    fs::create_dir_all(&dest)?;

    let pack_name = manifest.name.clone().unwrap_or_else(|| id.clone());
    let total = entries.len();
    let mut copy_buf = vec![0u8; COPY_BUF];
    let mut written: HashSet<String> = HashSet::new();

    for (index, entry) in entries.iter().enumerate() {
        let rel = normalize_res_path(&entry.path, &id);
        // Skip the duplicate manifest copy and any repeats.
        if !written.insert(rel.clone()) {
            continue;
        }
        let out_path = dest.join(&rel);
        // Safety: ensure we stay inside dest.
        if !out_path.starts_with(&dest) {
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        reader.seek(SeekFrom::Start(entry.offset))?;
        let mut out = BufWriter::new(File::create(&out_path)?);
        let mut remaining = entry.size;
        while remaining > 0 {
            let n = remaining.min(COPY_BUF as u64) as usize;
            reader.read_exact(&mut copy_buf[..n])?;
            out.write_all(&copy_buf[..n])?;
            remaining -= n as u64;
        }
        out.flush()?;

        let percent = (((index + 1) as f64 / total as f64) * 100.0) as u8;
        let _ = app.emit(
            "pack-install-progress",
            InstallProgress {
                pack: &pack_name,
                file_name: &rel,
                index: index + 1,
                total,
                percent,
            },
        );
    }

    let mut reg = read_registry(app);
    reg.insert(id.clone(), true);
    write_registry(app, &reg)?;

    build_installed(app, &id, true).ok_or_else(|| PackError::Other("install verification failed".into()))
}

// ---------------------------------------------------------------------------
// Image loading helpers
// ---------------------------------------------------------------------------

fn mime_for(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_string()
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

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Install (unpack) one or more `.dungeondraft_pack` files. Runs on a blocking
/// thread so the UI stays responsive; emits `pack-install-progress` events.
#[tauri::command]
pub async fn install_packs(app: AppHandle, paths: Vec<String>) -> Result<Vec<InstalledPack>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut installed = Vec::new();
        for p in &paths {
            let pack = install_one(&app, Path::new(p))?;
            installed.push(pack);
        }
        Ok(installed)
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// List every installed pack (reading its manifest from disk).
#[tauri::command]
pub fn list_installed(app: AppHandle) -> Result<Vec<InstalledPack>> {
    let reg = read_registry(&app);
    let root = packs_root(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&root)?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let enabled = reg.get(&id).copied().unwrap_or(true);
        if let Some(pack) = build_installed(&app, &id, enabled) {
            out.push(pack);
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Delete a pack from disk and free its resources.
#[tauri::command]
pub fn uninstall_pack(app: AppHandle, id: String) -> Result<()> {
    let dir = pack_dir(&app, &id)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir)?;
    }
    let mut reg = read_registry(&app);
    reg.remove(&id);
    write_registry(&app, &reg)?;
    Ok(())
}

/// Enable or disable a pack (toggles a flag; files stay on disk).
#[tauri::command]
pub fn set_pack_enabled(app: AppHandle, id: String, enabled: bool) -> Result<()> {
    if !pack_dir(&app, &id)?.is_dir() {
        return Err(PackError::NotInstalled(id));
    }
    let mut reg = read_registry(&app);
    reg.insert(id, enabled);
    write_registry(&app, &reg)?;
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
            out.push(AssetInfo { rel_path: rel, category, size_bytes });
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
        Ok(LoadedImage { mime: mime_for(&full), data })
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
    Ok(Some(LoadedImage { mime: "image/png".to_string(), data }))
}
