//! Uji data Analytic Dashboard dan pemberitahuan piutang jatuh tempo.

use crate::db;
use crate::report::{dashboard_query, notifikasi_query};
use rusqlite::Connection;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-uji4-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('A1','Sabun','Barang','PCS',5000,6000,1000,1000);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan) VALUES ('TUNAI','Tunai'),('C1','Bu Rina'),('C2','Pak Budi');",
    )
    .unwrap();
    (conn, dir)
}

/// Satu nota penjualan: `jml` sabun @6000 (modal 5000).
fn jual(c: &Connection, tid: i64, tgl: &str, pel: &str, jml: f64) {
    let no = format!("TJ-{tid}");
    c.execute("INSERT INTO transaksi (tid,notrans,tgltrans,kode,kodepelanggan,totaltrans) VALUES (?1,?2,?3,'TJ',?4,?5)", rusqlite::params![tid, no, tgl, pel, jml * 6000.0]).unwrap();
    c.execute(
        "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,jmljual,hrgjual,hrgterjual,hrgbeli) VALUES (?1,'TJ',1,'A1','Sabun','PCS',?2,?2,6000,6000,5000)",
        rusqlite::params![no, jml],
    )
    .unwrap();
}

#[test]
fn dashboard_hitung_ringkasan_dan_grafik() {
    let (c, dir) = setup();
    // 2026-11-22 adalah hari Minggu.
    jual(&c, 1, "2026-11-22", "TUNAI", 10.0);
    jual(&c, 2, "2026-11-22", "C1", 5.0);
    jual(&c, 3, "2026-11-20", "C1", 20.0);
    jual(&c, 4, "2026-10-25", "C2", 30.0); // 28 hari lalu, hari Minggu
    jual(&c, 5, "2026-04-01", "C2", 99.0); // di luar semua rentang
    let d = dashboard_query(&c, "2026-11-22").unwrap();
    assert_eq!(d["hari_jual"], 90000.0);
    assert_eq!(d["hari_laba"], 15000.0);
    // 30 hari terakhir: 10+5+20+30 = 65 sabun, dibagi 30.
    assert_eq!(d["rata_jual"].as_f64().unwrap(), 65.0 * 6000.0 / 30.0);
    assert_eq!(d["rata_laba"].as_f64().unwrap(), 65.0 * 1000.0 / 30.0);
    // Grafik 1: tanpa hari ini, hanya hari yang ada datanya.
    let p15 = d["penjualan15"].as_array().unwrap();
    assert_eq!(p15.len(), 1);
    assert_eq!(p15[0]["tgl"], "2026-11-20");
    assert_eq!(p15[0]["total"], 120000.0);
    // Grafik 3: laba harian 31 hari tanpa hari ini: 20 Nov dan 25 Okt.
    let l = d["laba30"].as_array().unwrap();
    assert_eq!(l.len(), 2);
    assert_eq!((l[0]["tgl"].as_str().unwrap(), l[0]["total"].as_f64().unwrap()), ("2026-10-25", 30000.0));
    assert_eq!((l[1]["tgl"].as_str().unwrap(), l[1]["total"].as_f64().unwrap()), ("2026-11-20", 20000.0));
    // Grafik 2: per hari dalam minggu, tanpa hari ini.
    let ph = d["per_hari"].as_array().unwrap();
    assert_eq!(ph.len(), 7);
    assert_eq!(ph[0]["total"], 180000.0); // Minggu: hanya 25 Okt (22 Nov hari ini tidak dihitung)
    assert_eq!(ph[5]["total"], 120000.0); // Jumat 20 Nov
    // Grafik 4: laba bulanan 183 hari tanpa hari ini, hanya bulan yang ada datanya.
    let lb = d["laba_bulan"].as_array().unwrap();
    assert_eq!(lb.len(), 2, "{lb:?}");
    assert_eq!((lb[0]["bulan"].as_str().unwrap(), lb[0]["total"].as_f64().unwrap()), ("2026-10", 30000.0));
    assert_eq!((lb[1]["bulan"].as_str().unwrap(), lb[1]["total"].as_f64().unwrap()), ("2026-11", 20000.0));
    // Pelanggan terbanyak: Tunai tidak ikut dihitung, urut dari terbesar.
    let pel = d["pelanggan"].as_array().unwrap();
    assert_eq!(pel.len(), 2);
    assert_eq!(pel[0]["nama"], "Pak Budi");
    assert_eq!(pel[0]["total"], 180000.0);
    assert_eq!(pel[1]["nama"], "Bu Rina");
    assert_eq!(pel[1]["total"], 150000.0);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn laba_dashboard_memakai_harga_jual_master_dikurangi_harga_beli() {
    let (c, dir) = setup();
    jual(&c, 1, "2026-11-21", "C1", 10.0);
    // Diskon nota tidak mengurangi laba; baris bonus (hrgjual 0) justru mengurangi laba sebesar modalnya.
    c.execute("UPDATE transaksi SET diskonnilai = 20000 WHERE tid = 1", []).unwrap();
    c.execute(
        "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,jmljual,hrgjual,hrgterjual,hrgbeli) VALUES ('TJ-1','TJ',2,'A1','Sabun','PCS',2,2,0,0,5000)",
        [],
    )
    .unwrap();
    let d = dashboard_query(&c, "2026-11-22").unwrap();
    assert_eq!(d["laba30"][0]["total"], 10.0 * 1000.0 - 2.0 * 5000.0);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn dashboard_kosong_tidak_error() {
    let (c, dir) = setup();
    let d = dashboard_query(&c, "2026-11-22").unwrap();
    assert_eq!(d["hari_jual"], 0.0);
    assert!(d["penjualan15"].as_array().unwrap().is_empty());
    assert!(d["pelanggan"].as_array().unwrap().is_empty());
    assert!(d["piutang"].as_array().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn piutang_dan_notifikasi_jatuh_tempo() {
    let (c, dir) = setup();
    c.execute_batch(
        "INSERT INTO trkartupiutang (nopiutang,kode,kodepelanggan,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan,status) VALUES
           ('P1','PS','C1','Piutang','TJ-1','2026-11-20',100000,0,100000,0),
           ('P2','PS','C1','Piutang','TJ-2','2026-11-22',50000,0,50000,0),
           ('P3','PS','C2','Piutang','TJ-3','2026-12-01',70000,0,70000,0),
           ('P4','PS','C2','Piutang','TJ-4','2026-11-01',30000,30000,0,1),
           ('H1','PB',NULL,'Hutang','TB-1','2026-11-01',40000,0,40000,0);",
    )
    .unwrap();
    assert_eq!(notifikasi_query(&c, "2026-11-22").unwrap()["piutang_jatuh_tempo"], 2);
    assert_eq!(notifikasi_query(&c, "2026-11-19").unwrap()["piutang_jatuh_tempo"], 0);
    assert_eq!(notifikasi_query(&c, "2026-12-01").unwrap()["piutang_jatuh_tempo"], 3);
    let d = dashboard_query(&c, "2026-11-22").unwrap();
    let pi = d["piutang"].as_array().unwrap();
    assert_eq!(pi.len(), 2);
    assert_eq!(pi[0]["nama"], "Bu Rina");
    assert_eq!(pi[0]["piutang"], 150000.0);
    assert_eq!(pi[1]["piutang"], 70000.0);
    let _ = std::fs::remove_dir_all(dir);
}
