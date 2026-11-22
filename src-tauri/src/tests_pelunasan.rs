//! Uji simpan Pelunasan Piutang / Hutang: urutan pembagian, kelebihan bayar, kasir pilihan, dan kas.

use crate::auth::User;
use crate::db;
use crate::pelunasan::{kartu_ke_json, pelunasan, Mode, PelunasanInput};
use crate::trans::{self, Item, TransInput};
use rusqlite::Connection;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-uji-lunas-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('A1','Sabun','Barang','PCS',5000,6000,1000,1000);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",limitkredit) VALUES ('C1','Bu Rina','Level 1',900000);
         INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E1','Uji');
         INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E2','Dewi');",
    )
    .unwrap();
    (conn, dir)
}

fn user(level: &str) -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
}

/// Penjualan kredit C1 senilai jml x 6000, jatuh tempo menurut urutan pemanggilan.
fn kredit(c: &mut Connection, jml: f64, tempo: &str) {
    let i = TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: "C1".into(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items: vec![Item { kodebarang: "A1".into(), namabarang: "A1".into(), kodesatuan: "PCS".into(), satuanjual: "PCS".into(), konversi: 1.0, jmljual: jml, harga: 6000.0, disknilai: 0.0 }],
        diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: "Kredit".into(), jmlbayar: 0.0,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: tempo.into(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    };
    trans::penjualan(c, &user("Manager"), &i).unwrap();
}

fn nominal(jml: f64) -> PelunasanInput {
    PelunasanInput { jenis: "Piutang".into(), kode: "C1".into(), tgl: "2026-11-23".into(), kodekaryawan: String::new(), mode: Mode::Nominal, nominal: jml, kartu: vec![] }
}

fn angka(c: &Connection, sql: &str) -> f64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Tiga kartu: PS-1 (10.000, jatuh tempo paling akhir), PS-2 (20.000), PS-3 (30.000, paling awal).
fn tiga_kartu() -> (Connection, std::path::PathBuf) {
    let (mut c, d) = setup();
    kredit(&mut c, 10.0 / 6.0, "2026-12-30");
    c.execute("UPDATE trkartupiutang SET jmlpiutang=10000, kekurangan=10000", []).unwrap();
    kredit(&mut c, 20.0 / 6.0, "2026-12-20");
    c.execute("UPDATE trkartupiutang SET jmlpiutang=20000, kekurangan=20000 WHERE jmlpiutang<>10000", []).unwrap();
    kredit(&mut c, 5.0, "2026-12-01");
    c.execute("UPDATE trkartupiutang SET jmlpiutang=30000, kekurangan=30000 WHERE jmlpiutang NOT IN (10000,20000)", []).unwrap();
    (c, d)
}

fn sisa(c: &Connection) -> Vec<f64> {
    let mut st = c.prepare("SELECT kekurangan FROM trkartupiutang ORDER BY nopiutang").unwrap();
    st.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
}

#[test]
fn nominal_dibagi_menurut_nomor_kartu_bukan_jatuh_tempo() {
    let (mut c, _d) = tiga_kartu();
    // Daftar di layar diurutkan menurut nomor kartu.
    let nomor: Vec<String> = kartu_ke_json(&c, "Piutang", "C1").unwrap().iter().map(|k| k["nopiutang"].as_str().unwrap().to_string()).collect();
    let mut urut = nomor.clone();
    urut.sort();
    assert_eq!(nomor, urut);
    // 25.000: kartu pertama lunas (10.000), kartu kedua terisi 15.000, kartu ketiga tidak tersentuh.
    let r = pelunasan(&mut c, &user("Manager"), &nominal(25000.0)).unwrap();
    assert_eq!(r["total"], 25000.0);
    assert_eq!(sisa(&c), vec![0.0, 5000.0, 30000.0]);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil"), 2.0);
    let status: Vec<i64> = {
        let mut st = c.prepare("SELECT status FROM trkartupiutang ORDER BY nopiutang").unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(|x| x.unwrap()).collect()
    };
    assert_eq!(status, vec![1, 0, 0]);
}

#[test]
fn kelebihan_bayar_tidak_dipakai_dan_kasir_pilihan_tercatat() {
    let (mut c, _d) = tiga_kartu();
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    let mut inp = nominal(999999.0);
    inp.kodekaryawan = "E2".into();
    let r = pelunasan(&mut c, &user("Manager"), &inp).unwrap();
    assert_eq!((r["total"].as_f64().unwrap(), r["kas"].as_f64().unwrap()), (60000.0, 60000.0));
    assert_eq!(sisa(&c), vec![0.0, 0.0, 0.0]);
    // Kasir pilihan tercatat di setiap pembayaran dan di kas, bukan user yang masuk.
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil WHERE kodekaryawan='E2' AND jmlbayar=total"), 3.0);
    let (kode, nama, noref, kat): (String, String, String, String) = c
        .query_row("SELECT kodekaryawan, namakaryawan, noreftrans, kategori FROM keuangan", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap();
    assert_eq!((kode.as_str(), nama.as_str(), noref.as_str(), kat.as_str()), ("E2", "Dewi", "", "Penjualan barang dagang"));
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 1.0, "satu baris kas untuk seluruh pelunasan");
    // Tanpa pilihan, kasirnya user yang masuk.
    kredit(&mut c, 1.0, "2026-12-01");
    pelunasan(&mut c, &user("Manager"), &nominal(6000.0)).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil WHERE kodekaryawan='E1'"), 1.0);
    // Kasir yang tidak ada ditolak.
    kredit(&mut c, 1.0, "2026-12-01");
    let mut salah = nominal(100.0);
    salah.kodekaryawan = "ZZ".into();
    assert!(pelunasan(&mut c, &user("Manager"), &salah).unwrap_err().contains("tidak ditemukan"));
}

#[test]
fn kas_hanya_ditulis_kalau_pengaturan_hubungkan_kas_aktif() {
    let (mut c, _d) = tiga_kartu();
    c.execute("UPDATE tseting SET aktiftranskas = 0", []).unwrap();
    let awal = angka(&c, "SELECT COUNT(*) FROM keuangan");
    pelunasan(&mut c, &user("Manager"), &nominal(5000.0)).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), awal);
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    pelunasan(&mut c, &user("Manager"), &nominal(5000.0)).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), awal + 1.0);
}

#[test]
fn per_transaksi_melunasi_kartu_yang_dicentang() {
    let (mut c, _d) = tiga_kartu();
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    let nomor: Vec<String> = kartu_ke_json(&c, "Piutang", "C1").unwrap().iter().map(|k| k["nopiutang"].as_str().unwrap().to_string()).collect();
    let mut inp = nominal(0.0);
    inp.mode = Mode::Transaksi;
    // Tidak ada yang dicentang: sama seperti jumlah masih kosong.
    assert_eq!(pelunasan(&mut c, &user("Manager"), &inp).unwrap_err(), "Jumlah pelunasan masih kosong");
    inp.kartu = vec![nomor[2].clone(), nomor[0].clone()];
    let r = pelunasan(&mut c, &user("Manager"), &inp).unwrap();
    assert_eq!(r["total"], 40000.0);
    assert_eq!(sisa(&c), vec![0.0, 20000.0, 0.0]);
    assert_eq!(angka(&c, "SELECT masuk FROM keuangan"), 40000.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutang WHERE status=1"), 2.0);
}
