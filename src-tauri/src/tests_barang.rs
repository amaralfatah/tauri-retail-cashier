//! Uji master barang: simpan, ganti kode, hapus (log del*.txt), dan Cari Barang mode stok minimum.

use crate::db;
use crate::master::{self, hapus_barang, simpan_master};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

fn setup() -> (Connection, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("tokopro-barang-{}-{:?}", std::process::id(), std::thread::current().id()).replace(['(', ')'], ""));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (db::open(&dir.join("t.db")).unwrap(), dir)
}

fn data(kode: &str, nama: &str) -> Map<String, Value> {
    let Value::Object(m) = json!({ "kodebarang": kode, "namabarang": nama, "kodesatuan": "PCS", "stokawal": 10, "stokmin": 5, "hrgbeli": 100, "hrgjual": 120 }) else { unreachable!() };
    m
}

fn n(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn kode_kembar_ditolak_dengan_pesan_asli() {
    let (mut c, _d) = setup();
    let t = master::table("mdbarang").unwrap();
    simpan_master(&mut c, t, &data("A1", "Sabun"), None).unwrap();
    let err = simpan_master(&mut c, t, &data("a1", "Lain"), None).unwrap_err();
    assert_eq!(err, "Kode barang sudah digunakan pada item barang lain, gunakan kode yang lain.");
}

#[test]
fn ganti_kode_barang_ikut_mengubah_referensi_transaksi() {
    let (mut c, _d) = setup();
    let t = master::table("mdbarang").unwrap();
    simpan_master(&mut c, t, &data("A1", "Sabun"), None).unwrap();
    simpan_master(&mut c, t, &data("B2", "Sampo"), None).unwrap();
    c.execute("INSERT INTO transaksidetil (kode, nourut, kodebarang) VALUES ('TJ', 1, 'A1')", []).unwrap();
    let mut d = data("A9", "Sabun baru");
    d.remove("stokawal");
    simpan_master(&mut c, t, &d, Some("A1")).unwrap();
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mdbarang WHERE kodebarang='A9' AND namabarang='Sabun baru'"), 1);
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mdbarang WHERE kodebarang='A1'"), 0);
    assert_eq!(n(&c, "SELECT COUNT(*) FROM transaksidetil WHERE kodebarang='A9'"), 1);
    assert_eq!(n(&c, "SELECT COUNT(*) FROM transaksidetil WHERE kodebarang='A1'"), 0);
    // kode milik barang lain tidak boleh dipakai
    let err = simpan_master(&mut c, t, &data("B2", "x"), Some("A9")).unwrap_err();
    assert!(err.starts_with("Kode barang sudah digunakan"));
    // menyimpan dengan kode yang sama tetap jalan
    simpan_master(&mut c, t, &data("A9", "Sabun lagi"), Some("A9")).unwrap();
}

#[test]
fn hapus_barang_langsung_dan_mencatat_log_di_samping_database() {
    let (mut c, dir) = setup();
    let t = master::table("mdbarang").unwrap();
    simpan_master(&mut c, t, &data("A1", "Sabun"), None).unwrap();
    c.execute("INSERT INTO transaksidetil (kode, nourut, kodebarang) VALUES ('TJ', 1, 'A1')", []).unwrap();
    hapus_barang(&c, "a1").unwrap();
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mdbarang"), 0, "tanpa pemeriksaan pemakaian, seperti aslinya");
    let log: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|f| f.ok()).map(|f| f.file_name().to_string_lossy().to_string())
        .filter(|f| f.starts_with("del") && f.ends_with(".txt")).collect();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].len(), "del26112210.txt".len());
    assert!(std::fs::read_to_string(dir.join(&log[0])).unwrap().contains("A1"));
}

#[test]
fn cari_barang_mode_stok_minimum() {
    let (mut c, _d) = setup();
    let t = master::table("mdbarang").unwrap();
    simpan_master(&mut c, t, &data("A1", "Sabun"), None).unwrap(); // stok 10 > min 5
    let mut d = data("B2", "Sampo");
    d.insert("stokawal".into(), json!(3));
    simpan_master(&mut c, t, &d, None).unwrap();
    assert_eq!(master::cari_barang_opsi(&c, "", 50, false).unwrap().len(), 2);
    let r = master::cari_barang_opsi(&c, "", 50, true).unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["kodebarang"], "B2");
}

#[test]
fn pelanggan_jatuh_tempo_hanya_piutang_penjualan_belum_lunas_sampai_hari_ini() {
    let (c, _d) = setup();
    c.execute_batch(
        "INSERT INTO mdpelanggan (kodepelanggan, namapelanggan) VALUES ('C001','Bu Rina'),('C002','Pak Budi'),('C003','Bu Tina');
         INSERT INTO trkartupiutang (nopiutang, kode, kodepelanggan, jthtempo, status) VALUES
           ('P1','PS','C001','2000-01-01',0),('P2','PS','C001','2000-02-01',0),('P3','PS','C002','2999-01-01',0),('P4','PS','C003','2000-01-01',1);",
    ).unwrap();
    let r = master::pelanggan_jatuh_tempo_daftar(&c, "").unwrap();
    assert_eq!(r.len(), 1, "satu baris per pelanggan, tanpa yang belum jatuh tempo atau sudah lunas");
    assert_eq!(r[0]["kodepelanggan"], "C001");
    assert!(master::pelanggan_jatuh_tempo_daftar(&c, "budi").unwrap().is_empty());
}
