//! Pindah otomatis dari Toko Pro lama saat KasirJet dibuka pertama kali (rancangan bagian 8).
//! Menentukan peran komputer dari `Settings.ini` lama, menyalin foto, logo, dan gambar latar, membaca pengaturan lama,
//! dan menyiapkan komputer Pusat. Pemetaan pengaturan ke setelan per komputer ada di `src/pages/localSettings.ts`.

use crate::auth::Session;
use crate::db::{e, Db, Res};
use crate::jaringan::{kendali::Kendali, klien::Klien, mode::Mode, server::antarmuka_sistem};
use crate::konteks::Konteks;
use crate::pindah_lama::{bersihkan_nama_komputer, cari, pindahkan, senyap, Firebird, Instalasi};
use perintah_macro::perintah;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};

const PESAN_TERBUKA: &str = "Toko Pro lama masih terbuka di komputer ini. Tutup Toko Pro lama, lalu KasirJet akan melanjutkan sendiri.";
const PESAN_BUKAN_PUSAT: &str = "Toko Pro lama di komputer ini bukan tempat data toko Anda, jadi komputer ini belum bisa dijadikan Pusat.";
const PESAN_TIDAK_ADA_DATA: &str = "KasirJet tidak menemukan data toko di komputer ini. Pilih Atur sendiri, lalu sambungkan komputer ini ke komputer Pusat.";
const PESAN_TIDAK_ADA_LAMA: &str = "Toko Pro lama tidak ditemukan di komputer ini.";

/// Kunci `[Database]`; kunci lain dicari di bagian `[Application]` lebih dulu (rancangan 8.4).
const KUNCI_DATABASE: [&str; 4] = ["namakomputer", "lokasidata", "lokasibackup", "firebirdlocation"];
/// Ekstensi foto aplikasi lama (rancangan 8.3).
const EKSTENSI_LAMA: [&str; 4] = ["jpg", "jpeg", "bmp", "gif"];
const EKSTENSI_GAMBAR: [&str; 6] = ["jpg", "jpeg", "png", "gif", "bmp", "webp"];

// ---------------------------------------------------------------- Settings.ini

/// Isi `Settings.ini` tanpa nama bagian: `namakomputer` -> nilai. Kunci database diambil dari `[Database]`, kunci lain dari
/// `[Application]` bila ada; bila tidak ada di sana, dari bagian mana pun (urutan nama bagian).
pub fn pengaturan_datar(ini: &HashMap<String, String>) -> BTreeMap<String, String> {
    let mut urut: Vec<(&String, &String)> = ini.iter().collect();
    urut.sort();
    let mut hasil: BTreeMap<String, (String, bool)> = BTreeMap::new();
    for (k, v) in urut {
        let Some((bagian, kunci)) = k.split_once('.') else { continue };
        let utama = if KUNCI_DATABASE.contains(&kunci) { bagian == "database" } else { bagian == "application" };
        match hasil.get(kunci) {
            Some((_, true)) => {}
            _ => {
                hasil.insert(kunci.to_string(), (v.clone(), utama));
            }
        }
    }
    hasil.into_iter().map(|(k, (v, _))| (k, v)).collect()
}

/// Alamat di `Settings.ini` lama menjadi alamat di komputer ini. Alamat tanpa huruf drive (`\_foto\`) dihitung dari folder instalasi lama.
pub fn jalur_lama(folder: &Path, nilai: &str) -> PathBuf {
    let n = nilai.trim().trim_matches('"').trim();
    let mutlak = n.starts_with("\\\\") || n.starts_with("//") || n.as_bytes().get(1) == Some(&b':') || (!cfg!(windows) && n.starts_with('/'));
    if mutlak {
        return if cfg!(windows) { PathBuf::from(n) } else { PathBuf::from(n.replace('\\', "/")) };
    }
    let mut p = folder.to_path_buf();
    for bagian in n.split(['\\', '/']).filter(|b| !b.is_empty() && *b != ".") {
        p.push(bagian);
    }
    p
}

fn nilai<'a>(datar: &'a BTreeMap<String, String>, kunci: &str) -> Option<&'a str> {
    datar.get(kunci).map(|s| s.trim()).filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------- peran

#[derive(Clone, Debug, PartialEq)]
pub enum Peran {
    /// Komputer ini tempat data toko lama; `data` adalah file `DATAPOS.FDB`-nya.
    Pusat { data: PathBuf },
    /// Komputer kasir yang tersambung ke komputer `pusat`.
    Kasir { pusat: String },
    /// Tidak ada Pusat lain dan tidak ada data di sini: tampilkan pertanyaan tiga pilihan biasa (7.1).
    TidakJelas,
}

/// Nama atau IP komputer Pusat dari `NamaKomputer`. `None` bila komputer ini sendiri (kosong, `localhost`, nama komputer ini, atau salah satu IP-nya).
pub fn bersihkan_nama_atau_ip(mentah: &str, nama_sendiri: &str, ip_sendiri: &[String]) -> Option<String> {
    let nama = bersihkan_nama_komputer(mentah, nama_sendiri)?;
    if let Ok(ip) = nama.parse::<IpAddr>() {
        if ip_sendiri.iter().filter_map(|i| i.parse::<IpAddr>().ok()).any(|i| i.to_canonical() == ip.to_canonical()) {
            return None;
        }
    }
    Some(nama)
}

/// File data toko lama di komputer ini (`DATAPOS.FDB`), bila ada. Keberadaannya saja tidak menentukan peran: pemasang
/// lama menaruh file data kosong di semua komputer.
fn berkas_data_lama(inst: &Instalasi) -> Option<PathBuf> {
    let datar = pengaturan_datar(&inst.ini);
    let mut calon: Vec<PathBuf> = vec![];
    if let Some(l) = nilai(&datar, "lokasidata") {
        calon.push(jalur_lama(&inst.folder, l));
    }
    calon.push(inst.folder.join("_data").join("DATAPOS.FDB"));
    calon.into_iter().find(|p| p.is_file())
}

/// Peran komputer ini menurut `Settings.ini` lama (rancangan 8.1).
pub fn tentukan_peran(inst: &Instalasi, nama_sendiri: &str, ip_sendiri: &[String]) -> Peran {
    let datar = pengaturan_datar(&inst.ini);
    if let Some(pusat) = bersihkan_nama_atau_ip(nilai(&datar, "namakomputer").unwrap_or(""), nama_sendiri, ip_sendiri) {
        return Peran::Kasir { pusat };
    }
    match berkas_data_lama(inst) {
        Some(data) => Peran::Pusat { data },
        None => Peran::TidakJelas,
    }
}

/// File data yang diambil bila komputer ini dijadikan Pusat. Dengan `paksa` (tombol "Jadikan komputer ini Pusat" di layar
/// menunggu Pusat), peran dari `Settings.ini` tidak dipakai: komputer yang IP atau namanya berubah bisa dianggap kasir padahal
/// data tokonya ada di sini (rancangan 8.1).
pub fn data_untuk_pusat(inst: &Instalasi, nama_sendiri: &str, ip_sendiri: &[String], paksa: bool) -> Result<PathBuf, String> {
    if paksa {
        return berkas_data_lama(inst).ok_or_else(|| PESAN_TIDAK_ADA_DATA.to_string());
    }
    match tentukan_peran(inst, nama_sendiri, ip_sendiri) {
        Peran::Pusat { data } => Ok(data),
        _ => Err(PESAN_BUKAN_PUSAT.to_string()),
    }
}

pub fn ip_sendiri() -> Vec<String> {
    antarmuka_sistem().into_iter().map(|(ip, _)| ip.to_string()).collect()
}

// ---------------------------------------------------------------- Toko Pro lama masih berjalan

/// Nama file `.exe` (huruf kecil) di folder instalasi lama, tanpa program pencopot dan pemasang.
pub fn exe_di_folder(folder: &Path) -> Vec<String> {
    std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .filter(|f| f.path().is_file())
                .filter_map(|f| f.file_name().to_str().map(str::to_lowercase))
                .filter(|n| n.ends_with(".exe") && !n.starts_with("unins") && !n.contains("setup"))
                .collect()
        })
        .unwrap_or_default()
}

/// Apakah salah satu nama di `exe` ada di keluaran `tasklist /FO CSV /NH`?
pub fn ada_proses(keluaran_tasklist: &str, exe: &[String]) -> bool {
    keluaran_tasklist.lines().any(|baris| {
        let nama = baris.trim().trim_start_matches('"').split('"').next().unwrap_or("").to_lowercase();
        !nama.is_empty() && exe.contains(&nama)
    })
}

/// Apakah program Toko Pro lama dari `folder` sedang berjalan di komputer ini? Hanya diperiksa di Windows.
pub fn proses_lama_berjalan(folder: &Path) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let mut exe = exe_di_folder(folder);
    if let Some(diri) = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())) {
        exe.retain(|n| *n != diri);
    }
    if exe.is_empty() {
        return false;
    }
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/FO", "CSV", "/NH"]);
    match senyap(&mut cmd).output() {
        Ok(o) => ada_proses(&String::from_utf8_lossy(&o.stdout), &exe),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------- foto dan gambar

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HasilFoto {
    pub tersalin: usize,
    /// Nama file yang tidak sama dengan kode barang mana pun.
    pub tidak_cocok: usize,
    /// Cocok dengan kode barang, tetapi tidak bisa disalin (rusak atau lebih dari 10 MB).
    pub gagal: usize,
}

/// File foto (`<nama>.jpg/.jpeg/.bmp/.gif`) di `folder`: (nama tanpa ekstensi, alamat), urut menurut nama.
pub fn daftar_foto(folder: &Path) -> Vec<(String, PathBuf)> {
    let mut v: Vec<(String, PathBuf)> = std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .map(|f| f.path())
                .filter(|p| p.is_file())
                .filter_map(|p| {
                    let ext = p.extension()?.to_str()?.to_lowercase();
                    if !EKSTENSI_LAMA.contains(&ext.as_str()) {
                        return None;
                    }
                    Some((p.file_stem()?.to_string_lossy().into_owned(), p))
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

/// Salin foto dari `folder_foto` ke `tujuan` bila namanya sama (tanpa beda huruf besar-kecil) dengan kode barang di `kode_ada`
/// (kode huruf kecil -> kode asli). Foto yang sudah ada di `tujuan` untuk kode yang sama diganti. File asli tidak dihapus.
pub fn salin_foto(folder_foto: &Path, tujuan: &Path, kode_ada: &HashMap<String, String>) -> HasilFoto {
    let mut h = HasilFoto::default();
    for (nama, path) in daftar_foto(folder_foto) {
        let Some(kode) = kode_ada.get(&nama.to_lowercase()) else {
            h.tidak_cocok += 1;
            continue;
        };
        match crate::berkas::foto_salin(tujuan, kode, &path.display().to_string()) {
            Ok(_) => h.tersalin += 1,
            Err(_) => h.gagal += 1,
        }
    }
    h
}

/// Salin satu gambar (logo atau latar) ke `<tujuan>/<nama>.<ekstensi>`. `None` bila tidak ada, bukan gambar, atau gagal disalin.
pub fn salin_gambar(folder: &Path, lokasi: Option<&str>, tujuan: &Path, nama: &str) -> Option<PathBuf> {
    let sumber = jalur_lama(folder, lokasi?);
    let ext = sumber.extension()?.to_str()?.to_lowercase();
    if !sumber.is_file() || !EKSTENSI_GAMBAR.contains(&ext.as_str()) {
        return None;
    }
    std::fs::create_dir_all(tujuan).ok()?;
    for x in EKSTENSI_GAMBAR {
        let _ = std::fs::remove_file(tujuan.join(format!("{nama}.{x}")));
    }
    let hasil = tujuan.join(format!("{nama}.{ext}"));
    std::fs::copy(&sumber, &hasil).ok()?;
    Some(hasil)
}

/// Folder cadangan lama yang masih layak dipakai: alamat lengkap (bukan `\_file\` di folder lama), ada, bisa ditulis,
/// dan tidak di dalam folder instalasi lama (bisa ikut terhapus saat Toko Pro lama dicopot).
pub fn folder_backup_layak(folder_lama: &Path, lokasi: &str) -> Option<PathBuf> {
    let n = lokasi.trim().trim_matches('"').trim();
    if !(n.starts_with("\\\\") || n.starts_with("//") || n.as_bytes().get(1) == Some(&b':')) {
        return None;
    }
    let p = jalur_lama(folder_lama, n);
    if !p.is_dir() || p.starts_with(folder_lama) {
        return None;
    }
    let uji = p.join(format!(".tokopro-uji-{}", std::process::id()));
    std::fs::write(&uji, b"").ok()?;
    let _ = std::fs::remove_file(&uji);
    Some(p)
}

fn folder_gambar(folder_data: &Path) -> PathBuf {
    folder_data.join("gambar")
}

/// Isi untuk perintah `lama_pengaturan`: peta kunci `Settings.ini` (huruf kecil, tanpa nama bagian) dan folder foto lama.
/// Logo dan latar disalin ke `<folder_data>/gambar` dan nilainya diganti alamat baru; cadangan hanya bila folder sendiri.
pub fn pengaturan_lama(inst: &Instalasi, folder_data: &Path) -> Value {
    let mut datar = pengaturan_datar(&inst.ini);
    let folder = &inst.folder;
    for (kunci, nama) in [("lokasilogo", "logo"), ("lokasibcgrnd", "background")] {
        let baru = salin_gambar(folder, nilai(&datar, kunci), &folder_gambar(folder_data), nama);
        match baru {
            Some(p) => datar.insert(kunci.into(), p.display().to_string()),
            None => datar.remove(kunci),
        };
    }
    match nilai(&datar, "lokasibackup").and_then(|l| folder_backup_layak(folder, l)) {
        Some(p) => datar.insert("lokasibackup".into(), p.display().to_string()),
        None => datar.remove("lokasibackup"),
    };
    let foto = jalur_lama(folder, nilai(&datar, "lokasifoto").unwrap_or("\\_foto\\"));
    json!({
        "ada": true,
        "folder": folder.display().to_string(),
        "nilai": datar,
        "fotoFolder": if foto.is_dir() { Some(foto.display().to_string()) } else { None },
    })
}

// ---------------------------------------------------------------- perintah (jalan lewat dispatcher, di komputer ini)

/// Pengaturan Toko Pro lama di komputer ini (rancangan 8.4). Dipakai di Pusat dan di Kasir, jadi golongan Lokal.
#[perintah]
pub fn lama_pengaturan(k: &Konteks) -> Res<Value> {
    let Some(inst) = cari().instalasi else { return Ok(json!({ "ada": false })) };
    Ok(pengaturan_lama(&inst, &k.folder_data()?))
}

/// Foto di folder foto Toko Pro lama komputer ini: nama (tanpa ekstensi) dan alamat file. Dipakai Kasir untuk mengirim fotonya ke Pusat.
#[perintah]
pub fn lama_foto_daftar(_k: &Konteks) -> Res<Value> {
    let Some(inst) = cari().instalasi else { return Ok(json!([])) };
    let datar = pengaturan_datar(&inst.ini);
    let foto = jalur_lama(&inst.folder, nilai(&datar, "lokasifoto").unwrap_or("\\_foto\\"));
    Ok(json!(daftar_foto(&foto).into_iter().map(|(n, p)| json!({ "nama": n, "path": p.display().to_string() })).collect::<Vec<_>>()))
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PilahFoto {
    /// (nama file, kode barang di Pusat) yang belum punya foto di Pusat.
    pub perlu: Vec<(String, String)>,
    pub sudah_ada: usize,
    pub tidak_cocok: usize,
}

/// Pilah nama foto Kasir: cocok dengan kode barang (tanpa beda huruf besar-kecil)? Sudah punya foto di Pusat?
pub fn pilah_foto(nama: &[String], kode_ada: &HashMap<String, String>, punya_foto: impl Fn(&str) -> bool) -> PilahFoto {
    let mut p = PilahFoto::default();
    for n in nama {
        match kode_ada.get(&n.to_lowercase()) {
            None => p.tidak_cocok += 1,
            Some(kode) if punya_foto(kode) => p.sudah_ada += 1,
            Some(kode) => p.perlu.push((n.clone(), kode.clone())),
        }
    }
    p
}

/// Sisi Pusat: dari nama foto di komputer Kasir, mana yang cocok dengan kode barang dan belum punya foto di Pusat.
/// Foto di Pusat tidak pernah ditimpa (rancangan 8.3).
#[perintah]
pub fn foto_perlu_kirim(k: &Konteks, db: &Db, session: &Session, daftar: Vec<String>) -> Res<Value> {
    session.user()?;
    let kode_ada = kode_barang(db)?;
    let dir = k.folder_foto()?;
    let p = pilah_foto(&daftar, &kode_ada, |kode| crate::berkas::foto_data(&dir, kode).map(|f| f.is_some()).unwrap_or(false));
    Ok(json!({ "perlu": p.perlu, "sudahAda": p.sudah_ada, "tidakCocok": p.tidak_cocok }))
}

/// Kode barang huruf kecil -> kode asli.
fn kode_barang(db: &Db) -> Res<HashMap<String, String>> {
    let conn = db.lock()?;
    let mut st = conn.prepare("SELECT kodebarang FROM mdbarang WHERE kodebarang IS NOT NULL AND kodebarang <> ''").map_err(e)?;
    let v = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?.flatten().map(|k| (k.to_lowercase(), k)).collect();
    Ok(v)
}

// ---------------------------------------------------------------- perintah Tauri (layar pilihan awal)

/// Hasil pemindaian saat KasirJet dibuka pertama kali: ada Toko Pro lama atau tidak, dan peran komputer ini.
#[tauri::command]
pub async fn lama_deteksi(app: tauri::AppHandle) -> Value {
    tauri::async_runtime::spawn_blocking(move || {
        let perlu = {
            let kendali = app.state::<Kendali>();
            let klien = app.state::<Arc<Klien>>();
            let db = app.state::<Db>();
            crate::perlu_pilihan(&kendali, &klien, &db)
        };
        let Some(inst) = cari().instalasi.filter(|_| perlu) else { return json!({ "ada": false }) };
        let (peran, pusat) = match tentukan_peran(&inst, &crate::jaringan::kendali::nama_komputer(), &ip_sendiri()) {
            Peran::Pusat { .. } => ("pusat", None),
            Peran::Kasir { pusat } => ("kasir", Some(pusat)),
            Peran::TidakJelas => ("tidakJelas", None),
        };
        json!({
            "ada": true,
            "peran": peran,
            "pusat": pusat,
            "folder": inst.folder.display().to_string(),
            "terbuka": proses_lama_berjalan(&inst.folder),
        })
    })
    .await
    .unwrap_or_else(|_| json!({ "ada": false }))
}

/// Apakah Toko Pro lama dari `folder` masih terbuka di komputer ini? Dipanggil berulang sambil menunggu.
#[tauri::command]
pub async fn lama_terbuka(folder: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || proses_lama_berjalan(Path::new(&folder))).await.unwrap_or(false)
}

/// Ambil data dari Toko Pro lama tanpa memilih file, salin foto, lalu jadikan komputer ini Pusat (rancangan 8.2).
/// Cadangan dibuat lebih dulu oleh `pindahkan`. Komputer ini baru dijadikan Pusat bila datanya berhasil diambil.
#[tauri::command]
pub async fn lama_pusat_mulai(app: tauri::AppHandle, paksa: Option<bool>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || lama_pusat_mulai_sync(&app, paksa.unwrap_or(false))).await.map_err(|err| err.to_string())?
}

fn lama_pusat_mulai_sync(app: &tauri::AppHandle, paksa: bool) -> Res<Value> {
    let kendali = app.state::<Kendali>();
    let klien = app.state::<Arc<Klien>>();
    let db = app.state::<Db>();
    if !crate::perlu_pilihan(&kendali, &klien, &db) {
        return Err("Peran komputer ini sudah dipilih. Manager bisa mengubahnya di Pengaturan, Alat Bantu, Komputer Pusat.".into());
    }
    let t = cari();
    let inst = t.instalasi.clone().ok_or(PESAN_TIDAK_ADA_LAMA)?;
    let data = data_untuk_pusat(&inst, &crate::jaringan::kendali::nama_komputer(), &ip_sendiri(), paksa)?;
    if proses_lama_berjalan(&inst.folder) {
        return Err(PESAN_TERBUKA.into());
    }
    let fb = Firebird::temukan(&t.folder_firebird).ok_or_else(|| crate::pindah_lama::PESAN_TIDAK_ADA.to_string())?;
    let h = pindahkan(&db, &data, None, &fb, &mut |p| {
        let _ = app.emit("pindah-lama", p.json());
    })?;
    let jumlah = |tabel: &str| h.hasil.iter().find(|x| x.tabel == tabel).map(|x| x.jumlah).unwrap_or(0);

    let folder_data = crate::konteks::folder_data_aplikasi(app)?;
    let datar = pengaturan_datar(&inst.ini);
    let folder_foto = jalur_lama(&inst.folder, nilai(&datar, "lokasifoto").unwrap_or("\\_foto\\"));
    let foto = salin_foto(&folder_foto, &folder_data.join("foto"), &kode_barang(&db)?);

    let mut galat_server = Value::Null;
    kendali.atur_mode(Arc::new(app.clone()), Mode::Pusat, None)?;
    match kendali.pusat() {
        Ok(p) => p.buka_terima_otomatis(crate::jaringan::kendali::sisa_sampai_tengah_malam()),
        Err(pesan) => galat_server = json!(pesan),
    }
    klien.selaraskan();
    // Windows menampilkan dialog UAC di sini. Bila ditolak, komputer tetap jadi Pusat; izinnya bisa diberikan lagi dari layar Komputer Pusat.
    let izin_windows = crate::jaringan::firewall::beri_izin(kendali.port_efektif()).err();
    Ok(json!({
        "izinWindows": izin_windows,
        "barang": jumlah("MDBARANG"),
        "transaksi": jumlah("TRANSAKSI"),
        "pelanggan": jumlah("MDPELANGGAN"),
        "pengguna": jumlah("MDUSER"),
        "foto": { "tersalin": foto.tersalin, "tidakCocok": foto.tidak_cocok, "gagal": foto.gagal },
        "cadangan": h.cadangan.display().to_string(),
        "peringatan": h.peringatan,
        "galatServer": galat_server,
    }))
}
