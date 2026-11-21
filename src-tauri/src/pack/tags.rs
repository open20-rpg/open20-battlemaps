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
/// (`textures/...`): some packs write full `res://packs/<id>/...` paths
/// (`prefix` is that `res://packs/<id>/`).
fn normalize_path(prefix: &str, path: &str) -> String {
    let p = if path.contains('\\') { path.replace('\\', "/") } else { path.to_string() };
    match p.strip_prefix(prefix) {
        Some(rest) => rest.to_string(),
        None => p,
    }
}

/// Parse a tags file. Tags files use trailing commas, so they go through the
/// same stripping as the colorable lookup (falling back to json5).
pub(crate) fn parse_tags(pack_id: &str, txt: &str) -> TagMap {
    let raw: RawTagsFile = serde_json::from_str(&strip_trailing_commas(txt))
        .or_else(|_| json5::from_str(txt))
        .unwrap_or_default();
    let prefix = format!("res://packs/{pack_id}/");
    raw.tags
        .into_iter()
        // "Colorable" is a capability flag, not a browsable group.
        .filter(|(name, _)| name != "Colorable")
        .map(|(name, paths)| {
            let set = paths.iter().map(|p| normalize_path(&prefix, p)).collect();
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

/// A pack's tag names for `category` (cached: the scan goes over every tagged path).
fn pack_names(app: &AppHandle, pack_id: &str, category: &str) -> Arc<Vec<String>> {
    let state = app.state::<LibraryState>();
    let key = format!("{pack_id}/{category}");
    if let Some(n) = state.tag_names.lock().ok().and_then(|m| m.get(&key).cloned()) {
        return n;
    }
    let tags = pack_tags(app, pack_id);
    let names = Arc::new(names_for_category([tags.as_ref()], category));
    if let Ok(mut m) = state.tag_names.lock() {
        m.insert(key, names.clone());
    }
    names
}

/// Tag names available for `category` across every enabled pack.
pub(crate) fn tags_for_category(app: &AppHandle, category: &str) -> Vec<String> {
    let reg = read_registry(app);
    let mut out = BTreeSet::new();
    for (id, _) in reg.iter().filter(|(_, r)| r.enabled) {
        out.extend(pack_names(app, id, category).iter().cloned());
    }
    out.into_iter().collect()
}

/// Read every enabled pack's tags (and colorable set) in the background, so
/// the Library's Tags tab opens at once instead of parsing megabytes of tag
/// files on first use. Called at startup and whenever packs change.
pub(crate) fn prewarm(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let reg = read_registry(&app);
        for (id, _) in reg.iter().filter(|(_, r)| r.enabled) {
            let _ = pack_tags(&app, id);
            let _ = super::recolor::pack_colorable_set(&app, id);
            let _ = pack_names(&app, id, "objects");
        }
    });
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
