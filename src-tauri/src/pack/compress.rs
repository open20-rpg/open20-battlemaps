//! "Optimize images" of an installed pack: every texture is recompressed in
//! place, like PNG compressors do (a palette of up to 256 colors, dithered,
//! with transparency), keeping its file name and format so maps, tags and
//! definitions still find it. Irreversible by design: no copy is kept, so it
//! never needs twice the space.
//!
//! Packs can be several GB with tens of thousands of files: files are taken
//! in small batches (a few decoded at once, in parallel), each written to a
//! temporary file and then renamed over the original — a crash leaves either
//! the old or the new image, never a broken one.

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, RgbaImage};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::assetdefs::pack_asset_defs;
use super::library::clear_library;
use super::optimize;
use super::recolor::pack_colorable_set;
use super::registry::{build_installed, dir_stats, pack_dir, update_registry, InstalledPack};
use super::{PackError, Result};

/// Set to stop the running optimization after the current batch.
static CANCEL: AtomicBool = AtomicBool::new(false);

pub(crate) fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Files smaller than this aren't worth touching.
const MIN_BYTES: u64 = 8 * 1024;

/// A recompressed file is kept only if it's at most this share of the old
/// one: below that the saving isn't worth any loss (and an image already
/// compressed this way is left alone when run again).
const KEEP_RATIO: f64 = 0.85;

/// Largest mean color error (0–255 per channel) a palette may introduce.
/// Above it (smooth photographic gradients) the PNG is left as it is.
const MAX_PALETTE_ERROR: f64 = 4.0;

/// Quality of recompressed WebP and JPEG files.
const LOSSY_QUALITY: u8 = 85;

/// Images decoded at the same time (bounds memory on huge packs).
fn workers() -> usize {
    std::thread::available_parallelism()
        .map_or(2, |n| n.get())
        .clamp(1, 3)
}

/// Where temporary files go: beside the packs folder (same disk, so the
/// rename is instant), never inside a pack, where the library would list them.
fn temp_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| PackError::Other(e.to_string()))?
        .join("optimize-tmp");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Remove temporary files left by an optimization the app closed during.
pub(crate) fn clear_temp(app: &AppHandle) {
    if let Ok(dir) = temp_dir(app) {
        let _ = fs::remove_dir_all(dir);
    }
}

// ---------------------------------------------------------------------------
// One image
// ---------------------------------------------------------------------------

/// A palette version of `img` as an indexed PNG, if the palette stays
/// faithful (see MAX_PALETTE_ERROR).
fn palette_png(img: &RgbaImage) -> Option<Vec<u8>> {
    let (w, h) = img.dimensions();
    let qimg = quantizr::Image::new(img.as_raw(), w as usize, h as usize).ok()?;
    let mut res = quantizr::QuantizeResult::quantize(&qimg, &quantizr::Options::default());
    res.set_dithering_level(1.0).ok()?;
    let mut indices = vec![0u8; (w * h) as usize];
    res.remap_image(&qimg, &mut indices).ok()?;
    let pal = res.get_palette();
    let colors = &pal.entries[..pal.count as usize];
    if mean_error(img, &indices, colors) > MAX_PALETTE_ERROR {
        return None;
    }
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(Cursor::new(&mut out), w, h);
    enc.set_color(png::ColorType::Indexed);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_palette(
        colors
            .iter()
            .flat_map(|c| [c.r, c.g, c.b])
            .collect::<Vec<_>>(),
    );
    if colors.iter().any(|c| c.a < 255) {
        enc.set_trns(colors.iter().map(|c| c.a).collect::<Vec<_>>());
    }
    enc.set_compression(png::Compression::High);
    enc.set_filter(png::Filter::NoFilter);
    let mut writer = enc.write_header().ok()?;
    writer.write_image_data(&indices).ok()?;
    writer.finish().ok()?;
    Some(out)
}

/// Mean per-channel difference between `img` and its palette version, with
/// color weighted by opacity (invisible pixels' color doesn't matter).
fn mean_error(img: &RgbaImage, indices: &[u8], colors: &[quantizr::Color]) -> f64 {
    let mut sum = 0f64;
    for (px, &i) in img.pixels().zip(indices) {
        let Some(c) = colors.get(i as usize) else {
            return f64::MAX;
        };
        let [r, g, b, a] = px.0;
        let alpha = a as f64 / 255.0;
        let d = |x: u8, y: u8| (x as f64 - y as f64).abs();
        sum += (d(r, c.r) + d(g, c.g) + d(b, c.b)) / 3.0 * alpha + d(a, c.a);
    }
    sum / indices.len().max(1) as f64
}

fn jpeg(img: &RgbaImage) -> Option<Vec<u8>> {
    let rgb = image::DynamicImage::ImageRgba8(img.clone()).into_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(Cursor::new(&mut out), LOSSY_QUALITY)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .ok()?;
    Some(out)
}

/// The recompressed bytes of an image in its own format, if they're worth it.
pub(crate) fn recompress(img: &RgbaImage, ext: &str, old_len: u64) -> Option<Vec<u8>> {
    let new = match ext {
        "png" => palette_png(img)?,
        "webp" => optimize::webp_lossy(img, LOSSY_QUALITY as f32).ok()?,
        "jpg" | "jpeg" => jpeg(img)?,
        _ => return None,
    };
    ((new.len() as f64) <= old_len as f64 * KEEP_RATIO).then_some(new)
}

/// Optimize one file in place. Returns the bytes it saved.
fn optimize_file(path: &Path, tmp_dir: &Path) -> u64 {
    let Ok(old_len) = fs::metadata(path).map(|m| m.len()) else {
        return 0;
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if old_len < MIN_BYTES {
        return 0;
    }
    let Ok(img) = fs::File::open(path)
        .map_err(PackError::Io)
        .and_then(optimize::decode_file)
    else {
        return 0;
    };
    let Some(bytes) = recompress(&img, &ext, old_len) else {
        return 0;
    };
    drop(img);
    // Write beside, then swap: the original is only replaced by a whole file.
    let tmp = tmp_dir.join(format!(
        "{:x}.tmp",
        md5::compute(path.to_string_lossy().as_bytes())
    ));
    if fs::write(&tmp, &bytes).is_err() || fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
        return 0;
    }
    old_len - bytes.len() as u64
}

// ---------------------------------------------------------------------------
// A whole pack
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    pack: &'a str,
    index: usize,
    total: usize,
    saved_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeReport {
    /// Pack size before and after, in bytes.
    before: u64,
    after: u64,
    /// Images looked at, and those made smaller.
    files: usize,
    optimized: usize,
    /// Stopped before the end (what was done stays done).
    cancelled: bool,
    pack: InstalledPack,
}

/// Every image texture of the pack, minus colorable ones: those are
/// recolored by their exact red regions, which a palette would alter.
fn images_to_optimize(app: &AppHandle, id: &str, dir: &Path) -> Vec<PathBuf> {
    let colorable = pack_colorable_set(app, id);
    let defs = pack_asset_defs(app, id);
    let custom: HashSet<String> = defs
        .iter()
        .filter(|(_, d)| d.custom_color)
        .map(|(k, _)| k.clone())
        .collect();
    let mut out = Vec::new();
    let mut stack = vec![dir.join("textures")];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(ext.as_str(), "png" | "webp" | "jpg" | "jpeg") {
                continue;
            }
            let rel = p
                .strip_prefix(dir)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/");
            if colorable.contains(&rel) || custom.contains(&super::assetdefs::def_key(&rel)) {
                continue;
            }
            out.push(p);
        }
    }
    out.sort();
    out
}

pub(crate) fn optimize_pack(app: &AppHandle, id: &str) -> Result<OptimizeReport> {
    let _g = super::userpack::lock();
    CANCEL.store(false, Ordering::SeqCst);
    let dir = pack_dir(app, id)?;
    if !dir.is_dir() {
        return Err(PackError::NotInstalled(id.to_string()));
    }
    let name = super::registry::read_installed_manifest(&dir)
        .name
        .unwrap_or_else(|| id.to_string());
    let tmp = temp_dir(app)?;
    let (_, before) = dir_stats(&dir);
    let files = images_to_optimize(app, id, &dir);
    let total = files.len();
    let mut saved = 0u64;
    let mut optimized = 0usize;
    let mut done = 0usize;
    let mut last_emit: Option<Instant> = None;
    let mut cancelled = false;

    for batch in files.chunks(workers()) {
        if CANCEL.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let results: Vec<u64> = std::thread::scope(|s| {
            let handles: Vec<_> = batch
                .iter()
                .map(|p| s.spawn(|| optimize_file(p, &tmp)))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or(0)).collect()
        });
        for r in results {
            saved += r;
            optimized += usize::from(r > 0);
        }
        done += batch.len();
        let now = Instant::now();
        if done == total || last_emit.is_none_or(|t| now - t >= Duration::from_millis(150)) {
            last_emit = Some(now);
            let _ = app.emit(
                "pack-optimize-progress",
                Progress {
                    pack: &name,
                    index: done,
                    total,
                    saved_bytes: saved,
                },
            );
        }
    }

    let (count, after) = dir_stats(&dir);
    let reg = update_registry(app, |reg| {
        let e = reg.entry(id.to_string()).or_default();
        e.file_count = Some(count);
        e.size_bytes = Some(after);
        if !cancelled {
            e.optimized = true;
        }
        e.clone()
    })?;
    clear_library(app);
    let pack = build_installed(app, id, &reg).ok_or(PackError::NotInstalled(id.to_string()))?;
    Ok(OptimizeReport {
        before,
        after,
        files: total,
        optimized,
        cancelled,
        pack,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    /// Few flat colors with a soft shadow: like a drawn object.
    fn drawn(w: u32, h: u32) -> RgbaImage {
        let mut img = RgbaImage::new(w, h);
        let mut seed = 11u32;
        for (x, y, px) in img.enumerate_pixels_mut() {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            // A little grain, like a painted texture.
            let grain = ((seed >> 16) % 5) as u8;
            let inside = x > w / 8 && x < w * 7 / 8 && y > h / 8 && y < h * 7 / 8;
            *px = if inside {
                let band = ((x / 9 + y / 13) % 6) as u8;
                Rgba([
                    120 + band * 12 + grain,
                    70 + band * 5 + grain,
                    40 + grain,
                    255,
                ])
            } else {
                Rgba([0, 0, 0, ((x % 16) * 4) as u8])
            };
        }
        img
    }

    fn png_bytes(img: &RgbaImage) -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img.clone())
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn palette_png_keeps_size_transparency_and_looks() {
        let img = drawn(200, 120);
        let png = palette_png(&img).expect("faithful palette");
        let back = image::load_from_memory(&png).unwrap().into_rgba8();
        assert_eq!(back.dimensions(), (200, 120));
        assert_eq!(back.get_pixel(0, 0).0[3], 0);
        assert_eq!(back.get_pixel(100, 60).0[3], 255);
        // Close to the original everywhere.
        let diff: u64 = img
            .pixels()
            .zip(back.pixels())
            .map(|(a, b)| (a.0[0] as i32 - b.0[0] as i32).unsigned_abs() as u64)
            .sum();
        assert!(diff / (200 * 120) < 6);
    }

    #[test]
    fn keeps_only_worthwhile_savings() {
        let img = drawn(256, 256);
        let old = png_bytes(&img).len() as u64;
        let new = recompress(&img, "png", old).expect("smaller");
        assert!((new.len() as u64) < old);
        // Pretending the original was already tiny: nothing to gain.
        assert!(recompress(&img, "png", 100).is_none());
        assert!(recompress(&img, "gif", old).is_none());
    }

    #[test]
    fn replaces_files_in_place() {
        let dir = std::env::temp_dir().join(format!("o20-compress-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let tmp = dir.join("tmp");
        fs::create_dir_all(&tmp).unwrap();
        let file = dir.join("a.png");
        fs::write(&file, png_bytes(&drawn(256, 256))).unwrap();
        let before = fs::metadata(&file).unwrap().len();
        let saved = optimize_file(&file, &tmp);
        let after = fs::metadata(&file).unwrap().len();
        assert!(saved > 0);
        assert_eq!(before - after, saved);
        // Still a readable PNG under the same name; no temporary left.
        assert_eq!(image::open(&file).unwrap().width(), 256);
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
        // A second pass finds nothing worth doing.
        assert_eq!(optimize_file(&file, &tmp), 0);
        fs::remove_dir_all(&dir).unwrap();
    }
}
