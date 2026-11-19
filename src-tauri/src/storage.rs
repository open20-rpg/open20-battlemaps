//! What the app keeps in its data folder, in the app's own terms (Settings ›
//! Storage): each installed pack, the Library's thumbnails, the downloaded
//! fonts and the rest, with the disk space each takes. Only what the app can
//! bring back by itself can be cleared here (thumbnails are remade while
//! browsing, fonts downloaded again when a map uses them); packs are
//! uninstalled with `uninstall_pack`. No arbitrary file access.

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackUsage {
    /// The pack's id (its folder under `packs/`).
    pub id: String,
    /// Its files, thumbnails apart.
    pub bytes: u64,
    /// Its Library thumbnails (shipped or made by the app).
    pub thumbnail_bytes: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    pub packs: Vec<PackUsage>,
    pub fonts_bytes: u64,
    pub fonts_count: usize,
    /// Everything else in the data folder (the pack registry…).
    pub other_bytes: u64,
    pub total_bytes: u64,
}

/// Bytes and files under `path` (0 when it isn't there). Links aren't followed.
fn dir_size(path: &Path) -> (u64, usize) {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if !meta.is_dir() {
        return (meta.len(), 1);
    }
    let Ok(entries) = fs::read_dir(path) else {
        return (0, 0);
    };
    entries.flatten().fold((0, 0), |(b, n), e| {
        let (eb, en) = dir_size(&e.path());
        (b + eb, n + en)
    })
}

/// The usage of the data folder at `root` (`packs/<id>/`, `fonts/`, the rest).
pub(crate) fn usage(root: &Path) -> StorageUsage {
    let packs_root = root.join("packs");
    let mut packs: Vec<PackUsage> = fs::read_dir(&packs_root)
        .map(|it| {
            it.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| {
                    let dir = e.path();
                    let (all, _) = dir_size(&dir);
                    let (thumbs, _) = dir_size(&dir.join("thumbnails"));
                    PackUsage {
                        id: e.file_name().to_string_lossy().into_owned(),
                        bytes: all - thumbs,
                        thumbnail_bytes: thumbs,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    packs.sort_by(|a, b| (b.bytes + b.thumbnail_bytes).cmp(&(a.bytes + a.thumbnail_bytes)));
    let (fonts_bytes, fonts_count) = dir_size(&root.join("fonts"));
    let (total_bytes, _) = dir_size(root);
    let counted: u64 = packs
        .iter()
        .map(|p| p.bytes + p.thumbnail_bytes)
        .sum::<u64>()
        + fonts_bytes;
    StorageUsage {
        packs,
        fonts_bytes,
        fonts_count,
        other_bytes: total_bytes.saturating_sub(counted),
        total_bytes,
    }
}

/// Delete every pack's Library thumbnails (they're remade while browsing).
pub(crate) fn clear_thumbnails(root: &Path) -> std::io::Result<()> {
    let Ok(packs) = fs::read_dir(root.join("packs")) else {
        return Ok(());
    };
    for pack in packs.flatten() {
        let thumbs = pack.path().join("thumbnails");
        if thumbs.is_dir() && !fs::symlink_metadata(&thumbs)?.file_type().is_symlink() {
            fs::remove_dir_all(&thumbs)?;
        }
    }
    Ok(())
}

/// Delete the downloaded fonts (downloaded again when a map uses them).
pub(crate) fn clear_fonts(root: &Path) -> std::io::Result<()> {
    let fonts = root.join("fonts");
    if fonts.is_dir() {
        fs::remove_dir_all(&fonts)?;
    }
    Ok(())
}

fn data_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// How much space each kind of the app's data takes.
#[tauri::command]
pub async fn storage_usage(app: AppHandle) -> Result<StorageUsage, String> {
    let root = data_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || usage(&root))
        .await
        .map_err(|e| e.to_string())
}

/// Clear one kind of the app's data that it can bring back: "thumbnails" or "fonts".
#[tauri::command]
pub async fn clear_storage(app: AppHandle, kind: String) -> Result<(), String> {
    let root = data_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "thumbnails" => clear_thumbnails(&root).map_err(|e| e.to_string()),
        "fonts" => clear_fonts(&root).map_err(|e| e.to_string()),
        other => Err(format!("unknown storage kind: {other}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("otbm-storage-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(path: PathBuf, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn measures_each_kind_of_data() {
        let root = temp_root("usage");
        file(root.join("packs/big/textures/a.png"), 300);
        file(root.join("packs/big/thumbnails/x.png"), 40);
        file(root.join("packs/small/pack.json"), 10);
        file(root.join("packs/registry.json"), 7);
        file(root.join("fonts/A-Regular.ttf"), 100);
        file(root.join("fonts/B-Bold.ttf"), 50);
        let u = usage(&root);
        assert_eq!(
            u.packs,
            vec![
                PackUsage {
                    id: "big".into(),
                    bytes: 300,
                    thumbnail_bytes: 40
                },
                PackUsage {
                    id: "small".into(),
                    bytes: 10,
                    thumbnail_bytes: 0
                },
            ]
        );
        assert_eq!((u.fonts_bytes, u.fonts_count), (150, 2));
        assert_eq!(u.other_bytes, 7);
        assert_eq!(u.total_bytes, 507);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn clears_only_what_the_app_can_bring_back() {
        let root = temp_root("clear");
        file(root.join("packs/p/textures/a.png"), 30);
        file(root.join("packs/p/thumbnails/x.png"), 4);
        file(root.join("fonts/A-Regular.ttf"), 10);
        clear_thumbnails(&root).unwrap();
        assert!(root.join("packs/p/textures/a.png").exists());
        assert!(!root.join("packs/p/thumbnails").exists());
        clear_fonts(&root).unwrap();
        assert!(!root.join("fonts").exists());
        // Nothing there: nothing to do.
        clear_fonts(&root).unwrap();
        let empty = temp_root("empty");
        assert_eq!(usage(&empty).total_bytes, 0);
        clear_thumbnails(&empty).unwrap();
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&empty).unwrap();
    }
}
