fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" && target_env == "msvc" {
        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows")
            .join("app.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        // Pasang manifest Common Controls v6 ke semua target (termasuk biner unit test `--lib`),
        // supaya `cargo test` di Windows tidak gagal STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)
        // karena `tauri-plugin-dialog` memakai ComCtl32 v6 (`TaskDialogIndirect`).
        // Manifest bawaan `tauri-build` dimatikan agar tidak ganda (CVT1100) di biner utama.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());

        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("gagal menjalankan tauri-build");
        return;
    }

    tauri_build::build();
}
