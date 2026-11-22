//! Uji Verifikasi Admin: izin supervisor untuk Kasir, tanda izin sekali pakai, dan harga jual dari margin.

use crate::auth::{self, User};
use crate::db;
use crate::izin::{self, Brankas, BERLAKU, TANDA};
use crate::trans::{self, Item, TransInput};
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::time::Instant;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-uji-izin-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,barcode,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,satuan1,konversi1,hrgmultisatuan1)
           VALUES ('A1','Sabun','899001','Barang','PCS',5000,6000,100,100,'BOX',12,60000);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",limitkredit) VALUES ('C1','Bu Rina','Level 1',50000);",
    )
    .unwrap();
    if conn.query_row("SELECT COUNT(*) FROM tseting", [], |r| r.get::<_, i64>(0)).unwrap() == 0 {
        conn.execute("INSERT INTO tseting (namausaha) VALUES ('Toko')", []).unwrap();
    }
    (conn, dir)
}

fn atur(c: &Connection, izinharga: i64, izindiskon: i64, izinstokmin: i64, konfirmasikredit: i64) {
    c.execute(
        "UPDATE tseting SET izinharga=?1, izindiskon=?2, izinstokmin=?3, konfirmasikredit=?4, aktifpromo=0",
        rusqlite::params![izinharga, izindiskon, izinstokmin, konfirmasikredit],
    )
    .unwrap();
}

fn user(level: &str) -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
}

fn item(sat: &str, konv: f64, jml: f64, harga: f64) -> Item {
    Item { kodebarang: "A1".into(), namabarang: "Sabun".into(), kodesatuan: "PCS".into(), satuanjual: sat.into(), konversi: konv, jmljual: jml, harga, disknilai: 0.0 }
}

fn input(items: Vec<Item>, bayar: f64) -> TransInput {
    TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: String::new(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items, diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: "Tunai".into(), jmlbayar: bayar,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    }
}

fn ditolak(r: Result<Value, String>, bagian: &str) {
    let err = r.unwrap_err();
    assert!(err.contains(bagian), "pesan harusnya memuat {bagian:?}, tetapi: {err}");
    assert!(!err.starts_with(TANDA), "tidak ada izin supervisor lagi: {err}");
}

fn jumlah_trans(c: &Connection) -> i64 {
    c.query_row("SELECT COUNT(*) FROM transaksi", [], |r| r.get(0)).unwrap()
}

#[test]
fn kasir_tanpa_izin_harga_ditolak_server() {
    let (mut c, _d) = setup();
    atur(&c, 0, 1, 1, 0);
    ditolak(trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("PCS", 1.0, 1.0, 5500.0)], 5500.0)), "Harga jual");
    assert_eq!(jumlah_trans(&c), 0, "tidak ada yang tersimpan");
    // Level lain bebas mengubah harga.
    assert_eq!(trans::penjualan(&mut c, &user("Supervisor"), &input(vec![item("PCS", 1.0, 1.0, 5500.0)], 5500.0)).unwrap()["total"], 5500.0);
    // Izin harga aktif: Kasir juga boleh.
    atur(&c, 1, 1, 1, 0);
    trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("PCS", 1.0, 1.0, 5000.0)], 5000.0)).unwrap();
}

#[test]
fn harga_resmi_lolos_untuk_kasir() {
    let (mut c, _d) = setup();
    atur(&c, 0, 0, 0, 0);
    // Harga satuan dasar dan harga multi satuan (BOX) adalah harga resmi.
    let r = trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("PCS", 1.0, 2.0, 6000.0), item("BOX", 12.0, 1.0, 60000.0)], 72000.0)).unwrap();
    assert_eq!(r["total"], 72000.0);
}

#[test]
fn diskon_ditolak_untuk_kasir_kalau_izin_diskon_mati() {
    let (mut c, _d) = setup();
    atur(&c, 1, 0, 1, 0);
    let mut inp = input(vec![item("PCS", 1.0, 2.0, 6000.0)], 12000.0);
    inp.diskonpersen = 10.0;
    ditolak(trans::penjualan(&mut c, &user("Kasir"), &inp), "Diskon");
    let mut inp = input(vec![item("PCS", 1.0, 2.0, 6000.0)], 12000.0);
    inp.diskonnilai = 1000.0;
    ditolak(trans::penjualan(&mut c, &user("Kasir"), &inp), "Diskon");
    // Diskon di baris barang juga dihitung.
    let mut inp = input(vec![item("PCS", 1.0, 2.0, 6000.0)], 12000.0);
    inp.items[0].disknilai = 500.0;
    ditolak(trans::penjualan(&mut c, &user("Kasir"), &inp), "Diskon");
    // Supervisor boleh memberi diskon; begitu juga Kasir kalau izin diskon aktif.
    inp.items[0].disknilai = 0.0;
    inp.diskonnilai = 1000.0;
    inp.jmlbayar = 11000.0;
    trans::penjualan(&mut c, &user("Supervisor"), &inp).unwrap();
    atur(&c, 1, 1, 1, 0);
    trans::penjualan(&mut c, &user("Kasir"), &inp).unwrap();
}

#[test]
fn stok_tidak_boleh_minus_untuk_semua_level_kalau_izin_stok_mati() {
    let (mut c, _d) = setup();
    atur(&c, 1, 1, 0, 0);
    // 9 BOX isi 12 = 108 > stok 100.
    for level in ["Kasir", "Supervisor", "Manager"] {
        ditolak(trans::penjualan(&mut c, &user(level), &input(vec![item("BOX", 12.0, 9.0, 60000.0)], 540000.0)), "Stok tidak mencukupi");
    }
    assert_eq!(jumlah_trans(&c), 0);
    trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("PCS", 1.0, 100.0, 6000.0)], 600000.0)).unwrap();
    // Izin stok aktif: tanpa batas.
    atur(&c, 1, 1, 1, 0);
    trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("PCS", 1.0, 5.0, 6000.0)], 30000.0)).unwrap();
}

fn kredit_besar() -> TransInput {
    let mut inp = input(vec![item("PCS", 1.0, 10.0, 6000.0)], 0.0);
    inp.kodepelanggan = "C1".into();
    inp.carabayar = "Kredit".into();
    inp.jthtempo = "2026-12-22".into();
    inp
}

#[test]
fn batas_kredit_terlampaui_tanya_ya_tidak_kalau_konfirmasi_aktif() {
    let (mut c, _d) = setup();
    atur(&c, 1, 1, 1, 1);
    let err = trans::penjualan(&mut c, &user("Kasir"), &kredit_besar()).unwrap_err();
    assert!(err.starts_with(trans::TANDA_KONFIRMASI) && err.contains("batas kredit maksimal") && err.contains("Apakah transaksi akan dilanjutkan?"), "{err}");
    assert_eq!(jumlah_trans(&c), 0);
    // Jawab Ya: lanjut tanpa izin supervisor.
    let mut ya = kredit_besar();
    ya.lanjutkredit = true;
    assert_eq!(trans::penjualan(&mut c, &user("Kasir"), &ya).unwrap()["total"], 60000.0);
}

#[test]
fn batas_kredit_terlampaui_dibatalkan_kalau_konfirmasi_mati() {
    let (mut c, _d) = setup();
    atur(&c, 1, 1, 1, 0);
    let mut ya = kredit_besar();
    ya.lanjutkredit = true;
    let err = trans::penjualan(&mut c, &user("Kasir"), &ya).unwrap_err();
    assert!(err.contains("batas kredit maksimal") && !err.starts_with(trans::TANDA_KONFIRMASI) && !err.starts_with(TANDA), "{err}");
    assert_eq!(jumlah_trans(&c), 0);
}

#[test]
fn piutang_untuk_pelanggan_tunai_ditolak_dengan_pesan_asli() {
    let (mut c, _d) = setup();
    atur(&c, 1, 1, 1, 0);
    let mut inp = kredit_besar();
    inp.kodepelanggan = String::new();
    ditolak(trans::penjualan(&mut c, &user("Kasir"), &inp), "Transaksi piutang tidak bisa dilakukan untuk pelanggan 'Tunai'");
}

#[test]
fn hapus_order_pending_kas_butuh_izin_untuk_kasir_dan_lainnya() {
    for level in ["Kasir", "Lainnya"] {
        let err = izin::periksa_hapus(&user(level), false).unwrap_err();
        assert!(err.starts_with(TANDA), "{level}: {err}");
        assert!(izin::periksa_hapus(&user(level), true).is_ok());
    }
    for level in ["Manager", "Supervisor"] {
        assert!(izin::periksa_hapus(&user(level), false).is_ok(), "{level} langsung boleh");
    }
}

#[test]
fn tanda_izin_sekali_pakai_dan_kedaluwarsa() {
    let b = Brankas::default();
    let t0 = Instant::now();
    let tanda = b.terbit_pada("kasir1", t0);
    assert!(b.sah_pada(&tanda, "kasir1", t0));
    assert!(!b.sah_pada(&tanda, "kasir2", t0), "tanda milik user lain tidak berlaku");
    assert!(!b.sah_pada("salah", "kasir1", t0));
    assert!(!b.sah_pada(&tanda, "kasir1", t0 + BERLAKU), "kedaluwarsa");
    b.pakai(&tanda);
    assert!(!b.sah_pada(&tanda, "kasir1", t0), "sudah terpakai");
    assert_ne!(b.terbit("kasir1"), b.terbit("kasir1"), "tiap tanda berbeda");
}

fn buat_user(c: &Connection, id: &str, level: &str, sandi: &str) {
    let aktor = user("Manager");
    let mut d = Map::new();
    d.insert("iduser".into(), json!(id));
    d.insert("level".into(), json!(level));
    d.insert("password".into(), json!(sandi));
    auth::simpan_user(c, &aktor, &d, true).unwrap();
}

/// Pesan error verifikasi (kosong kalau berhasil).
fn galat(c: &Connection, id: &str, sandi: &str) -> String {
    auth::verifikasi_pengelola(c, id, sandi).err().unwrap_or_default()
}

#[test]
fn verifikasi_hanya_untuk_pengelola_aktif_dengan_sandi_benar() {
    let (c, _d) = setup();
    buat_user(&c, "spv", "Supervisor", "rahasia1");
    buat_user(&c, "kas", "Kasir", "rahasia2");
    buat_user(&c, "off", "Manager", "rahasia3");
    c.execute("UPDATE mduser SET aktif = 0 WHERE iduser = 'off'", []).unwrap();

    assert_eq!(auth::verifikasi_pengelola(&c, "spv", "rahasia1").map(|u| u.level), Ok("Supervisor".to_string()));
    assert!(galat(&c, "spv", "salah").contains("salah"));
    assert!(galat(&c, "tidakada", "x").contains("salah"));
    assert!(galat(&c, "kas", "rahasia2").contains("Kasir"));
    c.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('lain', (SELECT pswduser FROM mduser WHERE iduser='spv'), '-', 'Lainnya', 1)", []).unwrap();
    assert!(galat(&c, "lain", "rahasia1").contains("Lainnya"), "level Lainnya tidak boleh memberi izin");
    assert!(galat(&c, "off", "rahasia3").contains("salah"), "akun nonaktif ditolak");
}

#[test]
fn pembelian_memperbarui_harga_jual_dari_margin() {
    let (mut c, _d) = setup();
    // Harga beli 5000 -> jual 6000 (margin 20%). Beli lagi di 6000 -> jual jadi 7200.
    let mut inp = input(vec![item("PCS", 1.0, 10.0, 6000.0)], 0.0);
    inp.update_hrgbeli = true;
    trans::pembelian_margin(&mut c, &user("Manager"), &inp).unwrap();
    let (beli, jual): (f64, f64) = c.query_row("SELECT hrgbeli, hrgjual FROM mdbarang WHERE kodebarang='A1'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((beli, jual), (6000.0, 7200.0));
    // Tanpa opsi, harga jual tidak berubah.
    let mut inp = input(vec![item("PCS", 1.0, 10.0, 8000.0)], 0.0);
    inp.update_hrgbeli = true;
    trans::pembelian(&mut c, &user("Manager"), &inp).unwrap();
    let jual: f64 = c.query_row("SELECT hrgjual FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(jual, 7200.0);
}

#[test]
fn cari_barang_kasir_tanpa_batas_stok_dan_scan_mengikuti_izin() {
    let (c, _d) = setup();
    c.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,barcode,jenis,kodesatuan,hrgjual,stokakhir,aktif) VALUES ('H1','Sabun habis','H-BC','Barang','PCS',1000,0,1);
         INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgjual,stokakhir,aktif) VALUES ('N1','Sabun lama','Barang','PCS',1000,5,0);
         INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgjual,aktif) VALUES ('J1','Sabun jasa','Jasa','KALI',1000,1);",
    ).unwrap();
    // Frasa dicocokkan ke kode atau nama saja, bukan barcode.
    assert!(trans::cari_barang_kasir(&c, "H-BC", 50).unwrap().is_empty());
    assert_eq!(trans::cari_barang_kasir(&c, "sabun habis", 50).unwrap().len(), 1, "frasa utuh, bukan kata per kata");
    let kodes = |c: &Connection| -> Vec<String> {
        let mut v: Vec<String> = trans::cari_barang_kasir(c, "sabun", 50).unwrap().iter().map(|r| r["kodebarang"].as_str().unwrap().to_string()).collect();
        v.sort();
        v
    };
    // Daftar Cari Barang tidak memakai batas stok maupun status aktif, sama dengan aslinya.
    c.execute("UPDATE tseting SET nonaktifstokhabis=1, tampilnonaktif=1, izinstokmin=0", []).unwrap();
    assert_eq!(kodes(&c), ["A1", "H1", "J1", "N1"], "stok habis dan nonaktif tetap tampil di daftar");
    // Scan kode/barcode tetap menolak barang stok habis bila izin stok minus mati.
    assert!(trans::cari_satu_kasir(&c, "H-BC").unwrap().is_none(), "scan barang stok habis tidak ketemu");
    assert!(trans::cari_satu_kasir(&c, "899001").unwrap().is_some());
    c.execute("UPDATE tseting SET izinstokmin=1", []).unwrap();
    assert!(trans::cari_satu_kasir(&c, "H-BC").unwrap().is_some());
}

#[test]
fn penjualan_dari_order_mengikuti_aturan_yang_sama() {
    let (mut c, _d) = setup();
    atur(&c, 0, 1, 1, 0);
    let so = crate::order::simpan_order(
        &mut c,
        &user("Manager"),
        &crate::order::OrderInput {
            jual: true, tgl: "2026-11-22".into(), kodepelanggan: "C1".into(), kodepemasok: String::new(), kodesales: String::new(),
            catatan: String::new(), dp: 0.0, items: vec![item("PCS", 1.0, 1.0, 6000.0)], notrans: None, kodekasir: String::new(),
        },
    )
    .unwrap();
    let no = so["notrans"].as_str().unwrap().to_string();
    let murah = input(vec![item("PCS", 1.0, 1.0, 5500.0)], 5500.0);
    ditolak(crate::order::penjualan_dari_order(&mut c, &user("Kasir"), &murah, &no), "Harga jual");
    crate::order::penjualan_dari_order(&mut c, &user("Supervisor"), &murah, &no).unwrap();
}
