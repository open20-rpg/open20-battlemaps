//! Low-level reading of the GDPC / `.dungeondraft_pack` binary format.
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

use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use serde::Deserialize;

use super::{PackError, Result};

const MAGIC: u32 = 0x4350_4447; // "GDPC"
const HEADER_SIZE: u64 = 88; // where the file index begins

// ---------------------------------------------------------------------------
// Data types shared with the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
pub struct Manifest {
    pub name: Option<String>,
    pub id: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    /// Pack manifests store keywords as a single comma-separated string.
    pub keywords: Option<String>,
}

/// One entry of the PCK file index.
pub(crate) struct PackEntry {
    pub(crate) path: String,
    pub(crate) offset: u64,
    pub(crate) size: u64,
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
pub(crate) fn read_index<R: Read + Seek>(reader: &mut R) -> Result<Vec<PackEntry>> {
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
fn read_entry_bytes<R: Read + Seek>(reader: &mut R, entry: &PackEntry) -> Result<Vec<u8>> {
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
pub(crate) fn normalize_res_path(res_path: &str, id: &str) -> String {
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
pub(crate) fn read_manifest<R: Read + Seek>(
    reader: &mut R,
    entries: &[PackEntry],
) -> Result<Manifest> {
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
    // Pack manifests are lenient (JSON5/HuJSON): try strict JSON first,
    // then fall back to json5 for comments / trailing commas.
    let manifest: Manifest = serde_json::from_str(&text)
        .or_else(|_| json5::from_str(&text))
        .map_err(|e| PackError::Manifest(e.to_string()))?;
    Ok(manifest)
}

pub(crate) fn split_keywords(kw: &Option<String>) -> Vec<String> {
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
// PCK writing (exporting user packs)
// ---------------------------------------------------------------------------

/// One file going into a written pack: its `res://` path and where it is.
pub(crate) struct PckFile {
    pub(crate) res_path: String,
    pub(crate) source: PathBuf,
    pub(crate) size: u64,
}

/// Write a Godot 3 PCK (format 1, the layout read above) to `out`: header,
/// index, then each file streamed through a fixed buffer — never the whole
/// pack in memory. MD5s are left zero, which the format allows.
/// `progress(done, total)` is called after each file.
pub(crate) fn write_pck<W: Write>(
    out: &mut W,
    files: &[PckFile],
    mut progress: impl FnMut(usize, usize),
) -> Result<()> {
    let index_size: u64 = files
        .iter()
        .map(|f| 4 + f.res_path.len() as u64 + 8 + 8 + 16)
        .sum();
    let mut offset = HEADER_SIZE + index_size;
    // Magic, pack format 1, Godot 3.4.0 (what Dungeondraft writes).
    for v in [MAGIC, 1, 3, 4, 0] {
        out.write_all(&v.to_le_bytes())?;
    }
    out.write_all(&[0u8; 64])?;
    out.write_all(&(files.len() as u32).to_le_bytes())?;
    for f in files {
        out.write_all(&(f.res_path.len() as u32).to_le_bytes())?;
        out.write_all(f.res_path.as_bytes())?;
        out.write_all(&offset.to_le_bytes())?;
        out.write_all(&f.size.to_le_bytes())?;
        out.write_all(&[0u8; 16])?;
        offset += f.size;
    }
    let mut buf = vec![0u8; 1 << 20];
    for (i, f) in files.iter().enumerate() {
        let mut src = std::fs::File::open(&f.source)?;
        let mut remaining = f.size;
        while remaining > 0 {
            let n = remaining.min(buf.len() as u64) as usize;
            src.read_exact(&mut buf[..n])?;
            out.write_all(&buf[..n])?;
            remaining -= n as u64;
        }
        progress(i + 1, files.len());
    }
    out.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn written_packs_read_back() {
        let dir = std::env::temp_dir().join(format!("o20-pck-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.json");
        let b = dir.join("b.png");
        std::fs::write(&a, br#"{"id": "xy12", "name": "Mine"}"#).unwrap();
        std::fs::write(&b, vec![7u8; 3000]).unwrap();
        let files: Vec<PckFile> = [
            ("res://packs/xy12.json", &a),
            ("res://packs/xy12/textures/objects/b.png", &b),
        ]
        .iter()
        .map(|(r, p)| PckFile {
            res_path: r.to_string(),
            source: p.to_path_buf(),
            size: std::fs::metadata(p).unwrap().len(),
        })
        .collect();
        let mut out = io::Cursor::new(Vec::new());
        let mut calls = 0;
        write_pck(&mut out, &files, |_, _| calls += 1).unwrap();
        assert_eq!(calls, 2);
        let entries = read_index(&mut out).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].size, 3000);
        let m = read_manifest(&mut out, &entries).unwrap();
        assert_eq!(m.id.as_deref(), Some("xy12"));
        let bytes = read_entry_bytes(&mut out, &entries[1]).unwrap();
        assert!(bytes.iter().all(|&x| x == 7));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn normalize_res_path_variants() {
        // Root manifest copy becomes pack.json.
        assert_eq!(
            normalize_res_path("res://packs/ABC123.json", "ABC123"),
            "pack.json"
        );
        // Files nested under the id folder are made folder-relative.
        assert_eq!(
            normalize_res_path("res://packs/ABC123/textures/objects/foo.png", "ABC123"),
            "textures/objects/foo.png"
        );
        // Backslashes are normalised and unknown prefixes fall back gracefully.
        assert_eq!(
            normalize_res_path("res://packs\\OTHER\\foo.png", "ABC123"),
            "OTHER/foo.png"
        );
    }

    #[test]
    fn split_keywords_trims_and_skips_empty() {
        let kw = Some(" dungeon, cave ,, forest ".to_string());
        assert_eq!(split_keywords(&kw), vec!["dungeon", "cave", "forest"]);
        assert!(split_keywords(&None).is_empty());
    }
}
