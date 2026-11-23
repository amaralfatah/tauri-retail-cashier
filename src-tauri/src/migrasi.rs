//! Migrasi susunan database berdasarkan `PRAGMA user_version`.
//!
//! Versi N = database sudah menjalani langkah 1 sampai N. `schema.sql` selalu berisi susunan terbaru lengkap.
//! Cara aturan ini bekerja ada di bagian "Mengubah susunan database" pada CLAUDE.md.
//!
//! - Database baru (belum ada tabel): `schema.sql` dijalankan, lalu versi langsung diset ke terbaru. Langkah tidak dijalankan.
//! - Database lama (sudah ada tabel, versi 0 atau lebih rendah dari terbaru): langkah yang belum jalan dijalankan berurutan,
//!   masing-masing dalam satu transaksi bersama kenaikan versi. Setelah itu `schema.sql` dijalankan lagi sebagai pelengkap
//!   (hanya `IF NOT EXISTS`) supaya tabel, indeks, dan trigger yang baru tetap terbentuk.
//! - Versi database lebih tinggi dari yang dikenal aplikasi: ditolak, data tidak disentuh.

use crate::database::{backup_ke, folder_bawaan};
use crate::db::{e, Res, SCHEMA};
use rusqlite::{Connection, Transaction};

pub enum Aksi {
    Sql(&'static str),
    Fungsi(fn(&Transaction) -> Res<()>),
}

pub struct Migrasi {
    pub no: i64,
    pub deskripsi: &'static str,
    pub aksi: Aksi,
}

/// Daftar langkah. JANGAN mengubah atau menghapus langkah yang sudah dirilis; tambahkan langkah baru di akhir.
pub const MIGRASI: &[Migrasi] = &[Migrasi {
    no: 1,
    deskripsi: "Susunan awal: pindahkan pending penjualan versi lama ke transaksi",
    // Susunan tabelnya sendiri sudah dibuat `schema.sql`. Langkah ini hanya menyusul perbaikan data lama yang dulu
    // dijalankan setiap kali program dibuka, dan aman dijalankan berulang.
    aksi: Aksi::Fungsi(crate::order::migrasi_pending_tx),
},
Migrasi {
    no: 2,
    deskripsi: "Tabel sesi_perangkat (sesi masuk per komputer)",
    aksi: Aksi::Sql("CREATE TABLE IF NOT EXISTS sesi_perangkat (token_hash TEXT PRIMARY KEY NOT NULL, idperangkat TEXT NOT NULL DEFAULT '', iduser TEXT, mulai INTEGER NOT NULL, terakhir INTEGER NOT NULL);"),
},
Migrasi {
    no: 3,
    deskripsi: "Tabel perangkat (komputer kasir yang tersambung ke Pusat)",
    aksi: Aksi::Sql("CREATE TABLE IF NOT EXISTS perangkat (id INTEGER PRIMARY KEY AUTOINCREMENT, nama_komputer TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, dibuat INTEGER NOT NULL, terakhir_terlihat INTEGER NOT NULL, aktif INTEGER NOT NULL DEFAULT 1, otomatis INTEGER NOT NULL DEFAULT 0);"),
},
Migrasi {
    no: 4,
    deskripsi: "Tabel permintaan_selesai (hasil simpan, supaya simpan yang diulang tidak tercatat dua kali)",
    aksi: Aksi::Sql("CREATE TABLE IF NOT EXISTS permintaan_selesai (id TEXT PRIMARY KEY NOT NULL, perintah TEXT NOT NULL, hasil_json TEXT NOT NULL, waktu INTEGER NOT NULL);"),
}];

pub fn versi_terbaru() -> i64 {
    MIGRASI.last().map(|m| m.no).unwrap_or(0)
}

pub fn versi(conn: &Connection) -> Res<i64> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(e)
}

pub fn tolak_jika_terlalu_baru(v: i64) -> Res<()> {
    tolak_jika_terlalu_baru_untuk(v, versi_terbaru())
}

fn tolak_jika_terlalu_baru_untuk(v: i64, terbaru: i64) -> Res<()> {
    if v > terbaru {
        return Err("Data ini dibuat oleh Toko Pro versi yang lebih baru. Pasang versi terbaru, lalu buka lagi.".into());
    }
    Ok(())
}

/// Tandai database yang tabelnya sudah dibuat dari `schema.sql` sebagai versi terbaru (dipakai pemindahan data dari aplikasi lama).
pub fn tandai_terbaru(conn: &Connection) -> Res<()> {
    conn.execute_batch(&format!("PRAGMA user_version = {}", versi_terbaru())).map_err(e)
}

/// Dipanggil `db::open`.
pub fn siapkan(conn: &mut Connection) -> Res<()> {
    jalankan(conn, SCHEMA, MIGRASI)
}

/// Tabel yang isinya dibuat otomatis untuk database baru; baris di sini tidak dihitung sebagai data pemilik toko.
const TABEL_DATA_AWAL: [&str; 5] = ["tseting", "mduser", "mdsatuan", "mdjenisnontunai", "mdjenisnontunaiitem"];

fn punya_tabel(conn: &Connection) -> Res<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0)).map_err(e)?;
    Ok(n > 0)
}

fn punya_data(conn: &Connection) -> Res<bool> {
    let tabel: Vec<String> = {
        let mut st = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map_err(e)?;
        let v = st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
        v
    };
    for t in tabel.iter().filter(|t| !TABEL_DATA_AWAL.contains(&t.as_str())) {
        let ada: bool = conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM \"{}\")", t.replace('"', "\"\"")), [], |r| r.get(0)).map_err(e)?;
        if ada {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Inti migrasi. `schema` dan `daftar` bisa diganti (untuk tes).
pub fn jalankan(conn: &mut Connection, schema: &str, daftar: &[Migrasi]) -> Res<()> {
    debug_assert!(daftar.iter().enumerate().all(|(i, m)| m.no == i as i64 + 1), "nomor langkah migrasi harus berurutan mulai dari 1");
    let terbaru = daftar.last().map(|m| m.no).unwrap_or(0);
    let sekarang = versi(conn)?;
    tolak_jika_terlalu_baru_untuk(sekarang, terbaru)?;

    // Database baru: `schema.sql` sudah susunan terbaru, jadi langsung ditandai terbaru tanpa menjalankan langkah.
    if sekarang == 0 && !punya_tabel(conn)? {
        let tx = conn.transaction().map_err(e)?;
        tx.execute_batch(schema).map_err(e)?;
        tx.execute_batch(&format!("PRAGMA user_version = {terbaru}")).map_err(e)?;
        return tx.commit().map_err(e);
    }

    let tertunda: Vec<&Migrasi> = daftar.iter().filter(|m| m.no > sekarang).collect();
    if !tertunda.is_empty() {
        // Cadangan pengaman hanya untuk database di file yang sudah berisi data. Database di memori dilewati.
        if folder_bawaan(conn).is_ok() && punya_data(conn)? {
            let folder = folder_bawaan(conn)?;
            backup_ke(conn, &folder, "sebelum-update").map_err(|err| {
                format!("Toko Pro belum bisa membuat cadangan sebelum memperbarui data Anda, jadi pembaruan dibatalkan dan data Anda tidak berubah. Periksa ruang kosong di komputer, lalu buka lagi aplikasinya. ({err})")
            })?;
        }
        for m in tertunda {
            terapkan(conn, m)?;
        }
    }

    // Pelengkap: tabel, indeks, dan trigger baru yang belum ada. Dijalankan setelah langkah supaya kolom barunya sudah tersedia.
    conn.execute_batch(schema).map_err(e)?;
    Ok(())
}

fn terapkan(conn: &mut Connection, m: &Migrasi) -> Res<()> {
    let gagal = |err: String| {
        format!(
            "Data Anda belum bisa diperbarui ke susunan terbaru (langkah {}: {}). Data Anda tidak berubah. Tutup lalu buka lagi aplikasinya; kalau masih gagal, hubungi penyedia aplikasi. ({err})",
            m.no, m.deskripsi
        )
    };
    let tx = conn.transaction().map_err(|x| gagal(e(x)))?;
    match &m.aksi {
        Aksi::Sql(sql) => tx.execute_batch(sql).map_err(|x| gagal(e(x)))?,
        Aksi::Fungsi(f) => f(&tx).map_err(gagal)?,
    }
    tx.execute_batch(&format!("PRAGMA user_version = {}", m.no)).map_err(|x| gagal(e(x)))?;
    tx.commit().map_err(|x| gagal(e(x)))
}

/* ---- Pembantu untuk langkah yang aman dijalankan berulang ---- */

/// Tambah kolom bila belum ada. `definisi` contoh: `"TEXT DEFAULT ''"`.
#[allow(dead_code)]
pub fn tambah_kolom(tx: &Transaction, tabel: &str, kolom: &str, definisi: &str) -> Res<()> {
    let ada: Vec<String> = {
        let mut st = tx.prepare(&format!("PRAGMA table_info(\"{tabel}\")")).map_err(e)?;
        let v = st.query_map([], |r| r.get::<_, String>(1)).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
        v
    };
    if ada.iter().any(|c| c.eq_ignore_ascii_case(kolom)) {
        return Ok(());
    }
    tx.execute_batch(&format!("ALTER TABLE \"{tabel}\" ADD COLUMN \"{kolom}\" {definisi}")).map_err(e)
}
