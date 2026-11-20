//! Image processing for assets imported into user packs: decoding with
//! memory limits, the user's adjustments (trim, flip, rotate, scale) and the
//! optimized encoding stored in the pack.
//!
//! Everything here works on one image at a time: callers process a batch
//! sequentially (or a few at a time), so memory stays bounded by the largest
//! single image no matter how many are imported.

use std::fs::File;
use std::io::BufReader;

use image::imageops::{self, FilterType};
use image::{DynamicImage, ImageReader, Limits, RgbaImage};
use serde::Deserialize;

use super::{PackError, Result};

/// Biggest side a stored texture may have. Godot 3 (Dungeondraft) and most
/// GPUs handle 8192; beyond that the texture fails to load or wastes memory.
pub(crate) const MAX_SIDE: u32 = 8192;

/// Most a single decode may allocate (a 16k × 16k RGBA image). Protects the
/// app from a corrupt or absurd file exhausting RAM.
const MAX_DECODE_BYTES: u64 = 1 << 30;

/// What the user adjusted on an image before it goes into the pack.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Adjust {
    /// Resize factor (1 = as is). 256 px = one grid cell.
    pub scale: f32,
    /// Quarter turns clockwise (0–3).
    pub rotate: u8,
    pub flip_h: bool,
    pub flip_v: bool,
    /// Cut fully transparent borders.
    pub trim: bool,
}

impl Default for Adjust {
    fn default() -> Self {
        Self {
            scale: 1.0,
            rotate: 0,
            flip_h: false,
            flip_v: false,
            trim: false,
        }
    }
}

/// How hard to compress.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    /// Pixel-exact (lossless WebP).
    Lossless,
    /// High-quality lossy WebP (exact transparency): several times smaller.
    #[default]
    Balanced,
}

/// Decode an image from a file with allocation limits.
pub(crate) fn decode_file(file: File) -> Result<RgbaImage> {
    let mut reader = ImageReader::new(BufReader::new(file))
        .with_guessed_format()
        .map_err(PackError::Io)?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    let img = reader
        .decode()
        .map_err(|e| PackError::Other(format!("image: {e}")))?;
    Ok(img.into_rgba8())
}

/// The smallest rectangle holding every non-transparent pixel (x, y, w, h).
pub(crate) fn opaque_bounds(img: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, px) in img.enumerate_pixels() {
        if px.0[3] > 0 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    (x0 <= x1).then(|| (x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

pub(crate) fn is_opaque(img: &RgbaImage) -> bool {
    img.pixels().all(|p| p.0[3] == 255)
}

/// Size in px an image of `w` × `h` ends up with after `adj` (before the
/// MAX_SIDE cap), given its opaque bounds when trimming.
pub(crate) fn target_size(w: u32, h: u32, adj: &Adjust) -> (u32, u32) {
    let scale = adj.scale.clamp(0.01, 16.0);
    let (w, h) = if adj.rotate % 2 == 1 { (h, w) } else { (w, h) };
    (
        ((w as f32 * scale).round() as u32).max(1),
        ((h as f32 * scale).round() as u32).max(1),
    )
}

/// Apply the user's adjustments, then cap the result to MAX_SIDE.
pub(crate) fn apply(mut img: RgbaImage, adj: &Adjust) -> RgbaImage {
    if adj.trim {
        if let Some((x, y, w, h)) = opaque_bounds(&img) {
            if (w, h) != img.dimensions() {
                img = imageops::crop_imm(&img, x, y, w, h).to_image();
            }
        }
    }
    if adj.flip_h {
        imageops::flip_horizontal_in_place(&mut img);
    }
    if adj.flip_v {
        imageops::flip_vertical_in_place(&mut img);
    }
    img = match adj.rotate % 4 {
        1 => imageops::rotate90(&img),
        2 => imageops::rotate180(&img),
        3 => imageops::rotate270(&img),
        _ => img,
    };
    let (w, h) = img.dimensions();
    let (mut nw, mut nh) = target_size(w, h, &Adjust { rotate: 0, ..*adj });
    let longest = nw.max(nh);
    if longest > MAX_SIDE {
        let k = MAX_SIDE as f32 / longest as f32;
        nw = ((nw as f32 * k).round() as u32).max(1);
        nh = ((nh as f32 * k).round() as u32).max(1);
    }
    if (nw, nh) != (w, h) {
        // Lanczos keeps detail when shrinking (the common case); a softer
        // filter avoids ringing when enlarging.
        let filter = if nw < w {
            FilterType::Lanczos3
        } else {
            FilterType::CatmullRom
        };
        img = imageops::resize(&img, nw, nh, filter);
    }
    img
}

/// An encoded texture and its file extension.
pub(crate) struct Encoded {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
}

/// WebP quality of the lossy (Balanced) encoding: visually indistinguishable
/// on map textures, several times smaller than lossless.
const LOSSY_QUALITY: f32 = 85.0;

/// Encode with libwebp. Lossy keeps the alpha channel exact (alpha_quality
/// 100): transparency outlines objects and blends terrain.
fn webp(img: &RgbaImage, lossless: bool) -> Result<Vec<u8>> {
    let mut config =
        webp::WebPConfig::new().map_err(|_| PackError::Other("webp: bad config".into()))?;
    config.lossless = i32::from(lossless);
    config.quality = if lossless { 75.0 } else { LOSSY_QUALITY };
    config.alpha_quality = 100;
    // Slower, smaller (4 is libwebp's default; 6 its slowest).
    config.method = 5;
    encode_with(img, &config)
}

/// Encode with libwebp, as RGB when there's no transparency (smaller).
fn encode_with(img: &RgbaImage, config: &webp::WebPConfig) -> Result<Vec<u8>> {
    let opaque = is_opaque(img);
    let rgb;
    let encoder = if opaque {
        rgb = DynamicImage::ImageRgba8(img.clone()).into_rgb8();
        webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height())
    } else {
        webp::Encoder::from_rgba(img.as_raw(), img.width(), img.height())
    };
    let mem = encoder
        .encode_advanced(config)
        .map_err(|e| PackError::Other(format!("webp: {e:?}")))?;
    Ok(mem.to_vec())
}

/// Lossy WebP at `quality` (exact transparency), for recompressing a pack.
pub(crate) fn webp_lossy(img: &RgbaImage, quality: f32) -> Result<Vec<u8>> {
    let mut config =
        webp::WebPConfig::new().map_err(|_| PackError::Other("webp: bad config".into()))?;
    config.quality = quality;
    config.alpha_quality = 100;
    config.method = 5;
    encode_with(img, &config)
}

/// Encode a texture as small as `quality` allows, always as WebP (which
/// Dungeondraft reads, transparency included). `exact` forces lossless:
/// colorable assets are recolored by their exact red regions, which lossy
/// compression would smear. Lossy is only kept when it's smaller.
pub(crate) fn encode(img: &RgbaImage, quality: Quality, exact: bool) -> Result<Encoded> {
    let lossless = webp(img, true)?;
    if quality == Quality::Balanced && !exact {
        let lossy = webp(img, false)?;
        if lossy.len() < lossless.len() {
            return Ok(Encoded {
                bytes: lossy,
                ext: "webp",
            });
        }
    }
    Ok(Encoded {
        bytes: lossless,
        ext: "webp",
    })
}

/// A small copy (longest side `side`) for previews.
pub(crate) fn shrink(img: &RgbaImage, side: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    let k = side as f32 / w.max(h) as f32;
    if k >= 1.0 {
        return img.clone();
    }
    imageops::resize(
        img,
        ((w as f32 * k).round() as u32).max(1),
        ((h as f32 * k).round() as u32).max(1),
        FilterType::Triangle,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn framed(w: u32, h: u32) -> RgbaImage {
        // A transparent canvas with an opaque block in the middle.
        let mut img = RgbaImage::new(w, h);
        for y in h / 4..h * 3 / 4 {
            for x in w / 4..w * 3 / 4 {
                img.put_pixel(x, y, Rgba([200, 10, 10, 255]));
            }
        }
        img
    }

    #[test]
    fn trims_scales_and_rotates() {
        let img = framed(400, 200); // opaque block 200 × 100
        let out = apply(
            img,
            &Adjust {
                trim: true,
                scale: 0.5,
                rotate: 1,
                ..Default::default()
            },
        );
        assert_eq!(out.dimensions(), (50, 100));
        assert!(is_opaque(&out));
    }

    #[test]
    fn target_size_swaps_sides_on_quarter_turns() {
        let a = Adjust {
            scale: 2.0,
            rotate: 3,
            ..Default::default()
        };
        assert_eq!(target_size(100, 30, &a), (60, 200));
        assert_eq!(target_size(100, 30, &Adjust::default()), (100, 30));
    }

    #[test]
    fn caps_huge_results() {
        let img = RgbaImage::new(1000, 500);
        let out = apply(
            img,
            &Adjust {
                scale: 16.0,
                ..Default::default()
            },
        );
        assert_eq!(out.dimensions(), (MAX_SIDE, MAX_SIDE / 2));
    }

    #[test]
    fn flips() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        let out = apply(
            img,
            &Adjust {
                flip_h: true,
                ..Default::default()
            },
        );
        assert_eq!(out.get_pixel(1, 0).0, [255, 0, 0, 255]);
        assert_eq!(out.get_pixel(0, 0).0[3], 0);
    }

    #[test]
    fn lossless_is_pixel_exact() {
        let img = framed(64, 64);
        let enc = encode(&img, Quality::Lossless, false).unwrap();
        assert_eq!(enc.ext, "webp");
        let back = image::load_from_memory(&enc.bytes).unwrap().into_rgba8();
        assert_eq!(back, img);
    }

    fn noise(w: u32, h: u32, alpha: bool) -> RgbaImage {
        let mut img = RgbaImage::new(w, h);
        let mut seed = 7u32;
        for (x, _, px) in img.enumerate_pixels_mut() {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            let v = (seed >> 16) as u8;
            let a = if alpha && x < w / 3 { 0 } else { 255 };
            *px = Rgba([v, v.wrapping_mul(3), v.wrapping_add(90), a]);
        }
        img
    }

    #[test]
    fn balanced_is_lossy_smaller_and_keeps_transparency() {
        let img = noise(128, 128, true);
        let lossless = encode(&img, Quality::Lossless, false).unwrap();
        let balanced = encode(&img, Quality::Balanced, false).unwrap();
        assert!(balanced.bytes.len() < lossless.bytes.len());
        let back = image::load_from_memory(&balanced.bytes)
            .unwrap()
            .into_rgba8();
        assert_eq!(back.dimensions(), (128, 128));
        // The transparent band stays transparent, the rest opaque.
        assert_eq!(back.get_pixel(5, 5).0[3], 0);
        assert_eq!(back.get_pixel(100, 5).0[3], 255);
    }

    #[test]
    fn exact_assets_stay_lossless() {
        let img = noise(64, 64, false);
        let enc = encode(&img, Quality::Balanced, true).unwrap();
        let back = image::load_from_memory(&enc.bytes).unwrap().into_rgba8();
        assert_eq!(back, img);
    }

    #[test]
    fn finds_opaque_bounds() {
        assert_eq!(opaque_bounds(&framed(8, 4)), Some((2, 1, 4, 2)));
        assert_eq!(opaque_bounds(&RgbaImage::new(3, 3)), None);
    }

    #[test]
    fn adjust_defaults_when_fields_are_missing() {
        let a: Adjust = serde_json::from_str(r#"{"scale": 0.5}"#).unwrap();
        assert_eq!(a.scale, 0.5);
        assert_eq!(a.rotate, 0);
        assert!(!a.trim);
    }
}
