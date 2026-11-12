use std::path::{Path, PathBuf};
use std::{env, fs};

fn main() {
    embed_builtin_pack();
    tauri_build::build()
}

/// The built-in pack is generated from code (`npm run pack`, done by CI for
/// every build) and not committed. Embed it when it's there; otherwise an
/// empty placeholder, so the app still builds without Python (it then ships
/// no built-in pack).
fn embed_builtin_pack() {
    let src = Path::new("resources/builtin.dungeondraft_pack");
    println!("cargo:rerun-if-changed=resources");
    let out =
        PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("builtin.dungeondraft_pack");
    if src.exists() {
        fs::copy(src, &out).expect("copy the built-in pack");
    } else {
        println!("cargo:warning=no built-in pack: run `npm run pack` to bundle Open20 Essentials");
        fs::write(&out, []).expect("write the built-in pack placeholder");
    }
}
