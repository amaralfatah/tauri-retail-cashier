//! Berkas pengguna: simpan hasil ekspor daftar (CSV) dan foto barang.
//! Penulisan dibatasi ke folder Documents atau Downloads, dan hanya untuk file baru.

use crate::auth::{require_menu, Session};
use crate::db::{e, Db, Res};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

const MAKS_EKSPOR: usize = 64 * 1024 * 1024;
const MAKS_FOTO: u64 = 10 * 1024 * 1024;
const EKSTENSI_FOTO: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp"];

fn folder_tujuan(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let p = app.path();
    [p.document_dir(), p.download_dir()].into_iter().flatten().collect()
}

/// Nama file baru di `dir`: `<nama>_<tgl>.csv`, ditambah -2, -3, ... kalau sudah ada.
pub fn nama_baru(dir: &Path, nama: &str, tgl: &str) -> PathBuf {
    let bersih: String = nama.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let dasar = format!("{bersih}_{tgl}");
    let mut p = dir.join(format!("{dasar}.csv"));
    let mut i = 2;
    while p.exists() {
        p = dir.join(format!("{dasar}-{i}.csv"));
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
#[tauri::command]
pub fn ekspor_nama(app: tauri::AppHandle, nama: String) -> Res<String> {
    let dir = folder_tujuan(&app).into_iter().find(|d| d.is_dir()).ok_or("Folder Documents tidak ditemukan di komputer ini.")?;
    Ok(nama_baru(&dir, &nama, &chrono::Local::now().format("%Y%m%d").to_string()).display().to_string())
}

/// Simpan isi ekspor sebagai file baru; mengembalikan alamat file yang dibuat.
#[tauri::command]
pub fn simpan_file(app: tauri::AppHandle, session: State<Session>, path: String, isi: String) -> Res<String> {
    session.user()?;
    Ok(tulis_baru(&path, &isi, &folder_tujuan(&app))?.display().to_string())
}

/// Simpan teks sebagai file baru dengan salah satu ekstensi `boleh_ext` (dipakai ekspor laporan).
pub fn simpan_teks(app: &tauri::AppHandle, path: &str, isi: &str, boleh_ext: &[&str]) -> Res<String> {
    let pesan = format!("Nama file harus berakhiran .{}.", boleh_ext.join(", ."));
    Ok(tulis_baru_byte(path, isi.as_bytes(), &folder_tujuan(app), boleh_ext, &pesan)?.display().to_string())
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
#[tauri::command]
pub fn simpan_xlsx(app: tauri::AppHandle, session: State<Session>, path: String, lembar: String, judul: Vec<String>, angka: Vec<bool>, baris: Vec<Vec<String>>) -> Res<String> {
    session.user()?;
    let isi = buat_xlsx(&lembar, &judul, &angka, &baris)?;
    Ok(tulis_baru_byte(&path, &isi, &folder_tujuan(&app), &["xlsx"], "Nama file harus berakhiran .xlsx.")?.display().to_string())
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

fn foto_ada(dir: &Path, kode: &str) -> Res<Option<PathBuf>> {
    let dasar = nama_foto(kode)?;
    Ok(EKSTENSI_FOTO.iter().map(|x| dir.join(format!("{dasar}.{x}"))).find(|p| p.is_file()))
}

/// Salin gambar `sumber` ke `dir` sebagai `<kode>.<ekstensi>`; foto lama barang itu diganti.
pub fn foto_salin(dir: &Path, kode: &str, sumber: &str) -> Res<String> {
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
    std::fs::create_dir_all(dir).map_err(e)?;
    if let Some(lama) = foto_ada(dir, kode)? {
        std::fs::remove_file(lama).map_err(e)?;
    }
    std::fs::copy(src, dir.join(format!("{dasar}.{ext}"))).map_err(e)?;
    Ok(ext)
}

/// Salin foto seperti `foto_salin`; kalau `hapus_asal`, file sumber dihapus setelah salinan berhasil.
pub fn foto_salin_hapus(dir: &Path, kode: &str, sumber: &str, hapus_asal: bool) -> Res<String> {
    let ext = foto_salin(dir, kode, sumber)?;
    if hapus_asal {
        std::fs::remove_file(Path::new(sumber.trim())).map_err(|_| "Foto sudah disalin, tetapi file aslinya tidak bisa dihapus.".to_string())?;
    }
    Ok(ext)
}

fn base64(data: &[u8]) -> String {
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

fn foto_dir(app: &tauri::AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(e)?.join("foto"))
}

fn izin_foto(db: &Db, session: &Session, kasir_boleh: bool) -> Res<()> {
    let user = session.user()?;
    if !kasir_boleh && user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengubah foto barang.".into());
    }
    require_menu(&*db.lock()?, &user, "mnMDDataBarang")
}

#[tauri::command]
pub fn foto_simpan(app: tauri::AppHandle, db: State<Db>, session: State<Session>, kode: String, path: String, hapus_asal: Option<bool>) -> Res<String> {
    // Aslinya (cSimpan_Click) tidak memeriksa level, jadi kasir pun boleh menyimpan foto.
    izin_foto(&db, &session, true)?;
    foto_salin_hapus(&foto_dir(&app)?, &kode, &path, hapus_asal.unwrap_or(false))
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

#[tauri::command]
pub fn baca_gambar(path: String) -> Res<String> {
    gambar_data(&path)
}

#[tauri::command]
pub fn foto_baca(app: tauri::AppHandle, kode: String) -> Res<Option<String>> {
    foto_data(&foto_dir(&app)?, &kode)
}

#[tauri::command]
pub fn foto_hapus(app: tauri::AppHandle, db: State<Db>, session: State<Session>, kode: String) -> Res<bool> {
    izin_foto(&db, &session, false)?;
    foto_buang(&foto_dir(&app)?, &kode)
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
        let a = nama_baru(&d, "Data Barang", "20261122");
        assert_eq!(a.file_name().unwrap(), "Data_Barang_20261122.csv");
        std::fs::write(&a, "x").unwrap();
        assert_eq!(nama_baru(&d, "Data Barang", "20261122").file_name().unwrap(), "Data_Barang_20261122-2.csv");
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
        foto_salin_hapus(&tujuan, "K1", a.to_str().unwrap(), false).unwrap();
        assert!(a.exists() && tujuan.join("K1.png").is_file(), "tanpa centang, file asal tetap");
        foto_salin_hapus(&tujuan, "K2", a.to_str().unwrap(), true).unwrap();
        assert!(!a.exists(), "dicentang: file asal dihapus");
        assert_eq!(std::fs::read(tujuan.join("K2.png")).unwrap(), [1u8, 2], "salinan utuh");
        // Salin gagal: file asal tidak boleh ikut dihapus.
        let t = d.join("b.txt");
        std::fs::write(&t, "x").unwrap();
        assert!(foto_salin_hapus(&tujuan, "K3", t.to_str().unwrap(), true).is_err());
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
