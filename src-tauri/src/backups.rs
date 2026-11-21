//! Automatic backups of the open map (`<app data>/backups/`).
//!
//! The frontend sends the map's `.otbm` text every few minutes (and on each
//! save); each one lands in `backups/<map id>/<ms>.otbm` beside a small
//! `<ms>.json` with what the backups list shows (name, source file,
//! thumbnail), so listing never reads whole maps. The sidecar is written
//! last: a backup without one was cut short and is cleaned up.
//!
//! They must not pile up: after each write the map's backups are thinned by
//! age ([`retained`]: many from the last minutes, fewer per hour, one a day,
//! one a week), at most [`MAX_PER_MAP`], and only the [`MAX_MAPS`] maps
//! backed up most recently keep theirs.
//!
//! A session marker (`session.json`) tells an unexpected exit apart: it's
//! written at start and removed when the app closes normally.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Most backups kept per map.
pub const MAX_PER_MAP: usize = 20;
/// Maps whose backups are kept (the ones backed up most recently).
pub const MAX_MAPS: usize = 10;

const MIN: u64 = 60_000;
const HOUR: u64 = 60 * MIN;
const DAY: u64 = 24 * HOUR;

/// `(up to this age, at least this far apart)`, nearest first; older than
/// the last tier, one a week.
const TIERS: [(u64, u64); 4] = [
    (10 * MIN, MIN),
    (2 * HOUR, 30 * MIN),
    (DAY, 4 * HOUR),
    (7 * DAY, DAY),
];
const BEYOND_TIERS: u64 = 7 * DAY;

/// The backup times (ms) to keep at `now`, newest first: the newest always,
/// then each one far enough from the last one kept for its age (see
/// [`TIERS`]), up to [`MAX_PER_MAP`]. Spacings allow a tenth less, so
/// copies taken a bit early (timers drift) aren't all dropped.
pub(crate) fn retained(times: &[u64], now: u64) -> Vec<u64> {
    let mut sorted = times.to_vec();
    sorted.sort_unstable_by(|a, b| b.cmp(a));
    sorted.dedup();
    let mut kept: Vec<u64> = Vec::new();
    for t in sorted {
        if kept.len() == MAX_PER_MAP {
            break;
        }
        let Some(&last) = kept.last() else {
            kept.push(t);
            continue;
        };
        let age = now.saturating_sub(t);
        let spacing = TIERS
            .iter()
            .find(|(max_age, _)| age <= *max_age)
            .map_or(BEYOND_TIERS, |(_, s)| *s);
        if last - t >= spacing - spacing / 10 {
            kept.push(t);
        }
    }
    kept
}

/// What the backups list shows of one backup (sent by the frontend).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// The map's name when it was backed up (its file name, or "unsaved").
    pub name: String,
    /// The file the map was opened from or saved to, if any.
    pub source_path: Option<String>,
    /// It had changes not saved to that file.
    pub unsaved: bool,
    /// A small picture of the map (`data:` URL), when one could be drawn.
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    /// When it was taken (ms since the epoch).
    pub created_at: u64,
    pub bytes: u64,
    #[serde(flatten)]
    pub info: BackupInfo,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupMap {
    pub map_id: String,
    /// Newest first.
    pub backups: Vec<BackupEntry>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Map ids come from the frontend and name a folder: nothing that could
/// reach outside `backups/`.
fn valid_map_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid map id: {id}"))
    }
}

fn parse_backup_id(id: &str) -> Result<u64, String> {
    id.parse::<u64>()
        .map_err(|_| format!("invalid backup id: {id}"))
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The complete backups (with their sidecar) in a map's folder, by time.
fn backup_times(dir: &Path) -> Vec<u64> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let t = name.strip_suffix(".otbm")?.parse::<u64>().ok()?;
            dir.join(format!("{t}.json")).is_file().then_some(t)
        })
        .collect()
}

/// Write one backup of map `map_id`, then thin its backups and drop the
/// maps backed up longest ago. Returns the new backup's time.
pub(crate) fn write(
    root: &Path,
    map_id: &str,
    contents: &str,
    info: &BackupInfo,
    now: u64,
) -> Result<u64, String> {
    valid_map_id(map_id)?;
    let dir = root.join(map_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut t = now;
    while dir.join(format!("{t}.otbm")).exists() {
        t += 1;
    }
    let io = |e: std::io::Error| e.to_string();
    let tmp = dir.join(format!("{t}.otbm.tmp"));
    fs::write(&tmp, contents).map_err(io)?;
    fs::rename(&tmp, dir.join(format!("{t}.otbm"))).map_err(io)?;
    let sidecar = serde_json::to_vec(info).map_err(|e| e.to_string())?;
    fs::write(dir.join(format!("{t}.json")), sidecar).map_err(io)?;
    prune_map(&dir, now);
    prune_maps(root, map_id);
    Ok(t)
}

/// Remove what [`retained`] doesn't keep, and leftovers of cut-short writes.
fn prune_map(dir: &Path, now: u64) {
    let keep = retained(&backup_times(dir), now);
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let stem = name.split('.').next().unwrap_or("");
        let kept = stem.parse::<u64>().is_ok_and(|t| keep.contains(&t))
            && (name.ends_with(".otbm") || name.ends_with(".json"));
        if !kept {
            let _ = fs::remove_file(e.path());
        }
    }
}

/// Keep the backups of the [`MAX_MAPS`] maps backed up most recently
/// (always `current`'s).
fn prune_maps(root: &Path, current: &str) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut maps: Vec<(u64, PathBuf, bool)> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let newest = backup_times(&e.path()).into_iter().max().unwrap_or(0);
            (newest, e.path(), e.file_name() == current)
        })
        .collect();
    maps.sort_by(|a, b| b.2.cmp(&a.2).then(b.0.cmp(&a.0)));
    for (_, dir, _) in maps.into_iter().skip(MAX_MAPS) {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Every map's backups, the map backed up most recently first.
pub(crate) fn list(root: &Path) -> Vec<BackupMap> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut maps: Vec<BackupMap> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let map_id = e.file_name().to_string_lossy().into_owned();
            let dir = e.path();
            let mut backups: Vec<BackupEntry> = backup_times(&dir)
                .into_iter()
                .filter_map(|t| {
                    let info = fs::read(dir.join(format!("{t}.json"))).ok()?;
                    let info: BackupInfo = serde_json::from_slice(&info).ok()?;
                    let bytes = fs::metadata(dir.join(format!("{t}.otbm"))).ok()?.len();
                    Some(BackupEntry {
                        id: t.to_string(),
                        created_at: t,
                        bytes,
                        info,
                    })
                })
                .collect();
            backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            (!backups.is_empty()).then_some(BackupMap { map_id, backups })
        })
        .collect();
    maps.sort_by(|a, b| b.backups[0].created_at.cmp(&a.backups[0].created_at));
    maps
}

pub(crate) fn read(root: &Path, map_id: &str, id: &str) -> Result<String, String> {
    valid_map_id(map_id)?;
    let t = parse_backup_id(id)?;
    fs::read_to_string(root.join(map_id).join(format!("{t}.otbm"))).map_err(|e| e.to_string())
}

/// Delete one backup, or every backup of the map when `id` is None.
pub(crate) fn delete(root: &Path, map_id: &str, id: Option<&str>) -> Result<(), String> {
    valid_map_id(map_id)?;
    let dir = root.join(map_id);
    let io = |e: std::io::Error| e.to_string();
    match id {
        None if dir.exists() => fs::remove_dir_all(&dir).map_err(io),
        None => Ok(()),
        Some(id) => {
            let t = parse_backup_id(id)?;
            // The sidecar first: without it the backup no longer counts.
            let _ = fs::remove_file(dir.join(format!("{t}.json")));
            let _ = fs::remove_file(dir.join(format!("{t}.otbm")));
            Ok(())
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    started_at: u64,
}

/// Mark this session as running. Returns when the previous one started if
/// it didn't end normally (its marker is still there).
pub(crate) fn session_start(root: &Path, now: u64) -> Option<u64> {
    let marker = root.join("session.json");
    let previous = fs::read(&marker)
        .ok()
        .and_then(|b| serde_json::from_slice::<Session>(&b).ok())
        .map(|s| s.started_at);
    if let Ok(b) = serde_json::to_vec(&Session { started_at: now }) {
        let _ = fs::write(&marker, b);
    }
    previous
}

pub(crate) fn session_end(root: &Path) {
    let _ = fs::remove_file(root.join("session.json"));
}

/// Run `f` on a blocking worker thread: file IO never stalls the UI.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn backup_write(
    app: AppHandle,
    map_id: String,
    contents: String,
    info: BackupInfo,
) -> Result<u64, String> {
    let root = root(&app)?;
    blocking(move || write(&root, &map_id, &contents, &info, now_ms())).await
}

#[tauri::command]
pub async fn backup_list(app: AppHandle) -> Result<Vec<BackupMap>, String> {
    let root = root(&app)?;
    blocking(move || Ok(list(&root))).await
}

#[tauri::command]
pub async fn backup_read(app: AppHandle, map_id: String, id: String) -> Result<String, String> {
    let root = root(&app)?;
    blocking(move || read(&root, &map_id, &id)).await
}

#[tauri::command]
pub async fn backup_delete(
    app: AppHandle,
    map_id: String,
    id: Option<String>,
) -> Result<(), String> {
    let root = root(&app)?;
    blocking(move || delete(&root, &map_id, id.as_deref())).await
}

#[tauri::command]
pub fn backup_session_start(app: AppHandle) -> Result<Option<u64>, String> {
    Ok(session_start(&root(&app)?, now_ms()))
}

/// Remove the session marker on a normal exit (also covers quitting
/// without the window's close request, e.g. Cmd+Q).
pub fn end_session(app: &AppHandle) {
    if let Ok(root) = root(app) {
        session_end(&root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("otbm-backups-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn info(name: &str) -> BackupInfo {
        BackupInfo {
            name: name.into(),
            source_path: None,
            unsaved: true,
            thumbnail: None,
        }
    }

    #[test]
    fn keeps_every_recent_backup() {
        let now = 100 * DAY;
        let times: Vec<u64> = (0..5).map(|i| now - i * 2 * MIN).collect();
        assert_eq!(retained(&times, now), times);
    }

    #[test]
    fn thins_older_backups_by_age() {
        let now = 100 * DAY;
        // One every 2 minutes for 30 days.
        let times: Vec<u64> = (0..(30 * DAY / (2 * MIN)))
            .map(|i| now - i * 2 * MIN)
            .collect();
        let kept = retained(&times, now);
        assert_eq!(kept.len(), MAX_PER_MAP);
        assert_eq!(kept[0], now);
        let ages: Vec<u64> = kept.iter().map(|t| now - t).collect();
        assert_eq!(ages.iter().filter(|a| **a <= 10 * MIN).count(), 6);
        assert!(
            ages.iter()
                .filter(|a| **a > 10 * MIN && **a <= 2 * HOUR)
                .count()
                >= 3
        );
        assert!(ages.iter().any(|a| *a > DAY));
        // Never two closer than their tier allows.
        for w in kept.windows(2) {
            let age = now - w[1];
            if age > 10 * MIN && age <= 2 * HOUR {
                assert!(w[0] - w[1] >= 27 * MIN);
            }
        }
    }

    #[test]
    fn keeps_weekly_backups_far_back() {
        let now = 400 * DAY;
        let times: Vec<u64> = (0..300).map(|d| now - d * DAY).collect();
        let kept = retained(&times, now);
        let old: Vec<u64> = kept
            .iter()
            .map(|t| now - t)
            .filter(|a| *a > 7 * DAY)
            .collect();
        assert!(!old.is_empty());
        for w in old.windows(2) {
            assert!(w[1] - w[0] >= 6 * DAY);
        }
    }

    #[test]
    fn writes_lists_reads_and_deletes() {
        let root = temp_root("roundtrip");
        let t1 = write(&root, "map-1", "{\"a\":1}", &info("One"), 1_000).unwrap();
        let t2 = write(&root, "map-1", "{\"a\":2}", &info("One"), 1_000 + 5 * MIN).unwrap();
        let maps = list(&root);
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].map_id, "map-1");
        let ids: Vec<u64> = maps[0].backups.iter().map(|b| b.created_at).collect();
        assert_eq!(ids, vec![t2, t1]);
        assert_eq!(read(&root, "map-1", &t1.to_string()).unwrap(), "{\"a\":1}");
        delete(&root, "map-1", Some(&t2.to_string())).unwrap();
        assert_eq!(list(&root)[0].backups.len(), 1);
        delete(&root, "map-1", None).unwrap();
        assert!(list(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn keeps_only_the_most_recent_maps() {
        let root = temp_root("maps");
        for i in 0..(MAX_MAPS as u64 + 3) {
            write(&root, &format!("m{i}"), "{}", &info("x"), 1_000 + i * MIN).unwrap();
        }
        let maps = list(&root);
        assert_eq!(maps.len(), MAX_MAPS);
        assert_eq!(maps[0].map_id, format!("m{}", MAX_MAPS + 2));
        assert!(maps.iter().all(|m| m.map_id != "m0"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_ids_outside_the_folder() {
        let root = temp_root("ids");
        assert!(write(&root, "../x", "{}", &info("x"), 1).is_err());
        assert!(read(&root, "ok", "../1").is_err());
        assert!(delete(&root, "a/b", None).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn detects_a_session_that_did_not_end() {
        let root = temp_root("session");
        assert_eq!(session_start(&root, 10), None);
        assert_eq!(session_start(&root, 20), Some(10));
        session_end(&root);
        assert_eq!(session_start(&root, 30), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
