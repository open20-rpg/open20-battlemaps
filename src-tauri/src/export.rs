//! Streaming PNG export.
//!
//! The frontend renders the map in horizontal bands and sends each band's
//! raw RGBA rows here as it goes; they're encoded straight into the file on
//! a blocking worker thread. Neither side ever holds the whole image (an
//! 8192² export would be 256 MB of RGBA), and neither the webview nor the
//! app's main thread does the encoding, so the UI stays responsive.

use std::io::Write;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

type Sink = Box<dyn Write + Send>;

/// An export in progress: the PNG stream and how many bytes are still due.
struct Export {
    stream: png::StreamWriter<'static, Sink>,
    remaining: u64,
}

/// The export in progress, if any (one at a time).
#[derive(Default)]
pub struct ExportState(Mutex<Option<Export>>);

/// Start a PNG of `width` × `height` RGBA pixels on `sink`.
fn begin(sink: Sink, width: u32, height: u32) -> Result<Export, String> {
    let mut encoder = png::Encoder::new(sink, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let writer = encoder.write_header().map_err(|e| e.to_string())?;
    let stream = writer.into_stream_writer().map_err(|e| e.to_string())?;
    Ok(Export {
        stream,
        remaining: u64::from(width) * u64::from(height) * 4,
    })
}

/// Append rows (RGBA, top to bottom); they must not overrun the image.
fn write_rows(export: &mut Export, rows: &[u8]) -> Result<(), String> {
    let len = rows.len() as u64;
    if len > export.remaining {
        return Err("more pixel data than the image holds".into());
    }
    export.stream.write_all(rows).map_err(|e| e.to_string())?;
    export.remaining -= len;
    Ok(())
}

/// Finish the PNG: every pixel must have been written.
fn finish(export: Export) -> Result<(), String> {
    if export.remaining != 0 {
        return Err("the image is incomplete".into());
    }
    export.stream.finish().map_err(|e| e.to_string())
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

/// Create the PNG file at `path` for a `width` × `height` image.
#[tauri::command]
pub async fn export_begin(
    app: AppHandle,
    path: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    blocking(move || {
        let export = begin(open_sink(&path)?, width, height)?;
        *app.state::<ExportState>().0.lock().unwrap() = Some(export);
        Ok(())
    })
    .await
}

/// Append a band of rows, sent as the raw request body.
#[tauri::command]
pub async fn export_rows(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected a raw byte body".into());
    };
    let rows = bytes.clone();
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

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn streams_bands_into_a_valid_png() {
        let out = Shared::default();
        let mut export = begin(Box::new(out.clone()), 2, 3).unwrap();
        // Three rows of two pixels, sent as a 2-row band then a 1-row band.
        let red = [255, 0, 0, 255];
        let blue = [0, 0, 255, 255];
        write_rows(&mut export, &[red, red, blue, blue].concat()).unwrap();
        write_rows(&mut export, &[red, blue].concat()).unwrap();
        finish(export).unwrap();
        let bytes = out.0.lock().unwrap().clone();
        let img = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(img.dimensions(), (2, 3));
        assert_eq!(img.get_pixel(0, 1).0, blue);
        assert_eq!(img.get_pixel(1, 2).0, blue);
        assert_eq!(img.get_pixel(0, 2).0, red);
    }

    #[test]
    fn rejects_overruns_and_incomplete_images() {
        let mut export = begin(Box::new(Shared::default()), 1, 1).unwrap();
        assert!(write_rows(&mut export, &[0; 8]).is_err());
        assert!(finish(export).is_err());
    }
}
