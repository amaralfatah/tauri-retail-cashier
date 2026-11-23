//! Berkas pengguna: simpan hasil ekspor daftar (CSV) dan foto barang.
//! Penulisan dibatasi ke folder Documents atau Downloads, dan hanya untuk file baru.

use crate::auth::{require_menu, Session};
use crate::db::{e, Db, Res};
use std::path::{Path, PathBuf};
use crate::konteks::Konteks;
use perintah_macro::perintah;

const MAKS_EKSPOR: usize = 64 * 1024 * 1024;
const MAKS_FOTO: u64 = 10 * 1024 * 1024;
const EKSTENSI_FOTO: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp"];

/// Nama file baru di `dir`: `<nama>_<tgl>.<ext>`, ditambah -2, -3, ... kalau sudah ada (dicek per ekstensi).
pub fn nama_baru_ext(dir: &Path, nama: &str, tgl: &str, ext: &str) -> PathBuf {
    let bersih: String = nama.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let dasar = format!("{bersih}_{tgl}");
    let mut p = dir.join(format!("{dasar}.{ext}"));
    let mut i = 2;
    while p.exists() {
        p = dir.join(format!("{dasar}-{i}.{ext}"));
        i += 1;
    }
    p
}

/// Tulis `isi` ke file baru `path`. Folder tujuan harus ada di bawah salah satu `roots`,
/// ekstensi harus csv atau txt, dan file tidak boleh sudah ada.
pub fn tulis_baru(path: &str, isi: &str, roots: &[PathBuf]) -> Res<PathBuf> {
    tulis_baru_byte(path, isi.as_bytes(), roots, &["csv", "txt"], "Nama file harus berakhiran .csv atau .txt.")
}

fn tulis_baru_byte(path: &str, isi: &[u8], roots: &[PathBuf], boleh_ext: &[&str], pesan_ext: &str) -> Res<PathBuf> {
    let p = Path::new(path.trim());
    if !p.is_absolute() {
        return Err("Alamat file harus lengkap, mulai dari folder Documents atau Downloads.".into());
    }
    let nama = p.file_name().and_then(|n| n.to_str()).ok_or("Nama file belum diisi.")?;
    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    if !boleh_ext.contains(&ext.as_str()) {
        return Err(pesan_ext.into());
    }
    if isi.len() > MAKS_EKSPOR {
        return Err("Isi file terlalu besar untuk disimpan.".into());
    }
    let parent = p.parent().ok_or("Folder tujuan tidak ditemukan.")?;
    let parent = parent.canonicalize().map_err(|_| "Folder tujuan tidak ditemukan.".to_string())?;
    let boleh = roots.iter().filter_map(|r| r.canonicalize().ok()).any(|r| parent.starts_with(&r));
    if !boleh {
        return Err("File hanya bisa disimpan di folder Documents atau Downloads.".into());
    }
    let tujuan = parent.join(nama);
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tujuan).map_err(|err| {
        if err.kind() == std::io::ErrorKind::AlreadyExists {
            format!("File {nama} sudah ada. Pakai nama lain.")
        } else {
            e(err)
        }
    })?;
    f.write_all(isi).map_err(e)?;
    Ok(tujuan)
}

/// Alamat bawaan untuk file ekspor, di folder Documents (atau Downloads kalau Documents tidak ada).
#[perintah]
pub fn ekspor_nama(k: &Konteks, nama: String, ext: Option<String>) -> Res<String> {
    let ext = ext.map(|x| x.trim().trim_start_matches('.').to_lowercase()).filter(|x| !x.is_empty() && x.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| "csv".into());
    let dir = k.folder_tujuan()?.into_iter().find(|d| d.is_dir()).ok_or("Folder Documents tidak ditemukan di komputer ini.")?;
    Ok(nama_baru_ext(&dir, &nama, &chrono::Local::now().format("%Y%m%d").to_string(), &ext).display().to_string())
}

/// Simpan isi ekspor sebagai file baru; mengembalikan alamat file yang dibuat.
#[perintah]
pub fn simpan_file(k: &Konteks, session: &Session, path: String, isi: String) -> Res<String> {
    session.user()?;
    Ok(tulis_baru(&path, &isi, &k.folder_tujuan()?)?.display().to_string())
}

/// Simpan teks sebagai file baru dengan salah satu ekstensi `boleh_ext` (dipakai ekspor laporan).
pub fn simpan_teks(k: &Konteks, path: &str, isi: &str, boleh_ext: &[&str]) -> Res<String> {
    let pesan = format!("Nama file harus berakhiran .{}.", boleh_ext.join(", ."));
    Ok(tulis_baru_byte(path, isi.as_bytes(), &k.folder_tujuan()?, boleh_ext, &pesan)?.display().to_string())
}

/// Isi file Excel (.xlsx) satu lembar: baris pertama judul kolom, sisanya data (semua teks).
pub fn buat_xlsx(lembar: &str, judul: &[String], angka_kol: &[bool], baris: &[Vec<String>]) -> Res<Vec<u8>> {
    let mut wb = rust_xlsxwriter::Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name(lembar).map_err(e)?;
    let tebal = rust_xlsxwriter::Format::new().set_bold();
    for (c, j) in judul.iter().enumerate() {
        ws.write_with_format(0, c as u16, j.as_str(), &tebal).map_err(e)?;
    }
    for (r, b) in baris.iter().enumerate() {
        for (c, v) in b.iter().enumerate() {
            // Kolom angka (harga, stok) ditulis sebagai angka supaya bisa dijumlahkan di Excel.
            let angka = v.replace('.', "").replace(',', ".");
            match angka.parse::<f64>() {
                Ok(x) if angka_kol.get(c).copied().unwrap_or(false) => ws.write((r + 1) as u32, c as u16, x).map_err(e)?,
                _ => ws.write((r + 1) as u32, c as u16, v.as_str()).map_err(e)?,
            };
        }
    }
    wb.save_to_buffer().map_err(e)
}

/// Simpan daftar sebagai file Excel baru (.xlsx); mengembalikan alamat file yang dibuat.
#[perintah]
pub fn simpan_xlsx(k: &Konteks, session: &Session, path: String, lembar: String, judul: Vec<String>, angka: Vec<bool>, baris: Vec<Vec<String>>) -> Res<String> {
    session.user()?;
    let isi = buat_xlsx(&lembar, &judul, &angka, &baris)?;
    Ok(tulis_baru_byte(&path, &isi, &k.folder_tujuan()?, &["xlsx"], "Nama file harus berakhiran .xlsx.")?.display().to_string())
}

// ---- Foto barang ----

/// Nama file foto dari kode barang; karakter selain huruf, angka, - dan _ diganti _.
pub fn nama_foto(kode: &str) -> Res<String> {
    let k = kode.trim();
    if k.is_empty() {
        return Err("Kode barang belum diisi.".into());
    }
    Ok(k.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect())
}

/// Satu kunci untuk semua penulisan foto di komputer ini (Pusat atau mode Tunggal): pemeriksaan "sudah ada foto?" dan penulisannya
/// terjadi di bawah kunci yang sama, jadi dua pengirim foto barang yang sama tidak saling menimpa.
static KUNCI_FOTO: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn kunci_foto() -> std::sync::MutexGuard<'static, ()> {
    KUNCI_FOTO.lock().unwrap_or_else(|p| p.into_inner())
}

fn foto_ada(dir: &Path, kode: &str) -> Res<Option<PathBuf>> {
    let dasar = nama_foto(kode)?;
    Ok(EKSTENSI_FOTO.iter().map(|x| dir.join(format!("{dasar}.{x}"))).find(|p| p.is_file()))
}

/// Salin gambar `sumber` ke `dir` sebagai `<kode>.<ekstensi>`; foto lama barang itu diganti.
pub fn foto_salin(dir: &Path, kode: &str, sumber: &str) -> Res<String> {
    foto_salin_opsi(dir, kode, sumber, false)
}

/// Seperti `foto_salin`. Dengan `hanya_baru`, barang yang sudah punya foto dibiarkan (yang dikembalikan ekstensi foto yang ada).
pub fn foto_salin_opsi(dir: &Path, kode: &str, sumber: &str, hanya_baru: bool) -> Res<String> {
    let dasar = nama_foto(kode)?;
    let src = Path::new(sumber.trim());
    let ext = src.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    if !EKSTENSI_FOTO.contains(&ext.as_str()) {
        return Err("File ini bukan gambar. Pilih file berakhiran .jpg, .png, .gif, .bmp, atau .webp.".into());
    }
    let meta = std::fs::metadata(src).map_err(|_| "File gambar tidak ditemukan. Periksa alamatnya.".to_string())?;
    if !meta.is_file() {
        return Err("File gambar tidak ditemukan. Periksa alamatnya.".into());
    }
    if meta.len() > MAKS_FOTO {
        return Err("Gambar terlalu besar. Pilih gambar di bawah 10 MB.".into());
    }
    let _kunci = kunci_foto();
    if let Some(ada) = hanya_baru.then(|| foto_ada(dir, kode)).transpose()?.flatten() {
        return Ok(ada.extension().and_then(|x| x.to_str()).unwrap_or("").to_string());
    }
    std::fs::create_dir_all(dir).map_err(e)?;
    // Salin ke nama sementara dulu: kalau gagal, foto lama tidak ikut hilang.
    // Ini juga aman kalau `sumber` ternyata foto lama itu sendiri.
    let sementara = dir.join(format!(".{dasar}.baru"));
    if let Err(err) = std::fs::copy(src, &sementara) {
        let _ = std::fs::remove_file(&sementara);
        return Err(e(err));
    }
    ganti_foto(dir, kode, &dasar, &ext, &sementara)
}

/// Pasang file sementara sebagai foto `<dasar>.<ext>`; foto lama barang itu (ekstensi apa pun) diganti.
fn ganti_foto(dir: &Path, kode: &str, dasar: &str, ext: &str, sementara: &Path) -> Res<String> {
    let tujuan = dir.join(format!("{dasar}.{ext}"));
    let lama = foto_ada(dir, kode)?;
    if let Err(err) = std::fs::rename(sementara, &tujuan) {
        let _ = std::fs::remove_file(sementara);
        return Err(e(err));
    }
    if let Some(lama) = lama.filter(|l| *l != tujuan) {
        std::fs::remove_file(lama).map_err(e)?;
    }
    Ok(ext.to_string())
}

/// Simpan foto dari isinya (bukan dari alamat file): dipakai Pusat untuk foto yang dikirim komputer Kasir. Dengan `hanya_baru` (foto dari Toko Pro lama), foto yang sudah ada di Pusat tidak ditimpa; yang
/// dikembalikan ekstensi foto yang ada. Pemeriksaannya di bawah kunci yang sama dengan penulisan.
pub fn foto_tulis_opsi(dir: &Path, kode: &str, ekstensi: &str, isi: &[u8], hanya_baru: bool) -> Res<String> {
    let dasar = nama_foto(kode)?;
    let ext = ekstensi.trim().trim_start_matches('.').to_lowercase();
    if !EKSTENSI_FOTO.contains(&ext.as_str()) {
        return Err("File ini bukan gambar. Pilih file berakhiran .jpg, .png, .gif, .bmp, atau .webp.".into());
    }
    if isi.is_empty() {
        return Err("Gambar kosong. Pilih gambar lain.".into());
    }
    if isi.len() as u64 > MAKS_FOTO {
        return Err("Gambar terlalu besar. Pilih gambar di bawah 10 MB.".into());
    }
    let _kunci = kunci_foto();
    if let Some(ada) = hanya_baru.then(|| foto_ada(dir, kode)).transpose()?.flatten() {
        return Ok(ada.extension().and_then(|x| x.to_str()).unwrap_or("").to_string());
    }
    std::fs::create_dir_all(dir).map_err(e)?;
    let sementara = dir.join(format!(".{dasar}.baru"));
    if let Err(err) = std::fs::write(&sementara, isi) {
        let _ = std::fs::remove_file(&sementara);
        return Err(e(err));
    }
    ganti_foto(dir, kode, &dasar, &ext, &sementara)
}

/// Baca file gambar di komputer ini untuk dikirim ke Pusat: ekstensi dan isinya. Aturan ekstensi dan ukuran sama dengan `foto_salin`.
pub fn foto_baca_berkas(sumber: &str) -> Res<(String, Vec<u8>)> {
    let src = Path::new(sumber.trim());
    let ext = src.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    if !EKSTENSI_FOTO.contains(&ext.as_str()) {
        return Err("File ini bukan gambar. Pilih file berakhiran .jpg, .png, .gif, .bmp, atau .webp.".into());
    }
    let meta = std::fs::metadata(src).map_err(|_| "File gambar tidak ditemukan. Periksa alamatnya.".to_string())?;
    if !meta.is_file() {
        return Err("File gambar tidak ditemukan. Periksa alamatnya.".into());
    }
    if meta.len() > MAKS_FOTO {
        return Err("Gambar terlalu besar. Pilih gambar di bawah 10 MB.".into());
    }
    Ok((ext, std::fs::read(src).map_err(e)?))
}

/// Hapus file asal foto setelah foto tersimpan.
pub fn hapus_berkas_asal(sumber: &str) -> Res<()> {
    std::fs::remove_file(Path::new(sumber.trim())).map_err(|_| "Foto sudah disimpan, tetapi file aslinya tidak bisa dihapus.".to_string())
}

/// Salin foto seperti `foto_salin`; kalau `hapus_asal`, file sumber dihapus setelah salinan berhasil.
/// Dengan `hanya_baru`, foto yang sudah ada dibiarkan dan file asal tidak dihapus.
pub fn foto_salin_hapus_opsi(dir: &Path, kode: &str, sumber: &str, hapus_asal: bool, hanya_baru: bool) -> Res<String> {
    let sudah_ada = hanya_baru && foto_ada(dir, kode)?.is_some();
    let ext = foto_salin_opsi(dir, kode, sumber, hanya_baru)?;
    if hapus_asal && !sudah_ada {
        std::fs::remove_file(Path::new(sumber.trim())).map_err(|_| "Foto sudah disalin, tetapi file aslinya tidak bisa dihapus.".to_string())?;
    }
    Ok(ext)
}

pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Kebalikan `base64`. `None` bila ada karakter di luar alfabet atau panjangnya tidak wajar.
pub fn dari_base64(teks: &str) -> Option<Vec<u8>> {
    let nilai = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let b: Vec<u8> = teks.bytes().filter(|c| !c.is_ascii_whitespace()).collect();
    if b.len() % 4 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(b.len() / 4 * 3);
    for (i, c) in b.chunks(4).enumerate() {
        let akhir = i == b.len() / 4 - 1;
        let pad = c.iter().rev().take_while(|x| **x == b'=').count();
        if pad > 2 || (pad > 0 && !akhir) {
            return None;
        }
        let mut n = 0u32;
        for (j, x) in c.iter().enumerate() {
            n = n << 6 | if j >= 4 - pad { 0 } else { nilai(*x)? };
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

/// Foto barang sebagai data URI, atau None kalau barang belum punya foto.
pub fn foto_data(dir: &Path, kode: &str) -> Res<Option<String>> {
    let Some(p) = foto_ada(dir, kode)? else { return Ok(None) };
    let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("png").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let bytes = std::fs::read(p).map_err(e)?;
    Ok(Some(format!("data:{mime};base64,{}", base64(&bytes))))
}

pub fn foto_buang(dir: &Path, kode: &str) -> Res<bool> {
    match foto_ada(dir, kode)? {
        Some(p) => {
            std::fs::remove_file(p).map_err(e)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

fn izin_foto(db: &Db, session: &Session, kasir_boleh: bool) -> Res<()> {
    let user = session.user()?;
    if !kasir_boleh && user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengubah foto barang.".into());
    }
    require_menu(&*db.lock()?, &user, "mnMDDataBarang")
}

/// Sisi Pusat dari `foto_simpan` untuk komputer Kasir: foto datang sebagai isi (base64), bukan alamat file.
/// Pusat tidak pernah membuka alamat file yang dikirim komputer lain.
#[perintah]
pub fn foto_simpan_data(k: &Konteks, db: &Db, session: &Session, kode: String, ekstensi: String, data: String, hanya_baru: Option<bool>) -> Res<String> {
    izin_foto(&db, &session, true)?;
    if data.len() as u64 > MAKS_FOTO / 3 * 4 + 16 {
        return Err("Gambar terlalu besar. Pilih gambar di bawah 10 MB.".into());
    }
    let isi = dari_base64(&data).ok_or("Isi gambar tidak terbaca. Pilih gambar lain.")?;
    foto_tulis_opsi(&k.folder_foto()?, &kode, &ekstensi, &isi, hanya_baru.unwrap_or(false))
}

#[perintah]
pub fn foto_simpan(k: &Konteks, db: &Db, session: &Session, kode: String, path: String, hapus_asal: Option<bool>, hanya_baru: Option<bool>) -> Res<String> {
    // Aslinya (cSimpan_Click) tidak memeriksa level, jadi kasir pun boleh menyimpan foto.
    izin_foto(&db, &session, true)?;
    foto_salin_hapus_opsi(&k.folder_foto()?, &kode, &path, hapus_asal.unwrap_or(false), hanya_baru.unwrap_or(false))
}

/// Gambar pilihan pengguna sebagai data URI untuk pratinjau, sebelum disalin ke folder foto.
pub fn gambar_data(sumber: &str) -> Res<String> {
    let src = Path::new(sumber.trim());
    let ext = src.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    if !EKSTENSI_FOTO.contains(&ext.as_str()) {
        return Err("File ini bukan gambar.".into());
    }
    let meta = std::fs::metadata(src).map_err(|_| "File gambar tidak ditemukan. Periksa alamatnya.".to_string())?;
    if !meta.is_file() || meta.len() > MAKS_FOTO {
        return Err("Gambar tidak bisa ditampilkan. Pilih gambar di bawah 10 MB.".into());
    }
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let bytes = std::fs::read(src).map_err(e)?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

#[perintah]
pub fn baca_gambar(path: String) -> Res<String> {
    gambar_data(&path)
}

#[perintah]
pub fn foto_baca(k: &Konteks, kode: String) -> Res<Option<String>> {
    foto_data(&k.folder_foto()?, &kode)
}

#[perintah]
pub fn foto_hapus(k: &Konteks, db: &Db, session: &Session, kode: String) -> Res<bool> {
    izin_foto(&db, &session, false)?;
    foto_buang(&k.folder_foto()?, &kode)
}

#[cfg(test)]
mod tests {
    #[test]
    fn xlsx_berisi_judul_dan_baris() {
        let b = super::buat_xlsx("Barang", &["Kode".into(), "Hrg. Jual".into()], &[false, true], &[vec!["A1".into(), "1.500".into()]]).unwrap();
        assert_eq!(&b[..2], b"PK", "berkas xlsx adalah zip");
        assert!(b.len() > 500);
    }

    use super::*;

    fn dir(n: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("tokopro-berkas-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn ekspor_hanya_file_baru_di_folder_yang_diizinkan() {
        let root = dir("ekspor");
        let luar = dir("luar");
        let roots = vec![root.clone()];
        let f = root.join("daftar.csv");
        let hasil = tulis_baru(f.to_str().unwrap(), "\u{feff}a;b\r\n1;2\r\n", &roots).unwrap();
        assert_eq!(std::fs::read(&hasil).unwrap()[..3], [0xEF, 0xBB, 0xBF]);
        // File sudah ada: ditolak, isi lama tetap.
        assert!(tulis_baru(f.to_str().unwrap(), "lain", &roots).unwrap_err().contains("sudah ada"));
        assert!(std::fs::read_to_string(&f).unwrap().contains("1;2"));
        // Di luar folder yang diizinkan, lewat .., ekstensi lain, alamat relatif.
        assert!(tulis_baru(luar.join("x.csv").to_str().unwrap(), "x", &roots).unwrap_err().contains("Documents"));
        let nyasar = root.join("..").join(luar.file_name().unwrap()).join("x.csv");
        assert!(tulis_baru(nyasar.to_str().unwrap(), "x", &roots).is_err());
        assert!(!luar.join("x.csv").exists());
        assert!(tulis_baru(root.join("a.exe").to_str().unwrap(), "x", &roots).unwrap_err().contains(".csv"));
        assert!(tulis_baru("x.csv", "x", &roots).is_err());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(luar);
    }

    #[test]
    fn nama_ekspor_bertanggal_dan_tidak_menimpa() {
        let d = dir("nama");
        let a = nama_baru_ext(&d, "Data Barang", "20261122", "csv");
        assert_eq!(a.file_name().unwrap(), "Data_Barang_20261122.csv");
        std::fs::write(&a, "x").unwrap();
        assert_eq!(nama_baru_ext(&d, "Data Barang", "20261122", "csv").file_name().unwrap(), "Data_Barang_20261122-2.csv");
        // Bentrok dicek per ekstensi: xlsx kedua di hari yang sama dapat -2, csv tetap tidak terpengaruh.
        let x = nama_baru_ext(&d, "Data Barang", "20261122", "xlsx");
        assert_eq!(x.file_name().unwrap(), "Data_Barang_20261122.xlsx");
        std::fs::write(&x, "x").unwrap();
        assert_eq!(nama_baru_ext(&d, "Data Barang", "20261122", "xlsx").file_name().unwrap(), "Data_Barang_20261122-2.xlsx");
        std::fs::write(d.join("Data_Barang_20261122-2.html"), "x").unwrap();
        assert_eq!(nama_baru_ext(&d, "Data Barang", "20261122", "html").file_name().unwrap(), "Data_Barang_20261122.html");
        assert_eq!(nama_baru_ext(&d, "Data Barang", "20261122", "csv").file_name().unwrap(), "Data_Barang_20261122-2.csv");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn foto_disalin_dibaca_diganti_dan_dihapus() {
        let d = dir("foto");
        let tujuan = d.join("foto");
        let png = d.join("a.png");
        std::fs::write(&png, [1u8, 2, 3, 4]).unwrap();
        assert_eq!(foto_salin(&tujuan, "A/1", png.to_str().unwrap()).unwrap(), "png");
        assert!(tujuan.join("A_1.png").is_file(), "kode dibersihkan dari karakter berbahaya");
        assert_eq!(foto_data(&tujuan, "A/1").unwrap().unwrap(), "data:image/png;base64,AQIDBA==");
        // Foto baru berbeda ekstensi menggantikan yang lama.
        let jpg = d.join("b.JPG");
        std::fs::write(&jpg, [9u8]).unwrap();
        foto_salin(&tujuan, "A/1", jpg.to_str().unwrap()).unwrap();
        assert!(!tujuan.join("A_1.png").exists() && tujuan.join("A_1.jpg").is_file());
        // Sumber adalah foto yang sudah tersimpan: tetap ada setelah diganti dengan dirinya sendiri.
        foto_salin(&tujuan, "A/1", tujuan.join("A_1.jpg").to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(tujuan.join("A_1.jpg")).unwrap(), [9u8]);
        // Salinan gagal: foto lama tetap, tidak ada file sementara tertinggal.
        let rusak = d.join("rusak.png");
        std::fs::create_dir(&rusak).unwrap();
        assert!(foto_salin(&tujuan, "A/1", rusak.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read(tujuan.join("A_1.jpg")).unwrap(), [9u8]);
        assert!(!tujuan.join(".A_1.baru").exists());
        std::fs::remove_dir(&rusak).unwrap();
        assert!(foto_buang(&tujuan, "A/1").unwrap());
        assert_eq!(foto_data(&tujuan, "A/1").unwrap(), None);
        assert!(!foto_buang(&tujuan, "A/1").unwrap());
        // Bukan gambar, tidak ada, kode kosong.
        let txt = d.join("c.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(foto_salin(&tujuan, "A", txt.to_str().unwrap()).unwrap_err().contains("bukan gambar"));
        assert!(foto_salin(&tujuan, "A", d.join("tidak.png").to_str().unwrap()).unwrap_err().contains("tidak ditemukan"));
        assert!(foto_salin(&tujuan, " ", png.to_str().unwrap()).is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn foto_disalin_lalu_file_asal_dihapus_bila_diminta() {
        let d = dir("hapus");
        let tujuan = d.join("foto");
        let a = d.join("a.png");
        std::fs::write(&a, [1u8, 2]).unwrap();
        foto_salin_hapus_opsi(&tujuan, "K1", a.to_str().unwrap(), false, false).unwrap();
        assert!(a.exists() && tujuan.join("K1.png").is_file(), "tanpa centang, file asal tetap");
        foto_salin_hapus_opsi(&tujuan, "K2", a.to_str().unwrap(), true, false).unwrap();
        assert!(!a.exists(), "dicentang: file asal dihapus");
        assert_eq!(std::fs::read(tujuan.join("K2.png")).unwrap(), [1u8, 2], "salinan utuh");
        // Salin gagal: file asal tidak boleh ikut dihapus.
        let t = d.join("b.txt");
        std::fs::write(&t, "x").unwrap();
        assert!(foto_salin_hapus_opsi(&tujuan, "K3", t.to_str().unwrap(), true, false).is_err());
        assert!(t.exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn base64_sesuai_standar() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }
}
