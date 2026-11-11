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
pub(crate) fn strip_trailing_commas(s: &str) -> String {
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

impl Default for ColorCfg {
    /// Dungeondraft's own thresholds (CustomColors.shader).
    fn default() -> Self {
        ColorCfg {
            enabled: true,
            min_redness: 0.1,
            min_saturation: 0.0,
            red_tolerance: 0.04,
        }
    }
}

/// How an image takes its color (the `mode` query parameter).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Mode {
    /// Colorable objects (CustomColors.shader), with the pack's thresholds.
    Object,
    /// "custom_color" tilesets and colorable patterns (TilesetCustomColor.shader).
    Tileset,
    /// Walls and "normal" tilesets: the whole image multiplied by the color
    /// (Wall/Tileset shaders; used for their thumbnails).
    Tint,
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// One pixel (straight RGBA, 0–1) recolored by `tint` as Dungeondraft does.
fn recolor_pixel(o: [f32; 4], tint: [f32; 4], mode: Mode, cfg: &ColorCfg) -> [f32; 4] {
    let [r, g, b, a] = o;
    let redness = r - (g + b) * 0.5;
    match mode {
        Mode::Tint => [r * tint[0], g * tint[1], b * tint[2], a],
        Mode::Tileset => {
            if redness <= 0.0 {
                return o;
            }
            let k = smoothstep(0.0, 0.5, redness);
            let mix = |x: f32, y: f32| x + (y - x) * k;
            [
                mix(r, tint[0] * r),
                mix(g, tint[1] * r),
                mix(b, tint[2] * r),
                a,
            ]
        }
        Mode::Object => {
            let is_red = (g - b).abs() <= cfg.red_tolerance;
            let sat_ok = 1.0 - (g + b) * 0.5 >= cfg.min_saturation;
            if !(is_red && sat_ok && redness > cfg.min_redness) {
                return o;
            }
            let mut texel = [r * tint[0], r * tint[1], r * tint[2]];
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            if l > 0.333 {
                let k = l - 0.333;
                for c in &mut texel {
                    *c += (1.0 - *c) * k;
                }
            }
            [texel[0], texel[1], texel[2], a * tint[3]]
        }
    }
}

/// Recolor a PNG as Dungeondraft's shader would draw it with `color`. Returns PNG bytes.
fn recolor_png(bytes: &[u8], color: [u8; 4], mode: Mode, cfg: &ColorCfg) -> Option<Vec<u8>> {
    let mut img = image::load_from_memory(bytes).ok()?.to_rgba8();
    let f = |v: u8| v as f32 / 255.0;
    let tint = [f(color[0]), f(color[1]), f(color[2]), f(color[3])];
    for px in img.pixels_mut() {
        if px.0[3] == 0 {
            continue;
        }
        let out = recolor_pixel(px.0.map(f), tint, mode, cfg);
        px.0 = out.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
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

    // Optional ?color=…[&mode=tileset] → recolored as Dungeondraft would.
    // The frontend only asks for colorable assets (see library.rs).
    let param = |key: &str| {
        uri.query().and_then(|q| {
            q.split('&')
                .find_map(|kv| kv.strip_prefix(key))
                .and_then(|v| urlencoding::decode(v).ok())
                .map(|v| v.into_owned())
        })
    };
    let color = param("color=").and_then(|v| parse_hex_color(&v));
    let mode = match param("mode=").as_deref() {
        Some("tileset") => Mode::Tileset,
        Some("tint") => Mode::Tint,
        _ => Mode::Object,
    };
    let recolored = color.and_then(|c| {
        let rel = canon.strip_prefix(&root).ok()?;
        let pack_id = rel.iter().next()?.to_string_lossy().into_owned();
        let cfg = pack_color_cfg(app, &pack_id).unwrap_or_default();
        recolor_png(&bytes, c, mode, &cfg)
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
    fn recolors_like_dungeondraft() {
        let cfg = ColorCfg::default();
        let green = [0.0, 1.0, 0.0, 1.0];
        // Objects: pure red takes the tint (scaled by the red), others don't.
        let red = recolor_pixel([1.0, 0.0, 0.0, 1.0], green, Mode::Object, &cfg);
        assert_eq!(red, [0.0, 1.0, 0.0, 1.0]);
        let grey = [0.5, 0.5, 0.5, 1.0];
        assert_eq!(recolor_pixel(grey, green, Mode::Object, &cfg), grey);
        // Uneven green/blue isn't red (|g − b| > 0.04).
        let orange = [1.0, 0.5, 0.0, 1.0];
        assert_eq!(recolor_pixel(orange, green, Mode::Object, &cfg), orange);
        // Tilesets: full red (redness ≥ 0.5) becomes tint × r; half-red blends.
        let t = recolor_pixel([0.8, 0.0, 0.0, 1.0], green, Mode::Tileset, &cfg);
        assert!((t[1] - 0.8).abs() < 1e-6 && t[0].abs() < 1e-6);
        assert_eq!(recolor_pixel(grey, green, Mode::Tileset, &cfg), grey);
        // Tint: everything multiplied.
        let t = recolor_pixel(grey, [0.5, 1.0, 0.0, 1.0], Mode::Tint, &cfg);
        assert_eq!(t, [0.25, 0.5, 0.0, 1.0]);
    }

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
