//! Reading, installing and querying Dungeondraft asset packs.
//!
//! Packs can be several GB, so file data is always streamed through a fixed
//! buffer — the whole archive is never held in memory. Only the small index
//! and individual small assets (manifest, thumbnails) are ever fully read.
//!
//! Module layout:
//! - [`format`]: low-level GDPC / `.dungeondraft_pack` binary reading.
//! - [`registry`]: persistent registry of installed packs & on-disk layout.
//! - [`install`]: streaming extraction with progress events.
//! - [`library`]: asset-browser search over installed packs.
//! - [`recolor`]: `recolor://` protocol and colorable-asset support.
//! - [`tags`]: pack tag groups (Library "Tags" tab).
//! - [`commands`]: the thin `#[tauri::command]` facade.

mod assetdefs;
mod commands;
mod format;
mod install;
mod library;
mod recolor;
mod registry;
mod tags;
mod thumbs;

pub use commands::*;
pub use library::LibraryState;
pub use recolor::recolor_protocol;

use std::io;
use std::path::Path;

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

pub(crate) type Result<T> = std::result::Result<T, PackError>;

/// Map a file extension to the MIME type used when serving images.
pub(crate) fn mime_for(path: &Path) -> String {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
    .to_string()
}
