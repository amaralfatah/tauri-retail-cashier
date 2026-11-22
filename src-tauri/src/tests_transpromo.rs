//! Uji penjualan dengan promo (harga diskon, bonus, PDP) dan poin member.

use crate::auth::User;
use crate::db;
use crate::trans::{self, Item, TransInput};
use rusqlite::Connection;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-uji3-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,satuan1,konversi1,hrgmultisatuan1)
           VALUES ('A1','Sabun','Barang','PCS',5000,10000,100,100,'BOX',10,100000);
         INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('B1','Permen','Barang','PCS',100,200,50,50);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,poin) VALUES ('C1','Bu Rina',0);
         UPDATE tseting SET aktifpromo = 1, aktifpoin = 1, mintranspoin = 50000, jmlpointrans = 2, berlakukelipatanpoin = 1;",
    )
    .unwrap();
    // Instalasi baru belum punya baris pengaturan: pastikan ada.
    if conn.query_row("SELECT COUNT(*) FROM tseting", [], |r| r.get::<_, i64>(0)).unwrap() == 0 {
        conn.execute("INSERT INTO tseting (namausaha, aktifpromo, aktifpoin, mintranspoin, jmlpointrans, berlakukelipatanpoin) VALUES ('Toko',1,1,50000,2,1)", []).unwrap();
    }
    (conn, dir)
}

fn user() -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: "Manager".into(), must_change: false }
}

fn item(kode: &str, sat: &str, konv: f64, jml: f64, harga: f64) -> Item {
    Item { kodebarang: kode.into(), namabarang: kode.into(), kodesatuan: "PCS".into(), satuanjual: sat.into(), konversi: konv, jmljual: jml, harga, disknilai: 0.0 }
}

fn input(items: Vec<Item>, pelanggan: &str, bayar: f64) -> TransInput {
    TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: pelanggan.into(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items, diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: "Tunai".into(), jmlbayar: bayar,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    }
}

fn stok(c: &Connection, kode: &str) -> f64 {
    c.query_row("SELECT stokakhir FROM mdbarang WHERE kodebarang=?1", [kode], |r| r.get(0)).unwrap()
}

fn poin(c: &Connection) -> i64 {
    c.query_row("SELECT poin FROM mdpelanggan WHERE kodepelanggan='C1'", [], |r| r.get(0)).unwrap()
}

#[test]
fn harga_promo_dipakai_walau_layar_mengirim_harga_normal() {
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdbarangdiskon (kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES ('A1','Sabun',10000,20,8000,'2026-11-01','2026-11-30')", []).unwrap();
    // PCS: 8000, BOX isi 10: 80000 (lebih murah dari harga BOX 100000).
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 2.0, 10000.0), item("A1", "BOX", 10.0, 1.0, 100000.0)], "", 200000.0)).unwrap();
    assert_eq!(r["total"], 96000.0);
    let h: Vec<f64> = c.prepare("SELECT hrgterjual FROM transaksidetil ORDER BY nourut").unwrap().query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect();
    assert_eq!(h, [8000.0, 80000.0]);
    // Harga manual yang sudah lebih murah dari promo tidak dinaikkan.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 1.0, 7000.0)], "", 7000.0)).unwrap();
    assert_eq!(r["total"], 7000.0);
    // Promo di luar tanggal tidak berlaku.
    let mut inp = input(vec![item("A1", "PCS", 1.0, 1.0, 10000.0)], "", 10000.0);
    inp.tgl = "2026-12-05".into();
    assert_eq!(trans::penjualan(&mut c, &user(), &inp).unwrap()["total"], 10000.0);
}

#[test]
fn promo_mati_tidak_mengubah_harga() {
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET aktifpromo = 0", []).unwrap();
    c.execute("INSERT INTO mdbarangdiskon (kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES ('A1','Sabun',10000,20,8000,'2026-11-01','2026-11-30')", []).unwrap();
    c.execute("INSERT INTO mdbarangbonus (kodebarang,namabarang,minbeli,kodebonus,jmlbonus,tglawal,tglakhir) VALUES ('A1','Sabun',1,'B1',1,'2026-11-01','2026-11-30')", []).unwrap();
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 1.0, 10000.0)], "", 10000.0)).unwrap();
    assert_eq!(r["total"], 10000.0);
    assert_eq!(stok(&c, "B1"), 50.0);
}

#[test]
fn bonus_masuk_baris_harga_nol_dan_mengurangi_stok() {
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdbarangbonus (kodebarang,namabarang,minbeli,kodebonus,jmlbonus,tglawal,tglakhir) VALUES ('A1','Sabun',3,'B1',2,'2026-11-01','2026-11-30')", []).unwrap();
    // Beli 7 PCS: dua kelipatan 3 -> 4 permen.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 7.0, 10000.0)], "", 70000.0)).unwrap();
    assert_eq!(r["total"], 70000.0, "bonus tidak menambah tagihan");
    assert_eq!(r["bonus"], 1);
    assert_eq!(stok(&c, "A1"), 93.0);
    assert_eq!(stok(&c, "B1"), 46.0);
    let (jml, harga, sub, urut): (f64, f64, f64, i64) = c
        .query_row("SELECT jml, hrgterjual, subtotal, nourut FROM transaksidetil WHERE kodebarang='B1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap();
    assert_eq!((jml, harga, sub, urut), (4.0, 0.0, 0.0, 2));
    let (hrgjual, hrgbeli): (f64, f64) = c.query_row("SELECT hrgjual, hrgbeli FROM transaksidetil WHERE kodebarang='B1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((hrgjual, hrgbeli), (0.0, 100.0), "baris bonus: hrgjual 0, hrgbeli harga beli master");
    // Modal ikut menghitung barang bonus: 7 x 5000 + 4 x 100.
    let modal: f64 = c.query_row("SELECT totalnilaibeli FROM transaksi", [], |r| r.get(0)).unwrap();
    assert_eq!(modal, 35400.0);
    // Di bawah minimal beli: tidak ada bonus.
    trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 2.0, 10000.0)], "", 20000.0)).unwrap();
    assert_eq!(stok(&c, "B1"), 46.0);
}

#[test]
fn pdp_potong_harga_kalau_belanja_cukup() {
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdbarangpdp (minbelanja,kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES (100000,'B1','Permen',200,50,100,'2026-11-01','2026-11-30')", []).unwrap();
    // Belanja 20 x 200 + 10 x 10000 = 104000 (>= 100000): permen jadi 100, potongan 20 x 100.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("B1", "PCS", 1.0, 20.0, 200.0), item("A1", "PCS", 1.0, 10.0, 10000.0)], "", 200000.0)).unwrap();
    assert_eq!(r["total"], 102000.0);
    let d: f64 = c.query_row("SELECT disknilai FROM transaksidetil WHERE kodebarang='B1'", [], |r| r.get(0)).unwrap();
    assert_eq!(d, 2000.0);
    let (jml, tot): (f64, f64) = c.query_row("SELECT jmltrans, totaltrans FROM transaksi", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((jml, tot), (102000.0, 102000.0));
    // Belanja belum mencapai batas: tanpa potongan.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("B1", "PCS", 1.0, 20.0, 200.0), item("A1", "PCS", 1.0, 5.0, 10000.0)], "", 100000.0)).unwrap();
    assert_eq!(r["total"], 54000.0);
}

#[test]
fn poin_hanya_untuk_member_dan_berlaku_kelipatan() {
    let (mut c, _d) = setup();
    // Pelanggan Tunai: tidak dapat poin.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 20.0, 10000.0)], "", 200000.0)).unwrap();
    assert_eq!(r["poin"], 0);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM transaksipoin", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    // Member, belanja 130000 = 2 kelipatan 50000 -> 4 poin.
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 13.0, 10000.0)], "C1", 130000.0)).unwrap();
    assert_eq!(r["poin"], 4);
    assert_eq!(poin(&c), 4);
    let (masuk, ref_trans): (i64, String) = c.query_row("SELECT poinmasuk, reftukar FROM transaksipoin", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((masuk, ref_trans.as_str()), (4, r["notrans"].as_str().unwrap()));
    // Di bawah minimal belanja: tidak dapat poin.
    assert_eq!(trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 4.0, 10000.0)], "C1", 40000.0)).unwrap()["poin"], 0);
    assert_eq!(poin(&c), 4);
    // Total tepat sama dengan minimal belanja (50000): belum cukup, harus lebih besar.
    assert_eq!(trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 5.0, 10000.0)], "C1", 50000.0)).unwrap()["poin"], 0);
    assert_eq!(poin(&c), 4);
    // Kelipatan mati: poin sekali saja.
    c.execute("UPDATE tseting SET berlakukelipatanpoin = 0", []).unwrap();
    assert_eq!(trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 13.0, 10000.0)], "C1", 130000.0)).unwrap()["poin"], 2);
    assert_eq!(poin(&c), 6);
    // Poin mati: tidak ada tambahan.
    c.execute("UPDATE tseting SET aktifpoin = 0", []).unwrap();
    assert_eq!(trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 13.0, 10000.0)], "C1", 130000.0)).unwrap()["poin"], 0);
    assert_eq!(poin(&c), 6);
    // Poin tampil di data transaksi untuk struk.
    c.execute("UPDATE tseting SET aktifpoin = 1", []).unwrap();
    let r = trans::penjualan(&mut c, &user(), &input(vec![item("A1", "PCS", 1.0, 13.0, 10000.0)], "C1", 130000.0)).unwrap();
    assert_eq!(r["poin"], 2);
}
