//! Uji pembatalan retur dan pelunasan lewat Alat Bantu, impor Excel, dan cadangan otomatis.

use crate::auth::User;
use crate::retur::{retur_beli_barang, retur_transaksi, ReturBrgInput, ReturInput, ReturLine};
use crate::pelunasan::{pelunasan, Mode, PelunasanInput};
use crate::trans::{self, Item, TransInput};
use crate::{alat, database, db, impor};
use rusqlite::Connection;

struct Dir(std::path::PathBuf);
impl Dir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("tokopro-uji-batal-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&p).unwrap();
        Dir(p)
    }
}
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn setup() -> (Connection, Dir) {
    let dir = Dir::new();
    let conn = db::open(&dir.0.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('A1','Sabun','Barang','PCS',5000,6000,100,100);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",limitkredit) VALUES ('C1','Bu Rina','Level 1',500000);
         INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','CV Maju');
         INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E1','Uji');",
    ).unwrap();
    (conn, dir)
}

fn mgr() -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: "Manager".into(), must_change: false }
}

fn item(jml: f64, harga: f64) -> Item {
    Item { kodebarang: "A1".into(), namabarang: "A1".into(), kodesatuan: "PCS".into(), satuanjual: "PCS".into(), konversi: 1.0, jmljual: jml, harga, disknilai: 0.0 }
}

fn input(jml: f64, harga: f64, cara: &str, bayar: f64) -> TransInput {
    TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: String::new(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items: vec![item(jml, harga)], diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: cara.into(), jmlbayar: bayar,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    }
}

fn kredit(c: &mut Connection, jml: f64) -> String {
    let mut i = input(jml, 6000.0, "Kredit", 0.0);
    i.kodepelanggan = "C1".into();
    i.jthtempo = "2026-12-22".into();
    trans::penjualan(c, &mgr(), &i).unwrap()["notrans"].as_str().unwrap().to_string()
}

fn angka(c: &Connection, sql: &str) -> f64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn ri(asal: &str, jml: f64) -> ReturInput {
    ReturInput { tgl: "2026-11-22".into(), asal: asal.into(), catatan: String::new(), items: vec![ReturLine { nourut: 1, jml }], potong_piutang: true, kodekasir: String::new() }
}

fn hapus(c: &mut Connection, d: &Dir, kunci: &str) -> Result<serde_json::Value, String> {
    alat::hapus_transaksi(c, &[kunci.to_string()], &d.0.join("backup"))
}

/// Saldo kas harus sama dengan hasil hitung ulang dari awal.
fn saldo_konsisten(c: &Connection) {
    let berubah = crate::kas::hitung_ulang_saldo(c).unwrap();
    assert_eq!(berubah, 0, "saldo kas sudah dihitung ulang saat hapus");
}

#[test]
fn hapus_retur_jual_tunai_mengembalikan_stok_kas_dan_jumlah_retur() {
    let (mut c, d) = setup();
    let asal = trans::penjualan(&mut c, &mgr(), &input(5.0, 6000.0, "Tunai", 30000.0)).unwrap()["notrans"].as_str().unwrap().to_string();
    let kas_awal = angka(&c, "SELECT COUNT(*) FROM keuangan");
    let h = retur_transaksi(&mut c, &mgr(), &ri(&asal, 2.0), false).unwrap();
    let no = h["notrans"].as_str().unwrap().to_string();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 97.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), kas_awal + 1.0);

    // Penjualan asal tidak boleh dihapus selama masih ada returnya.
    assert!(hapus(&mut c, &d, &asal).unwrap_err().contains("diretur"));

    let r = hapus(&mut c, &d, &no).unwrap();
    assert_eq!(r["dihapus"], 1);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 95.0, "stok kembali seperti sebelum retur");
    assert_eq!(angka(&c, "SELECT stokmasuk FROM mdbarang WHERE kodebarang='A1'"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), kas_awal, "kas retur hilang");
    assert_eq!(angka(&c, &format!("SELECT jmlretur FROM transaksidetil WHERE notrans='{asal}'")), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi WHERE kode='RJ'"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksidetil WHERE kode='RJ'"), 0.0);
    saldo_konsisten(&c);
    // Sekarang penjualan asal boleh dihapus, dan retur bisa dibuat lagi dengan nomor yang sama.
    assert_eq!(retur_transaksi(&mut c, &mgr(), &ri(&asal, 1.0), false).unwrap()["notrans"], no);
}

#[test]
fn hapus_retur_jual_kredit_membuka_lagi_piutang() {
    let (mut c, d) = setup();
    let asal = kredit(&mut c, 5.0);
    let h = retur_transaksi(&mut c, &mgr(), &ri(&asal, 2.0), false).unwrap();
    let no = h["notrans"].as_str().unwrap().to_string();
    assert_eq!(angka(&c, "SELECT kekurangan FROM trkartupiutang"), 18000.0);
    hapus(&mut c, &d, &no).unwrap();
    assert_eq!(angka(&c, "SELECT kekurangan FROM trkartupiutang"), 30000.0);
    assert_eq!(angka(&c, "SELECT jmlterbayar FROM trkartupiutang"), 0.0);
    assert_eq!(angka(&c, "SELECT status FROM trkartupiutang"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil"), 0.0);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 95.0);
    // Retur yang melunasi seluruh piutang: status lunas pun kembali terbuka.
    let h2 = retur_transaksi(&mut c, &mgr(), &ri(&asal, 5.0), false).unwrap();
    assert_eq!(angka(&c, "SELECT status FROM trkartupiutang"), 1.0);
    hapus(&mut c, &d, h2["notrans"].as_str().unwrap()).unwrap();
    assert_eq!((angka(&c, "SELECT status FROM trkartupiutang"), angka(&c, "SELECT kekurangan FROM trkartupiutang")), (0.0, 30000.0));
}

#[test]
fn hapus_retur_beli_dan_retur_per_barang() {
    let (mut c, d) = setup();
    let mut i = input(10.0, 5000.0, "Tunai", 0.0);
    i.kodepemasok = "S1".into();
    let asal = trans::pembelian(&mut c, &mgr(), &i).unwrap()["notrans"].as_str().unwrap().to_string();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 110.0);
    let kas_awal = angka(&c, "SELECT COUNT(*) FROM keuangan");
    let h = retur_transaksi(&mut c, &mgr(), &ri(&asal, 4.0), true).unwrap();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 106.0);
    hapus(&mut c, &d, h["notrans"].as_str().unwrap()).unwrap();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 110.0);
    assert_eq!(angka(&c, "SELECT stokkeluar FROM mdbarang"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), kas_awal);
    assert_eq!(angka(&c, &format!("SELECT jmlretur FROM transaksidetil WHERE notrans='{asal}'")), 0.0);

    // Retur per barang (tanpa transaksi asal).
    let brg = ReturBrgInput { tgl: "2026-11-22".into(), kodepemasok: "S1".into(), catatan: String::new(), items: vec![item(3.0, 5000.0)], kodekasir: String::new() };
    let h2 = retur_beli_barang(&mut c, &mgr(), &brg).unwrap();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 107.0);
    hapus(&mut c, &d, h2["notrans"].as_str().unwrap()).unwrap();
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 110.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), kas_awal);
    saldo_konsisten(&c);
}

/// Bayar piutang C1 dengan jumlah tertentu (mode Sesuai Nominal Bayar). Hanya ada satu kartu terbuka di uji ini.
fn bayar_piutang(c: &mut Connection, jml: f64) {
    let pi = PelunasanInput {
        jenis: "Piutang".into(), kode: "C1".into(), tgl: "2026-11-22".into(), kodekaryawan: String::new(),
        mode: Mode::Nominal, nominal: jml, kartu: vec![],
    };
    pelunasan(c, &mgr(), &pi).unwrap();
}

#[test]
fn hapus_pelunasan_piutang_membuka_kartu_lagi() {
    let (mut c, d) = setup();
    kredit(&mut c, 5.0);
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    bayar_piutang(&mut c, 10000.0);
    bayar_piutang(&mut c, 20000.0);
    assert_eq!(angka(&c, "SELECT status FROM trkartupiutang"), 1.0);
    let kas_awal = angka(&c, "SELECT COUNT(*) FROM keuangan");

    // Pembayaran muncul di daftar, yang terbaru paling atas.
    let daftar = alat::daftar_transaksi(&c, "Pelunasan Piutang Customer", "", "", "").unwrap();
    assert_eq!(daftar.len(), 2);
    assert_eq!(daftar[0]["totaltrans"], 20000.0);
    assert_eq!(daftar[0]["namakontak"], "Bu Rina");
    assert!(alat::daftar_transaksi(&c, "Pelunasan Hutang Supplier", "", "", "").unwrap().is_empty());

    let kunci = daftar[0]["kunci"].as_str().unwrap().to_string();
    hapus(&mut c, &d, &kunci).unwrap();
    let (kurang, bayar, status): (f64, f64, f64) =
        c.query_row("SELECT kekurangan, jmlterbayar, status FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((kurang, bayar, status), (20000.0, 10000.0, 0.0));
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil"), 1.0);
    // Kas pelunasan itu (tanpa nomor referensi) ikut terhapus; kas pelunasan yang lain tetap.
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), kas_awal - 1.0);
    assert_eq!(angka(&c, "SELECT COALESCE(SUM(masuk),0) FROM keuangan WHERE kategori='Penjualan barang dagang'"), 10000.0);
    saldo_konsisten(&c);

    // Pelunasan yang sama bisa dibayar ulang, dan kunci yang sudah hilang ditolak.
    assert!(hapus(&mut c, &d, &kunci).unwrap_err().contains("tidak ditemukan"));
    bayar_piutang(&mut c, 20000.0);
    assert_eq!(angka(&c, "SELECT status FROM trkartupiutang"), 1.0);
}

#[test]
fn hapus_pelunasan_hutang_membuka_kartu_lagi() {
    let (mut c, d) = setup();
    let mut i = input(10.0, 5000.0, "Kredit", 0.0);
    i.kodepemasok = "S1".into();
    i.jthtempo = "2026-12-22".into();
    trans::pembelian(&mut c, &mgr(), &i).unwrap();
    let pi = PelunasanInput {
        jenis: "Hutang".into(), kode: "S1".into(), tgl: "2026-11-22".into(), kodekaryawan: String::new(),
        mode: Mode::Nominal, nominal: 15000.0, kartu: vec![],
    };
    pelunasan(&mut c, &mgr(), &pi).unwrap();
    let daftar = alat::daftar_transaksi(&c, "Pelunasan Hutang Supplier", "", "", "").unwrap();
    assert_eq!(daftar.len(), 1);
    hapus(&mut c, &d, daftar[0]["kunci"].as_str().unwrap()).unwrap();
    assert_eq!(angka(&c, "SELECT kekurangan FROM trkartupiutang"), 50000.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM trkartupiutangdetil"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan WHERE keterangan LIKE 'Pelunasan Hutang%'"), 0.0, "kas keluar pelunasan ikut terhapus");
    saldo_konsisten(&c);
}

#[test]
fn hapus_pelunasan_yang_mencakup_dua_kartu_mengurangi_kasnya() {
    let (mut c, d) = setup();
    kredit(&mut c, 1.0);
    kredit(&mut c, 2.0);
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    bayar_piutang(&mut c, 9000.0); // kartu 1 lunas (6.000) + 3.000 di kartu 2, satu baris kas 9.000
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 1.0);
    let daftar = alat::daftar_transaksi(&c, "Pelunasan Piutang Customer", "", "", "").unwrap();
    assert_eq!(daftar.len(), 2);
    // Hapus pembayaran 3.000: kas tinggal 6.000. Lalu hapus yang 6.000: baris kas hilang.
    let kecil = daftar.iter().find(|r| r["totaltrans"] == 3000.0).unwrap()["kunci"].as_str().unwrap().to_string();
    let besar = daftar.iter().find(|r| r["totaltrans"] == 6000.0).unwrap()["kunci"].as_str().unwrap().to_string();
    hapus(&mut c, &d, &kecil).unwrap();
    assert_eq!(angka(&c, "SELECT masuk FROM keuangan"), 6000.0);
    saldo_konsisten(&c);
    hapus(&mut c, &d, &besar).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 0.0);
    saldo_konsisten(&c);
}

#[test]
fn potongan_dari_retur_tidak_bisa_dihapus_sendiri() {
    let (mut c, d) = setup();
    let asal = kredit(&mut c, 5.0);
    retur_transaksi(&mut c, &mgr(), &ri(&asal, 2.0), false).unwrap();
    // Tidak tampil di daftar pelunasan.
    assert!(alat::daftar_transaksi(&c, "Pelunasan Piutang Customer", "", "", "").unwrap().is_empty());
    let xid: i64 = c.query_row("SELECT xid FROM trkartupiutangdetil", [], |r| r.get(0)).unwrap();
    let err = hapus(&mut c, &d, &format!("XID{xid}")).unwrap_err();
    assert!(err.contains("retur"), "{err}");
    assert_eq!(angka(&c, "SELECT kekurangan FROM trkartupiutang"), 18000.0, "gagal menghapus tidak mengubah apa pun");
    // Retur yang muncul di daftar Retur Penjualan.
    let r = alat::daftar_transaksi(&c, "Retur Penjualan", "", "", "").unwrap();
    assert_eq!((r.len(), r[0]["totaltrans"].clone()), (1, 12000.0.into()));
}

#[test]
fn hapus_transaksi_membuat_cadangan_dulu() {
    let (mut c, d) = setup();
    let asal = trans::penjualan(&mut c, &mgr(), &input(1.0, 6000.0, "Tunai", 6000.0)).unwrap()["notrans"].as_str().unwrap().to_string();
    let h = retur_transaksi(&mut c, &mgr(), &ri(&asal, 1.0), false).unwrap();
    let r = hapus(&mut c, &d, h["notrans"].as_str().unwrap()).unwrap();
    assert!(std::path::Path::new(r["cadangan"].as_str().unwrap()).is_file());
}

#[test]
fn impor_xlsx_membaca_sheet_pertama() {
    let (mut c, d) = setup();
    let f = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/barang.xlsx");
    let p = impor::pratinjau("barang", f.to_str().unwrap()).unwrap();
    assert_eq!(p["jumlah"], 2);
    assert!(p["wajib_hilang"].as_array().unwrap().is_empty());
    assert_eq!(p["baris"][0][1], "Teh Botol");
    let r = impor::impor(&mut c, "barang", f.to_str().unwrap(), false, &d.0.join("backup")).unwrap();
    assert_eq!(r["jumlah"], 2);
    let (nama, jual, stok): (String, f64, f64) =
        c.query_row("SELECT namabarang, hrgjual, stokakhir FROM mdbarang WHERE kodebarang='X2'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((nama.as_str(), jual, stok), ("Kecap & Manis", 12000.5, 3.0), "angka desimal dan angka berbentuk teks terbaca benar");
    assert_eq!(angka(&c, "SELECT hrgjual FROM mdbarang WHERE kodebarang='X1'"), 5500.0);
    // Kode yang sama ditolak seperti pada CSV.
    assert!(impor::impor(&mut c, "barang", f.to_str().unwrap(), false, &d.0.join("backup")).unwrap_err().contains("sudah ada"));
    // File rusak atau bukan Excel.
    let rusak = d.0.join("rusak.xlsx");
    std::fs::write(&rusak, "bukan excel").unwrap();
    assert!(impor::pratinjau("barang", rusak.to_str().unwrap()).unwrap_err().contains("tidak bisa dibaca"));
}

#[test]
fn cadangan_otomatis_menyimpan_hanya_yang_terbaru() {
    let (c, d) = setup();
    let folder = d.0.join("backup");
    std::fs::create_dir_all(&folder).unwrap();
    let manual = database::backup_ke(&c, &folder, "tokopro").unwrap();
    for _ in 0..5 {
        database::backup_otomatis_ke(&c, &folder, 3).unwrap();
    }
    let n = |awal: &str| {
        std::fs::read_dir(&folder).unwrap().flatten().filter(|f| f.file_name().to_string_lossy().starts_with(awal)).count()
    };
    assert_eq!(n("otomatis-"), 3);
    assert!(manual.is_file(), "cadangan manual tidak ikut terhapus");
    let terbaru = database::backup_otomatis_ke(&c, &folder, 3).unwrap();
    assert!(terbaru.is_file());
    assert_eq!(n("otomatis-"), 3);
}
