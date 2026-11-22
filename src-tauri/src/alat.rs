//! Alat Bantu: hitung ulang stok, sinkronisasi data, hapus transaksi, hapus data, dan editor SQL.
//! Semua tindakan yang menghapus atau mengubah banyak data membuat cadangan lebih dulu.

use crate::auth::{Session, User};
use crate::database::{backup_ke, folder_bawaan, hanya_manager, hanya_pengelola};
use crate::db::{e, rows, to_json, Db, Res};
use crate::kas::hitung_ulang_saldo;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::State;

fn folder_aman(conn: &Connection, folder: Option<&str>) -> Res<PathBuf> {
    match folder.map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => Ok(PathBuf::from(f)),
        None => folder_bawaan(conn),
    }
}

/* ---------------- Hitung ulang stok ---------------- */

/// Stok masuk, keluar, dan opname dihitung ulang dari semua baris transaksi, lalu stok akhir.
/// Mengembalikan jumlah barang yang stok akhirnya berubah.
pub fn hitung_ulang_stok(conn: &Connection) -> Res<usize> {
    let sebelum: Vec<(String, f64)> = {
        let mut st = conn.prepare("SELECT kodebarang, COALESCE(stokakhir,0) FROM mdbarang WHERE jenis = 'Barang'").map_err(e)?;
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
    };
    let jumlah = |kodes: &str| {
        format!(
            "(SELECT COALESCE(SUM(d.jml),0) FROM transaksidetil d WHERE d.kodebarang = mdbarang.kodebarang AND d.kode IN ({kodes}))"
        )
    };
    conn.execute(
        &format!(
            "UPDATE mdbarang SET stokmasuk = {}, stokkeluar = {}, stokopname = {} WHERE jenis = 'Barang'",
            jumlah("'RJ','TB'"), jumlah("'TJ','RB'"), jumlah("'OP'")
        ),
        [],
    ).map_err(e)?;
    conn.execute(
        "UPDATE mdbarang SET stokakhir = COALESCE(stokawal,0) + stokmasuk - stokkeluar + stokopname WHERE jenis = 'Barang'",
        [],
    ).map_err(e)?;
    let mut berubah = 0;
    for (kode, lama) in sebelum {
        let baru: f64 = conn.query_row("SELECT COALESCE(stokakhir,0) FROM mdbarang WHERE kodebarang = ?1", params![kode], |r| r.get(0)).map_err(e)?;
        if (baru - lama).abs() > 0.0049 {
            berubah += 1;
        }
    }
    Ok(berubah)
}

/* ---------------- Sinkronisasi ---------------- */

/// Harga beli di baris penjualan yang kosong atau lebih besar dari harga jual diganti harga beli di master barang.
/// Nilai beli di kepala transaksi ikut dihitung ulang.
pub fn sinkron_harga_beli(conn: &mut Connection) -> Res<usize> {
    let tx = conn.transaction().map_err(e)?;
    let kena: Vec<String> = {
        let mut st = tx.prepare(
            "SELECT DISTINCT d.notrans FROM transaksidetil d JOIN mdbarang b ON b.kodebarang = d.kodebarang
             WHERE d.kode = 'TJ' AND b.jenis = 'Barang' AND d.jml > 0 AND (d.hrgbeli > d.hrgjual OR COALESCE(d.hrgbeli,0) = 0)",
        ).map_err(e)?;
        st.query_map([], |r| r.get(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
    };
    let n = tx.execute(
        "UPDATE transaksidetil SET hrgbeli = (SELECT b.hrgbeli FROM mdbarang b WHERE b.kodebarang = transaksidetil.kodebarang)
         WHERE kode = 'TJ' AND jml > 0 AND (hrgbeli > hrgjual OR COALESCE(hrgbeli,0) = 0)
           AND kodebarang IN (SELECT kodebarang FROM mdbarang WHERE jenis = 'Barang')",
        [],
    ).map_err(e)?;
    for no in &kena {
        tx.execute(
            "UPDATE transaksi SET totalnilaibeli = (SELECT COALESCE(SUM(jml * hrgbeli),0) FROM transaksidetil WHERE notrans = ?1) WHERE notrans = ?1",
            params![no],
        ).map_err(e)?;
    }
    tx.commit().map_err(e)?;
    Ok(n)
}

/// Hapus transaksi penjualan yang tidak punya baris barang (sisa penyimpanan yang terputus), beserta kas dan piutangnya.
pub fn sinkron_jual(conn: &mut Connection) -> Res<usize> {
    let tx = conn.transaction().map_err(e)?;
    let kosong: Vec<String> = {
        let mut st = tx.prepare(
            "SELECT t.notrans FROM transaksi t WHERE t.kode = 'TJ' AND NOT EXISTS (SELECT 1 FROM transaksidetil d WHERE d.notrans = t.notrans)",
        ).map_err(e)?;
        st.query_map([], |r| r.get(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
    };
    for no in &kosong {
        hapus_terkait(&tx, no)?;
        tx.execute("DELETE FROM transaksi WHERE notrans = ?1", params![no]).map_err(e)?;
    }
    if !kosong.is_empty() {
        hitung_ulang_saldo(&tx)?;
    }
    tx.commit().map_err(e)?;
    Ok(kosong.len())
}

/// Kas, piutang/hutang beserta pembayarannya, dan poin yang terkait satu transaksi.
fn hapus_terkait(tx: &Connection, notrans: &str) -> Res<()> {
    tx.execute("DELETE FROM keuangan WHERE noreftrans = ?1", params![notrans]).map_err(e)?;
    tx.execute("DELETE FROM trkartupiutangdetil WHERE nopiutang IN (SELECT nopiutang FROM trkartupiutang WHERE noreftrans = ?1)", params![notrans]).map_err(e)?;
    tx.execute("DELETE FROM trkartupiutang WHERE noreftrans = ?1", params![notrans]).map_err(e)?;
    let poin: Vec<(String, i64)> = {
        let mut st = tx.prepare("SELECT kodepelanggan, COALESCE(poinmasuk,0) FROM transaksipoin WHERE reftukar = ?1 AND COALESCE(poinmasuk,0) > 0").map_err(e)?;
        st.query_map(params![notrans], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
    };
    for (pel, p) in poin {
        tx.execute("UPDATE mdpelanggan SET poin = MAX(0, COALESCE(poin,0) - ?1) WHERE kodepelanggan = ?2", params![p, pel]).map_err(e)?;
    }
    tx.execute("DELETE FROM transaksipoin WHERE reftukar = ?1", params![notrans]).map_err(e)?;
    Ok(())
}

/* ---------------- Hapus transaksi ---------------- */

fn kode_jenis(jenis: &str) -> Res<&'static str> {
    match jenis {
        "Penjualan" => Ok("TJ"),
        "Pembelian" => Ok("TB"),
        "Retur Penjualan" => Ok("RJ"),
        "Retur Pembelian" => Ok("RB"),
        _ => Err("Jenis transaksi ini belum bisa dihapus lewat Alat Bantu.".into()),
    }
}

/// Kunci baris pelunasan di daftar Hapus Transaksi: "XID" diikuti nomor pembayaran.
const AWAL_KUNCI_BAYAR: &str = "XID";

pub fn daftar_transaksi(conn: &Connection, jenis: &str, no: &str, dari: &str, sampai: &str) -> Res<Vec<Value>> {
    if jenis == "Pelunasan Piutang Customer" || jenis == "Pelunasan Hutang Supplier" {
        return daftar_pelunasan(conn, jenis == "Pelunasan Piutang Customer", no, dari, sampai);
    }
    let kode = kode_jenis(jenis)?;
    let (kolom, tabel, kunci) = if kode == "TJ" || kode == "RJ" { ("kodepelanggan", "mdpelanggan", "namapelanggan") } else { ("kodepemasok", "mdpemasok", "namapemasok") };
    // Retur tidak punya TOTALTRANS yang terisi; nilainya ada di JMLTRANS.
    let total = if kode == "RJ" || kode == "RB" { "t.jmltrans" } else { "t.totaltrans" };
    rows(
        conn,
        &format!(
            "SELECT t.tid, t.notrans AS kunci, t.notrans, t.noref, t.tgltrans, t.kode, t.jenis, t.{kolom} AS kodekontak, k.{kunci} AS namakontak, {total} AS totaltrans
             FROM transaksi t LEFT JOIN {tabel} k ON k.{kolom} = t.{kolom}
             WHERE t.kode = ?1 AND UPPER(t.notrans) LIKE UPPER(?2) AND (?3 = '' OR t.tgltrans >= ?3) AND (?4 = '' OR t.tgltrans <= ?4)
             ORDER BY t.tgltrans DESC, t.notrans DESC LIMIT 5000"
        ),
        params![kode, format!("%{}%", no.trim()), dari, sampai],
    )
}

/// Pembayaran piutang/hutang satu per satu. Potongan tagihan yang berasal dari retur tidak ditampilkan:
/// itu ikut batal bersama returnya.
fn daftar_pelunasan(conn: &Connection, piutang: bool, no: &str, dari: &str, sampai: &str) -> Res<Vec<Value>> {
    let (kolom, tabel, nama) = if piutang { ("kodepelanggan", "mdpelanggan", "namapelanggan") } else { ("kodepemasok", "mdpemasok", "namapemasok") };
    rows(
        conn,
        &format!(
            "SELECT d.xid, 'XID' || d.xid AS kunci, d.nopiutang AS notrans, k.noreftrans AS noref, d.tglbayar AS tgltrans,
                    k.{kolom} AS kodekontak, m.{nama} AS namakontak, d.jmlbayar AS totaltrans, d.catatan
             FROM trkartupiutangdetil d JOIN trkartupiutang k ON k.nopiutang = d.nopiutang
             LEFT JOIN {tabel} m ON m.{kolom} = k.{kolom}
             WHERE k.jenis = ?1 AND UPPER(d.nopiutang) LIKE UPPER(?2) AND (?3 = '' OR d.tglbayar >= ?3) AND (?4 = '' OR d.tglbayar <= ?4)
               AND COALESCE(d.catatan,'') NOT IN (SELECT notrans FROM transaksi WHERE kode IN ('RJ','RB'))
             ORDER BY d.tglbayar DESC, d.xid DESC LIMIT 5000"
        ),
        params![if piutang { "Piutang" } else { "Hutang" }, format!("%{}%", no.trim()), dari, sampai],
    )
}

/// Hapus satu transaksi penjualan/pembelian/retur beserta kas, piutang/hutang, dan efeknya ke stok.
fn hapus_satu(tx: &Connection, notrans: &str) -> Res<()> {
    let kode: String = tx
        .query_row("SELECT COALESCE(kode,'') FROM transaksi WHERE notrans = ?1", params![notrans], |r| r.get(0))
        .map_err(|_| format!("Transaksi {notrans} tidak ditemukan."))?;
    if kode == "RJ" || kode == "RB" {
        return hapus_retur(tx, notrans, &kode);
    }
    if kode != "TJ" && kode != "TB" {
        return Err(format!("Transaksi {notrans} bukan penjualan, pembelian, atau retur."));
    }
    let retur: i64 = tx
        .query_row("SELECT COUNT(*) FROM transaksidetil WHERE notrans = ?1 AND COALESCE(jmlretur,0) > 0", params![notrans], |r| r.get(0))
        .map_err(e)?;
    if retur > 0 {
        return Err(format!("Transaksi {notrans} tidak bisa dihapus karena pernah diretur. Hapus dulu returnya."));
    }
    let bayar: i64 = tx
        .query_row("SELECT COUNT(*) FROM trkartupiutang WHERE noreftrans = ?1 AND COALESCE(jmlterbayar,0) > 0", params![notrans], |r| r.get(0))
        .map_err(e)?;
    if bayar > 0 {
        let apa = if kode == "TJ" { "piutang" } else { "hutang" };
        return Err(format!("Transaksi {notrans} tidak bisa dihapus karena {apa}nya pernah dibayar."));
    }
    kembalikan_stok(tx, notrans, if kode == "TJ" { "stokkeluar" } else { "stokmasuk" })?;
    hapus_terkait(tx, notrans)?;
    tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1", params![notrans]).map_err(e)?;
    tx.execute("DELETE FROM transaksi WHERE notrans = ?1", params![notrans]).map_err(e)?;
    Ok(())
}

/// Kurangi kolom stok (`stokkeluar` atau `stokmasuk`) sebesar jumlah di baris transaksi, lalu hitung stok akhirnya.
/// Menghapus baris tidak memicu apa-apa di database, jadi stok dikembalikan lewat sini.
fn kembalikan_stok(tx: &Connection, notrans: &str, kolom: &str) -> Res<()> {
    tx.execute(
        &format!(
            "UPDATE mdbarang SET {kolom} = {kolom} - (SELECT COALESCE(SUM(d.jml),0) FROM transaksidetil d WHERE d.notrans = ?1 AND d.kodebarang = mdbarang.kodebarang)
             WHERE jenis = 'Barang' AND kodebarang IN (SELECT kodebarang FROM transaksidetil WHERE notrans = ?1)"
        ),
        params![notrans],
    ).map_err(e)?;
    tx.execute(
        "UPDATE mdbarang SET stokakhir = COALESCE(stokawal,0) + stokmasuk - stokkeluar + stokopname
         WHERE jenis = 'Barang' AND kodebarang IN (SELECT kodebarang FROM transaksidetil WHERE notrans = ?1)",
        params![notrans],
    ).map_err(e)?;
    Ok(())
}

/// Batalkan satu pembayaran kartu: kartu kembali berhutang sebesar pembayaran itu dan baris pembayarannya dihapus.
fn batalkan_bayar(tx: &Connection, xid: i64) -> Res<()> {
    let (no, jml): (String, f64) = tx
        .query_row("SELECT nopiutang, COALESCE(jmlbayar,0) FROM trkartupiutangdetil WHERE xid = ?1", params![xid], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Data pelunasan itu tidak ditemukan.".to_string())?;
    tx.execute("DELETE FROM trkartupiutangdetil WHERE xid = ?1", params![xid]).map_err(e)?;
    tx.execute(
        "UPDATE trkartupiutang SET jmlterbayar = MAX(0, COALESCE(jmlterbayar,0) - ?1), kekurangan = COALESCE(kekurangan,0) + ?1, status = 0 WHERE nopiutang = ?2",
        params![jml, no],
    ).map_err(e)?;
    Ok(())
}

/// Hapus retur penjualan (RJ) atau retur pembelian (RB): stok kembali, jumlah retur di transaksi asal berkurang,
/// tagihan yang dipotong oleh retur ini kembali terbuka, dan kas retur dihapus.
fn hapus_retur(tx: &Connection, notrans: &str, kode: &str) -> Res<()> {
    let asal: String = tx
        .query_row("SELECT COALESCE(noref,'') FROM transaksi WHERE notrans = ?1", params![notrans], |r| r.get(0))
        .map_err(e)?;
    // Jumlah retur dikurangkan dari baris asal dengan barang yang sama.
    if !asal.is_empty() {
        let baris: Vec<(String, f64)> = {
            let mut st = tx.prepare("SELECT kodebarang, COALESCE(jmljual,0) FROM transaksidetil WHERE notrans = ?1 ORDER BY nourut").map_err(e)?;
            st.query_map(params![notrans], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
        };
        for (barang, jml) in baris {
            let mut sisa = jml;
            let sumber: Vec<(i64, f64)> = {
                let mut st = tx.prepare("SELECT nourut, COALESCE(jmlretur,0) FROM transaksidetil WHERE notrans = ?1 AND kodebarang = ?2 AND COALESCE(jmlretur,0) > 0 ORDER BY nourut").map_err(e)?;
                st.query_map(params![asal, barang], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
            };
            for (nourut, retur) in sumber {
                if sisa < 0.005 {
                    break;
                }
                let kurang = sisa.min(retur);
                tx.execute("UPDATE transaksidetil SET jmlretur = COALESCE(jmlretur,0) - ?1 WHERE notrans = ?2 AND nourut = ?3", params![kurang, asal, nourut]).map_err(e)?;
                sisa -= kurang;
            }
        }
    }
    // Tagihan yang dipotong retur ini (dicatat dengan nomor retur di kolom catatan).
    let bayar: Vec<i64> = {
        let mut st = tx.prepare("SELECT xid FROM trkartupiutangdetil WHERE catatan = ?1").map_err(e)?;
        st.query_map(params![notrans], |r| r.get(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)?
    };
    for xid in bayar {
        batalkan_bayar(tx, xid)?;
    }
    kembalikan_stok(tx, notrans, if kode == "RJ" { "stokmasuk" } else { "stokkeluar" })?;
    hapus_terkait(tx, notrans)?;
    tx.execute("DELETE FROM transaksidetil WHERE notrans = ?1", params![notrans]).map_err(e)?;
    tx.execute("DELETE FROM transaksi WHERE notrans = ?1", params![notrans]).map_err(e)?;
    Ok(())
}

/// Hapus satu pembayaran piutang/hutang (kunci "XID123"): kartu kembali terbuka.
/// Kas pelunasan ditulis `pelunasan.rs` tanpa nomor referensi (seperti aplikasi lama), satu baris untuk seluruh pelunasan.
/// Isi prosedur hapus aslinya tidak terbaca, jadi kas dicari lewat tanda yang benar-benar ditulis:
/// kategori, tanggal, kontak, awal keterangan, dan jumlah. Kalau barisnya mencakup beberapa kartu, jumlahnya dikurangi.
fn hapus_pelunasan(tx: &Connection, xid: i64) -> Res<()> {
    let (no, tgl, jml, catatan, jenis): (String, String, f64, String, String) = tx
        .query_row(
            "SELECT d.nopiutang, COALESCE(d.tglbayar,''), COALESCE(d.jmlbayar,0), COALESCE(d.catatan,''), COALESCE(k.jenis,'')
             FROM trkartupiutangdetil d JOIN trkartupiutang k ON k.nopiutang = d.nopiutang WHERE d.xid = ?1",
            params![xid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "Data pelunasan itu tidak ditemukan.".to_string())?;
    let dari_retur: i64 = tx
        .query_row("SELECT COUNT(*) FROM transaksi WHERE notrans = ?1 AND kode IN ('RJ','RB')", params![catatan], |r| r.get(0))
        .map_err(e)?;
    if dari_retur > 0 {
        return Err(format!("Pelunasan {no} berasal dari retur {catatan}, jadi tidak bisa dihapus sendiri. Hapus returnya untuk membatalkan potongan ini."));
    }
    batalkan_bayar(tx, xid)?;
    let hutang = jenis == "Hutang";
    let (kolom, kategori, label) = if hutang { ("keluar", "Harga pokok penjualan", "Pelunasan Hutang") } else { ("masuk", "Penjualan barang dagang", "Pelunasan Piutang") };
    let kode_kontak: String = tx
        .query_row("SELECT COALESCE(CASE WHEN jenis = 'Hutang' THEN kodepemasok ELSE kodepelanggan END,'') FROM trkartupiutang WHERE nopiutang = ?1", params![no], |r| r.get(0))
        .map_err(e)?;
    let awal = format!("{label} {kode_kontak}-");
    // Kas versi lama memakai nomor kartu sebagai referensi dan kategori "Pelunasan ...".
    let kas: Option<(i64, f64)> = tx
        .query_row(
            &format!(
                "SELECT idkas, COALESCE({kolom},0) FROM keuangan
                 WHERE tglkas = ?3 AND COALESCE({kolom},0) > ?4 - 0.005 AND (
                     (noreftrans = '' AND kategori = ?1 AND kodekontak = ?5 AND instr(keterangan, ?2) = 1)
                  OR (noreftrans = ?6 AND kategori = ?7 AND ABS(COALESCE(masuk,0) + COALESCE(keluar,0) - ?4) < 0.005))
                 ORDER BY idkas DESC LIMIT 1"
            ),
            params![kategori, awal, tgl, jml, kode_kontak, no, if hutang { "Pelunasan hutang" } else { "Pelunasan piutang" }],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    if let Some((idkas, ada)) = kas {
        if ada - jml < 0.005 {
            tx.execute("DELETE FROM keuangan WHERE idkas = ?1", params![idkas]).map_err(e)?;
        } else {
            tx.execute(&format!("UPDATE keuangan SET {kolom} = ROUND({kolom} - ?1, 2) WHERE idkas = ?2"), params![jml, idkas]).map_err(e)?;
        }
    }
    Ok(())
}

/// Hapus beberapa transaksi sekaligus. Semuanya batal kalau ada satu yang tidak boleh dihapus.
/// Entri berkunci "XID<nomor>" adalah pembayaran piutang/hutang, selain itu nomor transaksi.
pub fn hapus_transaksi(conn: &mut Connection, daftar: &[String], folder: &Path) -> Res<Value> {
    if daftar.is_empty() {
        return Err("Pilih dulu transaksi yang akan dihapus.".into());
    }
    let cadangan = backup_ke(conn, folder, "sebelum-hapus-transaksi")?;
    let tx = conn.transaction().map_err(e)?;
    for no in daftar {
        match no.strip_prefix(AWAL_KUNCI_BAYAR).and_then(|n| n.parse::<i64>().ok()) {
            Some(xid) => hapus_pelunasan(&tx, xid)?,
            None => hapus_satu(&tx, no)?,
        }
    }
    hitung_ulang_saldo(&tx)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "dihapus": daftar.len(), "cadangan": cadangan.display().to_string() }))
}

/* ---------------- Hapus data ---------------- */

/// (kunci, nama di daftar) tampilan Hapus Data. Urutan ini juga urutan penghapusan: transaksi dulu, data induk terakhir.
pub const ITEM_HAPUS: &[(&str, &str)] = &[
    ("jual", "Transaksi Penjualan"),
    ("beli", "Transaksi Pembelian"),
    ("opname", "Transaksi Stok Opname"),
    ("stokawal", "Transaksi Stok Awal"),
    ("piutang", "Piutang Pelanggan"),
    ("hutang", "Hutang Supplier"),
    ("kas", "Kas"),
    ("promo", "Promo Barang"),
    ("hrglevel", "Harga Level Barang"),
    ("multisatuan", "Harga Multisatuan Barang"),
    ("hrgtingkat", "Harga Tingkat Barang"),
    ("barang", "Data Barang"),
    ("satuan", "Data Satuan"),
    ("kategori", "Data Kategori"),
    ("kelompok", "Data Kelompok"),
    ("pemasok", "Data Supplier"),
    ("pelanggan", "Data Pelanggan"),
    ("karyawan", "Data Karyawan"),
    ("pengguna", "Pengguna"),
];

/// Hapus data menurut `item` (kunci dari ITEM_HAPUS). Jika `dari`/`sampai` diisi, hanya data dalam periode itu
/// yang dihapus untuk transaksi, kas, piutang, dan hutang.
pub fn hapus_data(conn: &mut Connection, iduser_aktif: &str, item: &[String], dari: &str, sampai: &str, folder: &Path) -> Res<Value> {
    if item.is_empty() {
        return Err("Data yang akan dihapus belum dipilih.".into());
    }
    for k in item {
        if !ITEM_HAPUS.iter().any(|(kunci, _)| kunci == k) {
            return Err(format!("Pilihan {k} tidak dikenal."));
        }
    }
    let cadangan = backup_ke(conn, folder, "sebelum-hapus-data")?;
    let tx = conn.transaction().map_err(e)?;
    let mau = |k: &str| item.iter().any(|x| x == k);
    let mut hasil = Map::new();
    let mut stok_berubah = false;
    let mut kas_berubah = false;

    // Transaksi menurut kode, dalam periode.
    let periode = "(?1 = '' OR COALESCE(tgltrans, tglorder) >= ?1) AND (?2 = '' OR COALESCE(tgltrans, tglorder) <= ?2)";
    for (kunci, kodes) in [("jual", "'TJ','RJ','SO'"), ("beli", "'TB','RB','PO'"), ("opname", "'OP'"), ("stokawal", "'SA'")] {
        if !mau(kunci) {
            continue;
        }
        let dasar = format!("SELECT notrans FROM transaksi WHERE kode IN ({kodes}) AND {periode}");
        tx.execute(&format!("DELETE FROM transaksidetil WHERE notrans IN ({dasar})"), params![dari, sampai]).map_err(e)?;
        let n = tx.execute(&format!("DELETE FROM transaksi WHERE kode IN ({kodes}) AND {periode}"), params![dari, sampai]).map_err(e)?;
        hasil.insert(kunci.into(), json!(n));
        stok_berubah = true;
    }

    // Piutang dan hutang: tanggal ikut transaksinya, atau jatuh tempo kalau transaksinya sudah tidak ada.
    for (kunci, kodes) in [("piutang", "'PS'"), ("hutang", "'HS','HP'")] {
        if !mau(kunci) {
            continue;
        }
        let tgl = "COALESCE((SELECT t.tgltrans FROM transaksi t WHERE t.notrans = trkartupiutang.noreftrans), jthtempo, '')";
        let kena = format!("kode IN ({kodes}) AND (?1 = '' OR {tgl} >= ?1) AND (?2 = '' OR {tgl} <= ?2)");
        tx.execute(&format!("DELETE FROM trkartupiutangdetil WHERE nopiutang IN (SELECT nopiutang FROM trkartupiutang WHERE {kena})"), params![dari, sampai]).map_err(e)?;
        let n = tx.execute(&format!("DELETE FROM trkartupiutang WHERE {kena}"), params![dari, sampai]).map_err(e)?;
        hasil.insert(kunci.into(), json!(n));
    }

    if mau("kas") {
        let n = tx.execute(
            "DELETE FROM keuangan WHERE (?1 = '' OR tglkas >= ?1) AND (?2 = '' OR tglkas <= ?2)",
            params![dari, sampai],
        ).map_err(e)?;
        hasil.insert("kas".into(), json!(n));
        kas_berubah = true;
    }
    if mau("promo") {
        let mut n = 0;
        for t in ["mdbarangbonus", "mdbarangdiskon", "mdbarangpdp"] {
            n += tx.execute(&format!("DELETE FROM {t}"), []).map_err(e)?;
        }
        hasil.insert("promo".into(), json!(n));
    }
    if mau("hrglevel") {
        let n = tx.execute("UPDATE mdbarang SET hrglevel1=0,hrglevel2=0,hrglevel3=0,hrglevel4=0,hrglevel5=0", []).map_err(e)?;
        hasil.insert("hrglevel".into(), json!(n));
    }
    if mau("multisatuan") {
        let sets = (1..=5).map(|i| format!("satuan{i}='',konversi{i}=0,hrgsatuan{i}=0,hrgmultisatuan{i}=0")).collect::<Vec<_>>().join(",");
        let n = tx.execute(&format!("UPDATE mdbarang SET {sets}"), []).map_err(e)?;
        hasil.insert("multisatuan".into(), json!(n));
    }
    if mau("hrgtingkat") {
        let sets = (1..=5).map(|i| format!("hrgtingkat{i}=0,minhrg{i}=0")).collect::<Vec<_>>().join(",");
        let n = tx.execute(&format!("UPDATE mdbarang SET {sets}"), []).map_err(e)?;
        hasil.insert("hrgtingkat".into(), json!(n));
    }
    for (kunci, tabel) in [
        ("barang", "mdbarang"), ("satuan", "mdsatuan"), ("kategori", "mdkategori"), ("kelompok", "mdkelompok"),
        ("pemasok", "mdpemasok"), ("pelanggan", "mdpelanggan"), ("karyawan", "mdkaryawan"),
    ] {
        if mau(kunci) {
            let n = tx.execute(&format!("DELETE FROM {tabel}"), []).map_err(e)?;
            if kunci == "barang" {
                tx.execute("DELETE FROM sqlite_sequence WHERE name = 'mdbarang'", []).map_err(e)?;
            }
            hasil.insert(kunci.into(), json!(n));
        }
    }
    if mau("pengguna") {
        // 'admin' dan akun yang sedang dipakai dipertahankan supaya Anda tidak terkunci.
        tx.execute("DELETE FROM mdusermenu WHERE LOWER(iduser) <> 'admin' AND LOWER(iduser) <> LOWER(?1)", params![iduser_aktif]).map_err(e)?;
        let n = tx.execute("DELETE FROM mduser WHERE LOWER(iduser) <> 'admin' AND LOWER(iduser) <> LOWER(?1)", params![iduser_aktif]).map_err(e)?;
        hasil.insert("pengguna".into(), json!(n));
    }

    if stok_berubah {
        hitung_ulang_stok(&tx)?;
    }
    if kas_berubah {
        hitung_ulang_saldo(&tx)?;
    }
    tx.commit().map_err(e)?;
    Ok(json!({ "dihapus": hasil, "cadangan": cadangan.display().to_string() }))
}

/* ---------------- Editor SQL ---------------- */

/// Jalankan satu atau beberapa perintah SQL. SELECT dibaca saja (maksimal 500 baris); perintah lain
/// dijalankan dalam satu transaksi setelah membuat cadangan.
pub fn jalankan_sql(conn: &mut Connection, sql: &str, folder: &Path) -> Res<Value> {
    let s = sql.trim().trim_end_matches(';').trim();
    if s.is_empty() {
        return Err("Perintah SQL belum diisi.".into());
    }
    let kecil = s.to_lowercase();
    if kecil.contains("attach ") || kecil.contains("load_extension") {
        return Err("Perintah ini tidak diizinkan.".into());
    }
    let baca = ["select", "with", "explain"].iter().any(|k| kecil.starts_with(k)) || (kecil.starts_with("pragma") && !kecil.contains('='));
    if baca && !s.contains(';') {
        let mut stmt = conn.prepare(s).map_err(e)?;
        let kolom: Vec<String> = stmt.column_names().into_iter().map(|c| c.to_string()).collect();
        let mut q = stmt.query([]).map_err(e)?;
        let mut baris: Vec<Value> = vec![];
        let mut terpotong = false;
        while let Some(r) = q.next().map_err(e)? {
            if baris.len() >= 500 {
                terpotong = true;
                break;
            }
            let mut o = vec![];
            for i in 0..kolom.len() {
                o.push(to_json(r.get_ref(i).map_err(e)?));
            }
            baris.push(Value::Array(o));
        }
        return Ok(json!({ "kolom": kolom, "baris": baris, "terpotong": terpotong, "cadangan": null }));
    }
    let cadangan = backup_ke(conn, folder, "sebelum-sql")?;
    let tx = conn.transaction().map_err(e)?;
    tx.execute_batch(s).map_err(e)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "kolom": [], "baris": [], "terpotong": false, "cadangan": cadangan.display().to_string() }))
}

/* ---------------- Perintah Tauri ---------------- */

#[tauri::command]
pub fn alat_item_hapus(session: State<Session>) -> Res<Vec<Value>> {
    hanya_pengelola(&session.user()?)?;
    Ok(ITEM_HAPUS.iter().map(|(k, n)| json!({ "kunci": k, "nama": n })).collect())
}

#[tauri::command]
pub fn alat_hitung_stok(db: State<Db>, session: State<Session>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    Ok(json!({ "berubah": hitung_ulang_stok(&*db.lock()?)? }))
}

#[tauri::command]
pub fn alat_hitung_kas(db: State<Db>, session: State<Session>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    Ok(json!({ "berubah": hitung_ulang_saldo(&*db.lock()?)? }))
}

#[tauri::command]
pub fn alat_sinkron_harga_beli(db: State<Db>, session: State<Session>, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let mut conn = db.lock()?;
    let aman = backup_ke(&conn, &folder_aman(&conn, folder.as_deref())?, "sebelum-sinkron")?;
    Ok(json!({ "berubah": sinkron_harga_beli(&mut conn)?, "cadangan": aman.display().to_string() }))
}

#[tauri::command]
pub fn alat_sinkron_jual(db: State<Db>, session: State<Session>, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let mut conn = db.lock()?;
    let aman = backup_ke(&conn, &folder_aman(&conn, folder.as_deref())?, "sebelum-sinkron")?;
    Ok(json!({ "dihapus": sinkron_jual(&mut conn)?, "cadangan": aman.display().to_string() }))
}

#[tauri::command]
pub fn alat_daftar_transaksi(db: State<Db>, session: State<Session>, jenis: String, no: String, dari: String, sampai: String) -> Res<Vec<Value>> {
    hanya_manager(&session.user()?)?;
    daftar_transaksi(&*db.lock()?, &jenis, &no, &dari, &sampai)
}

#[tauri::command]
pub fn alat_hapus_transaksi(db: State<Db>, session: State<Session>, daftar: Vec<String>, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let mut conn = db.lock()?;
    let f = folder_aman(&conn, folder.as_deref())?;
    hapus_transaksi(&mut conn, &daftar, &f)
}

#[derive(Deserialize)]
pub struct HapusInput {
    pub item: Vec<String>,
    #[serde(default)]
    pub dari: String,
    #[serde(default)]
    pub sampai: String,
    pub folder: Option<String>,
}

#[tauri::command]
pub fn alat_hapus_data(db: State<Db>, session: State<Session>, input: HapusInput) -> Res<Value> {
    let user: User = session.user()?;
    hanya_manager(&user)?;
    let mut conn = db.lock()?;
    let f = folder_aman(&conn, input.folder.as_deref())?;
    hapus_data(&mut conn, &user.iduser, &input.item, &input.dari, &input.sampai, &f)
}

#[tauri::command]
pub fn alat_sql(db: State<Db>, session: State<Session>, sql: String, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let mut conn = db.lock()?;
    let f = folder_aman(&conn, folder.as_deref())?;
    jalankan_sql(&mut conn, &sql, &f)
}
