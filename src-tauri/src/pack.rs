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

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

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

/// One registry.json entry. `file_count`/`size_bytes` are cached at install
/// time so listing never has to walk a (possibly huge) pack tree.
#[derive(Debug, Clone)]
struct PackReg {
    enabled: bool,
    file_count: Option<usize>,
    size_bytes: Option<u64>,
}

impl Default for PackReg {
    fn default() -> Self {
        Self { enabled: true, file_count: None, size_bytes: None }
    }
}

/// Read registry.json into a map. Backward compatible with the old format
/// where each value was a plain bool (enabled) with no cached stats.
fn read_registry(app: &AppHandle) -> HashMap<String, PackReg> {
    let Ok(path) = registry_path(app) else { return HashMap::new() };
    let Ok(text) = fs::read_to_string(path) else { return HashMap::new() };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return HashMap::new();
    };
    let Some(obj) = value.as_object() else { return HashMap::new() };

    let mut map = HashMap::new();
    for (id, v) in obj {
        let reg = match v {
            serde_json::Value::Bool(b) => PackReg { enabled: *b, ..Default::default() },
            serde_json::Value::Object(o) => PackReg {
                enabled: o.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true),
                file_count: o.get("fileCount").and_then(|x| x.as_u64()).map(|n| n as usize),
                size_bytes: o.get("sizeBytes").and_then(|x| x.as_u64()),
            },
            _ => PackReg::default(),
        };
        map.insert(id.clone(), reg);
    }
    map
}

fn write_registry(app: &AppHandle, reg: &HashMap<String, PackReg>) -> Result<()> {
    let path = registry_path(app)?;
    let mut obj = serde_json::Map::new();
    for (id, r) in reg {
        let mut e = serde_json::Map::new();
        e.insert("enabled".into(), serde_json::json!(r.enabled));
        if let Some(fc) = r.file_count {
            e.insert("fileCount".into(), serde_json::json!(fc));
        }
        if let Some(sb) = r.size_bytes {
            e.insert("sizeBytes".into(), serde_json::json!(sb));
        }
        obj.insert(id.clone(), serde_json::Value::Object(e));
    }
    fs::write(path, serde_json::to_vec_pretty(&serde_json::Value::Object(obj))?)?;
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

fn build_installed(app: &AppHandle, id: &str, reg: &PackReg) -> Option<InstalledPack> {
    let dir = pack_dir(app, id).ok()?;
    if !dir.is_dir() {
        return None;
    }
    let manifest = read_installed_manifest(&dir);
    // Use cached stats when available; only walk the tree as a last resort
    // (legacy packs installed before stats were cached).
    let (file_count, size_bytes) = match (reg.file_count, reg.size_bytes) {
        (Some(fc), Some(sb)) => (fc, sb),
        _ => dir_stats(&dir),
    };
    Some(InstalledPack {
        id: id.to_string(),
        name: manifest.name.clone().unwrap_or_else(|| id.to_string()),
        version: manifest.version.clone(),
        author: manifest.author.clone(),
        keywords: split_keywords(&manifest.keywords),
        enabled: reg.enabled,
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

/// Open the source pack for reading.
///
/// On desktop the picker returns a real filesystem path. On Android the Storage
/// Access Framework returns a `content://` URI that has no path, so we resolve
/// it to a file descriptor through the platform ContentResolver and read the
/// pack straight from it — no temporary copy, so disk/time cost matches desktop.
fn open_pack_source(src: &str) -> Result<File> {
    #[cfg(target_os = "android")]
    {
        if src.starts_with("content://") {
            return open_content_uri(src);
        }
    }
    Ok(File::open(src)?)
}

/// Resolve an Android `content://` URI to an owned `File` via a `content://`
/// ParcelFileDescriptor. `detachFd` transfers ownership of the fd to us, so the
/// returned `File` stays valid after the JNI thread detaches.
#[cfg(target_os = "android")]
fn open_content_uri(uri: &str) -> Result<File> {
    use jni::objects::{JObject, JValue};
    use std::os::unix::io::FromRawFd;

    let jni_err = |ctx: &str, e: jni::errors::Error| PackError::Other(format!("{ctx}: {e}"));

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| jni_err("JavaVM", e))?;
    let mut env = vm.attach_current_thread().map_err(|e| jni_err("attach", e))?;
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };

    let resolver = env
        .call_method(&context, "getContentResolver", "()Landroid/content/ContentResolver;", &[])
        .and_then(|v| v.l())
        .map_err(|e| jni_err("getContentResolver", e))?;

    let juri = env.new_string(uri).map_err(|e| jni_err("new_string", e))?;
    let uri_obj = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&juri)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("Uri.parse", e))?;

    let mode = env.new_string("r").map_err(|e| jni_err("new_string", e))?;
    let pfd = env
        .call_method(
            &resolver,
            "openFileDescriptor",
            "(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;",
            &[JValue::Object(&uri_obj), JValue::Object(&mode)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("openFileDescriptor", e))?;
    if pfd.is_null() {
        return Err(PackError::Other("openFileDescriptor returned null".into()));
    }

    let fd = env
        .call_method(&pfd, "detachFd", "()I", &[])
        .and_then(|v| v.i())
        .map_err(|e| jni_err("detachFd", e))?;

    Ok(unsafe { File::from_raw_fd(fd) })
}

/// Extract a single pack file into `app_data/packs/<id>/`, streaming every
/// file through a fixed buffer so memory stays bounded regardless of pack size.
fn install_one(app: &AppHandle, pack_src: &str) -> Result<InstalledPack> {
    let file = open_pack_source(pack_src)?;
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
    let mut total_bytes: u64 = 0;

    for (index, entry) in entries.iter().enumerate() {
        let rel = normalize_res_path(&entry.path, &id);
        // Skip the duplicate manifest copy and any repeats.
        if !written.insert(rel.clone()) {
            continue;
        }
        total_bytes += entry.size;
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

    let reg_entry = PackReg {
        enabled: true,
        file_count: Some(written.len()),
        size_bytes: Some(total_bytes),
    };
    let mut reg = read_registry(app);
    reg.insert(id.clone(), reg_entry.clone());
    write_registry(app, &reg)?;
    clear_library(app);

    build_installed(app, &id, &reg_entry)
        .ok_or_else(|| PackError::Other("install verification failed".into()))
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
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
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

// ---------------------------------------------------------------------------
// Library (asset browser for the Object/Scatter tools, etc.)
// ---------------------------------------------------------------------------
//
// Packs can hold >100k objects, so the library never ships the whole list over
// IPC. A search filters an in-memory, cached per-pack index and stores the
// result set in `LibraryState`; the frontend then pulls only the visible window
// via `get_library_items`. Thumbnails are served through Tauri's asset protocol
// (convertFileSrc) so the webview loads/frees the images natively.

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
    /// The most recent search's results, served in windows.
    results: Mutex<Vec<LibItemLite>>,
}

/// Drop all cached indexes/results (call when packs are added/removed/toggled).
fn clear_library(app: &AppHandle) {
    let state = app.state::<LibraryState>();
    if let Ok(mut idx) = state.indexes.lock() {
        idx.clear();
    }
    if let Ok(mut res) = state.results.lock() {
        res.clear();
    };
}

/// Walk `textures/<category>` of a pack and collect its files.
fn build_category_index(app: &AppHandle, pack_id: &str, category: &str) -> Vec<CacheItem> {
    let Ok(dir) = pack_dir(app, pack_id) else {
        return Vec::new();
    };
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
            let rel = path
                .strip_prefix(&dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let name_lower = name.to_lowercase();
            out.push(CacheItem { rel_path: rel, name, name_lower });
        }
    }
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
#[tauri::command]
pub async fn search_library(
    app: AppHandle,
    category: String,
    query: String,
    exactness: f32,
) -> Result<LibrarySearch> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LibraryState>();
        let reg = read_registry(&app);
        let mut enabled: Vec<String> = reg
            .iter()
            .filter(|(_, r)| r.enabled)
            .map(|(id, _)| id.clone())
            .collect();
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
                    let built = Arc::new(build_category_index(&app, pack_id, &category));
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
        *state.results.lock().unwrap() = results;
        Ok(LibrarySearch { total })
    })
    .await
    .map_err(|e| PackError::Other(e.to_string()))?
}

/// Fetch a window of the current search results, resolving thumbnail paths.
#[tauri::command]
pub fn get_library_items(app: AppHandle, offset: usize, limit: usize) -> Result<Vec<LibItem>> {
    let state = app.state::<LibraryState>();
    let results = state.results.lock().unwrap();
    if offset >= results.len() {
        return Ok(Vec::new());
    }
    let end = (offset + limit).min(results.len());
    let mut out = Vec::with_capacity(end - offset);
    for lite in &results[offset..end] {
        let dir = pack_dir(&app, &lite.pack_id)?;
        let res_path = format!("res://packs/{}/{}", lite.pack_id, lite.rel_path);
        let hash = format!("{:x}", md5::compute(res_path.as_bytes()));
        let thumb = dir.join("thumbnails").join(format!("{hash}.png"));
        // Some packs ship no pre-baked thumbnails; fall back to the texture
        // itself (the webview scales it down to the cell size).
        let image = if thumb.is_file() {
            thumb
        } else {
            dir.join(&lite.rel_path)
        };
        out.push(LibItem {
            id: format!("{}|{}", lite.pack_id, lite.rel_path),
            name: lite.name.clone(),
            thumb: image.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}
