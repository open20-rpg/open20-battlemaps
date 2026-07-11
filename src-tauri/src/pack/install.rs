//! Installation of packs: streaming extraction with progress events.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::format::{normalize_res_path, read_index, read_manifest};
use super::library::clear_library;
use super::registry::{
    build_installed, pack_dir, read_registry, write_registry, InstalledPack, PackReg,
};
use super::{PackError, Result};

const COPY_BUF: usize = 1 << 20; // 1 MiB streaming buffer

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    pack: &'a str,
    file_name: &'a str,
    index: usize,
    total: usize,
    percent: u8,
}

/// Open the source pack for reading.
///
/// On desktop the picker returns a real filesystem path. On Android the Storage
/// Access Framework returns a `content://` URI that has no path, so we resolve
/// it to a file descriptor through the platform ContentResolver and read the
/// pack straight from it — no temporary copy, so disk/time cost matches desktop.
fn open_pack_source(src: &str) -> Result<File> {
    #[cfg(target_os = "android")]
    {
        if src.starts_with("content://") {
            return open_content_uri(src);
        }
    }
    Ok(File::open(src)?)
}

/// Captures the `JavaVM` when the JVM loads our native library. The Tauri/wry
/// runtime does not populate `ndk-context`, so `JNI_OnLoad` is the reliable way
/// to reach the VM from arbitrary threads (e.g. the blocking install pool).
#[cfg(target_os = "android")]
mod android_jni {
    use jni::sys::{jint, JNI_VERSION_1_6};
    use jni::JavaVM;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();

    #[no_mangle]
    pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint {
        if let Ok(vm) = unsafe { JavaVM::from_raw(vm) } {
            let _ = JAVA_VM.set(vm);
        }
        JNI_VERSION_1_6
    }

    pub fn java_vm() -> Option<&'static JavaVM> {
        JAVA_VM.get()
    }
}

/// Resolve an Android `content://` URI to an owned `File` via a `content://`
/// ParcelFileDescriptor. `detachFd` transfers ownership of the fd to us, so the
/// returned `File` stays valid after the JNI thread detaches.
#[cfg(target_os = "android")]
fn open_content_uri(uri: &str) -> Result<File> {
    use jni::objects::JValue;
    use std::os::unix::io::FromRawFd;

    let jni_err = |ctx: &str, e: jni::errors::Error| PackError::Other(format!("{ctx}: {e}"));

    let vm = android_jni::java_vm()
        .ok_or_else(|| PackError::Other("JavaVM not captured (JNI_OnLoad missing)".into()))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| jni_err("attach", e))?;

    // App Context via ActivityThread.currentApplication() — available off any
    // thread once the app is running, without ndk-context or an activity handle.
    let context = env
        .call_static_method(
            "android/app/ActivityThread",
            "currentApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("currentApplication", e))?;
    if context.is_null() {
        return Err(PackError::Other("no current Application context".into()));
    }

    let resolver = env
        .call_method(
            &context,
            "getContentResolver",
            "()Landroid/content/ContentResolver;",
            &[],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("getContentResolver", e))?;

    let juri = env.new_string(uri).map_err(|e| jni_err("new_string", e))?;
    let uri_obj = env
        .call_static_method(
            "android/net/Uri",
            "parse",
            "(Ljava/lang/String;)Landroid/net/Uri;",
            &[JValue::Object(&juri)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("Uri.parse", e))?;

    let mode = env.new_string("r").map_err(|e| jni_err("new_string", e))?;
    let pfd = env
        .call_method(
            &resolver,
            "openFileDescriptor",
            "(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;",
            &[JValue::Object(&uri_obj), JValue::Object(&mode)],
        )
        .and_then(|v| v.l())
        .map_err(|e| jni_err("openFileDescriptor", e))?;
    if pfd.is_null() {
        return Err(PackError::Other("openFileDescriptor returned null".into()));
    }

    let fd = env
        .call_method(&pfd, "detachFd", "()I", &[])
        .and_then(|v| v.i())
        .map_err(|e| jni_err("detachFd", e))?;

    Ok(unsafe { File::from_raw_fd(fd) })
}

/// Extract a single pack file into `app_data/packs/<id>/`, streaming every
/// file through a fixed buffer so memory stays bounded regardless of pack size.
pub(crate) fn install_one(app: &AppHandle, pack_src: &str) -> Result<InstalledPack> {
    let file = open_pack_source(pack_src)?;
    let mut reader = BufReader::new(file);
    let entries = read_index(&mut reader)?;

    let manifest = read_manifest(&mut reader, &entries)?;
    let id = manifest
        .id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| PackError::Manifest("manifest has no id".into()))?;

    let dest = pack_dir(app, &id)?;
    // Reinstall cleanly.
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    fs::create_dir_all(&dest)?;

    let pack_name = manifest.name.clone().unwrap_or_else(|| id.clone());
    let total = entries.len();
    let mut copy_buf = vec![0u8; COPY_BUF];
    let mut written: HashSet<String> = HashSet::new();
    let mut total_bytes: u64 = 0;

    for (index, entry) in entries.iter().enumerate() {
        let rel = normalize_res_path(&entry.path, &id);
        // Skip the duplicate manifest copy and any repeats.
        if !written.insert(rel.clone()) {
            continue;
        }
        total_bytes += entry.size;
        let out_path = dest.join(&rel);
        // Safety: ensure we stay inside dest.
        if !out_path.starts_with(&dest) {
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        reader.seek(SeekFrom::Start(entry.offset))?;
        let mut out = BufWriter::new(File::create(&out_path)?);
        let mut remaining = entry.size;
        while remaining > 0 {
            let n = remaining.min(COPY_BUF as u64) as usize;
            reader.read_exact(&mut copy_buf[..n])?;
            out.write_all(&copy_buf[..n])?;
            remaining -= n as u64;
        }
        out.flush()?;

        let percent = (((index + 1) as f64 / total as f64) * 100.0) as u8;
        let _ = app.emit(
            "pack-install-progress",
            InstallProgress {
                pack: &pack_name,
                file_name: &rel,
                index: index + 1,
                total,
                percent,
            },
        );
    }

    let reg_entry = PackReg {
        enabled: true,
        file_count: Some(written.len()),
        size_bytes: Some(total_bytes),
    };
    let mut reg = read_registry(app);
    reg.insert(id.clone(), reg_entry.clone());
    write_registry(app, &reg)?;
    clear_library(app);

    build_installed(app, &id, &reg_entry)
        .ok_or_else(|| PackError::Other("install verification failed".into()))
}
