//! Installation of packs: streaming extraction with progress events.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::format::{normalize_res_path, read_index, read_manifest};
use super::library::clear_library;
use super::registry::{
    build_installed, pack_dir, read_registry, write_registry, InstalledPack, PackReg,
};
use super::{PackError, Result};

const COPY_BUF: usize = 1 << 20; // 1 MiB streaming buffer

/// Minimum time between progress events.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// Rate-limits install progress events. Big packs hold tens of thousands of
/// files; one event per file floods the webview (every event is a JS task and
/// a React update), starving input, resizes and clicks until it drains. An
/// event goes out only when the percent changed and the interval elapsed —
/// plus always for the last file, so the UI ends at 100%.
struct ProgressThrottle {
    last_percent: Option<u8>,
    last_emit: Option<Instant>,
}

impl ProgressThrottle {
    fn new() -> Self {
        Self {
            last_percent: None,
            last_emit: None,
        }
    }

    fn should_emit(&mut self, percent: u8, now: Instant, is_last: bool) -> bool {
        let changed = self.last_percent != Some(percent);
        let due = self
            .last_emit
            .is_none_or(|t| now.duration_since(t) >= PROGRESS_INTERVAL);
        if is_last || (changed && due) {
            self.last_percent = Some(percent);
            self.last_emit = Some(now);
            return true;
        }
        false
    }
}

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
/// it to a file descriptor through the platform ContentResolver (see
/// `crate::android_fs`) and read the pack straight from it — no temporary
/// copy, so disk/time cost matches desktop.
fn open_pack_source(src: &str) -> Result<File> {
    #[cfg(target_os = "android")]
    {
        if src.starts_with("content://") {
            return crate::android_fs::open_content_uri(src, "r").map_err(PackError::Other);
        }
    }
    Ok(File::open(src)?)
}

/// Extract a single pack file into `app_data/packs/<id>/`, streaming every
/// file through a fixed buffer so memory stays bounded regardless of pack size.
pub(crate) fn install_one(app: &AppHandle, pack_src: &str) -> Result<InstalledPack> {
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
    let mut throttle = ProgressThrottle::new();

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
        if !throttle.should_emit(percent, Instant::now(), index + 1 == total) {
            continue;
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_emits_on_percent_change_after_the_interval() {
        let mut t = ProgressThrottle::new();
        let start = Instant::now();
        assert!(t.should_emit(1, start, false));
        // Same percent, or too soon: skipped.
        assert!(!t.should_emit(1, start + PROGRESS_INTERVAL * 2, false));
        assert!(!t.should_emit(2, start + Duration::from_millis(10), false));
        // New percent after the interval: emitted.
        assert!(t.should_emit(2, start + PROGRESS_INTERVAL, false));
    }

    #[test]
    fn throttle_always_emits_the_last_file() {
        let mut t = ProgressThrottle::new();
        let start = Instant::now();
        assert!(t.should_emit(99, start, false));
        assert!(t.should_emit(100, start, true));
    }

    #[test]
    fn throttle_caps_events_for_huge_packs() {
        let mut t = ProgressThrottle::new();
        let start = Instant::now();
        let total = 50_000;
        // Simulate files finishing 1ms apart.
        let emitted = (0..total)
            .filter(|&i| {
                let percent = (((i + 1) as f64 / total as f64) * 100.0) as u8;
                t.should_emit(
                    percent,
                    start + Duration::from_millis(i as u64),
                    i + 1 == total,
                )
            })
            .count();
        assert!(emitted <= 102, "emitted {emitted}");
    }
}
