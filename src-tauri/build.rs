use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    embed_builtin_pack();
    tauri_build::build()
}

/// The built-in pack's files are drawn locally (`npm run pack`) and committed
/// unpacked in `resources/builtin/`, laid out as inside the pack. Here they
/// are packed into `resources/builtin.dungeondraft_pack` (git-ignored), which
/// tauri.conf.json bundles as a resource: one copy in the installer (on
/// Android, in the APK's assets), not inside the native library, which a
/// universal APK repeats per ABI. Packing takes seconds, drawing doesn't, so
/// CI only ever does this. The pack's version becomes BUILTIN_PACK_VERSION so
/// the app can skip reading the resource when that version is installed.
/// With no folder the app still builds, with an empty placeholder.
fn embed_builtin_pack() {
    let src = Path::new("resources/builtin");
    println!("cargo:rerun-if-changed={}", src.display());
    let mut files = Vec::new();
    collect(src, src, &mut files);
    if files.is_empty() {
        println!("cargo:warning=no built-in pack: run `npm run pack` to draw Open20 Essentials");
    }
    let version = files
        .iter()
        .find(|(rel, _)| !rel.contains('/') && rel.ends_with(".json"))
        .and_then(|(_, p)| manifest_version(&fs::read_to_string(p).ok()?))
        .unwrap_or_default();
    println!("cargo:rustc-env=BUILTIN_PACK_VERSION={version}");
    let out = PathBuf::from("resources/builtin.dungeondraft_pack");
    let data = pck(&files);
    // Rewriting an identical file would only make Tauri copy it again.
    if fs::read(&out).ok().as_deref() != Some(&data[..]) {
        fs::create_dir_all("resources").expect("create resources/");
        fs::write(&out, data).expect("write the built-in pack");
    }
}

/// The `"version"` of a pack manifest (flat JSON written by build.py).
fn manifest_version(json: &str) -> Option<String> {
    let rest = &json[json.find("\"version\"")? + 9..];
    let start = rest.find('"')? + 1;
    let len = rest[start..].find('"')?;
    Some(rest[start..start + len].to_string())
}

/// Every file under `dir`, as (path relative to `root` with `/`, absolute path), sorted.
fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(root, &path, out);
        } else {
            let rel = path
                .strip_prefix(root)
                .expect("under root")
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, path));
        }
    }
    out.sort();
}

/// A Godot 3 PCK (format 1), as `.dungeondraft_pack` files are (see
/// `pack/format.rs`): header, index of `res://packs/<rel>` entries, then the
/// files back to back. MD5s are left zero, which the format allows. An empty
/// file list gives an empty placeholder.
fn pck(files: &[(String, PathBuf)]) -> Vec<u8> {
    if files.is_empty() {
        return Vec::new();
    }
    let datas: Vec<Vec<u8>> = files
        .iter()
        .map(|(_, p)| fs::read(p).expect("read pack file"))
        .collect();
    let paths: Vec<String> = files
        .iter()
        .map(|(rel, _)| format!("res://packs/{rel}"))
        .collect();
    let index_size: usize = paths.iter().map(|p| 4 + p.len() + 8 + 8 + 16).sum();
    let mut offset = (88 + index_size) as u64;
    let mut buf = Vec::with_capacity(offset as usize + datas.iter().map(Vec::len).sum::<usize>());
    for v in [0x4350_4447u32, 1, 3, 4, 0] {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    buf.extend_from_slice(&[0u8; 64]);
    buf.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for (path, data) in paths.iter().zip(&datas) {
        buf.extend_from_slice(&(path.len() as u32).to_le_bytes());
        buf.extend_from_slice(path.as_bytes());
        buf.extend_from_slice(&offset.to_le_bytes());
        buf.extend_from_slice(&(data.len() as u64).to_le_bytes());
        buf.extend_from_slice(&[0u8; 16]);
        offset += data.len() as u64;
    }
    for data in &datas {
        buf.extend_from_slice(data);
    }
    buf
}
