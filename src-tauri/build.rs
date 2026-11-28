/// Masker tetap untuk menyamarkan kunci reset di biner (supaya tidak tampil sebagai string heksa polos).
const MASKER: [u8; 32] = [
    0x5a, 0xc3, 0x91, 0x2e, 0x7d, 0xb8, 0x04, 0xf6, 0x3b, 0x6c, 0xd2, 0x89, 0xe1, 0x47, 0xa5, 0x1f,
    0x98, 0x32, 0xcd, 0x70, 0x0b, 0xee, 0x65, 0xa9, 0xd4, 0x1a, 0x83, 0x5f, 0xbc, 0x26, 0xf0, 0x4d,
];

fn dari_heks(h: &str) -> Option<[u8; 32]> {
    let h = h.trim();
    if h.len() != 64 || !h.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// Kunci reset password Manager: env `KASIRJET_KUNCI_RESET`, lalu `~/.kasirjet/kunci-reset`.
/// Build release tanpa kunci gagal. Build debug (tauri dev, cargo test) memakai kunci uji 0x00..0x1f.
/// Hasilnya ditulis ke `OUT_DIR/kunci_reset.rs` dalam bentuk byte yang di-XOR dengan `MASKER`.
fn siapkan_kunci_reset() {
    println!("cargo:rerun-if-env-changed=KASIRJET_KUNCI_RESET");
    println!("cargo:rerun-if-env-changed=HOME");
    println!("cargo:rerun-if-env-changed=USERPROFILE");
    let rumah = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok();
    let file = rumah.map(|r| std::path::PathBuf::from(r).join(".kasirjet").join("kunci-reset"));
    if let Some(f) = &file {
        println!("cargo:rerun-if-changed={}", f.display());
    }

    let dari_env = std::env::var("KASIRJET_KUNCI_RESET").ok().filter(|v| !v.trim().is_empty());
    let teks = dari_env.clone().or_else(|| file.as_ref().and_then(|f| std::fs::read_to_string(f).ok()));
    let rilis = std::env::var("PROFILE").map(|p| p == "release").unwrap_or(false);

    let kunci: [u8; 32] = match teks {
        Some(t) => dari_heks(&t).unwrap_or_else(|| {
            let asal = if dari_env.is_some() { "env KASIRJET_KUNCI_RESET" } else { "file ~/.kasirjet/kunci-reset" };
            panic!("Kunci reset di {asal} harus 64 karakter heksa (0-9, a-f). Buat yang baru dengan: node tools/kode_reset.mjs --buat-kunci");
        }),
        None if rilis => panic!(
            "Kunci reset password belum ada, jadi build release dihentikan.\n\
             Buat kunci: node tools/kode_reset.mjs --buat-kunci (tersimpan di ~/.kasirjet/kunci-reset).\n\
             Lalu setel env KASIRJET_KUNCI_RESET dengan isi file itu (di GitHub: Settings, Secrets and variables, Actions, secret KASIRJET_KUNCI_RESET)."
        ),
        None => std::array::from_fn(|i| i as u8),
    };

    let tersamar: Vec<String> = kunci.iter().zip(MASKER.iter()).map(|(k, m)| format!("0x{:02x}", k ^ m)).collect();
    let masker: Vec<String> = MASKER.iter().map(|m| format!("0x{m:02x}")).collect();
    let isi = format!(
        "pub const KUNCI_TERSAMAR: [u8; 32] = [{}];\npub const KUNCI_MASKER: [u8; 32] = [{}];\n",
        tersamar.join(", "),
        masker.join(", ")
    );
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("kunci_reset.rs");
    std::fs::write(out, isi).expect("gagal menulis kunci_reset.rs");
}

fn main() {
    siapkan_kunci_reset();
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
