//! Map image export (PNG, JPEG, WebP).
//!
//! The frontend renders the map in horizontal bands and sends each band's
//! raw RGBA rows here as it goes. A PNG is encoded straight into the file as
//! rows arrive (neither side ever holds the whole image); JPEG and WebP
//! encoders need the whole picture, so their rows are collected (JPEG as
//! RGB) and encoded at the end. All of it runs on a blocking worker thread,
//! never the webview or the app's main thread, so the UI stays responsive.

use std::io::Write;
use std::sync::Mutex;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

type Sink = Box<dyn Write + Send>;

/// Output format; JPEG carries its quality (1–100).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Format {
    Png,
    Jpeg { quality: u8 },
    Webp,
}

enum Encoding {
    /// PNG rows go straight into the file.
    Png(Box<png::StreamWriter<'static, Sink>>),
    /// Rows kept until the end (RGB for JPEG, RGBA for WebP).
    Buffered { sink: Sink, pixels: Vec<u8> },
}

/// An export in progress: its encoder and how many RGBA bytes are still due.
struct Export {
    format: Format,
    width: u32,
    height: u32,
    encoding: Encoding,
    remaining: u64,
}

/// The export in progress, if any (one at a time).
#[derive(Default)]
pub struct ExportState(Mutex<Option<Export>>);

/// Start an image of `width` × `height` pixels on `sink`.
fn begin(sink: Sink, format: Format, width: u32, height: u32) -> Result<Export, String> {
    if width == 0 || height == 0 {
        return Err("empty image".into());
    }
    let encoding = match format {
        Format::Png => {
            let mut encoder = png::Encoder::new(sink, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let writer = encoder.write_header().map_err(|e| e.to_string())?;
            Encoding::Png(Box::new(
                writer.into_stream_writer().map_err(|e| e.to_string())?,
            ))
        }
        Format::Jpeg { .. } | Format::Webp => {
            let channels = if matches!(format, Format::Jpeg { .. }) {
                3
            } else {
                4
            };
            let size = u64::from(width) * u64::from(height) * channels;
            let mut pixels = Vec::new();
            pixels
                .try_reserve_exact(usize::try_from(size).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            Encoding::Buffered { sink, pixels }
        }
    };
    Ok(Export {
        format,
        width,
        height,
        encoding,
        remaining: u64::from(width) * u64::from(height) * 4,
    })
}

/// Append rows (RGBA, top to bottom); they must not overrun the image.
fn write_rows(export: &mut Export, rows: &[u8]) -> Result<(), String> {
    let len = rows.len() as u64;
    if len > export.remaining || !len.is_multiple_of(4) {
        return Err("more pixel data than the image holds".into());
    }
    match &mut export.encoding {
        Encoding::Png(stream) => stream.write_all(rows).map_err(|e| e.to_string())?,
        Encoding::Buffered { pixels, .. } => match export.format {
            // JPEG has no alpha: keep RGB.
            Format::Jpeg { .. } => {
                for px in rows.chunks_exact(4) {
                    pixels.extend_from_slice(&px[..3]);
                }
            }
            _ => pixels.extend_from_slice(rows),
        },
    }
    export.remaining -= len;
    Ok(())
}

/// Encode a whole picture (`pixels`: RGB for JPEG, RGBA otherwise) into `out`.
fn encode_all(
    format: Format,
    out: &mut dyn Write,
    pixels: &[u8],
    width: u32,
    height: u32,
) -> Result<(), String> {
    match format {
        Format::Jpeg { quality } => JpegEncoder::new_with_quality(out, quality.clamp(1, 100))
            .write_image(pixels, width, height, ExtendedColorType::Rgb8),
        Format::Webp => WebPEncoder::new_lossless(out).write_image(
            pixels,
            width,
            height,
            ExtendedColorType::Rgba8,
        ),
        Format::Png => image::codecs::png::PngEncoder::new(out).write_image(
            pixels,
            width,
            height,
            ExtendedColorType::Rgba8,
        ),
    }
    .map_err(|e| e.to_string())
}

/// Finish the image: every pixel must have been written.
fn finish(export: Export) -> Result<(), String> {
    if export.remaining != 0 {
        return Err("the image is incomplete".into());
    }
    match export.encoding {
        Encoding::Png(stream) => stream.finish().map_err(|e| e.to_string()),
        Encoding::Buffered { mut sink, pixels } => {
            encode_all(
                export.format,
                &mut sink,
                &pixels,
                export.width,
                export.height,
            )?;
            sink.flush().map_err(|e| e.to_string())
        }
    }
}

/// Encoded size of an RGBA picture in `format` (for the export size estimate).
fn encoded_size(format: Format, rgba: &[u8], width: u32, height: u32) -> Result<u64, String> {
    if u64::from(width) * u64::from(height) * 4 != rgba.len() as u64 || rgba.is_empty() {
        return Err("pixel data doesn't match the size".into());
    }
    let rgb: Vec<u8>;
    let pixels = if matches!(format, Format::Jpeg { .. }) {
        rgb = rgba
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        &rgb[..]
    } else {
        rgba
    };
    let mut out = Vec::new();
    encode_all(format, &mut out, pixels, width, height)?;
    Ok(out.len() as u64)
}

fn open_sink(path: &str) -> Result<Sink, String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        let file = crate::android_fs::open_content_uri(path, "w")?;
        return Ok(Box::new(std::io::BufWriter::new(file)));
    }
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    Ok(Box::new(std::io::BufWriter::new(file)))
}

/// Run `f` on a blocking worker thread (file IO and encoding).
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Create the image file at `path` for a `width` × `height` image.
#[tauri::command]
pub async fn export_begin(
    app: AppHandle,
    path: String,
    format: Format,
    width: u32,
    height: u32,
) -> Result<(), String> {
    blocking(move || {
        let export = begin(open_sink(&path)?, format, width, height)?;
        *app.state::<ExportState>().0.lock().unwrap() = Some(export);
        Ok(())
    })
    .await
}

/// The pixels a request carries: its raw body (desktop), or, where the IPC
/// only carries JSON (Android's), `{ "data": "<base64>" }`.
fn body_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    use base64::Engine;
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(json) => {
            let data = json
                .get("data")
                .and_then(|v| v.as_str())
                .ok_or("expected image bytes")?;
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|e| e.to_string())
        }
    }
}

/// Append a band of rows: the request's bytes (see [`body_bytes`]).
#[tauri::command]
pub async fn export_rows(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let rows = body_bytes(request.body())?;
    blocking(move || {
        let state = app.state::<ExportState>();
        let mut guard = state.0.lock().unwrap();
        let export = guard.as_mut().ok_or("no export in progress")?;
        write_rows(export, &rows)
    })
    .await
}

/// Finish (or, with `cancel`, abandon) the export in progress.
#[tauri::command]
pub async fn export_end(app: AppHandle, cancel: bool) -> Result<(), String> {
    blocking(move || {
        let export = app.state::<ExportState>().0.lock().unwrap().take();
        match export {
            Some(e) if !cancel => finish(e),
            _ => Ok(()),
        }
    })
    .await
}

/// Header of [`export_estimate`] carrying its JSON `{format, width, height}`.
const ESTIMATE_HEADER: &str = "x-export-sample";

#[derive(Deserialize)]
struct Sample {
    format: Format,
    width: u32,
    height: u32,
}

/// Encoded size of a sample picture (RGBA, see [`body_bytes`]; format and
/// size in the `x-export-sample` header, or in the JSON body beside `data`):
/// the frontend scales it to estimate a file size.
#[tauri::command]
pub async fn export_estimate(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let rgba = body_bytes(request.body())?;
    let sample: Sample = match request.body() {
        tauri::ipc::InvokeBody::Json(json) => {
            serde_json::from_value(json.clone()).map_err(|e| e.to_string())?
        }
        tauri::ipc::InvokeBody::Raw(_) => {
            let header = request
                .headers()
                .get(ESTIMATE_HEADER)
                .and_then(|v| v.to_str().ok())
                .ok_or("missing sample header")?;
            serde_json::from_str(header).map_err(|e| e.to_string())?
        }
    };
    blocking(move || encoded_size(sample.format, &rgba, sample.width, sample.height)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pixels_raw_or_as_base64_json() {
        use tauri::ipc::InvokeBody;
        assert_eq!(
            body_bytes(&InvokeBody::Raw(vec![1, 2, 3])).unwrap(),
            vec![1, 2, 3]
        );
        let json = InvokeBody::Json(serde_json::json!({ "data": "AQID", "format": "png" }));
        assert_eq!(body_bytes(&json).unwrap(), vec![1, 2, 3]);
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!([1, 2]))).is_err());
    }
    use std::sync::{Arc, Mutex as StdMutex};

    /// A sink that keeps what's written, readable after the encoder drops it.
    #[derive(Clone, Default)]
    struct Shared(Arc<StdMutex<Vec<u8>>>);
    impl Write for Shared {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];

    /// Export a 2×3 picture (sent as a 2-row band then a 1-row band) and decode it.
    fn roundtrip(format: Format) -> image::RgbaImage {
        let out = Shared::default();
        let mut export = begin(Box::new(out.clone()), format, 2, 3).unwrap();
        write_rows(&mut export, &[RED, RED, BLUE, BLUE].concat()).unwrap();
        write_rows(&mut export, &[RED, BLUE].concat()).unwrap();
        finish(export).unwrap();
        let bytes = out.0.lock().unwrap().clone();
        image::load_from_memory(&bytes).unwrap().to_rgba8()
    }

    #[test]
    fn streams_bands_into_a_valid_png_and_webp() {
        for format in [Format::Png, Format::Webp] {
            let img = roundtrip(format);
            assert_eq!(img.dimensions(), (2, 3));
            assert_eq!(img.get_pixel(0, 1).0, BLUE);
            assert_eq!(img.get_pixel(1, 2).0, BLUE);
            assert_eq!(img.get_pixel(0, 2).0, RED);
        }
    }

    #[test]
    fn writes_jpeg() {
        let out = Shared::default();
        let mut export = begin(Box::new(out.clone()), Format::Jpeg { quality: 90 }, 8, 8).unwrap();
        write_rows(&mut export, &RED.repeat(64)).unwrap();
        finish(export).unwrap();
        let bytes = out.0.lock().unwrap().clone();
        assert_eq!(&bytes[..2], &[0xFF, 0xD8]);
    }

    #[test]
    fn rejects_overruns_and_incomplete_images() {
        let mut export = begin(Box::new(Shared::default()), Format::Png, 1, 1).unwrap();
        assert!(write_rows(&mut export, &[0; 8]).is_err());
        assert!(finish(export).is_err());
    }

    #[test]
    fn measures_encoded_sizes() {
        let flat = RED.repeat(64 * 64);
        let png = encoded_size(Format::Png, &flat, 64, 64).unwrap();
        assert!(png > 0 && png < flat.len() as u64);
        let low = encoded_size(Format::Jpeg { quality: 10 }, &flat, 64, 64).unwrap();
        assert!(low > 0);
        assert!(encoded_size(Format::Webp, &flat, 10, 10).is_err());
        let format: Format = serde_json::from_str(r#"{"kind":"jpeg","quality":80}"#).unwrap();
        assert_eq!(format, Format::Jpeg { quality: 80 });
    }
}
