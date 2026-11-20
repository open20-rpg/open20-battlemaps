//! On-disk layout & persistent registry of installed packs.
//!
//! `file_count`/`size_bytes` are cached at install time in `registry.json`
//! so listing never has to walk a (possibly huge) pack tree.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::format::{split_keywords, Manifest};
use super::{PackError, Result};

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
    /// Created in the app (not installed from a file): only these can be
    /// edited and exported.
    pub editable: bool,
    /// Its images were optimized (see `compress.rs`) since it was installed.
    pub optimized: bool,
}

pub(crate) fn packs_root(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PackError::Other(e.to_string()))?
        .join("packs");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub(crate) fn pack_dir(app: &AppHandle, id: &str) -> Result<PathBuf> {
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
pub(crate) struct PackReg {
    pub(crate) enabled: bool,
    pub(crate) file_count: Option<usize>,
    pub(crate) size_bytes: Option<u64>,
    /// A pack the user created in the app (see `userpack.rs`).
    pub(crate) user: bool,
    /// Its images were optimized (see `compress.rs`).
    pub(crate) optimized: bool,
}

impl Default for PackReg {
    fn default() -> Self {
        Self {
            enabled: true,
            file_count: None,
            size_bytes: None,
            user: false,
            optimized: false,
        }
    }
}

/// Serializes every read-modify-write of registry.json. Commands run on the
/// blocking pool, several at a time (enabling a map's packs, installing many
/// packs), and without it concurrent updates would overwrite each other. Only
/// ever taken there, never on the main thread, and held just for the small
/// JSON read/write — never across an install's extraction.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

/// Read registry.json into a map. Backward compatible with the old format
/// where each value was a plain bool (enabled) with no cached stats.
pub(crate) fn read_registry(app: &AppHandle) -> HashMap<String, PackReg> {
    match registry_path(app) {
        Ok(path) => read_registry_at(&path),
        Err(_) => HashMap::new(),
    }
}

/// Apply `f` to the registry and persist the result, atomically with respect
/// to every other update. Returns whatever `f` returns.
pub(crate) fn update_registry<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut HashMap<String, PackReg>) -> T,
) -> Result<T> {
    update_registry_at(&registry_path(app)?, f)
}

fn update_registry_at<T>(
    path: &Path,
    f: impl FnOnce(&mut HashMap<String, PackReg>) -> T,
) -> Result<T> {
    // A panic inside another update can't leave the file half-written (see
    // write_registry_at), so a poisoned lock is safe to keep using.
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = read_registry_at(path);
    let out = f(&mut reg);
    write_registry_at(path, &reg)?;
    Ok(out)
}

fn read_registry_at(path: &Path) -> HashMap<String, PackReg> {
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return HashMap::new();
    };
    let Some(obj) = value.as_object() else {
        return HashMap::new();
    };

    let mut map = HashMap::new();
    for (id, v) in obj {
        let reg = match v {
            serde_json::Value::Bool(b) => PackReg {
                enabled: *b,
                ..Default::default()
            },
            serde_json::Value::Object(o) => PackReg {
                enabled: o.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true),
                file_count: o
                    .get("fileCount")
                    .and_then(|x| x.as_u64())
                    .map(|n| n as usize),
                size_bytes: o.get("sizeBytes").and_then(|x| x.as_u64()),
                user: o.get("user").and_then(|x| x.as_bool()).unwrap_or(false),
                optimized: o
                    .get("optimized")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false),
            },
            _ => PackReg::default(),
        };
        map.insert(id.clone(), reg);
    }
    map
}

/// Write to a sibling temp file and rename it over registry.json: a reader
/// (which takes no lock) never sees a truncated file, which would parse as an
/// empty registry and reset every pack's flags.
fn write_registry_at(path: &Path, reg: &HashMap<String, PackReg>) -> Result<()> {
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
        if r.user {
            e.insert("user".into(), serde_json::json!(true));
        }
        if r.optimized {
            e.insert("optimized".into(), serde_json::json!(true));
        }
        obj.insert(id.clone(), serde_json::Value::Object(e));
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(&serde_json::Value::Object(obj))?,
    )?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Recursively sum size and count of files under `dir`.
pub(crate) fn dir_stats(dir: &Path) -> (usize, u64) {
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

pub(crate) fn read_installed_manifest(dir: &Path) -> Manifest {
    fs::read_to_string(dir.join("pack.json"))
        .ok()
        .and_then(|s| {
            serde_json::from_str(&s)
                .or_else(|_| json5::from_str(&s))
                .ok()
        })
        .unwrap_or_default()
}

pub(crate) fn build_installed(app: &AppHandle, id: &str, reg: &PackReg) -> Option<InstalledPack> {
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
        editable: reg.user,
        optimized: reg.optimized,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    fn temp_registry(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("open20-registry-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("registry.json")
    }

    #[test]
    fn concurrent_updates_are_not_lost() {
        let path = Arc::new(temp_registry("concurrent"));
        let initial: HashMap<String, PackReg> = (0..16)
            .map(|i| {
                (
                    format!("p{i}"),
                    PackReg {
                        enabled: false,
                        file_count: Some(i),
                        size_bytes: Some(10),
                        user: i % 2 == 0,
                        optimized: false,
                    },
                )
            })
            .collect();
        write_registry_at(&path, &initial).unwrap();

        let handles: Vec<_> = (0..16)
            .map(|i| {
                let path = Arc::clone(&path);
                thread::spawn(move || {
                    update_registry_at(&path, |reg| {
                        reg.entry(format!("p{i}")).or_default().enabled = true;
                    })
                    .unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let reg = read_registry_at(&path);
        assert_eq!(reg.len(), 16);
        for i in 0..16 {
            let r = &reg[&format!("p{i}")];
            assert!(r.enabled, "p{i} lost its update");
            assert_eq!(r.file_count, Some(i), "p{i} lost its cached stats");
            assert_eq!(r.user, i % 2 == 0, "p{i} lost its user flag");
        }
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn reads_the_legacy_bool_format() {
        let path = temp_registry("legacy");
        fs::write(
            &path,
            r#"{"a": false, "b": {"enabled": true, "fileCount": 3}}"#,
        )
        .unwrap();
        let reg = read_registry_at(&path);
        assert!(!reg["a"].enabled);
        assert!(reg["b"].enabled);
        assert_eq!(reg["b"].file_count, Some(3));
        assert_eq!(reg["b"].size_bytes, None);
    }

    #[test]
    fn update_returns_the_closure_result() {
        let path = temp_registry("result");
        let n = update_registry_at(&path, |reg| {
            reg.insert("x".into(), PackReg::default());
            reg.len()
        })
        .unwrap();
        assert_eq!(n, 1);
        assert!(read_registry_at(&path)["x"].enabled);
    }
}
