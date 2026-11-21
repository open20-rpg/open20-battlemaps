//! Android Storage Access Framework helper: resolve a `content://` URI (as
//! returned by the file/save picker — SAF gives no real filesystem path) to a
//! real file descriptor via the platform `ContentResolver`. Shared by every
//! command that reads/writes a user-picked file on Android (pack install,
//! map save/load).

use jni::objects::JValue;
use jni::sys::{jint, JNI_VERSION_1_6};
use jni::JavaVM;
use std::ffi::c_void;
use std::fs::File;
use std::os::unix::io::FromRawFd;
use std::sync::OnceLock;

static JAVA_VM: OnceLock<JavaVM> = OnceLock::new();

/// Captures the `JavaVM` when the JVM loads our native library. The Tauri/wry
/// runtime does not populate `ndk-context`, so `JNI_OnLoad` is the reliable way
/// to reach the VM from arbitrary threads (e.g. a blocking task pool). There
/// can only be one `JNI_OnLoad` in the whole cdylib — this is it.
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint {
    if let Ok(vm) = unsafe { JavaVM::from_raw(vm) } {
        let _ = JAVA_VM.set(vm);
    }
    JNI_VERSION_1_6
}

/// Resolve a `content://` URI to an owned `File` via a `ContentResolver`
/// `ParcelFileDescriptor`, opened in `mode` (`ParcelFileDescriptor.parseMode`:
/// `"r"` read-only, `"wt"` write/create/truncate). `detachFd` transfers fd
/// ownership to us, so the returned `File` stays valid after the JNI thread
/// detaches.
pub fn open_content_uri(uri: &str, mode: &str) -> Result<File, String> {
    let jni_err = |ctx: &str, e: jni::errors::Error| format!("{ctx}: {e}");

    let vm = JAVA_VM
        .get()
        .ok_or_else(|| "JavaVM not captured (JNI_OnLoad missing)".to_string())?;
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
        return Err("no current Application context".into());
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

    let jmode = env.new_string(mode).map_err(|e| jni_err("new_string", e))?;
    let pfd = env
        .call_method(
            &resolver,
            "openFileDescriptor",
            "(Landroid/net/Uri;Ljava/lang/String;)Landroid/os/ParcelFileDescriptor;",
            &[JValue::Object(&uri_obj), JValue::Object(&jmode)],
        )
        .and_then(|v| v.l())
        .map_err(|e| {
            // A thrown Java exception stays pending on this thread; clear it
            // so the caller can retry (see `create_content_uri`).
            let _ = env.exception_clear();
            jni_err("openFileDescriptor", e)
        })?;
    if pfd.is_null() {
        return Err("openFileDescriptor returned null".into());
    }

    let fd = env
        .call_method(&pfd, "detachFd", "()I", &[])
        .and_then(|v| v.i())
        .map_err(|e| jni_err("detachFd", e))?;

    Ok(unsafe { File::from_raw_fd(fd) })
}

/// Open a `content://` URI to overwrite it from scratch. Plain `"w"` does not
/// truncate on many document providers (Android 10+): a shorter new file
/// leaves the old tail behind and the result no longer parses. `"wt"` is the
/// documented overwrite mode; the fallback covers providers that reject it,
/// truncating by hand where the fd allows it (stream-backed ones, e.g. cloud
/// providers, replace the whole file anyway).
pub fn create_content_uri(uri: &str) -> Result<File, String> {
    match open_content_uri(uri, "wt") {
        Ok(file) => Ok(file),
        Err(_) => {
            let file = open_content_uri(uri, "w")?;
            let _ = file.set_len(0);
            Ok(file)
        }
    }
}
