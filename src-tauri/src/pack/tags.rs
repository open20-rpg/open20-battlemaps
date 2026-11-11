//! Pack tags (`data/default.dungeondraft_tags`): named groups of texture paths
//! that the Library's Tags tab browses by (e.g. "Furniture", "Plants").

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::library::LibraryState;
use super::recolor::strip_trailing_commas;
use super::registry::{pack_dir, read_registry};

/// Tag name -> pack-relative texture paths.
pub(crate) type TagMap = HashMap<String, HashSet<String>>;

#[derive(Default, Deserialize)]
struct RawTagsFile {
    #[serde(default)]
    tags: HashMap<String, Vec<String>>,
}

/// Normalize a tag entry to the pack-relative form the library index uses
/// (`textures/...`): some packs write full `res://packs/<id>/...` paths.
fn normalize_path(pack_id: &str, path: &str) -> String {
    let p = path.replace('\\', "/");
    let prefix = format!("res://packs/{pack_id}/");
    p.strip_prefix(&prefix).unwrap_or(&p).to_string()
}

/// Parse a tags file. Tags files use trailing commas, so they go through the
/// same stripping as the colorable lookup (falling back to json5).
pub(crate) fn parse_tags(pack_id: &str, txt: &str) -> TagMap {
    let raw: RawTagsFile = serde_json::from_str(&strip_trailing_commas(txt))
        .or_else(|_| json5::from_str(txt))
        .unwrap_or_default();
    raw.tags
        .into_iter()
        // "Colorable" is a capability flag, not a browsable group.
        .filter(|(name, _)| name != "Colorable")
        .map(|(name, paths)| {
            let set = paths.iter().map(|p| normalize_path(pack_id, p)).collect();
            (name, set)
        })
        .collect()
}

/// Tag names that contain at least one texture of `category`, sorted.
pub(crate) fn names_for_category<'a>(
    tags: impl IntoIterator<Item = &'a TagMap>,
    category: &str,
) -> Vec<String> {
    let prefix = format!("textures/{category}/");
    let mut out = BTreeSet::new();
    for map in tags {
        for (name, paths) in map {
            if paths.iter().any(|p| p.starts_with(&prefix)) {
                out.insert(name.clone());
            }
        }
    }
    out.into_iter().collect()
}

/// Load (and cache) a pack's tags.
pub(crate) fn pack_tags(app: &AppHandle, pack_id: &str) -> Arc<TagMap> {
    let state = app.state::<LibraryState>();
    if let Some(t) = state.tags.lock().ok().and_then(|m| m.get(pack_id).cloned()) {
        return t;
    }
    let tags = pack_dir(app, pack_id)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("data/default.dungeondraft_tags")).ok())
        .map(|txt| parse_tags(pack_id, &txt))
        .unwrap_or_default();
    let arc = Arc::new(tags);
    if let Ok(mut m) = state.tags.lock() {
        m.insert(pack_id.to_string(), arc.clone());
    }
    arc
}

/// Tag names available for `category` across every enabled pack.
pub(crate) fn tags_for_category(app: &AppHandle, category: &str) -> Vec<String> {
    let reg = read_registry(app);
    let maps: Vec<Arc<TagMap>> = reg
        .iter()
        .filter(|(_, r)| r.enabled)
        .map(|(id, _)| pack_tags(app, id))
        .collect();
    names_for_category(maps.iter().map(|m| m.as_ref()), category)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = r#"{
        "tags": {
            "Colorable": ["textures/objects/a.png",],
            "Furniture": ["textures/objects/a.png", "res://packs/p1/textures/objects/b.png",],
            "Ground": ["textures/terrain/g.png"],
        },
        "sets": {},
    }"#;

    #[test]
    fn parses_and_normalizes_paths() {
        let tags = parse_tags("p1", FILE);
        assert!(!tags.contains_key("Colorable"));
        let furniture = &tags["Furniture"];
        assert!(furniture.contains("textures/objects/a.png"));
        assert!(furniture.contains("textures/objects/b.png"));
    }

    #[test]
    fn filters_tag_names_by_category() {
        let tags = parse_tags("p1", FILE);
        assert_eq!(names_for_category([&tags], "objects"), vec!["Furniture"]);
        assert_eq!(names_for_category([&tags], "terrain"), vec!["Ground"]);
        assert!(names_for_category([&tags], "walls").is_empty());
    }

    #[test]
    fn invalid_file_yields_no_tags() {
        assert!(parse_tags("p1", "not json").is_empty());
    }
}
