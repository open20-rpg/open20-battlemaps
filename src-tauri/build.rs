fn main() {
    // Android 15+ devices can use 16 KB memory pages, and Google Play requires
    // native libraries aligned to them. Set here (not in .cargo/config.toml)
    // because the Tauri CLI passes its own rustflags for Android builds.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
