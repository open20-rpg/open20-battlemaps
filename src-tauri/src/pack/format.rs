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

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};

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
    /// Dungeondraft stores keywords as a single comma-separated string.
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
pub(crate) fn read_index(reader: &mut BufReader<File>) -> Result<Vec<PackEntry>> {
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
pub(crate) fn read_manifest(
    reader: &mut BufReader<File>,
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
    // Dungeondraft manifests are lenient (JSON5/HuJSON): try strict JSON first,
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

#[cfg(test)]
mod tests {
    use super::*;

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
