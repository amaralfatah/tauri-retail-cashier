//! Keuangan: daftar kas dan catatan kas manual (kas masuk / kas keluar di luar transaksi).
//! Saldo berjalan disimpan di kolom SALDO, diurutkan menurut IDKAS seperti aplikasi lama.

use crate::auth::{Session, User};
use crate::db::{e, one, round2, rows, Db, Res};
use crate::trans::{check_date, insert_kas_paksa};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

/// Kategori yang ditawarkan di Input Transaksi Kas.
pub const KATEGORI: &[&str] = &[
    "Penjualan barang dagang",
    "Retur penjualan",
    "Harga pokok penjualan",
    "Retur pembelian",
    "Biaya gaji, upah, dll",
    "Biaya operasional",
    "Pendapatan diluar usaha",
];

/// Kas manual: bukan hasil transaksi, bukan pelunasan. Hanya untuk penanda di daftar; aslinya semua baris kas boleh dihapus.
const SQL_MANUAL: &str = "(COALESCE(noreftrans,'') = ''
        OR (noreftrans NOT IN (SELECT notrans FROM transaksi) AND noreftrans NOT IN (SELECT nopiutang FROM trkartupiutang)))
     AND COALESCE(keterangan,'') NOT LIKE '%Pelunasan%'";

#[tauri::command]
pub fn kas_kategori() -> Vec<&'static str> {
    KATEGORI.to_vec()
}

#[tauri::command]
pub fn kas_list(db: State<Db>, session: State<Session>, dari: Option<String>, sampai: Option<String>) -> Res<Value> {
    let user = session.user()?;
    let conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnKeuangan")?;
    daftar(&conn, dari.as_deref().unwrap_or(""), sampai.as_deref().unwrap_or(""))
}

pub fn daftar(conn: &Connection, dari: &str, sampai: &str) -> Res<Value> {
    let r = rows(
        conn,
        &format!(
            "SELECT idkas, nokas, tglkas, noreftrans, kategori, jenis, namakaryawan, namakontak, keterangan, masuk, keluar, saldo,
                    CASE WHEN {SQL_MANUAL} THEN 1 ELSE 0 END AS manual
             FROM keuangan
             WHERE nokas <> '' AND (?1 = '' OR tglkas >= ?1) AND (?2 = '' OR tglkas <= ?2)
             ORDER BY idkas"
        ),
        params![dari, sampai],
    )?;
    let sum = |k: &str| round2(r.iter().map(|x| x[k].as_f64().unwrap_or(0.0)).sum());
    let (masuk, keluar) = (sum("masuk"), sum("keluar"));
    Ok(json!({ "rows": r, "masuk": masuk, "keluar": keluar, "kas": round2(masuk - keluar) }))
}

#[derive(Deserialize)]
pub struct KasInput {
    pub tgl: String,
    #[serde(default)]
    pub noref: String,
    /// "Saldo Awal", "Masuk" atau "Keluar".
    pub jenis: String,
    pub kategori: String,
    #[serde(default)]
    pub kodekaryawan: String,
    #[serde(default)]
    pub kodepelanggan: String,
    #[serde(default)]
    pub kodepemasok: String,
    #[serde(default)]
    pub masuk: f64,
    #[serde(default)]
    pub keluar: f64,
    #[serde(default)]
    pub ket: String,
}

#[tauri::command]
pub fn kas_save(db: State<Db>, session: State<Session>, input: KasInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnKeuangan")?;
    simpan(&mut conn, &user, &input)
}

pub fn simpan(conn: &mut Connection, user: &User, input: &KasInput) -> Res<Value> {
    check_date(&input.tgl).map_err(|_| "Tanggal kas belum diisi dengan benar.".to_string())?;
    let jenis = input.jenis.trim();
    if jenis != "Saldo Awal" && jenis != "Masuk" && jenis != "Keluar" {
        return Err("Pilih dulu jenis kasnya: Saldo Awal, Masuk atau Keluar.".into());
    }
    // Seperti aslinya, jumlah nol dan kategori kosong tidak ditolak.
    let jumlah = round2(if jenis == "Keluar" { input.keluar } else { input.masuk });
    let tx = conn.transaction().map_err(e)?;

    // Petugas: yang dipilih di form, kalau tidak ada maka akun yang sedang masuk.
    let petugas = if input.kodekaryawan.trim().is_empty() {
        user.clone()
    } else {
        let kode = input.kodekaryawan.trim();
        let nama: String = tx
            .query_row("SELECT COALESCE(namakaryawan,'') FROM mdkaryawan WHERE kodekaryawan = ?1", params![kode], |r| r.get(0))
            .map_err(|_| "Petugas yang dipilih tidak ada di data karyawan.".to_string())?;
        User { kodekaryawan: kode.to_string(), namakaryawan: nama, ..user.clone() }
    };

    let (kodekontak, namakontak) = if !input.kodepelanggan.trim().is_empty() {
        let k = input.kodepelanggan.trim();
        let n: String = tx
            .query_row("SELECT COALESCE(namapelanggan,'') FROM mdpelanggan WHERE kodepelanggan = ?1", params![k], |r| r.get(0))
            .map_err(|_| "Pelanggan yang dipilih tidak ada di data pelanggan.".to_string())?;
        (k.to_string(), n)
    } else if !input.kodepemasok.trim().is_empty() {
        let k = input.kodepemasok.trim();
        let n: String = tx
            .query_row("SELECT COALESCE(namapemasok,'') FROM mdpemasok WHERE kodepemasok = ?1", params![k], |r| r.get(0))
            .map_err(|_| "Pemasok yang dipilih tidak ada di data pemasok.".to_string())?;
        (k.to_string(), n)
    } else {
        (String::new(), String::new())
    };

    insert_kas_paksa(&tx, (&petugas.kodekaryawan, &petugas.namakaryawan), &input.tgl, jenis, input.kategori.trim(), input.noref.trim(), (&kodekontak, &namakontak), jumlah, input.ket.trim())?;
    let (idkas, nokas): (i64, String) = tx
        .query_row("SELECT idkas, nokas FROM keuangan ORDER BY idkas DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(e)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "idkas": idkas, "nokas": nokas }))
}

#[tauri::command]
pub fn kas_delete(db: State<Db>, session: State<Session>, idkas: i64, izin: Option<String>) -> Res<()> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnKeuangan")?;
    crate::izin::periksa_hapus(&user, crate::izin::tanda_sah(&izin, &user))?;
    hapus(&mut conn, idkas)?;
    crate::izin::habiskan(&izin);
    Ok(())
}

pub fn hapus(conn: &mut Connection, idkas: i64) -> Res<()> {
    let tx = conn.transaction().map_err(e)?;
    // Semua baris kas boleh dihapus, termasuk kas dari transaksi atau pelunasan (seperti aslinya).
    one(&tx, "SELECT idkas FROM keuangan WHERE idkas = ?1", params![idkas])?.ok_or("Data kas tidak ditemukan. Silakan muat ulang daftarnya.")?;
    tx.execute("DELETE FROM keuangan WHERE idkas = ?1", params![idkas]).map_err(e)?;
    hitung_ulang_saldo(&tx)?;
    tx.commit().map_err(e)
}

/// Hitung ulang SALDO semua baris menurut urutan IDKAS. Mengembalikan jumlah baris yang berubah.
pub fn hitung_ulang_saldo(conn: &Connection) -> Res<usize> {
    let mut stmt = conn.prepare("SELECT idkas, COALESCE(masuk,0), COALESCE(keluar,0), COALESCE(saldo,0) FROM keuangan ORDER BY idkas").map_err(e)?;
    let data: Vec<(i64, f64, f64, f64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(e)?
        .collect::<Result<_, _>>()
        .map_err(e)?;
    let mut saldo = 0.0;
    let mut berubah = 0;
    for (id, masuk, keluar, lama) in data {
        saldo = round2(saldo + masuk - keluar);
        if (saldo - lama).abs() > 0.005 {
            conn.execute("UPDATE keuangan SET saldo = ?1 WHERE idkas = ?2", params![saldo, id]).map_err(e)?;
            berubah += 1;
        }
    }
    Ok(berubah)
}
