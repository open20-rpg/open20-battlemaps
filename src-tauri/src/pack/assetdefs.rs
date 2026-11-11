//! A pack's tileset and wall definitions (`data/**/*.dungeondraft_tileset`,
//! `data/**/*.dungeondraft_wall`): per texture, the color it's tinted with by
//! default and, for tilesets, whether it's a "custom_color" one (recolored by
//! its red regions instead of multiplied by the color).

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::library::LibraryState;
use super::recolor::strip_trailing_commas;
use super::registry::pack_dir;

/// What a definition says about one texture.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct AssetDef {
    /// Default tint as `#rrggbb` (or `#rrggbbaa` when not opaque).
    pub default_color: Option<String>,
    /// A "custom_color" tileset: its red regions take the color.
    pub custom_color: bool,
}

/// Texture key (see [`def_key`]) → its definition.
pub(crate) type AssetDefs = HashMap<String, AssetDef>;

/// How definitions are matched to textures: the path inside the pack,
/// lowercased and without its extension — a definition naming `x.png` still
/// finds a texture re-encoded as `x.webp` (as `library::locate` tolerates).
pub(crate) fn def_key(rel_path: &str) -> String {
    let lower = rel_path.to_ascii_lowercase();
    match lower.rsplit_once('.') {
        Some((stem, ext)) if !ext.contains('/') => stem.to_string(),
        _ => lower,
    }
}

/// The definition of the texture at `rel_path`, if the pack has one.
pub(crate) fn def_for(defs: &AssetDefs, rel_path: &str) -> AssetDef {
    defs.get(&def_key(rel_path)).cloned().unwrap_or_default()
}

#[derive(Deserialize)]
struct DefFile {
    path: Option<String>,
    color: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// A Godot 3 html color (`AARRGGBB` or `RRGGBB`, `#` optional) as `#rrggbb[aa]`.
pub(crate) fn godot_color(s: &str) -> Option<String> {
    let h = s.trim().trim_start_matches('#').to_ascii_lowercase();
    if !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match h.len() {
        6 => Some(format!("#{h}")),
        8 => {
            let (a, rgb) = h.split_at(2);
            Some(if a == "ff" {
                format!("#{rgb}")
            } else {
                format!("#{rgb}{a}")
            })
        }
        _ => None,
    }
}

/// A definition's texture path relative to its pack (`res://packs/<id>/` stripped).
fn rel_texture_path(path: &str) -> String {
    let p = path.trim();
    if let Some(rest) = p.strip_prefix("res://packs/") {
        return rest
            .split_once('/')
            .map(|(_, r)| r.to_string())
            .unwrap_or_default();
    }
    p.trim_start_matches("res://")
        .trim_start_matches('/')
        .to_string()
}

/// Parse one definition file's text into (texture rel-path, definition).
pub(crate) fn parse_def(text: &str) -> Option<(String, AssetDef)> {
    let file: DefFile = serde_json::from_str(&strip_trailing_commas(text))
        .or_else(|_| json5::from_str(text))
        .ok()?;
    let rel = rel_texture_path(file.path.as_deref()?);
    if rel.is_empty() {
        return None;
    }
    Some((
        rel,
        AssetDef {
            default_color: file.color.as_deref().and_then(godot_color),
            custom_color: file.kind.as_deref() == Some("custom_color"),
        },
    ))
}

/// Every definition under `dir` (recursively).
fn collect(dir: &Path, out: &mut AssetDefs) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "dungeondraft_tileset" && ext != "dungeondraft_wall" {
            continue;
        }
        if let Some((rel, def)) = fs::read_to_string(&path)
            .ok()
            .as_deref()
            .and_then(parse_def)
        {
            out.insert(def_key(&rel), def);
        }
    }
}

/// Load (and cache) a pack's tileset/wall definitions.
pub(crate) fn pack_asset_defs(app: &AppHandle, pack_id: &str) -> Arc<AssetDefs> {
    let state = app.state::<LibraryState>();
    if let Some(defs) = state.defs.lock().ok().and_then(|m| m.get(pack_id).cloned()) {
        return defs;
    }
    let mut defs = AssetDefs::new();
    if let Ok(dir) = pack_dir(app, pack_id) {
        collect(&dir.join("data"), &mut defs);
    }
    let arc = Arc::new(defs);
    if let Ok(mut m) = state.defs.lock() {
        m.insert(pack_id.to_string(), arc.clone());
    }
    arc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_definition_files_and_finds_them_by_texture() {
        // A real pack layout on disk: the path through collect() and def_for().
        let root = std::env::temp_dir().join(format!("o20-defs-{}", std::process::id()));
        let walls = root.join("data/walls");
        fs::create_dir_all(&walls).unwrap();
        fs::write(
            walls.join("x.dungeondraft_wall"),
            r#"{"path": "textures/walls/X.png", "color": "605f58"}"#,
        )
        .unwrap();
        let mut defs = AssetDefs::new();
        collect(&root.join("data"), &mut defs);
        fs::remove_dir_all(&root).unwrap();
        let found = def_for(&defs, "textures/walls/x.webp");
        assert_eq!(found.default_color.as_deref(), Some("#605f58"));
    }

    #[test]
    fn matches_definitions_across_extension_and_case() {
        let mut defs = AssetDefs::new();
        defs.insert(
            def_key("textures/tilesets/Wood.png"),
            AssetDef {
                default_color: Some("#b08850".into()),
                custom_color: false,
            },
        );
        let found = def_for(&defs, "textures/tilesets/wood.webp");
        assert_eq!(found.default_color.as_deref(), Some("#b08850"));
        assert_eq!(
            def_for(&defs, "textures/tilesets/other.png"),
            AssetDef::default()
        );
    }

    #[test]
    fn reads_godot_colors() {
        assert_eq!(godot_color("ff7f7e71"), Some("#7f7e71".into()));
        assert_eq!(godot_color("#80112233"), Some("#11223380".into()));
        assert_eq!(godot_color("aabbcc"), Some("#aabbcc".into()));
        assert_eq!(godot_color("nope"), None);
    }

    #[test]
    fn parses_tileset_and_wall_definitions() {
        let (rel, def) = parse_def(
            r#"{"path": "res://packs/abc123/textures/tilesets/simple/wood.png",
                "name": "Wood", "type": "custom_color", "color": "ffb08850",}"#,
        )
        .unwrap();
        assert_eq!(rel, "textures/tilesets/simple/wood.png");
        assert_eq!(
            def,
            AssetDef {
                default_color: Some("#b08850".into()),
                custom_color: true
            }
        );
        let (rel, def) =
            parse_def(r#"{"path": "textures/walls/stone.png", "color": "ff808080"}"#).unwrap();
        assert_eq!(rel, "textures/walls/stone.png");
        assert!(!def.custom_color);
        assert!(parse_def(r#"{"name": "no path"}"#).is_none());
    }
}
