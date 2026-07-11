//! Colorable assets & on-the-fly recoloring (the `recolor://` protocol).

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use super::library::LibraryState;
use super::mime_for;
use super::registry::{pack_dir, packs_root};

/// A pack's `custom_color_overrides` from pack.json — the thresholds that decide
/// which pixels of a colorable asset are the (red) recolorable region.
#[derive(Clone, Copy, Deserialize)]
pub(crate) struct ColorCfg {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    min_redness: f32,
    #[serde(default = "one_f32")]
    min_saturation: f32,
    #[serde(default)]
    red_tolerance: f32,
}
fn one_f32() -> f32 {
    1.0
}

#[derive(Deserialize)]
struct PackJsonColor {
    custom_color_overrides: Option<ColorCfg>,
}

/// Load (and cache) a pack's colorable config from its pack.json.
pub(crate) fn pack_color_cfg(app: &AppHandle, pack_id: &str) -> Option<ColorCfg> {
    let state = app.state::<LibraryState>();
    if let Some(cached) = state
        .color_cfg
        .lock()
        .ok()
        .and_then(|m| m.get(pack_id).copied())
    {
        return cached;
    }
    let cfg = pack_dir(app, pack_id)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("pack.json")).ok())
        .and_then(|txt| serde_json::from_str::<PackJsonColor>(&txt).ok())
        .and_then(|p| p.custom_color_overrides)
        .filter(|c| c.enabled);
    if let Ok(mut m) = state.color_cfg.lock() {
        m.insert(pack_id.to_string(), cfg);
    }
    cfg
}

#[derive(Deserialize)]
struct TagsFile {
    #[serde(default)]
    tags: ColorableOnly,
}
#[derive(Default, Deserialize)]
struct ColorableOnly {
    #[serde(rename = "Colorable", default)]
    colorable: Vec<String>,
}

/// Remove JSON5-style trailing commas (`,` right before `]`/`}`) while respecting
/// string literals, so the (large) Dungeondraft tags files parse with strict,
/// fast serde_json instead of the much slower json5 parser.
fn strip_trailing_commas(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_str = false;
    let mut esc = false;
    for ch in s.chars() {
        if in_str {
            out.push(ch);
            if esc {
                esc = false;
            } else if ch == '\\' {
                esc = true;
            } else if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                out.push(ch);
            }
            ']' | '}' => {
                let end = out.trim_end().len();
                let new_len = if out[..end].ends_with(',') {
                    end - 1
                } else {
                    end
                };
                out.truncate(new_len);
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Load (and cache) the set of colorable texture rel-paths for a pack, read from
/// `data/default.dungeondraft_tags` (`tags.Colorable`).
pub(crate) fn pack_colorable_set(app: &AppHandle, pack_id: &str) -> Arc<HashSet<String>> {
    let state = app.state::<LibraryState>();
    if let Some(set) = state
        .colorable
        .lock()
        .ok()
        .and_then(|m| m.get(pack_id).cloned())
    {
        return set;
    }
    let set: HashSet<String> = pack_dir(app, pack_id)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("data/default.dungeondraft_tags")).ok())
        .and_then(|txt| {
            // Tags files use trailing commas; strip them for strict serde, and
            // fall back to json5 for anything else non-standard.
            serde_json::from_str::<TagsFile>(&strip_trailing_commas(&txt))
                .or_else(|_| json5::from_str::<TagsFile>(&txt))
                .ok()
        })
        .map(|t| t.tags.colorable.into_iter().collect())
        .unwrap_or_default();
    let arc = Arc::new(set);
    if let Ok(mut m) = state.colorable.lock() {
        m.insert(pack_id.to_string(), arc.clone());
    }
    arc
}

/// Is this pixel part of the recolorable (red) region, per the pack thresholds?
fn is_colorable_pixel(r: u8, g: u8, b: u8, cfg: &ColorCfg) -> bool {
    // Red must lead the other channels.
    if r < g || r < b {
        return false;
    }
    let rf = r as f32 / 255.0;
    let redness = rf - (g.max(b) as f32 / 255.0);
    if redness < cfg.min_redness {
        return false;
    }
    // HSV saturation (maxc = r here, and r > 0 because redness > 0).
    let minc = r.min(g).min(b);
    let sat = (r - minc) as f32 / r as f32;
    if sat < cfg.min_saturation {
        return false;
    }
    // How far the "red" is allowed to tint toward green/blue.
    (g as i32 - b as i32).abs() as f32 / 255.0 <= cfg.red_tolerance
}

/// Recolor a PNG's colorable (red) pixels to `color` (RGBA), preserving shading
/// (the red brightness becomes the new colour's brightness). Returns PNG bytes.
fn recolor_png(bytes: &[u8], color: [u8; 4], cfg: &ColorCfg) -> Option<Vec<u8>> {
    let mut img = image::load_from_memory(bytes).ok()?.to_rgba8();
    let (cr, cg, cb, ca) = (
        color[0] as f32,
        color[1] as f32,
        color[2] as f32,
        color[3] as f32 / 255.0,
    );
    for px in img.pixels_mut() {
        let [r, g, b, a] = px.0;
        if a == 0 || !is_colorable_pixel(r, g, b, cfg) {
            continue;
        }
        let lum = r.max(g).max(b) as f32 / 255.0; // brightness from the red shade
        px.0 = [
            (cr * lum) as u8,
            (cg * lum) as u8,
            (cb * lum) as u8,
            (a as f32 * ca) as u8,
        ];
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .ok()?;
    Some(out.into_inner())
}

/// Parse "#rrggbb" / "#rrggbbaa" / "rrggbbaa" into RGBA bytes.
fn parse_hex_color(s: &str) -> Option<[u8; 4]> {
    let s = s.trim_start_matches('#');
    let byte = |i: usize| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok();
    match s.len() {
        6 => Some([byte(0)?, byte(1)?, byte(2)?, 255]),
        8 => Some([byte(0)?, byte(1)?, byte(2)?, byte(3)?]),
        _ => None,
    }
}

/// Custom URI scheme `recolor://` serving pack images, optionally recoloured.
///
/// URL: `convertFileSrc(absPath, "recolor")` + `?color=RRGGBBAA`. Without a
/// colour (or if the pack has no colorable config) the original bytes are served
/// unchanged, so non-colorable images keep a stable, webview-cached URL.
pub fn recolor_protocol(
    ctx: tauri::UriSchemeContext<tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        responder.respond(build_recolor_response(&app, request.uri()));
    });
}

fn build_recolor_response(
    app: &AppHandle,
    uri: &tauri::http::Uri,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode};
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    };

    // Decode the absolute file path from the URL path (convertFileSrc-encoded).
    let Some(path) = urlencoding::decode(uri.path()).ok().map(|p| {
        let p = p.trim_start_matches('/');
        PathBuf::from(format!("/{p}"))
    }) else {
        return not_found();
    };
    // Security: only ever serve files under the packs root.
    let Some(root) = packs_root(app).ok().and_then(|r| r.canonicalize().ok()) else {
        return not_found();
    };
    let Ok(canon) = path.canonicalize() else {
        return not_found();
    };
    if !canon.starts_with(&root) {
        return not_found();
    }
    let Ok(bytes) = fs::read(&canon) else {
        return not_found();
    };

    // Optional ?color=... → recolor if the owning pack has a colorable config.
    let color = uri.query().and_then(|q| {
        q.split('&')
            .find_map(|kv| kv.strip_prefix("color="))
            .and_then(|v| urlencoding::decode(v).ok())
            .and_then(|v| parse_hex_color(&v))
    });
    let recolored = color.and_then(|c| {
        let rel = canon.strip_prefix(&root).ok()?;
        let pack_id = rel.iter().next()?.to_string_lossy().into_owned();
        let cfg = pack_color_cfg(app, &pack_id)?;
        recolor_png(&bytes, c, &cfg)
    });

    let (body, ctype) = match recolored {
        Some(png) => (png, "image/png".to_string()),
        None => (bytes, mime_for(&canon)),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", ctype)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_color_variants() {
        assert_eq!(parse_hex_color("#ff0080"), Some([255, 0, 128, 255]));
        assert_eq!(parse_hex_color("ff008040"), Some([255, 0, 128, 64]));
        assert_eq!(parse_hex_color("#fff"), None);
        assert_eq!(parse_hex_color("zzzzzz"), None);
    }

    #[test]
    fn strip_trailing_commas_respects_strings() {
        assert_eq!(strip_trailing_commas("[1, 2, 3,]"), "[1, 2, 3]");
        assert_eq!(
            strip_trailing_commas("{\"a\": [1,\n2,\n],}"),
            "{\"a\": [1,\n2]}"
        );
        // Commas inside string literals must be preserved.
        assert_eq!(strip_trailing_commas("[\"a,\"]"), "[\"a,\"]");
    }
}
