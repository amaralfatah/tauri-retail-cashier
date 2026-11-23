//! Inventori: stok awal (transaksi SA), data label barcode/price tag, dan katalog barang.

use crate::auth::{Session, User};
use crate::db::{e, round2, rows, Db, Res};
use crate::promo;
use crate::trans::{check_date, next_id, next_number};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use perintah_macro::perintah;

#[derive(Deserialize)]
pub struct StokAwalItem {
    pub kodebarang: String,
    pub stokawal: f64,
}

/// Catat stok awal seperti aslinya (FrmTransStokAwal.SimpanData): header `kode` "SA" dengan `jenis` "Sales Order"
/// (salinan dari form order di aslinya), lalu satu baris detail untuk setiap baris tabel. Tidak ada pemeriksaan level,
/// jasa, nilai minus, atau baris yang nilainya tidak berubah. Trigger `transaksidetil_insert` mengisi `mdbarang.stokawal`
/// dengan jumlah di baris SA lalu menghitung ulang STOKAKHIR = AWAL + MASUK - KELUAR + OPNAME.
pub fn stok_awal(conn: &mut Connection, user: &User, tgl: &str, catatan: &str, items: &[StokAwalItem]) -> Res<Value> {
    if items.is_empty() {
        return Err("Belum ada barang yang diisi. Silakan tambahkan barang dulu.".into());
    }
    check_date(tgl)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let notrans = next_number(&tx, "transaksi", "notrans", "SA", tgl)?;
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,catatan,tahun,bulan,tglupload,jamupload)
         VALUES (?1,?2,?3,'SA','Sales Order',?4,?5,?6,?7,date('now','localtime'),time('now','localtime'))",
        params![next_id(&tx, "transaksi", "tid")?, notrans, tgl, user.kodekaryawan, catatan, &tgl[0..4], &tgl[5..7]],
    )
    .map_err(e)?;
    let mut n = 0;
    let mut total = 0.0;
    for it in items {
        let (nama, satuan, lama, hrgbeli): (String, String, f64, f64) = tx
            .query_row(
                "SELECT COALESCE(namabarang,''), COALESCE(kodesatuan,''), COALESCE(stokawal,0), COALESCE(hrgbeli,0) FROM mdbarang WHERE kodebarang = ?1",
                params![it.kodebarang],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|_| format!("Barang {} tidak ditemukan.", it.kodebarang))?;
        n += 1;
        let sub = round2(it.stokawal * hrgbeli);
        total += sub;
        tx.execute(
            "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,satuanjual,jmljual,konversi,stokasal,subtotal)
             VALUES (?1,'SA',?2,?3,?4,?5,?6,?7,?5,?6,1,?8,?9)",
            params![notrans, n, it.kodebarang, nama, satuan, it.stokawal, hrgbeli, lama, sub],
        )
        .map_err(e)?;
    }
    tx.execute("UPDATE transaksi SET jmltrans=?1, totaltrans=?1 WHERE notrans=?2", params![round2(total), notrans]).map_err(e)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "jumlah": n }))
}

/// Kasir yang dipilih lewat tombol Cari Kasir menjadi pencatat di header (kodekaryawan); kosong berarti user yang masuk.
fn dengan_kasir(user: &User, kodekasir: Option<String>) -> User {
    let mut u = user.clone();
    if let Some(k) = kodekasir.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) { u.kodekaryawan = k; }
    u
}

#[perintah]
pub fn save_stok_awal(db: &Db, session: &Session, tgl: String, catatan: String, items: Vec<StokAwalItem>, kodekasir: Option<String>) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnInvStokAwal")?;
    stok_awal(&mut conn, &dengan_kasir(&user, kodekasir), &tgl, &catatan, &items)
}

#[derive(Deserialize)]
pub struct OpnameBaris {
    pub kodebarang: String,
    /// Stok Buku seperti yang tampil di tabel saat barang dimasukkan.
    pub stokbuku: f64,
    pub stokfisik: f64,
}

/// Catat stok opname seperti aslinya (FrmTransStokOpname.SimpanData): header `kode` "OP" dengan `jenis` "Stok Opname",
/// detail hanya untuk baris yang Selisih Stok-nya tidak nol (`jml` = selisih, `stokasal` = stok buku). Tidak ada pemeriksaan level,
/// jasa, atau baris ganda. Trigger menambahkan `jml` ke `mdbarang.stokopname` lalu menghitung ulang stok akhir.
pub fn opname(conn: &mut Connection, user: &User, tgl: &str, catatan: &str, items: &[OpnameBaris]) -> Res<Value> {
    check_date(tgl)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let notrans = next_number(&tx, "transaksi", "notrans", "OP", tgl)?;
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,catatan,tahun,bulan,tglupload,jamupload)
         VALUES (?1,?2,?3,'OP','Stok Opname',?4,?5,?6,?7,date('now','localtime'),time('now','localtime'))",
        params![next_id(&tx, "transaksi", "tid")?, notrans, tgl, user.kodekaryawan, catatan, &tgl[0..4], &tgl[5..7]],
    )
    .map_err(e)?;
    let mut n = 0;
    for it in items {
        let selisih = round2(it.stokfisik - it.stokbuku);
        if selisih == 0.0 {
            continue;
        }
        let (nama, satuan, hrgbeli): (String, String, f64) = tx
            .query_row(
                "SELECT COALESCE(namabarang,''), COALESCE(kodesatuan,''), COALESCE(hrgbeli,0) FROM mdbarang WHERE kodebarang = ?1",
                params![it.kodebarang],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| format!("Barang {} tidak ditemukan.", it.kodebarang))?;
        n += 1;
        tx.execute(
            "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,satuanjual,jmljual,konversi,stokasal,subtotal)
             VALUES (?1,'OP',?2,?3,?4,?5,?6,?7,?5,?6,1,?8,?9)",
            params![notrans, n, it.kodebarang, nama, satuan, selisih, hrgbeli, it.stokbuku, round2(selisih * hrgbeli)],
        )
        .map_err(e)?;
    }
    if n == 0 {
        return Err("Semua stok fisik sama dengan stok buku, jadi tidak ada yang perlu disimpan.".into());
    }
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "jumlah": n }))
}

#[perintah]
pub fn save_opname_stok(db: &Db, session: &Session, tgl: String, catatan: String, items: Vec<OpnameBaris>, kodekasir: Option<String>) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnInvStokOpname")?;
    opname(&mut conn, &dengan_kasir(&user, kodekasir), &tgl, &catatan, &items)
}

/// Cari satu barang untuk tabel cetak label: kode atau barcode persis, tanpa syarat aktif dan tanpa barcode2 (seperti query aslinya).
pub fn label_find(conn: &Connection, code: &str) -> Res<Option<Value>> {
    let k = code.trim().to_uppercase();
    Ok(rows(
        conn,
        "SELECT kodebarang, COALESCE(barcode,'') AS barcode, COALESCE(namabarang,'') AS namabarang, COALESCE(hrgjual,0) AS hrgjual, COALESCE(stokakhir,0) AS stokakhir
         FROM mdbarang WHERE kodebarang <> '' AND (UPPER(kodebarang) = ?1 OR UPPER(COALESCE(barcode,'')) = ?1) ORDER BY kodebarang LIMIT 1",
        params![k],
    )?
    .into_iter()
    .next())
}

#[perintah]
pub fn label_barang_find(db: &Db, code: String) -> Res<Option<Value>> {
    label_find(&*db.lock()?, &code)
}

/// Data label: harga jual, harga promo, dan keterangan promo yang berlaku pada `tgl`.
pub fn label_data(conn: &Connection, kodes: &[String], tgl: &str) -> Res<Vec<Value>> {
    let mut out = Vec::new();
    for k in kodes {
        let Some(mut b) = rows(conn, "SELECT kodebarang, COALESCE(barcode,'') AS barcode, COALESCE(namabarang,'') AS namabarang, COALESCE(hrgjual,0) AS hrgjual FROM mdbarang WHERE kodebarang = ?1", params![k])?
            .into_iter()
            .next()
        else {
            continue;
        };
        let (harga, ket) = promo::label_promo(conn, k, tgl)?;
        b["hrgpromo"] = json!(harga);
        b["ketpromo"] = json!(ket);
        out.push(b);
    }
    Ok(out)
}

#[perintah]
pub fn barang_label(db: &Db, kodes: Vec<String>, tgl: String) -> Res<Vec<Value>> {
    label_data(&*db.lock()?, &kodes, &tgl)
}

/// Daftar untuk Katalog Barang, dengan nama kelompok, kategori, dan pemasok. Seperti aslinya: semua barang termasuk
/// yang nonaktif, urut kode, tanpa batas jumlah baris.
pub fn katalog(conn: &Connection, search: &str) -> Res<Vec<Value>> {
    let s = format!("%{}%", search.trim().to_uppercase());
    rows(
        conn,
        "SELECT b.kodebarang, b.barcode, b.namabarang, b.jenis, b.kodekelompok, k.namakelompok, b.kodekategori, t.namakategori,
                b.kodepemasok, p.namapemasok, b.kodesatuan, b.hrgjual, b.stokakhir, b.rak, b.aktif
         FROM mdbarang b
         LEFT JOIN mdkelompok k ON k.kodekelompok = b.kodekelompok
         LEFT JOIN mdkategori t ON t.kodekategori = b.kodekategori
         LEFT JOIN mdpemasok p ON p.kodepemasok = b.kodepemasok
         WHERE b.kodebarang <> ''
           AND (UPPER(b.kodebarang) LIKE ?1 OR UPPER(COALESCE(b.barcode,'')) LIKE ?1 OR UPPER(COALESCE(b.namabarang,'')) LIKE ?1)
         ORDER BY b.kodebarang",
        params![s],
    )
}

#[perintah]
pub fn katalog_barang(db: &Db, search: Option<String>) -> Res<Vec<Value>> {
    katalog(&*db.lock()?, &search.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema.sql")).unwrap();
        c.execute_batch(
            "INSERT INTO tseting (namausaha, aktifpromo) VALUES ('Toko', 1);
             INSERT INTO mdkelompok VALUES ('K1','Sabun');
             INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('P1','PT Maju');
             INSERT INTO mdbarang (kodebarang,namabarang,barcode,jenis,kodekelompok,kodepemasok,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,rak)
               VALUES ('A1','Sabun Mandi','899001','Barang','K1','P1','PCS',5000,6000,100,100,'R1');
             INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgjual) VALUES ('J1','Ongkos kirim','Jasa','KALI',10000);
             INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,aktif) VALUES ('X1','Barang lama','Barang','PCS',0);",
        )
        .unwrap();
        c
    }

    fn user(level: &str) -> User {
        User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
    }

    fn si(k: &str, v: f64) -> StokAwalItem {
        StokAwalItem { kodebarang: k.into(), stokawal: v }
    }

    fn angka(c: &Connection, col: &str) -> f64 {
        c.query_row(&format!("SELECT {col} FROM mdbarang WHERE kodebarang='A1'"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn stok_awal_menjaga_rumus_stok_akhir() {
        let mut c = conn();
        // sudah ada transaksi: keluar 5, opname +2
        c.execute("UPDATE mdbarang SET stokkeluar = 5, stokopname = 2, stokakhir = 97 WHERE kodebarang='A1'", []).unwrap();
        let r = stok_awal(&mut c, &user("Manager"), "2026-11-22", "hitung ulang", &[si("A1", 120.0)]).unwrap();
        assert_eq!(r["notrans"], "SA2611-00001");
        assert_eq!(angka(&c, "stokawal"), 120.0);
        assert_eq!(angka(&c, "stokakhir"), 120.0 + angka(&c, "stokmasuk") - 5.0 + 2.0);
        assert_eq!(angka(&c, "stokakhir"), 117.0);
        let (kode, jenis, total): (String, String, f64) = c.query_row("SELECT kode, jenis, totaltrans FROM transaksi", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((kode.as_str(), jenis.as_str(), total), ("SA", "Sales Order", 600000.0));
        let asal: f64 = c.query_row("SELECT stokasal FROM transaksidetil", [], |r| r.get(0)).unwrap();
        assert_eq!(asal, 100.0);
        // nomor berikutnya naik
        let r2 = stok_awal(&mut c, &user("Manager"), "2026-11-22", "", &[si("A1", 10.0)]).unwrap();
        assert_eq!(r2["notrans"], "SA2611-00002");
        assert_eq!(angka(&c, "stokakhir"), 7.0);
    }

    #[test]
    fn stok_awal_tanpa_penolakan_seperti_aslinya() {
        let mut c = conn();
        // Kasir, jasa, nilai minus, baris tidak berubah, dan baris ganda semuanya diterima.
        let r = stok_awal(&mut c, &user("Kasir"), "2026-11-22", "", &[si("A1", 100.0), si("A1", 40.0), si("J1", 5.0), si("A1", -1.0)]).unwrap();
        assert_eq!(r["jumlah"], 4);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM transaksidetil", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 4);
        assert_eq!(angka(&c, "stokawal"), -1.0);
        assert!(stok_awal(&mut c, &user("Manager"), "salah", "", &[si("A1", 5.0)]).is_err());
        assert!(stok_awal(&mut c, &user("Manager"), "2026-11-22", "", &[]).is_err());
        assert!(stok_awal(&mut c, &user("Manager"), "2026-11-22", "", &[si("ZZ", 5.0)]).unwrap_err().contains("tidak ditemukan"));
        let t: i64 = c.query_row("SELECT COUNT(*) FROM transaksi", [], |r| r.get(0)).unwrap();
        assert_eq!(t, 1, "kegagalan tidak menyimpan sebagian");
    }

    fn ob(k: &str, buku: f64, fisik: f64) -> OpnameBaris {
        OpnameBaris { kodebarang: k.into(), stokbuku: buku, stokfisik: fisik }
    }

    #[test]
    fn opname_jenis_stok_opname_lewati_selisih_nol_tanpa_tolak_kasir() {
        let mut c = conn();
        let r = opname(&mut c, &user("Kasir"), "2026-11-22", "hitung", &[ob("A1", 100.0, 90.0), ob("J1", 0.0, 0.0), ob("A1", 100.0, 100.0), ob("A1", 100.0, 105.0)]).unwrap();
        assert_eq!(r["notrans"], "OP2611-00001");
        assert_eq!(r["jumlah"], 2);
        let jenis: String = c.query_row("SELECT jenis FROM transaksi", [], |r| r.get(0)).unwrap();
        assert_eq!(jenis, "Stok Opname");
        assert_eq!(angka(&c, "stokopname"), -5.0);
        assert_eq!(angka(&c, "stokakhir"), 95.0);
        let asal: f64 = c.query_row("SELECT stokasal FROM transaksidetil WHERE nourut=1", [], |r| r.get(0)).unwrap();
        assert_eq!(asal, 100.0);
        // jasa ikut tercatat bila selisihnya tidak nol, tanpa mengubah stok
        opname(&mut c, &user("Manager"), "2026-11-22", "", &[ob("J1", 0.0, 3.0)]).unwrap();
        // semua selisih nol: tidak ada yang disimpan
        assert!(opname(&mut c, &user("Manager"), "2026-11-22", "", &[ob("A1", 95.0, 95.0)]).unwrap_err().contains("sama"));
        let t: i64 = c.query_row("SELECT COUNT(*) FROM transaksi", [], |r| r.get(0)).unwrap();
        assert_eq!(t, 2);
    }

    #[test]
    fn data_label_dan_katalog() {
        let c = conn();
        let l = label_data(&c, &["A1".into(), "ZZ".into()], "2026-11-22").unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!((l[0]["hrgjual"].as_f64(), l[0]["hrgpromo"].as_f64()), (Some(6000.0), Some(0.0)));
        c.execute("INSERT INTO mdbarangdiskon (kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES ('A1','Sabun Mandi',6000,50,3000,'2026-11-01','2026-11-30')", []).unwrap();
        let l = label_data(&c, &["A1".into()], "2026-11-22").unwrap();
        assert_eq!(l[0]["hrgpromo"], 3000.0);
        assert_eq!(l[0]["ketpromo"], "Berlaku : 01/11/26 - 30/11/26");

        let k = katalog(&c, "sabun").unwrap();
        assert_eq!(k.len(), 1);
        assert_eq!((k[0]["namakelompok"].as_str(), k[0]["namapemasok"].as_str(), k[0]["rak"].as_str()), (Some("Sabun"), Some("PT Maju"), Some("R1")));
        assert_eq!(katalog(&c, "899001").unwrap().len(), 1);
        let semua = katalog(&c, "").unwrap();
        assert_eq!(semua.len(), 3, "barang nonaktif dan jasa ikut");
        assert_eq!(semua[0]["kodebarang"], "A1");
        assert_eq!(semua[2]["kodebarang"], "X1");

        // cari label: nonaktif ikut, barcode2 tidak
        c.execute("UPDATE mdbarang SET barcode2='B2X' WHERE kodebarang='A1'", []).unwrap();
        assert_eq!(label_find(&c, "x1").unwrap().unwrap()["kodebarang"], "X1");
        assert_eq!(label_find(&c, "899001").unwrap().unwrap()["kodebarang"], "A1");
        assert!(label_find(&c, "B2X").unwrap().is_none());
        // persis, bukan sebagian
        assert!(label_find(&c, "899").unwrap().is_none());
        assert!(label_find(&c, "TIDAKADA").unwrap().is_none());
    }
}
