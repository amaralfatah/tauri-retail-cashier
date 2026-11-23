//! Aturan firewall Windows untuk port Pusat (rancangan 5.3).
//!
//! Aturannya satu, bernama `Toko Pro Pusat`: masuk, TCP, hanya port Pusat, hanya untuk program ini, hanya dari subnet yang sama
//! (`remoteip=localsubnet`, sudah mencakup 169.254.0.0/16), untuk profil Private, Public, dan Domain.
//! Membuatnya butuh hak administrator, jadi `netsh` dijalankan lewat PowerShell dengan `-Verb RunAs` (dialog UAC).
//! Memeriksanya tidak butuh hak administrator. Di macOS dan Linux semua fungsi di sini tidak melakukan apa-apa.

use crate::db::Res;

pub const NAMA_ATURAN: &str = "Toko Pro Pusat";

/// Keadaan izin firewall untuk komputer ini.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Izin {
    /// Bukan Windows: tidak ada yang perlu diatur.
    TidakPerlu,
    /// Aturan ada dan cocok dengan port serta lokasi program sekarang.
    Ada,
    /// Belum ada aturan.
    Belum,
    /// Aturan ada, tetapi port atau lokasi programnya berbeda (mis. Toko Pro dipindah atau port diubah).
    Berbeda,
}

impl Izin {
    pub fn kode(self) -> &'static str {
        match self {
            Izin::TidakPerlu => "tidak-perlu",
            Izin::Ada => "ada",
            Izin::Belum => "belum",
            Izin::Berbeda => "berbeda",
        }
    }
}

/* ---- Pembentukan perintah (jalan di semua sistem, supaya bisa dites di mana saja) ---- */

/// `netsh advfirewall firewall add rule ...`, satu token per elemen. Nilai yang berisi spasi sudah diberi tanda kutip,
/// seperti yang ditulis di dokumentasi `netsh`.
pub fn argumen_tambah(port: u16, program: &str) -> Vec<String> {
    [
        "advfirewall".to_string(),
        "firewall".into(),
        "add".into(),
        "rule".into(),
        format!("name=\"{NAMA_ATURAN}\""),
        "dir=in".into(),
        "action=allow".into(),
        "protocol=TCP".into(),
        format!("localport={port}"),
        "profile=private,public,domain".into(),
        "remoteip=localsubnet".into(),
        format!("program=\"{program}\""),
    ]
    .into()
}

/// `netsh advfirewall firewall delete rule name="Toko Pro Pusat"`.
pub fn argumen_hapus() -> Vec<String> {
    ["advfirewall", "firewall", "delete", "rule"].iter().map(|s| s.to_string()).chain([format!("name=\"{NAMA_ATURAN}\"")]).collect()
}

/// `netsh advfirewall firewall show rule name="Toko Pro Pusat" verbose`. Tidak butuh hak administrator.
pub fn argumen_cek() -> Vec<String> {
    ["advfirewall", "firewall", "show", "rule"].iter().map(|s| s.to_string()).chain([format!("name=\"{NAMA_ATURAN}\""), "verbose".to_string()]).collect()
}

/// Baris perintah utuh untuk satu `netsh`.
pub fn baris_perintah(argumen: &[String]) -> String {
    argumen.join(" ")
}

/// Skrip PowerShell yang dijalankan dengan hak administrator: hapus aturan lama (bila ada), lalu buat yang baru.
/// `--%` membuat PowerShell meneruskan sisa barisnya apa adanya, jadi tanda kutip dan spasi di alamat program tidak berubah.
/// Kode keluar skrip adalah kode keluar `netsh` yang terakhir.
pub fn skrip_beri_izin(port: u16, program: &str) -> String {
    format!(
        "netsh --% {}\nnetsh --% {}\nexit $LASTEXITCODE\n",
        baris_perintah(&argumen_hapus()),
        baris_perintah(&argumen_tambah(port, program)),
    )
}

/// Base64 dari teks UTF-16 little-endian, bentuk yang diminta `powershell -EncodedCommand`.
pub fn kode_powershell(skrip: &str) -> String {
    const ABJAD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let byte: Vec<u8> = skrip.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut hasil = String::with_capacity(byte.len().div_ceil(3) * 4);
    for potong in byte.chunks(3) {
        let n = (potong[0] as u32) << 16 | (*potong.get(1).unwrap_or(&0) as u32) << 8 | *potong.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= potong.len() {
                hasil.push(ABJAD[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                hasil.push('=');
            }
        }
    }
    hasil
}

/// Perintah PowerShell biasa (tanpa hak administrator) yang membuka PowerShell kedua dengan UAC, menunggu, lalu
/// meneruskan kode keluarnya. Bila pengguna menjawab Tidak di UAC, `Start-Process` gagal dan kode keluarnya bukan 0.
pub fn perintah_naik_hak(skrip: &str) -> String {
    format!(
        "$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','{}'; exit $p.ExitCode",
        kode_powershell(skrip)
    )
}

/// Apakah hasil `show rule` memuat aturan yang cocok dengan port dan program ini. Label `netsh` mengikuti bahasa Windows,
/// jadi yang dibandingkan hanya nilainya. Bila alamat program berisi huruf non-ASCII (keluaran `netsh` memakai code page lain),
/// yang dibandingkan nama file-nya saja.
pub fn aturan_cocok(keluaran: &str, port: u16, program: &str) -> bool {
    let kecil = keluaran.to_lowercase();
    let punya_port = keluaran.split(|c: char| !c.is_ascii_digit()).any(|t| t == port.to_string());
    let kunci = if program.is_ascii() { program } else { program.rsplit(['\\', '/']).next().unwrap_or(program) };
    punya_port && kecil.contains(&kunci.to_lowercase())
}

/// Alamat program tanpa awalan `\\?\` yang kadang ikut dari `current_exe`.
fn alamat_program() -> Res<String> {
    let p = std::env::current_exe().map_err(|e| format!("Lokasi Toko Pro tidak terbaca ({e})."))?;
    let s = p.display().to_string();
    Ok(s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s))
}

/* ---- Windows ---- */

#[cfg(windows)]
mod sistem {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const TANPA_JENDELA: u32 = 0x0800_0000;
    const MASA_SIMPAN: Duration = Duration::from_secs(20);
    static SIMPANAN: Mutex<Option<(Instant, u16, Izin)>> = Mutex::new(None);

    fn simpanan() -> std::sync::MutexGuard<'static, Option<(Instant, u16, Izin)>> {
        SIMPANAN.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn periksa_langsung(port: u16) -> Izin {
        let Ok(program) = alamat_program() else { return Izin::Belum };
        let o = Command::new("netsh").raw_arg(baris_perintah(&argumen_cek())).creation_flags(TANPA_JENDELA).output();
        match o {
            Ok(o) if o.status.success() => {
                if aturan_cocok(&String::from_utf8_lossy(&o.stdout), port, &program) { Izin::Ada } else { Izin::Berbeda }
            }
            _ => Izin::Belum,
        }
    }

    /// Keadaan izin sekarang. Hasilnya diingat 20 detik supaya status yang dibaca tiap 5 detik tidak memanggil `netsh` terus.
    pub fn periksa(port: u16) -> Izin {
        let mut s = simpanan();
        if let Some((waktu, p, izin)) = *s {
            if p == port && waktu.elapsed() < MASA_SIMPAN {
                return izin;
            }
        }
        let izin = periksa_langsung(port);
        *s = Some((Instant::now(), port, izin));
        izin
    }

    pub fn beri_izin(port: u16) -> Res<()> {
        let program = alamat_program()?;
        let perintah = perintah_naik_hak(&skrip_beri_izin(port, &program));
        let o = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &perintah])
            .creation_flags(TANPA_JENDELA)
            .output()
            .map_err(|e| format!("Windows belum bisa dimintai izin ({e})."))?;
        *simpanan() = None;
        if !o.status.success() {
            return Err("Izin dari Windows belum diberikan. Tekan Beri izin, lalu pilih Ya saat Windows bertanya. Kalau Windows meminta kata sandi administrator, minta bantuan orang yang memasang komputer ini.".into());
        }
        match periksa_langsung(port) {
            Izin::Ada => Ok(()),
            _ => Err("Windows sudah menjawab, tetapi izinnya belum tercatat. Coba tekan Beri izin sekali lagi.".into()),
        }
    }
}

/* ---- Selain Windows: tidak melakukan apa-apa ---- */

#[cfg(not(windows))]
mod sistem {
    use super::*;

    pub fn periksa(_port: u16) -> Izin {
        Izin::TidakPerlu
    }

    pub fn beri_izin(_port: u16) -> Res<()> {
        Ok(())
    }
}

/// Keadaan izin firewall untuk `port`. Di luar Windows selalu `TidakPerlu`.
pub fn periksa(port: u16) -> Izin {
    sistem::periksa(port)
}

/// Buat (atau perbarui) aturan firewall untuk `port` dan program ini. Windows menampilkan dialog UAC; fungsi ini menunggu jawabannya.
/// Di luar Windows tidak melakukan apa-apa dan berhasil.
pub fn beri_izin(port: u16) -> Res<()> {
    sistem::beri_izin(port)
}
