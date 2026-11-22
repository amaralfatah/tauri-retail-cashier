//! Order penjualan (SO), order pembelian (PO) dan penjualan yang ditunda (pending).
//!
//! Order disimpan seperti di aplikasi lama: header di TRANSAKSI (kode SO/PO, STATUS 0 = belum diambil),
//! baris di TRANSAKSIDETIL. Trigger stok melewati kode SO dan PO, jadi order tidak mengubah stok.
//! Saat order diambil menjadi penjualan/pembelian, NOREF transaksi baru berisi nomor order dan
//! STATUS order menjadi 1. Pending disimpan sebagai transaksi berkode TP.

use crate::auth::{Session, User};
use crate::db::{e, one, round2, rows, Db, Res};
use crate::trans::{self, check_date, insert_detail, next_id, next_number, Item, TransInput};
use rusqlite::{params, Connection, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

#[derive(Deserialize)]
pub struct OrderInput {
    /// true = order penjualan (SO), false = order pembelian (PO).
    pub jual: bool,
    pub tgl: String,
    #[serde(default)]
    pub kodepelanggan: String,
    #[serde(default)]
    pub kodepemasok: String,
    #[serde(default)]
    pub kodesales: String,
    #[serde(default)]
    pub catatan: String,
    /// Uang muka (hanya order penjualan).
    #[serde(default)]
    pub dp: f64,
    pub items: Vec<Item>,
    /// Diisi saat koreksi order yang sudah ada.
    #[serde(default)]
    pub notrans: Option<String>,
    /// Kasir yang dipilih di layar. Kosong = user yang masuk.
    #[serde(default)]
    pub kodekasir: String,
}

fn kode_order(jual: bool) -> &'static str {
    if jual { "SO" } else { "PO" }
}

#[tauri::command]
pub fn save_order(db: State<Db>, session: State<Session>, input: OrderInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, if input.jual { "mnTROrderJual" } else { "mnTROrderPembelian" })?;
    simpan_order(&mut conn, &user, &input)
}

pub fn simpan_order(conn: &mut Connection, user: &User, input: &OrderInput) -> Res<Value> {
    check_date(&input.tgl)?;
    if input.items.is_empty() {
        return Err("Belum ada barang di order ini.".into());
    }
    for it in &input.items {
        if it.jmljual <= 0.0 {
            return Err(format!("Jumlah {} harus lebih dari 0.", it.namabarang));
        }
        if it.konversi <= 0.0 || it.harga < 0.0 {
            return Err(format!("Satuan atau harga {} tidak valid.", it.namabarang));
        }
    }
    if input.dp < 0.0 {
        return Err("Uang muka tidak boleh minus.".into());
    }
    let kode = kode_order(input.jual);
    let kasir = if input.kodekasir.trim().is_empty() { user.kodekaryawan.clone() } else { input.kodekasir.trim().to_string() };
    let jmltrans = round2(input.items.iter().map(|i| i.jmljual * i.harga - i.disknilai).sum());
    if input.jual && input.dp > jmltrans + 0.005 {
        return Err("Uang muka tidak boleh lebih besar dari total order.".into());
    }
    let kontak = |s: &str| if s.trim().is_empty() { "Tunai".to_string() } else { s.trim().to_string() };
    let (pelanggan, pemasok) = if input.jual { (kontak(&input.kodepelanggan), String::new()) } else { (String::new(), kontak(&input.kodepemasok)) };
    let dp = if input.jual { input.dp } else { 0.0 };

    let tx = conn.transaction().map_err(e)?;
    let notrans = match input.notrans.as_deref().filter(|s| !s.is_empty()) {
        Some(no) => {
            let status: Option<i64> = tx
                .query_row("SELECT COALESCE(status,0) FROM transaksi WHERE notrans = ?1 AND kode = ?2", params![no, kode], |r| r.get(0))
                .ok();
            match status {
                None => return Err("Order yang akan dikoreksi tidak ditemukan.".into()),
                Some(1) => return Err("Order ini sudah diambil, jadi tidak bisa dikoreksi lagi.".into()),
                _ => {}
            }
            tx.execute(
                "UPDATE transaksi SET tglorder=?1, kodekaryawan=?2, kodesales=?3, kodepelanggan=?4, kodepemasok=?5, catatan=?6, jmltrans=?7,
                   jmlbayar=?8, tahun=?9, bulan=?10, tglupdate=date('now','localtime'), jamupdate=time('now','localtime') WHERE notrans=?11",
                params![input.tgl, kasir, input.kodesales, pelanggan, pemasok, input.catatan, jmltrans, dp, &input.tgl[0..4], &input.tgl[5..7], no],
            ).map_err(e)?;
            tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1", params![no]).map_err(e)?;
            no.to_string()
        }
        None => {
            let no = next_number(&tx, "transaksi", "notrans", kode, &input.tgl)?;
            tx.execute(
                "INSERT INTO transaksi (tid,notrans,tglorder,kode,jenis,kodekaryawan,kodesales,kodepelanggan,kodepemasok,catatan,jmltrans,jmlbayar,status,tahun,bulan,tglupload,jamupload)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0,?13,?14,date('now','localtime'),time('now','localtime'))",
                params![
                    next_id(&tx, "transaksi", "tid")?, no, input.tgl, kode, if input.jual { "Sales Order" } else { "Purchase Order" },
                    kasir, input.kodesales, pelanggan, pemasok, input.catatan, jmltrans, dp, &input.tgl[0..4], &input.tgl[5..7]
                ],
            ).map_err(e)?;
            no
        }
    };
    insert_detail(&tx, &notrans, kode, &input.items, !input.jual)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "total": jmltrans }))
}

#[tauri::command]
pub fn list_order(db: State<Db>, jual: bool, dari: String, sampai: String, search: Option<String>) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    daftar_order(&conn, jual, &dari, &sampai, search.as_deref().unwrap_or(""))
}

/// Order yang belum diambil, terbaru di atas.
pub fn daftar_order(conn: &Connection, jual: bool, dari: &str, sampai: &str, search: &str) -> Res<Vec<Value>> {
    let s = format!("%{}%", search.trim().to_uppercase());
    rows(
        conn,
        "SELECT t.notrans, t.tglorder, t.tgltrans, t.jmltrans, t.jmlbayar AS dp, t.catatan,
                COALESCE(p.namapelanggan, s.namapemasok, NULLIF(t.kodepelanggan,''), t.kodepemasok) AS kontak,
                COALESCE(sl.namakaryawan, t.kodesales, '') AS sales,
                COALESCE(k.namakaryawan, t.kodekaryawan) AS kasir
         FROM transaksi t
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         LEFT JOIN mdkaryawan sl ON sl.kodekaryawan = t.kodesales
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
         WHERE t.kode = ?1 AND COALESCE(t.status,0) = 0 AND t.tglorder BETWEEN ?2 AND ?3
           AND (UPPER(t.notrans) LIKE ?4 OR UPPER(COALESCE(t.kodepelanggan,'')) LIKE ?4 OR UPPER(COALESCE(t.kodepemasok,'')) LIKE ?4
                OR UPPER(COALESCE(t.kodesales,'')) LIKE ?4 OR UPPER(COALESCE(p.namapelanggan,'')) LIKE ?4
                OR UPPER(COALESCE(s.namapemasok,'')) LIKE ?4 OR UPPER(COALESCE(sl.namakaryawan,'')) LIKE ?4)
         ORDER BY t.notrans LIMIT 2000",
        params![kode_order(jual), dari, sampai, s],
    )
}

#[tauri::command]
pub fn get_order(db: State<Db>, notrans: String) -> Res<Value> {
    let conn = db.lock()?;
    ambil_order(&conn, &notrans)
}

/// Header dan baris order. Satuan dan konversi ikut supaya baris bisa dimuat ulang ke layar transaksi.
pub fn ambil_order(conn: &Connection, notrans: &str) -> Res<Value> {
    let header = one(
        conn,
        "SELECT t.*, COALESCE(p.namapelanggan, t.kodepelanggan) AS namapelanggan, COALESCE(s.namapemasok, t.kodepemasok) AS namapemasok,
                COALESCE(k.namakaryawan, t.kodekaryawan) AS namakasir
         FROM transaksi t
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
         WHERE t.notrans = ?1 AND t.kode IN ('SO','PO')",
        params![notrans],
    )?
    .ok_or("Order tidak ditemukan.")?;
    let detail = rows(
        conn,
        "SELECT nourut, kodebarang, namabarang, kodesatuan, satuanjual, jmljual, hrgterjual, COALESCE(disknilai,0) AS disknilai,
                CASE WHEN COALESCE(konversi,0) > 0 THEN konversi ELSE 1 END AS konversi
         FROM transaksidetil WHERE notrans = ?1 ORDER BY nourut",
        params![notrans],
    )?;
    Ok(json!({ "header": header, "detail": detail }))
}

#[tauri::command]
pub fn delete_order(db: State<Db>, session: State<Session>, notrans: String, izin: Option<String>) -> Res<()> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, if notrans.starts_with("PO") { "mnTROrderPembelian" } else { "mnTROrderJual" })?;
    crate::izin::periksa_hapus(&user, crate::izin::tanda_sah(&izin, &user))?;
    hapus_order(&mut conn, &notrans)?;
    crate::izin::habiskan(&izin);
    Ok(())
}

pub fn hapus_order(conn: &mut Connection, notrans: &str) -> Res<()> {
    let tx = conn.transaction().map_err(e)?;
    let status: Option<i64> = tx
        .query_row("SELECT COALESCE(status,0) FROM transaksi WHERE notrans = ?1 AND kode IN ('SO','PO')", params![notrans], |r| r.get(0))
        .ok();
    match status {
        None => return Err("Order tidak ditemukan.".into()),
        Some(1) => return Err("Order ini sudah diambil, jadi tidak bisa dihapus.".into()),
        _ => {}
    }
    tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1", params![notrans]).map_err(e)?;
    tx.execute("DELETE FROM transaksi WHERE notrans = ?1", params![notrans]).map_err(e)?;
    tx.commit().map_err(e)
}

/// Pastikan order masih terbuka, lalu kembalikan tanggal ordernya.
fn order_terbuka(tx: &Transaction, noorder: &str, kode: &str) -> Res<String> {
    let (tglorder, status): (Option<String>, i64) = tx
        .query_row("SELECT tglorder, COALESCE(status,0) FROM transaksi WHERE notrans = ?1 AND kode = ?2", params![noorder, kode], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Order tidak ditemukan.".to_string())?;
    if status == 1 {
        return Err("Order ini sudah diambil. Silakan pilih order lain.".into());
    }
    Ok(tglorder.unwrap_or_default())
}

fn tandai_diambil(tx: &Transaction, notrans: &str, noorder: &str, tglorder: &str) -> Res<()> {
    tx.execute("UPDATE transaksi SET noref = ?1, tglorder = ?2 WHERE notrans = ?3", params![noorder, tglorder, notrans]).map_err(e)?;
    tx.execute("UPDATE transaksi SET status = 1 WHERE notrans = ?1", params![noorder]).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn save_penjualan_order(db: State<Db>, session: State<Session>, input: TransInput, noorder: String) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRTrPenjualan")?;
    penjualan_dari_order(&mut conn, &user, &input, &noorder)
}

/// Simpan penjualan yang barangnya diambil dari order, dan tandai order sudah diambil, dalam satu langkah.
/// Aturannya sama dengan penjualan biasa.
pub fn penjualan_dari_order(conn: &mut Connection, user: &User, input: &TransInput, noorder: &str) -> Res<Value> {
    let tx = conn.transaction().map_err(e)?;
    let tglorder = order_terbuka(&tx, noorder, "SO")?;
    let r = trans::penjualan_tx(&tx, user, input)?;
    tandai_diambil(&tx, r["notrans"].as_str().unwrap_or_default(), noorder, &tglorder)?;
    tx.commit().map_err(e)?;
    Ok(r)
}

#[tauri::command]
pub fn save_pembelian_order(db: State<Db>, session: State<Session>, input: TransInput, noorder: String) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRTransPembelian")?;
    pembelian_dari_order(&mut conn, &user, &input, &noorder)
}

pub fn pembelian_dari_order(conn: &mut Connection, user: &User, input: &TransInput, noorder: &str) -> Res<Value> {
    let tx = conn.transaction().map_err(e)?;
    let tglorder = order_terbuka(&tx, noorder, "PO")?;
    let r = trans::pembelian_tx(&tx, user, input)?;
    tandai_diambil(&tx, r["notrans"].as_str().unwrap_or_default(), noorder, &tglorder)?;
    tx.commit().map_err(e)?;
    Ok(r)
}

/* ------------------------------------------------------------------ */
/* Pending penjualan                                                   */
/* ------------------------------------------------------------------ */
//
// Seperti aplikasi lama, pending disimpan sebagai baris TRANSAKSI berkode TP (jenis "Pending") dengan baris di TRANSAKSIDETIL.
// Trigger stok tidak menghitung kode TP, jadi pending tidak mengubah stok. Tabel pendingjual versi sebelumnya dipindah
// ke TRANSAKSI saat database dibuka (`migrasi_pending`).

#[derive(Deserialize)]
pub struct PendingInput {
    /// Diisi bila menyimpan ulang pending yang tadinya diambil dari daftar.
    #[serde(default)]
    pub nopending: Option<String>,
    pub tgl: String,
    #[serde(default)]
    pub kodepelanggan: String,
    #[serde(default)]
    pub kodesales: String,
    #[serde(default)]
    pub catatan: String,
    pub items: Vec<Item>,
    #[serde(default)]
    pub kodekasir: String,
}

#[tauri::command]
pub fn save_pending(db: State<Db>, session: State<Session>, input: PendingInput) -> Res<Value> {
    let user = session.user()?;
    simpan_pending(&mut *db.lock()?, &user, &input)
}

pub fn simpan_pending(conn: &mut Connection, user: &User, input: &PendingInput) -> Res<Value> {
    check_date(&input.tgl)?;
    if input.items.is_empty() {
        return Err("Data transaksi masih kosong.".into());
    }
    let tx = conn.transaction().map_err(e)?;
    let no = pending_tulis(&tx, if input.kodekasir.trim().is_empty() { &user.kodekaryawan } else { input.kodekasir.trim() }, input.nopending.as_deref(), &input.tgl, &input.kodepelanggan, &input.kodesales, &input.catatan, &input.items)?;
    let total = round2(input.items.iter().map(|i| i.jmljual * i.harga - i.disknilai).sum());
    tx.commit().map_err(e)?;
    Ok(json!({ "nopending": no, "total": total }))
}

/// Tulis satu pending (TP). Dengan `nomor` yang sudah ada, isi lamanya diganti.
#[allow(clippy::too_many_arguments)]
fn pending_tulis(tx: &Transaction, kasir: &str, nomor: Option<&str>, tgl: &str, pelanggan: &str, sales: &str, catatan: &str, items: &[Item]) -> Res<String> {
    let total = round2(items.iter().map(|i| i.jmljual * i.harga - i.disknilai).sum());
    let no = match nomor.filter(|s| !s.is_empty()) {
        Some(no) => {
            tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1 AND kode = 'TP'", params![no]).map_err(e)?;
            tx.execute("DELETE FROM transaksi WHERE notrans = ?1 AND kode = 'TP'", params![no]).map_err(e)?;
            no.to_string()
        }
        None => next_number(tx, "transaksi", "notrans", "TP", tgl)?,
    };
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,kodesales,kodepelanggan,catatan,jmltrans,totaltrans,status,tahun,bulan,tglupload,jamupload)
         VALUES (?1,?2,?3,'TP','Pending',?4,?5,?6,?7,?8,?8,0,?9,?10,date('now','localtime'),time('now','localtime'))",
        params![next_id(tx, "transaksi", "tid")?, no, tgl, kasir, sales, pelanggan, catatan, total, &tgl[0..4], &tgl[5..7]],
    ).map_err(e)?;
    insert_detail(tx, &no, "TP", items, false)?;
    Ok(no)
}

/// Pindahkan isi tabel pendingjual versi sebelumnya menjadi transaksi TP, lalu kosongkan tabel itu.
pub fn migrasi_pending(conn: &mut Connection) -> Res<()> {
    let ada: i64 = conn.query_row("SELECT COUNT(*) FROM pendingjual", [], |r| r.get(0)).unwrap_or(0);
    if ada == 0 {
        return Ok(());
    }
    let tx = conn.transaction().map_err(e)?;
    let daftar: Vec<(String, String, String, String, String, String)> = {
        let mut st = tx
            .prepare("SELECT nopending, COALESCE(tgltrans,date('now','localtime')), COALESCE(kodekaryawan,''), COALESCE(kodepelanggan,''), COALESCE(kodesales,''), COALESCE(catatan,'') FROM pendingjual ORDER BY nopending")
            .map_err(e)?;
        let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
        v
    };
    for (no, tgl, kasir, pelanggan, sales, catatan) in daftar {
        let items: Vec<Item> = {
            let mut st = tx
                .prepare(
                    "SELECT d.kodebarang, COALESCE(b.namabarang,d.kodebarang), COALESCE(b.kodesatuan,d.satuanjual,''), COALESCE(d.satuanjual,b.kodesatuan,''), COALESCE(d.jmljual,0), COALESCE(d.hrgterjual,0),
                            CASE WHEN d.satuanjual = b.satuan1 AND COALESCE(b.konversi1,0) > 0 THEN b.konversi1
                                 WHEN d.satuanjual = b.satuan2 AND COALESCE(b.konversi2,0) > 0 THEN b.konversi2
                                 WHEN d.satuanjual = b.satuan3 AND COALESCE(b.konversi3,0) > 0 THEN b.konversi3
                                 WHEN d.satuanjual = b.satuan4 AND COALESCE(b.konversi4,0) > 0 THEN b.konversi4
                                 WHEN d.satuanjual = b.satuan5 AND COALESCE(b.konversi5,0) > 0 THEN b.konversi5
                                 ELSE 1 END
                     FROM pendingjualdetil d JOIN mdbarang b ON b.kodebarang = d.kodebarang WHERE d.nopending = ?1 ORDER BY d.nourut",
                )
                .map_err(e)?;
            let v = st
                .query_map(params![no], |r| {
                    Ok(Item { kodebarang: r.get(0)?, namabarang: r.get(1)?, kodesatuan: r.get(2)?, satuanjual: r.get(3)?, jmljual: r.get(4)?, harga: r.get(5)?, konversi: r.get(6)?, disknilai: 0.0 })
                })
                .map_err(e)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(e)?;
            v
        };
        if !items.is_empty() {
            pending_tulis(&tx, &kasir, None, &tgl, &pelanggan, &sales, &catatan, &items)?;
        }
    }
    tx.execute("DELETE FROM pendingjualdetil", []).map_err(e)?;
    tx.execute("DELETE FROM pendingjual", []).map_err(e)?;
    tx.commit().map_err(e)
}

#[tauri::command]
pub fn list_pending(db: State<Db>, dari: String, sampai: String, search: Option<String>) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    daftar_pending(&conn, &dari, &sampai, search.as_deref().unwrap_or(""))
}

/// FrmCariPendingJual: kode TP, tanggal transaksi dalam rentang; teks cari dicocokkan ke nomor, kode pelanggan, kode sales, nama pelanggan, dan nama sales.
pub fn daftar_pending(conn: &Connection, dari: &str, sampai: &str, search: &str) -> Res<Vec<Value>> {
    let s = format!("%{}%", search.trim().to_uppercase());
    rows(
        conn,
        "SELECT t.notrans AS nopending, t.notrans, t.tglorder, t.tgltrans, t.jmltrans, t.catatan,
                COALESCE(p.namapelanggan, NULLIF(t.kodepelanggan,''), 'Tunai') AS kontak,
                COALESCE(sl.namakaryawan, t.kodesales, '') AS sales,
                COALESCE(k.namakaryawan, t.kodekaryawan) AS kasir
         FROM transaksi t
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdkaryawan sl ON sl.kodekaryawan = t.kodesales
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
         WHERE t.kode = 'TP' AND t.tgltrans BETWEEN ?1 AND ?2 AND t.notrans <> ''
           AND (UPPER(t.notrans) LIKE ?3 OR UPPER(COALESCE(t.kodepelanggan,'')) LIKE ?3 OR UPPER(COALESCE(t.kodesales,'')) LIKE ?3
                OR UPPER(COALESCE(p.namapelanggan,'')) LIKE ?3 OR UPPER(COALESCE(sl.namakaryawan,'')) LIKE ?3)
         ORDER BY t.notrans",
        params![dari, sampai, s],
    )
}

#[tauri::command]
pub fn get_pending(db: State<Db>, nopending: String) -> Res<Value> {
    let conn = db.lock()?;
    ambil_pending(&conn, &nopending)
}

pub fn ambil_pending(conn: &Connection, nopending: &str) -> Res<Value> {
    let header = one(conn, "SELECT * FROM transaksi WHERE notrans = ?1 AND kode = 'TP'", params![nopending])?.ok_or("Data pending tidak ditemukan.")?;
    let detail = rows(
        conn,
        "SELECT nourut, kodebarang, namabarang, kodesatuan, satuanjual, jmljual, hrgterjual, COALESCE(disknilai,0) AS disknilai,
                CASE WHEN COALESCE(konversi,0) > 0 THEN konversi ELSE 1 END AS konversi
         FROM transaksidetil WHERE notrans = ?1 ORDER BY nourut",
        params![nopending],
    )?;
    Ok(json!({ "header": header, "detail": detail }))
}

#[tauri::command]
pub fn delete_pending(db: State<Db>, session: State<Session>, nopending: String, izin: Option<String>) -> Res<()> {
    let user = session.user()?;
    crate::izin::periksa_hapus(&user, crate::izin::tanda_sah(&izin, &user))?;
    hapus_pending(&mut *db.lock()?, &nopending)?;
    crate::izin::habiskan(&izin);
    Ok(())
}

/// Pending yang sudah dipakai untuk menyimpan penjualan ikut dibersihkan; ini bukan penghapusan oleh pengguna, jadi tanpa izin.
#[tauri::command]
pub fn pending_selesai(db: State<Db>, session: State<Session>, nopending: String) -> Res<()> {
    session.user()?;
    hapus_pending(&mut *db.lock()?, &nopending)
}

pub fn hapus_pending(conn: &mut Connection, nopending: &str) -> Res<()> {
    let tx = conn.transaction().map_err(e)?;
    tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1 AND kode = 'TP'", params![nopending]).map_err(e)?;
    tx.execute("DELETE FROM transaksi WHERE notrans = ?1 AND kode = 'TP'", params![nopending]).map_err(e)?;
    tx.commit().map_err(e)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    struct Dir(std::path::PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn setup() -> (Connection, Dir) {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("tokopro-order-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&p).unwrap();
        let conn = db::open(&p.join("t.db")).unwrap();
        conn.execute_batch(
            "INSERT INTO mdbarang (kodebarang,namabarang,barcode,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir)
               VALUES ('A1','Sabun','899001','Barang','PCS',5000,6000,100,100);
             INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",limitkredit) VALUES ('C1','Bu Rina','Level 1',50000);
             INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','CV Maju');",
        ).unwrap();
        (conn, Dir(p))
    }

    fn user(level: &str) -> User {
        User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
    }

    fn item(jml: f64, harga: f64) -> Item {
        Item { kodebarang: "A1".into(), namabarang: "Sabun".into(), kodesatuan: "PCS".into(), satuanjual: "PCS".into(), konversi: 1.0, jmljual: jml, harga, disknilai: 0.0 }
    }

    fn order(jual: bool, items: Vec<Item>) -> OrderInput {
        OrderInput {
            jual, tgl: "2026-11-22".into(), kodepelanggan: if jual { "C1".into() } else { String::new() },
            kodepemasok: if jual { String::new() } else { "S1".into() }, kodesales: String::new(), catatan: "uji".into(), dp: 0.0, items, notrans: None, kodekasir: String::new(),
        }
    }

    fn trans_input(items: Vec<Item>, bayar: f64) -> TransInput {
        TransInput {
            tgl: "2026-11-22".into(), kodepelanggan: String::new(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
            items, diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: "Tunai".into(), jmlbayar: bayar,
            jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
        }
    }

    fn stok(c: &Connection) -> f64 {
        c.query_row("SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap()
    }

    fn count(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn order_tersimpan_bernomor_dan_tidak_mengubah_stok() {
        let (mut c, _d) = setup();
        let so = simpan_order(&mut c, &user("Manager"), &order(true, vec![item(3.0, 6000.0)])).unwrap();
        assert_eq!(so["notrans"], "SO2611-00001");
        assert_eq!(so["total"], 18000.0);
        let po = simpan_order(&mut c, &user("Manager"), &order(false, vec![item(10.0, 4500.0)])).unwrap();
        assert_eq!(po["notrans"], "PO2611-00001");
        let so2 = simpan_order(&mut c, &user("Manager"), &order(true, vec![item(1.0, 6000.0)])).unwrap();
        assert_eq!(so2["notrans"], "SO2611-00002");
        assert_eq!(stok(&c), 100.0, "order tidak mengubah stok");
        assert_eq!(count(&c, "SELECT COUNT(*) FROM keuangan"), 0, "order tidak mencatat kas");
        let (kode, status, tglorder): (String, i64, String) =
            c.query_row("SELECT kode,status,tglorder FROM transaksi WHERE notrans='SO2611-00001'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((kode.as_str(), status, tglorder.as_str()), ("SO", 0, "2026-11-22"));
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksidetil WHERE kode='PO' AND jml=10"), 1);
        assert_eq!(daftar_order(&c, true, "2026-01-01", "2026-12-31", "").unwrap().len(), 2);
        assert_eq!(daftar_order(&c, false, "2026-01-01", "2026-12-31", "Maju").unwrap().len(), 1);
    }

    #[test]
    fn order_kasir_boleh_dan_isian_diperiksa() {
        let (mut c, _d) = setup();
        assert!(simpan_order(&mut c, &user("Kasir"), &order(true, vec![item(1.0, 1.0)])).is_ok(), "aslinya tidak memeriksa level");
        assert!(simpan_order(&mut c, &user("Manager"), &order(true, vec![])).is_err());
        assert!(simpan_order(&mut c, &user("Manager"), &order(true, vec![item(0.0, 1.0)])).is_err());
        let mut o = order(true, vec![item(1.0, 6000.0)]);
        o.dp = 7000.0;
        assert!(simpan_order(&mut c, &user("Manager"), &o).unwrap_err().contains("Uang muka"));
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi"), 1);
    }

    #[test]
    fn koreksi_dan_hapus_order() {
        let (mut c, _d) = setup();
        let mut o = order(true, vec![item(3.0, 6000.0)]);
        o.dp = 5000.0;
        let no = simpan_order(&mut c, &user("Manager"), &o).unwrap()["notrans"].as_str().unwrap().to_string();
        let mut k = order(true, vec![item(2.0, 6000.0), item(1.0, 5000.0)]);
        k.notrans = Some(no.clone());
        k.dp = 0.0;
        simpan_order(&mut c, &user("Manager"), &k).unwrap();
        let g = ambil_order(&c, &no).unwrap();
        assert_eq!(g["detail"].as_array().unwrap().len(), 2);
        assert_eq!(g["header"]["jmltrans"], 17000.0);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi"), 1, "koreksi tidak membuat order baru");
        assert!(crate::izin::periksa_hapus(&user("Kasir"), false).is_err(), "Kasir butuh izin untuk menghapus order");
        assert!(crate::izin::periksa_hapus(&user("Kasir"), true).is_ok());
        hapus_order(&mut c, &no).unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi"), 0);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksidetil"), 0);
    }

    #[test]
    fn order_jual_diambil_jadi_penjualan_dan_ditandai() {
        let (mut c, _d) = setup();
        let no = simpan_order(&mut c, &user("Manager"), &order(true, vec![item(3.0, 6000.0)])).unwrap()["notrans"].as_str().unwrap().to_string();
        // Pembayaran kurang: tidak ada yang berubah, order tetap terbuka.
        assert!(penjualan_dari_order(&mut c, &user("Kasir"), &trans_input(vec![item(3.0, 6000.0)], 100.0), &no).is_err());
        assert_eq!(count(&c, "SELECT status FROM transaksi WHERE notrans='SO2611-00001'"), 0);
        assert_eq!(daftar_order(&c, true, "2026-01-01", "2026-12-31", "").unwrap().len(), 1);

        let r = penjualan_dari_order(&mut c, &user("Kasir"), &trans_input(vec![item(3.0, 6000.0)], 20000.0), &no).unwrap();
        assert_eq!(r["notrans"], "TJ2611-00001");
        assert_eq!(stok(&c), 97.0);
        let (noref, tglorder): (String, String) =
            c.query_row("SELECT noref, tglorder FROM transaksi WHERE notrans='TJ2611-00001'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((noref.as_str(), tglorder.as_str()), ("SO2611-00001", "2026-11-22"));
        assert_eq!(count(&c, "SELECT status FROM transaksi WHERE notrans='SO2611-00001'"), 1);
        assert!(daftar_order(&c, true, "2026-01-01", "2026-12-31", "").unwrap().is_empty(), "order yang sudah diambil tidak muncul lagi");

        let lagi = penjualan_dari_order(&mut c, &user("Kasir"), &trans_input(vec![item(3.0, 6000.0)], 20000.0), &no).unwrap_err();
        assert!(lagi.contains("sudah diambil"), "{lagi}");
        assert_eq!(stok(&c), 97.0);
        assert!(hapus_order(&mut c, &no).is_err(), "order yang sudah diambil tidak bisa dihapus");
        let mut k = order(true, vec![item(1.0, 6000.0)]);
        k.notrans = Some(no);
        assert!(simpan_order(&mut c, &user("Manager"), &k).is_err(), "dan tidak bisa dikoreksi");
    }

    #[test]
    fn order_beli_diambil_jadi_pembelian() {
        let (mut c, _d) = setup();
        let no = simpan_order(&mut c, &user("Manager"), &order(false, vec![item(10.0, 4500.0)])).unwrap()["notrans"].as_str().unwrap().to_string();
        let mut inp = trans_input(vec![item(10.0, 4500.0)], 0.0);
        inp.kodepemasok = "S1".into();
        let r = pembelian_dari_order(&mut c, &user("Manager"), &inp, &no).unwrap();
        assert_eq!(r["notrans"], "TB2611-00001");
        assert_eq!(stok(&c), 110.0);
        let noref: String = c.query_row("SELECT noref FROM transaksi WHERE notrans='TB2611-00001'", [], |r| r.get(0)).unwrap();
        assert_eq!(noref, "PO2611-00001");
        assert_eq!(count(&c, "SELECT status FROM transaksi WHERE notrans='PO2611-00001'"), 1);
        assert!(pembelian_dari_order(&mut c, &user("Manager"), &inp, &no).is_err());
        // Order penjualan tidak bisa diambil lewat pembelian.
        let so = simpan_order(&mut c, &user("Manager"), &order(true, vec![item(1.0, 6000.0)])).unwrap()["notrans"].as_str().unwrap().to_string();
        assert!(pembelian_dari_order(&mut c, &user("Manager"), &inp, &so).is_err());
    }

    #[test]
    fn pending_disimpan_sebagai_transaksi_tp() {
        let (mut c, _d) = setup();
        let p = |no: Option<&str>, jml: f64| PendingInput {
            nopending: no.map(String::from), tgl: "2026-11-22".into(), kodepelanggan: "C1".into(), kodesales: String::new(), catatan: "tunggu".into(),
            items: vec![item(jml, 6000.0)], kodekasir: String::new(),
        };
        assert!(simpan_pending(&mut c, &user("Kasir"), &PendingInput { items: vec![], ..p(None, 1.0) }).is_err());
        let r = simpan_pending(&mut c, &user("Kasir"), &p(None, 2.0)).unwrap();
        assert_eq!(r["nopending"], "TP2611-00001");
        assert_eq!(r["total"], 12000.0);
        let r2 = simpan_pending(&mut c, &user("Kasir"), &p(None, 1.0)).unwrap();
        assert_eq!(r2["nopending"], "TP2611-00002");
        let (kode, jenis): (String, String) = c.query_row("SELECT kode, jenis FROM transaksi WHERE notrans='TP2611-00001'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((kode.as_str(), jenis.as_str()), ("TP", "Pending"));
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksidetil WHERE kode='TP'"), 2);
        assert_eq!(daftar_pending(&c, "2026-11-22", "2026-11-22", "").unwrap().len(), 2);
        assert_eq!(daftar_pending(&c, "2026-11-22", "2026-11-22", "rina").unwrap().len(), 2, "cari nama pelanggan tanpa membedakan huruf besar");
        assert_eq!(daftar_pending(&c, "2026-11-22", "2026-11-22", "C1").unwrap().len(), 2, "cari kode pelanggan");
        assert_eq!(daftar_pending(&c, "2026-11-23", "2026-11-30", "").unwrap().len(), 0);

        let g = ambil_pending(&c, "TP2611-00001").unwrap();
        assert_eq!(g["header"]["kodepelanggan"], "C1");
        assert_eq!(g["detail"][0]["jmljual"], 2.0);
        assert_eq!(g["detail"][0]["namabarang"], "Sabun");

        simpan_pending(&mut c, &user("Kasir"), &p(Some("TP2611-00001"), 5.0)).unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi WHERE kode='TP'"), 2);
        assert_eq!(ambil_pending(&c, "TP2611-00001").unwrap()["detail"][0]["jmljual"], 5.0);

        hapus_pending(&mut c, "TP2611-00001").unwrap();
        assert!(ambil_pending(&c, "TP2611-00001").is_err());
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksidetil"), 1);
        // Pending tidak menyentuh stok, kas, maupun penjualan.
        assert_eq!(stok(&c), 100.0);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi WHERE kode<>'TP'"), 0);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM keuangan"), 0);
    }

    #[test]
    fn pending_lama_dipindah_ke_transaksi() {
        let (mut c, _d) = setup();
        c.execute_batch(
            "INSERT INTO pendingjual (nopending,tgltrans,kodekaryawan,kodepelanggan,kodesales,catatan,jmltrans) VALUES ('PD2611-00001','2026-11-20','E1','C1','','lama',12000);
             INSERT INTO pendingjualdetil (nopending,nourut,kodebarang,satuanjual,jmljual,hrgterjual) VALUES ('PD2611-00001',1,'A1','PCS',2,6000);",
        ).unwrap();
        migrasi_pending(&mut c).unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM pendingjual"), 0);
        let l = daftar_pending(&c, "2026-11-20", "2026-11-20", "").unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0]["nopending"], "TP2611-00001");
        assert_eq!(ambil_pending(&c, "TP2611-00001").unwrap()["detail"][0]["namabarang"], "Sabun");
        migrasi_pending(&mut c).unwrap();
        assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi WHERE kode='TP'"), 1);
    }
}
