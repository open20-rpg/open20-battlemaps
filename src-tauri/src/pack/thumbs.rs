//! Library thumbnails for textures a pack ships none for, made the way
//! Dungeondraft makes them and written where the pack's own would be
//! (`thumbnails/<md5 of the res:// path>.png` in the installed pack), so
//! they're made once and served like shipped ones.

use std::fs;
use std::path::Path;

use image::imageops::{self, FilterType};
use image::RgbaImage;

/// How a category's thumbnails are cut (Dungeondraft's rules).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Rule {
    /// Floors and patterns: the top-left tile (256 px) shrunk to 64 × 64.
    Tile,
    /// Walls (32) and paths (48): transparent borders trimmed, scaled to this
    /// height, cut to STRIP_WIDTH from the left.
    Strip(u32),
    /// Terrain: the whole texture shrunk to this square, opaque — terrain
    /// alpha is the height used to blend terrains, not transparency.
    Square(u32),
    /// Everything else: shrunk until the longer side is this long.
    Fit(u32),
}

/// One grid tile, in texture px.
const TILE_PX: u32 = 256;
/// Thumbnail side of grid cells.
const CELL_PX: u32 = 64;
/// Widest a wall or path strip thumbnail gets.
const STRIP_WIDTH: u32 = 228;

/// The rule for a texture, by its category folder (`textures/<category>/…`).
pub(crate) fn rule_for(rel_path: &str) -> Rule {
    match rel_path.split('/').nth(1).unwrap_or("") {
        "tilesets" | "patterns" | "materials" => Rule::Tile,
        "walls" => Rule::Strip(32),
        "paths" => Rule::Strip(48),
        "terrain" => Rule::Square(160),
        _ => Rule::Fit(CELL_PX),
    }
}

/// The smallest rectangle holding every non-transparent pixel (x, y, w, h).
fn opaque_bounds(img: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
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

/// Make a thumbnail of `img` by `rule`.
pub(crate) fn make(img: &RgbaImage, rule: Rule) -> RgbaImage {
    let (w, h) = img.dimensions();
    let shrink = |src: &RgbaImage, nw: u32, nh: u32| {
        imageops::resize(src, nw.max(1), nh.max(1), FilterType::Triangle)
    };
    match rule {
        Rule::Tile => {
            let tile = imageops::crop_imm(img, 0, 0, w.min(TILE_PX), h.min(TILE_PX)).to_image();
            shrink(&tile, CELL_PX, CELL_PX)
        }
        Rule::Strip(height) => {
            let (x, y, bw, bh) = opaque_bounds(img).unwrap_or((0, 0, w, h));
            let trimmed = imageops::crop_imm(img, x, y, bw, bh).to_image();
            let nw = ((bw as f32) * height as f32 / bh as f32).round() as u32;
            let scaled = shrink(&trimmed, nw, height);
            let keep = scaled.width().min(STRIP_WIDTH);
            imageops::crop_imm(&scaled, 0, 0, keep, height).to_image()
        }
        Rule::Square(side) => {
            let mut t = shrink(img, side, side);
            for px in t.pixels_mut() {
                px.0[3] = 255;
            }
            t
        }
        Rule::Fit(side) => {
            let k = side as f32 / w.max(h) as f32;
            if k >= 1.0 {
                return img.clone();
            }
            shrink(
                img,
                (w as f32 * k).round() as u32,
                (h as f32 * k).round() as u32,
            )
        }
    }
}

/// Make `full`'s thumbnail at `path` by `rule`. False if the texture can't be read.
pub(crate) fn generate(full: &Path, path: &Path, rule: Rule) -> bool {
    let Ok(img) = image::open(full) else {
        return false;
    };
    let thumb = make(&img.to_rgba8(), rule);
    path.parent()
        .is_some_and(|dir| fs::create_dir_all(dir).is_ok())
        && thumb.save(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn picks_rules_by_category() {
        assert_eq!(rule_for("textures/tilesets/wood.png"), Rule::Tile);
        assert_eq!(rule_for("textures/materials/grass_tile.png"), Rule::Tile);
        assert_eq!(rule_for("textures/walls/stone.png"), Rule::Strip(32));
        assert_eq!(rule_for("textures/paths/road.png"), Rule::Strip(48));
        assert_eq!(rule_for("textures/terrain/grass.png"), Rule::Square(160));
        assert_eq!(rule_for("textures/objects/chair.png"), Rule::Fit(64));
    }

    #[test]
    fn cuts_like_dungeondraft() {
        // A 512 × 512 floor: only its top-left tile, at 64 × 64.
        let floor = RgbaImage::from_pixel(512, 512, Rgba([255, 0, 0, 255]));
        assert_eq!(make(&floor, Rule::Tile).dimensions(), (64, 64));
        // A wall strip with transparent rows above and below: trimmed to the
        // opaque 1000 × 100, scaled to 32 px tall (320 wide), cut to 228.
        let mut wall = RgbaImage::new(1000, 160);
        for y in 30..130 {
            for x in 0..1000 {
                wall.put_pixel(x, y, Rgba([200, 200, 200, 255]));
            }
        }
        assert_eq!(make(&wall, Rule::Strip(32)).dimensions(), (228, 32));
        // Objects keep their aspect, longest side 64; small ones stay as is.
        let tall = RgbaImage::new(100, 200);
        assert_eq!(make(&tall, Rule::Fit(64)).dimensions(), (32, 64));
        let small = RgbaImage::new(20, 10);
        assert_eq!(make(&small, Rule::Fit(64)).dimensions(), (20, 10));
        assert_eq!(make(&floor, Rule::Square(160)).dimensions(), (160, 160));
    }

    #[test]
    fn terrain_thumbnails_ignore_the_blend_alpha() {
        // Terrain alpha is blend height: the thumbnail shows the colour as is.
        let terrain = RgbaImage::from_pixel(512, 512, Rgba([90, 140, 60, 70]));
        let t = make(&terrain, Rule::Square(160));
        assert!(t.pixels().all(|p| p.0 == [90, 140, 60, 255]));
        // Other textures keep their transparency.
        let wall = RgbaImage::from_pixel(64, 64, Rgba([90, 140, 60, 70]));
        assert!(make(&wall, Rule::Fit(64)).pixels().all(|p| p.0[3] == 70));
    }
}
