//! Pengaturan database: lokasi, cadangan (backup), pemulihan (restore), pemeriksaan, dan perbaikan.
//! Cadangan dibuat dengan `VACUUM INTO`, jadi hasilnya satu file SQLite utuh yang konsisten walau aplikasi sedang dipakai.

use crate::auth::{Session, User};
use crate::db::{e, Db, Res};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use perintah_macro::perintah;

pub fn hanya_pengelola(user: &User) -> Res<()> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengakses pengaturan database.".into());
    }
    Ok(())
}

/// Tindakan yang bisa menimpa atau menghapus data: hanya Manager.
pub fn hanya_manager(user: &User) -> Res<()> {
    if user.level != "Manager" {
        return Err("Hanya akun Manager yang bisa melakukan ini.".into());
    }
    Ok(())
}

/// Backup, cek, dan perbaikan juga ada di Alat Bantu (FrmZAlat), yang punya menu sendiri.
/// Cukup salah satu dari menu Database atau Alat Bantu yang boleh dibuka.
pub(crate) fn izin_database_atau_alat(conn: &Connection, user: &User) -> Res<()> {
    crate::auth::require_menu(conn, user, "mnPengaturanDatabase").or_else(|err| crate::auth::require_menu(conn, user, "mnPengaturanAlat").map_err(|_| err))
}

pub fn lokasi_db(conn: &Connection) -> Res<PathBuf> {
    conn.path().filter(|p| !p.is_empty()).map(PathBuf::from).ok_or_else(|| "Lokasi database tidak diketahui.".to_string())
}

/// Folder cadangan bawaan: `backup` di samping file database (folder data aplikasi).
pub fn folder_bawaan(conn: &Connection) -> Res<PathBuf> {
    Ok(lokasi_db(conn)?.parent().map(|p| p.join("backup")).unwrap_or_else(|| PathBuf::from("backup")))
}

fn folder_pilihan(conn: &Connection, folder: Option<&str>) -> Res<PathBuf> {
    match folder.map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => Ok(PathBuf::from(f)),
        None => folder_bawaan(conn),
    }
}

fn cap_waktu() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Salin database ke `folder` dengan nama bertanggal. Mengembalikan lokasi file hasilnya.
pub fn backup_ke(conn: &Connection, folder: &Path, awalan: &str) -> Res<PathBuf> {
    std::fs::create_dir_all(folder).map_err(|_| format!("Folder {} tidak bisa dibuat. Periksa lokasinya.", folder.display()))?;
    let mut file = folder.join(format!("{awalan}-{}.db", cap_waktu()));
    let mut n = 1;
    while file.exists() {
        file = folder.join(format!("{awalan}-{}-{n}.db", cap_waktu()));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", [file.to_string_lossy().as_ref()]).map_err(e)?;
    Ok(file)
}

/// Apakah database sudah berisi data yang diisi pengguna: barang, transaksi (termasuk order), pelanggan, supplier, karyawan,
/// kas, piutang, poin, penjualan tertunda, promo, kategori dan kelompok, pengguna selain akun bawaan, serta jenis non tunai dan
/// satuan yang berbeda dari data bawaan. Data bawaan database baru (`seed`) tidak dihitung. Satu tempat untuk layar pilihan awal
/// dan cadangan sebelum jadi Kasir. Bila pemeriksaan gagal, dianggap berisi (lebih aman: dicadangkan dan tidak ditimpa).
pub fn database_berisi(conn: &Connection) -> bool {
    const ADA: &[&str] = &[
        "mdbarang", "transaksi", "mdpelanggan", "mdpemasok", "mdkaryawan", "keuangan", "trkartupiutang", "transaksipoin", "pendingjual",
        "mdbarangbonus", "mdbarangdiskon", "mdbarangpdp", "mdbarangbarcode", "mdkategori", "mdkelompok",
    ];
    // Selain data bawaan: akun lain, atau akun admin yang kata sandinya sudah diatur.
    const BEDA: &[&str] = &[
        "SELECT 1 FROM mduser WHERE NOT (iduser = 'admin' AND pswduser IS NULL)",
        "SELECT 1 FROM mdjenisnontunai WHERE kode || '|' || namajenis NOT IN ('01|Kartu Debit','02|Kartu Kredit','03|E-Money','04|E-Wallet')",
        "SELECT 1 FROM mdjenisnontunaiitem WHERE kode || '|' || namaitem NOT IN ('01|BCA','01|BRI','01|Mandiri','02|BCA','04|QRIS')",
        "SELECT 1 FROM mdsatuan WHERE kodesatuan || '|' || namasatuan NOT IN ('PCS|Pieces','BOX|Box','PAK|Pak','KG|Kilogram')",
        // Data bawaan yang dihapus juga tanda ada yang mengubahnya.
        "SELECT 1 WHERE (SELECT COUNT(*) FROM mdjenisnontunai) <> 4 OR (SELECT COUNT(*) FROM mdjenisnontunaiitem) <> 5 OR (SELECT COUNT(*) FROM mdsatuan) <> 4",
    ];
    let ada = |sql: &str| conn.query_row(&format!("SELECT EXISTS({sql})"), [], |r| r.get::<_, i64>(0)).map(|n| n != 0);
    ADA.iter().map(|t| format!("SELECT 1 FROM {t}")).chain(BEDA.iter().map(|s| s.to_string())).any(|sql| ada(&sql).unwrap_or(true))
}

/// Cadangan database toko sebelum komputer ini dijadikan Kasir (rancangan 6.2). Kasir tidak membuka `tokopro.db` lagi, jadi isinya
/// dibiarkan di tempatnya dan salinan ini menjaganya tetap bisa dipulihkan. `None` bila tidak ada datanya (atau tidak ada file).
pub fn cadangan_sebelum_kasir(db: &Db) -> Res<Option<PathBuf>> {
    let conn = db.lock()?;
    let Ok(lokasi) = lokasi_db(&conn) else { return Ok(None) };
    if !database_berisi(&conn) {
        return Ok(None);
    }
    let folder = lokasi.parent().map(|p| p.join("backup")).unwrap_or_else(|| PathBuf::from("backup"));
    backup_ke(&conn, &folder, "sebelum-jadi-kasir").map(Some)
}

/// Jumlah cadangan otomatis yang disimpan; yang lebih lama dihapus.
pub const CADANGAN_OTOMATIS_MAKS: usize = 10;
const AWALAN_OTOMATIS: &str = "otomatis";

/// Cadangan saat program ditutup. Hanya `simpan` file otomatis terbaru yang dipertahankan;
/// cadangan buatan Anda sendiri dan cadangan pengaman tidak pernah dihapus.
pub fn backup_otomatis_ke(conn: &Connection, folder: &Path, simpan: usize) -> Res<PathBuf> {
    let file = backup_ke(conn, folder, AWALAN_OTOMATIS)?;
    let mut lama: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(folder)
        .map(|rd| {
            rd.flatten()
                .filter(|f| {
                    let n = f.file_name().to_string_lossy().into_owned();
                    n.starts_with(&format!("{AWALAN_OTOMATIS}-")) && n.ends_with(".db")
                })
                .filter_map(|f| Some((f.metadata().ok()?.modified().ok()?, f.path())))
                .collect()
        })
        .unwrap_or_default();
    lama.sort_by(|a, b| b.cmp(a));
    for (_, p) in lama.into_iter().skip(simpan.max(1)) {
        let _ = std::fs::remove_file(p);
    }
    Ok(file)
}

/// Hasil PRAGMA integrity_check (atau quick_check). Kosong berarti tidak ada masalah.
pub fn periksa(conn: &Connection, penuh: bool) -> Res<Vec<String>> {
    let sql = if penuh { "PRAGMA integrity_check" } else { "PRAGMA quick_check" };
    let mut stmt = conn.prepare(sql).map_err(e)?;
    let hasil: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)?;
    Ok(hasil.into_iter().filter(|h| h != "ok").collect())
}

/// Pastikan `file` adalah database KasirJet yang utuh sebelum dipakai untuk memulihkan data.
pub fn cek_file_backup(file: &Path) -> Res<()> {
    if !file.is_file() {
        return Err("File backup tidak ditemukan. Periksa lokasi dan nama filenya.".into());
    }
    let c = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "File ini bukan file backup KasirJet yang bisa dibaca.".to_string())?;
    let salah = || "File ini bukan file backup KasirJet yang bisa dibaca.".to_string();
    let masalah = periksa(&c, true).map_err(|_| salah())?;
    if !masalah.is_empty() {
        return Err("File backup ini rusak, jadi tidak bisa dipakai untuk memulihkan data.".into());
    }
    for tabel in ["mdbarang", "tseting", "keuangan", "transaksi"] {
        let ada: i64 = c
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1", [tabel], |r| r.get(0))
            .map_err(|_| salah())?;
        if ada == 0 {
            return Err(salah());
        }
    }
    crate::migrasi::tolak_jika_terlalu_baru(crate::migrasi::versi(&c)?)?;
    Ok(())
}

/// Ganti seluruh isi database dengan `file`. Cadangan pengaman dibuat dulu di `folder_aman`.
/// Koneksi `conn` dibuka ulang pada file yang sama. Mengembalikan lokasi cadangan pengaman.
pub fn pulihkan(conn: &mut Connection, file: &Path, folder_aman: &Path) -> Res<PathBuf> {
    cek_file_backup(file)?;
    let tujuan = lokasi_db(conn)?;
    if let (Ok(a), Ok(b)) = (std::fs::canonicalize(file), std::fs::canonicalize(&tujuan)) {
        if a == b {
            return Err("File ini adalah database yang sedang dipakai. Pilih file backup yang lain.".into());
        }
    }
    let aman = backup_ke(conn, folder_aman, "sebelum-restore")?;

    // Tutup koneksi lama supaya file bisa diganti, lalu buka lagi.
    let lama = std::mem::replace(conn, Connection::open_in_memory().map_err(e)?);
    let _ = lama.close();
    let wal = PathBuf::from(format!("{}-wal", tujuan.display()));
    let shm = PathBuf::from(format!("{}-shm", tujuan.display()));
    let salin = (|| -> Res<()> {
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);
        std::fs::copy(file, &tujuan).map_err(e)?;
        *conn = crate::db::open(&tujuan)?;
        Ok(())
    })();
    if let Err(err) = salin {
        // Kembalikan data semula supaya aplikasi tetap bisa dipakai.
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);
        let _ = std::fs::copy(&aman, &tujuan);
        if let Ok(c) = crate::db::open(&tujuan) {
            *conn = c;
        }
        return Err(format!("Data belum berhasil dipulihkan, data Anda yang semula tetap aman. ({err})"));
    }
    Ok(aman)
}

/// Perbaikan: susun ulang indeks dan rapikan file. Cadangan dibuat dulu.
pub fn perbaiki(conn: &Connection, folder: &Path) -> Res<PathBuf> {
    let aman = backup_ke(conn, folder, "sebelum-perbaikan")?;
    conn.execute_batch("REINDEX; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;").map_err(e)?;
    Ok(aman)
}

pub fn daftar_backup(folder: &Path) -> Vec<Value> {
    let mut out: Vec<(std::time::SystemTime, Value)> = vec![];
    if let Ok(rd) = std::fs::read_dir(folder) {
        for f in rd.flatten() {
            let p = f.path();
            if p.extension().and_then(|x| x.to_str()) != Some("db") {
                continue;
            }
            let meta = match f.metadata() {
                Ok(m) if m.is_file() => m,
                _ => continue,
            };
            let waktu = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            out.push((waktu, json!({
                "nama": p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                "path": p.display().to_string(),
                "ukuran": meta.len(),
                "waktu": chrono::DateTime::<chrono::Local>::from(waktu).format("%Y-%m-%d %H:%M").to_string(),
            })));
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|x| x.1).collect()
}

#[perintah]
pub fn db_info(db: &Db, session: &Session) -> Res<Value> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    izin_database_atau_alat(&*db.lock()?, &user)?;
    let conn = db.lock()?;
    let path = lokasi_db(&conn)?;
    let ukuran = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(json!({ "path": path.display().to_string(), "ukuran": ukuran, "folder_backup": folder_bawaan(&conn)?.display().to_string() }))
}

#[perintah]
pub fn db_daftar_backup(db: &Db, session: &Session, folder: Option<String>) -> Res<Vec<Value>> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    izin_database_atau_alat(&*db.lock()?, &user)?;
    let conn = db.lock()?;
    Ok(daftar_backup(&folder_pilihan(&conn, folder.as_deref())?))
}

#[perintah]
pub fn db_backup(db: &Db, session: &Session, folder: Option<String>) -> Res<Value> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    izin_database_atau_alat(&*db.lock()?, &user)?;
    let conn = db.lock()?;
    let file = backup_ke(&conn, &folder_pilihan(&conn, folder.as_deref())?, "tokopro")?;
    let ukuran = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    Ok(json!({ "path": file.display().to_string(), "ukuran": ukuran }))
}

/// Cek database. `penuh` = pemeriksaan lengkap (Cek Data Corrupt); selain itu pemeriksaan cepat (Tes Koneksi).
#[perintah]
pub fn db_cek(db: &Db, session: &Session, penuh: bool) -> Res<Value> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    izin_database_atau_alat(&*db.lock()?, &user)?;
    let masalah = periksa(&*db.lock()?, penuh)?;
    Ok(json!({ "ok": masalah.is_empty(), "masalah": masalah }))
}

#[perintah]
pub fn db_perbaiki(db: &Db, session: &Session, folder: Option<String>) -> Res<Value> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    izin_database_atau_alat(&*db.lock()?, &user)?;
    let conn = db.lock()?;
    let aman = perbaiki(&conn, &folder_pilihan(&conn, folder.as_deref())?)?;
    Ok(json!({ "cadangan": aman.display().to_string() }))
}

#[perintah]
pub fn db_restore(db: &Db, session: &Session, file: String, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    if file.trim().is_empty() {
        return Err("File backup yang akan dipulihkan belum dipilih.".into());
    }
    let mut conn = db.lock()?;
    let folder = folder_pilihan(&conn, folder.as_deref())?;
    let aman = pulihkan(&mut conn, Path::new(file.trim()), &folder)?;
    Ok(json!({ "cadangan": aman.display().to_string() }))
}

/// Dipanggil saat Anda keluar dari program kalau "Auto Backup" aktif. Boleh dipakai semua akun yang sedang masuk.
#[perintah]
pub fn backup_otomatis(db: &Db, session: &Session, folder: Option<String>, simpan: Option<usize>) -> Res<Value> {
    session.user()?;
    let conn = db.lock()?;
    let file = backup_otomatis_ke(&conn, &folder_pilihan(&conn, folder.as_deref())?, simpan.unwrap_or(CADANGAN_OTOMATIS_MAKS))?;
    Ok(json!({ "path": file.display().to_string() }))
}
