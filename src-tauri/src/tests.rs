//! Uji alur transaksi terhadap database SQLite sementara.

use crate::auth::User;
use crate::db;
use crate::trans::{self, Item, OpnameItem, TransInput};
use rusqlite::Connection;

fn setup() -> (Connection, tempdir::Dir) {
    let dir = tempdir::Dir::new();
    let conn = db::open(&dir.0.join("t.db")).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    conn.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,barcode,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,satuan1,konversi1,hrgmultisatuan1)
           VALUES ('A1','Sabun','899001','Barang','PCS',5000,6000,100,100,'BOX',12,60000);
         INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual) VALUES ('J1','Ongkos kirim','Jasa','KALI',0,10000);
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",limitkredit) VALUES ('C1','Bu Rina','Level 1',50000);",
    )
    .unwrap();
    (conn, dir)
}

fn user(level: &str) -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
}

fn item(kode: &str, sat: &str, konv: f64, jml: f64, harga: f64) -> Item {
    Item { kodebarang: kode.into(), namabarang: kode.into(), kodesatuan: "PCS".into(), satuanjual: sat.into(), konversi: konv, jmljual: jml, harga, disknilai: 0.0 }
}

fn input(items: Vec<Item>, cara: &str, bayar: f64) -> TransInput {
    TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: String::new(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items, diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: cara.into(), jmlbayar: bayar,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    }
}

fn stok(c: &Connection, kode: &str) -> f64 {
    c.query_row("SELECT stokakhir FROM mdbarang WHERE kodebarang=?1", [kode], |r| r.get(0)).unwrap()
}

fn count(c: &Connection, sql: &str) -> i64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn penjualan_tunai_multi_satuan_dan_jasa() {
    let (mut c, _d) = setup();
    let r = trans::penjualan(&mut c, &user("Manager"), &input(
        vec![item("A1", "PCS", 1.0, 2.0, 6000.0), item("A1", "BOX", 12.0, 1.0, 60000.0), item("J1", "KALI", 1.0, 1.0, 10000.0)],
        "Tunai", 100000.0,
    )).unwrap();
    assert_eq!(r["notrans"], "TJ2611-00001");
    assert_eq!(r["total"], 82000.0);
    assert_eq!(r["kembali"], 18000.0);
    assert_eq!(stok(&c, "A1"), 86.0, "2 PCS + 1 BOX isi 12 = 14 keluar");
    let (masuk, saldo): (f64, f64) = c.query_row("SELECT masuk, saldo FROM keuangan", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((masuk, saldo), (82000.0, 82000.0));
    let nilai_beli: f64 = c.query_row("SELECT totalnilaibeli FROM transaksi", [], |r| r.get(0)).unwrap();
    assert_eq!(nilai_beli, 70000.0, "modal 14 x 5000, jasa tanpa modal");

    let r2 = trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("A1", "PCS", 1.0, 1.0, 6000.0)], "Tunai", 6000.0)).unwrap();
    assert_eq!(r2["notrans"], "TJ2611-00002");
    let saldo2: f64 = c.query_row("SELECT saldo FROM keuangan ORDER BY idkas DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(saldo2, 88000.0);
}

#[test]
fn bayar_kurang_tidak_menyimpan_apa_pun() {
    let (mut c, _d) = setup();
    let err = trans::penjualan(&mut c, &user("Kasir"), &input(vec![item("A1", "PCS", 1.0, 2.0, 6000.0)], "Tunai", 5000.0)).unwrap_err();
    assert!(err.contains("kurang"), "{err}");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi"), 0);
    assert_eq!(stok(&c, "A1"), 100.0);
}

#[test]
fn kredit_butuh_pelanggan_dan_menghormati_batas() {
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Kredit", 0.0);
    inp.jthtempo = "2026-12-22".into();
    assert!(trans::penjualan(&mut c, &user("Kasir"), &inp).unwrap_err().contains("pelanggan"));

    inp.kodepelanggan = "C1".into();
    inp.items = vec![item("A1", "PCS", 1.0, 10.0, 6000.0)]; // 60.000 > batas 50.000
    assert!(trans::penjualan(&mut c, &user("Kasir"), &inp).unwrap_err().contains("batas kredit"));

    inp.jmlbayar = 20000.0; // piutang 40.000, masih di bawah batas
    let r = trans::penjualan(&mut c, &user("Kasir"), &inp).unwrap();
    let (kurang, status): (f64, i64) = c.query_row("SELECT kekurangan, status FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((kurang, status), (40000.0, 0));
    let masuk: f64 = c.query_row("SELECT masuk FROM keuangan", [], |r| r.get(0)).unwrap();
    assert_eq!(masuk, 20000.0, "kas hanya menerima uang muka");
    assert_eq!(r["notrans"], "TJ2611-00001");
}

#[test]
fn pembelian_menambah_stok_dan_memperbarui_harga_beli() {
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "BOX", 12.0, 2.0, 54000.0)], "Tunai", 0.0);
    inp.update_hrgbeli = true;
    let r = trans::pembelian(&mut c, &user("Manager"), &inp).unwrap();
    assert_eq!(r["notrans"], "TB2611-00001");
    assert_eq!(stok(&c, "A1"), 124.0);
    let hb: f64 = c.query_row("SELECT hrgbeli FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(hb, 4500.0);
    let keluar: f64 = c.query_row("SELECT keluar FROM keuangan", [], |r| r.get(0)).unwrap();
    assert_eq!(keluar, 108000.0);
}

#[test]
fn opname_menyimpan_selisih() {
    let (mut c, _d) = setup();
    let r = trans::opname(&mut c, &user("Manager"), "2026-11-22", "", &[OpnameItem { kodebarang: "A1".into(), stokfisik: 97.0 }]).unwrap();
    assert_eq!(r["jumlah"], 1);
    assert_eq!(stok(&c, "A1"), 97.0);
    let op: f64 = c.query_row("SELECT stokopname FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(op, -3.0);
    assert!(trans::opname(&mut c, &user("Manager"), "2026-11-22", "", &[OpnameItem { kodebarang: "A1".into(), stokfisik: 97.0 }]).is_err());
}

fn map(v: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
    v.as_object().unwrap().clone()
}

#[test]
fn kelola_pengguna() {
    use crate::auth::{hapus_user, simpan_user};
    use serde_json::json;
    let (c, _d) = setup();
    c.execute("INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E9','Dewi')", []).unwrap();
    let pemilik = User { iduser: "bos".into(), ..user("Manager") };
    let spv = User { iduser: "spv".into(), ..user("Supervisor") };

    assert!(simpan_user(&c, &user("Kasir"), &map(json!({"iduser":"x","level":"Kasir"})), true).is_err(), "kasir tidak boleh");
    assert!(hapus_user(&c, &user("Kasir"), "x").is_err());

    // Pengguna baru tanpa password: belum ada hash, masuk dengan password sementara.
    simpan_user(&c, &pemilik, &map(json!({"iduser":"dewi","level":"Kasir","kodekaryawan":"E9"})), true).unwrap();
    let h: Option<String> = c.query_row("SELECT pswduser FROM mduser WHERE iduser='dewi'", [], |r| r.get(0)).unwrap();
    assert!(h.is_none());
    assert!(simpan_user(&c, &pemilik, &map(json!({"iduser":"dewi","level":"Kasir"})), true).unwrap_err().contains("sudah dipakai"));
    assert!(simpan_user(&c, &pemilik, &map(json!({"iduser":"a","level":"Raja"})), true).is_err(), "level tidak dikenal");
    assert!(simpan_user(&c, &pemilik, &map(json!({"iduser":"a","level":"Kasir","kodekaryawan":"E404"})), true).is_err(), "karyawan tidak ada");
    // Seperti aslinya, kata sandi tidak dibatasi panjang atau isinya.
    simpan_user(&c, &pemilik, &map(json!({"iduser":"a","level":"Kasir","password":"abc"})), true).unwrap();
    hapus_user(&c, &pemilik, "a").unwrap();

    // Ubah level dan isi password; password kosong berikutnya tidak menghapus hash.
    simpan_user(&c, &pemilik, &map(json!({"iduser":"dewi","level":"Supervisor","kodekaryawan":"E9","password":"rahasia1"})), false).unwrap();
    let h: String = c.query_row("SELECT pswduser FROM mduser WHERE iduser='dewi'", [], |r| r.get(0)).unwrap();
    assert!(h.starts_with("$argon2"), "{h}");
    simpan_user(&c, &pemilik, &map(json!({"iduser":"dewi","level":"Kasir","kodekaryawan":"E9","password":""})), false).unwrap();
    let h2: String = c.query_row("SELECT pswduser FROM mduser WHERE iduser='dewi'", [], |r| r.get(0)).unwrap();
    assert_eq!(h, h2);

    // Level lain dari combo aslinya: Direktur dan Lainnya.
    simpan_user(&c, &spv, &map(json!({"iduser":"dir","level":"Direktur"})), true).unwrap();
    simpan_user(&c, &spv, &map(json!({"iduser":"lain","level":"Lainnya"})), true).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM mduser WHERE level IN ('Direktur','Lainnya')"), 2);

    // Supervisor tidak boleh memberi atau mengubah level Manager.
    assert!(simpan_user(&c, &spv, &map(json!({"iduser":"b","level":"Manager"})), true).is_err());
    simpan_user(&c, &pemilik, &map(json!({"iduser":"bos2","level":"Manager"})), true).unwrap();
    assert!(simpan_user(&c, &spv, &map(json!({"iduser":"bos2","level":"Kasir"})), false).is_err());
    assert!(hapus_user(&c, &spv, "bos2").is_err());

    // Akun sendiri tidak bisa dihapus, diturunkan levelnya, atau diganti password lewat sini.
    simpan_user(&c, &pemilik, &map(json!({"iduser":"bos","level":"Manager"})), true).unwrap();
    assert!(hapus_user(&c, &pemilik, "bos").is_err());
    assert!(simpan_user(&c, &pemilik, &map(json!({"iduser":"bos","level":"Kasir"})), false).is_err());
    assert!(simpan_user(&c, &pemilik, &map(json!({"iduser":"bos","level":"Manager","password":"baru1234"})), false).is_err());

    c.execute("INSERT INTO mdusermenu (iduser,idmenu,akses) VALUES ('dewi','m1',1)", []).unwrap();
    hapus_user(&c, &pemilik, "dewi").unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM mduser WHERE iduser='dewi'"), 0);
    assert_eq!(count(&c, "SELECT COUNT(*) FROM mdusermenu WHERE iduser='dewi'"), 0);
    assert!(hapus_user(&c, &pemilik, "dewi").is_err(), "sudah tidak ada");
}

/// Folder sementara tanpa crate tambahan; dihapus saat selesai.
mod tempdir {
    pub struct Dir(pub std::path::PathBuf);
    impl Dir {
        pub fn new() -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static N: AtomicU32 = AtomicU32::new(0);
            let p = std::env::temp_dir().join(format!("tokopro-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
            std::fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[test]
fn laporan_cetak_menghitung_subtotal_dan_menyaring() {
    use crate::report::{lap_query, LapFilter};
    let (mut c, _d) = setup();
    let inp = input(vec![item("A1", "PCS", 1.0, 3.0, 6000.0)], "Tunai", 20000.0);
    trans::penjualan(&mut c, &user("Manager"), &inp).unwrap();
    // Data lama menyimpan SUBTOTAL = 0; laporan harus tetap menghitung dari jumlah x harga.
    c.execute("UPDATE transaksidetil SET subtotal = 0", []).unwrap();
    let f = LapFilter { dari: "2026-11-01".into(), sampai: "2026-11-30".into(), ..Default::default() };
    let r = lap_query(&c, "jual_detil", &f).unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0]["subtotal"], 18000.0);
    assert_eq!(r[0]["keuntungansubtotal"], 3000.0);
    let head = lap_query(&c, "jual_head", &f).unwrap();
    assert_eq!(head[0]["laba"], 3000.0);
    // Saring per kode barang dan per pelanggan yang tidak cocok.
    let f2 = LapFilter { kode: "ZZ".into(), ..LapFilter { dari: f.dari.clone(), sampai: f.sampai.clone(), ..Default::default() } };
    assert!(lap_query(&c, "jual_barang", &f2).unwrap().is_empty());
    let f3 = LapFilter { pelanggan: "C1".into(), dari: f.dari.clone(), sampai: f.sampai.clone(), ..Default::default() };
    assert!(lap_query(&c, "jual_head", &f3).unwrap().is_empty());
    assert!(lap_query(&c, "beli_detil", &f).unwrap().is_empty());
    assert!(lap_query(&c, "piutang", &f).unwrap().is_empty());
    assert!(lap_query(&c, "kas", &f).unwrap().len() == 1);
    assert!(lap_query(&c, "tidak_ada", &f).is_err());
}

fn kas_terakhir(c: &Connection) -> (String, f64, f64, String) {
    c.query_row("SELECT jenis, masuk, keluar, kategori FROM keuangan ORDER BY idkas DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap()
}

#[test]
fn retur_jual_menambah_stok_dan_mencatat_kas() {
    use crate::retur::{retur_transaksi, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    let r = trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Tunai", 30000.0)).unwrap();
    let asal = r["notrans"].as_str().unwrap().to_string();
    assert_eq!(stok(&c, "A1"), 95.0);
    let ri = |jml: f64| ReturInput { tgl: "2026-11-22".into(), asal: asal.clone(), catatan: String::new(), items: vec![ReturLine { nourut: 1, jml }], potong_piutang: true, kodekasir: String::new() };
    let hasil = retur_transaksi(&mut c, &user("Manager"), &ri(2.0), false).unwrap();
    assert_eq!(hasil["notrans"], "RJ2611-00001");
    assert_eq!(hasil["total"], 12000.0);
    assert_eq!(stok(&c, "A1"), 97.0, "2 PCS kembali ke stok");
    assert_eq!(kas_terakhir(&c), ("Keluar".into(), 0.0, 12000.0, "Retur penjualan".into()));
    let diretur: f64 = c.query_row("SELECT jmlretur FROM transaksidetil WHERE notrans=?1", [&asal], |r| r.get(0)).unwrap();
    assert_eq!(diretur, 2.0);
    assert!(retur_transaksi(&mut c, &user("Kasir"), &ri(1.0), false).is_ok(), "aslinya tidak memeriksa level");
}

#[test]
fn retur_jual_tidak_boleh_melebihi_penjualan() {
    use crate::retur::{retur_transaksi, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    let r = trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 3.0, 6000.0)], "Tunai", 18000.0)).unwrap();
    let asal = r["notrans"].as_str().unwrap().to_string();
    let ri = |jml: f64| ReturInput { tgl: "2026-11-22".into(), asal: asal.clone(), catatan: String::new(), items: vec![ReturLine { nourut: 1, jml }], potong_piutang: true, kodekasir: String::new() };
    retur_transaksi(&mut c, &user("Manager"), &ri(2.0), false).unwrap();
    let err = retur_transaksi(&mut c, &user("Manager"), &ri(2.0), false).unwrap_err();
    assert!(err.contains("melebihi"), "{err}");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi WHERE kode='RJ'"), 1, "retur yang ditolak tidak tersimpan");
    assert_eq!(stok(&c, "A1"), 99.0);
    retur_transaksi(&mut c, &user("Manager"), &ri(1.0), false).unwrap();
    assert_eq!(stok(&c, "A1"), 100.0);
}

#[test]
fn retur_jual_kredit_memotong_piutang_dulu() {
    use crate::retur::{retur_transaksi, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Kredit", 0.0);
    inp.kodepelanggan = "C1".into();
    inp.jthtempo = "2026-12-22".into();
    let asal = trans::penjualan(&mut c, &user("Manager"), &inp).unwrap()["notrans"].as_str().unwrap().to_string();
    let kas_sebelum = count(&c, "SELECT COUNT(*) FROM keuangan");
    let ri = ReturInput { tgl: "2026-11-22".into(), asal, catatan: String::new(), items: vec![ReturLine { nourut: 1, jml: 2.0 }], potong_piutang: true, kodekasir: String::new() };
    let h = retur_transaksi(&mut c, &user("Manager"), &ri, false).unwrap();
    assert_eq!((h["dipotong"].clone(), h["kas"].clone()), (12000.0.into(), 0.0.into()));
    let (kurang, bayar): (f64, f64) = c.query_row("SELECT kekurangan, jmlterbayar FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((kurang, bayar), (18000.0, 12000.0));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM keuangan"), kas_sebelum, "tidak ada uang keluar karena piutang yang dipotong");
}

#[test]
fn retur_beli_mengurangi_stok_dan_menjaga_batas() {
    use crate::retur::{retur_beli_barang, retur_transaksi, ReturBrgInput, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','Toko Maju')", []).unwrap();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 10.0, 5000.0)], "Tunai", 0.0);
    inp.kodepemasok = "S1".into();
    let asal = trans::pembelian(&mut c, &user("Manager"), &inp).unwrap()["notrans"].as_str().unwrap().to_string();
    assert_eq!(stok(&c, "A1"), 110.0);
    let ri = |jml: f64| ReturInput { tgl: "2026-11-22".into(), asal: asal.clone(), catatan: String::new(), items: vec![ReturLine { nourut: 1, jml }], potong_piutang: true, kodekasir: String::new() };
    let h = retur_transaksi(&mut c, &user("Manager"), &ri(4.0), true).unwrap();
    assert_eq!(h["notrans"], "RB2611-00001");
    assert_eq!(stok(&c, "A1"), 106.0);
    assert_eq!(kas_terakhir(&c), ("Masuk".into(), 20000.0, 0.0, "Retur pembelian".into()));
    // Seperti aslinya, retur pembelian tidak dibatasi stok maupun riwayat beli, dan tidak memotong hutang.
    let h2 = retur_transaksi(&mut c, &user("Manager"), &ri(7.0), true).unwrap();
    assert_eq!(h2["dipotong"], 0.0);
    assert_eq!(stok(&c, "A1"), 99.0);
    let (jenis, retur): (String, f64) = c
        .query_row("SELECT (SELECT jenis FROM transaksi WHERE notrans='RB2611-00001'), (SELECT jmlretur FROM transaksidetil WHERE notrans=?1)", [&asal], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((jenis.as_str(), retur), ("Sales Return", 11.0), "jenis dan JMLRETUR per kode barang seperti aslinya");
    let brg = |jml: f64, pemasok: &str| ReturBrgInput { tgl: "2026-11-22".into(), kodepemasok: pemasok.into(), catatan: String::new(), items: vec![item("A1", "PCS", 1.0, jml, 5000.0)], kodekasir: String::new() };
    let h3 = retur_beli_barang(&mut c, &user("Kasir"), &brg(6.0, "S1")).unwrap();
    assert_eq!(h3["total"], 30000.0);
    assert_eq!(stok(&c, "A1"), 93.0);
    assert!(retur_beli_barang(&mut c, &user("Manager"), &brg(1.0, "")).is_err(), "pemasok wajib");
}

#[test]
fn pelunasan_piutang_sebagian_lalu_lunas() {
    use crate::pelunasan::{pelunasan, Mode, PelunasanInput};
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Kredit", 10000.0);
    inp.kodepelanggan = "C1".into();
    inp.jthtempo = "2026-12-22".into();
    trans::penjualan(&mut c, &user("Manager"), &inp).unwrap();
    let pi = |jml: f64| PelunasanInput { jenis: "Piutang".into(), kode: "C1".into(), tgl: "2026-11-23".into(), kodekaryawan: String::new(), mode: Mode::Nominal, nominal: jml, kartu: vec![] };
    pelunasan(&mut c, &user("Manager"), &pi(5000.0)).unwrap();
    let (kurang, status): (f64, i64) = c.query_row("SELECT kekurangan, status FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((kurang, status), (15000.0, 0));
    assert_eq!(kas_terakhir(&c), ("Masuk".into(), 5000.0, 0.0, "Penjualan barang dagang".into()));
    let (noref, ket): (String, String) = c.query_row("SELECT noreftrans, keterangan FROM keuangan ORDER BY idkas DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((noref.as_str(), ket.as_str()), ("", "Pelunasan Piutang C1-Bu Rina"));
    assert_eq!(pelunasan(&mut c, &user("Manager"), &pi(0.0)).unwrap_err(), "Jumlah pelunasan masih kosong");
    // Kelebihan bayar tidak dipakai: hanya sisa tagihan yang dilunasi dan dicatat ke kas.
    pelunasan(&mut c, &user("Manager"), &pi(99999.0)).unwrap();
    let (kurang, terbayar, status): (f64, f64, i64) = c.query_row("SELECT kekurangan, jmlterbayar, status FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((kurang, terbayar, status), (0.0, 20000.0, 1));
    assert_eq!(kas_terakhir(&c), ("Masuk".into(), 15000.0, 0.0, "Penjualan barang dagang".into()));
    assert_eq!(count(&c, "SELECT COUNT(*) FROM trkartupiutangdetil"), 2);
    assert!(pelunasan(&mut c, &user("Manager"), &pi(1000.0)).unwrap_err().contains("Tidak ada tagihan"));
    assert!(pelunasan(&mut c, &user("Kasir"), &pi(1.0)).is_err(), "tidak ada tagihan lagi, tapi bukan karena level Kasir");
    assert!(!pelunasan(&mut c, &user("Kasir"), &pi(1.0)).unwrap_err().contains("kasir"));
}

#[test]
fn pelunasan_hutang_mengeluarkan_kas() {
    use crate::pelunasan::{pelunasan, Mode, PelunasanInput};
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    c.execute("INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','Toko Maju')", []).unwrap();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 10.0, 5000.0)], "Kredit", 0.0);
    inp.kodepemasok = "S1".into();
    inp.jthtempo = "2026-12-22".into();
    trans::pembelian(&mut c, &user("Manager"), &inp).unwrap();
    let no: String = c.query_row("SELECT nopiutang FROM trkartupiutang", [], |r| r.get(0)).unwrap();
    assert!(no.starts_with("HP"), "hutang pembelian memakai kode HP seperti aslinya");
    let salah = PelunasanInput { jenis: "Hutang".into(), kode: "S2".into(), tgl: "2026-11-23".into(), kodekaryawan: String::new(), mode: Mode::Transaksi, nominal: 0.0, kartu: vec![no.clone()] };
    assert!(pelunasan(&mut c, &user("Manager"), &salah).unwrap_err().contains("bukan milik"));
    let ok = PelunasanInput { kode: "S1".into(), ..salah };
    pelunasan(&mut c, &user("Manager"), &ok).unwrap();
    let status: i64 = c.query_row("SELECT status FROM trkartupiutang", [], |r| r.get(0)).unwrap();
    assert_eq!(status, 1);
    assert_eq!(kas_terakhir(&c), ("Keluar".into(), 0.0, 50000.0, "Harga pokok penjualan".into()));
    let ket: String = c.query_row("SELECT keterangan FROM keuangan ORDER BY idkas DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(ket, "Pelunasan Hutang S1-Toko Maju");
}

fn lf(dari: &str, sampai: &str) -> crate::report::LapFilter {
    crate::report::LapFilter { dari: dari.into(), sampai: sampai.into(), ..Default::default() }
}

#[test]
fn laporan_order_retur_dan_sales_memakai_kode_dan_subtotal_yang_benar() {
    use crate::report::{lap_query, LapFilter};
    let (mut c, _d) = setup();
    c.execute_batch(
        "INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('S1','Sari');
         INSERT INTO transaksi (tid,notrans,tglorder,kode,kodepelanggan,jmltrans,jmlbayar,status) VALUES (1,'SO2611-00001','2026-11-10','SO','C1',12000,5000,0);
         INSERT INTO transaksi (tid,notrans,tglorder,kode,kodepelanggan,jmltrans,status) VALUES (2,'SO2611-00002','2026-11-11','SO','C1',6000,1);
         INSERT INTO transaksi (tid,notrans,tglorder,kode,jmltrans,status) VALUES (3,'PO2611-00001','2026-11-12','PO',5000,0);
         INSERT INTO transaksi (tid,notrans,tgltrans,kode,kodepelanggan,jmltrans,totaltrans) VALUES (4,'RJ2611-00001','2026-11-13','RJ','C1',12000,0);
         INSERT INTO transaksi (tid,notrans,tgltrans,kode,jmltrans,totaltrans) VALUES (5,'RB2611-00001','2026-11-14','RB',5000,0);
         INSERT INTO transaksi (tid,notrans,tgltrans,kode,jmltrans,totaltrans) VALUES (6,'SA2611-00001','2026-11-01','SA',9999,9999);
         INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,satuanjual,jmljual,hrgterjual,subtotal) VALUES
           ('SO2611-00001','SO',1,'A1','Sabun','PCS',2,5000,'PCS',2,6000,0),
           ('SO2611-00002','SO',1,'A1','Sabun','PCS',1,5000,'PCS',1,6000,0),
           ('PO2611-00001','PO',1,'A1','Sabun','PCS',1,5000,'PCS',1,5000,0),
           ('RJ2611-00001','RJ',1,'A1','Sabun','PCS',2,5000,'PCS',2,6000,0),
           ('RB2611-00001','RB',1,'A1','Sabun','PCS',1,5000,'PCS',1,5000,0);",
    ).unwrap();
    c.execute("UPDATE transaksi SET kodesales='S1' WHERE notrans='SO2611-00001'", []).unwrap();
    let f = lf("2026-11-01", "2026-11-30");
    let so = lap_query(&c, "order_jual", &f).unwrap();
    // Seperti aslinya, hanya order yang belum diambil (status=0) yang ikut.
    assert_eq!(so.len(), 1);
    assert_eq!(so[0]["subtotal"], 12000.0, "subtotal dihitung dari jumlah x harga walau tersimpan 0");
    assert_eq!(so[0]["status"], 0);
    assert_eq!(so[0]["jmlbayar"], 5000.0);
    // Saring tanggal order dan pelanggan.
    assert!(lap_query(&c, "order_jual", &lf("2026-11-11", "2026-11-30")).unwrap().is_empty());
    assert!(lap_query(&c, "order_jual", &LapFilter { pelanggan: "ZZ".into(), ..lf("2026-11-01", "2026-11-30") }).unwrap().is_empty());
    let po = lap_query(&c, "order_beli", &f).unwrap();
    assert_eq!((po.len(), po[0]["notrans"].as_str().unwrap()), (1, "PO2611-00001"));
    let rj = lap_query(&c, "retur_jual", &f).unwrap();
    assert_eq!((rj.len(), rj[0]["subtotal"].as_f64().unwrap(), rj[0]["tgllap"].as_str().unwrap()), (1, 12000.0, "2026-11-13"));
    let rb = lap_query(&c, "retur_beli", &f).unwrap();
    assert_eq!((rb.len(), rb[0]["subtotal"].as_f64().unwrap()), (1, 5000.0));
    // Stok awal (SA) dan order tidak masuk laporan penjualan atau pembelian.
    assert!(lap_query(&c, "jual_head", &f).unwrap().is_empty());
    assert!(lap_query(&c, "beli_head", &f).unwrap().is_empty());
    // Penjualan per sales: hanya TJ.
    let mut inp = input(vec![item("A1", "PCS", 1.0, 1.0, 6000.0)], "Tunai", 6000.0);
    inp.kodesales = "S1".into();
    trans::penjualan(&mut c, &user("Manager"), &inp).unwrap();
    trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 2.0, 6000.0)], "Tunai", 12000.0)).unwrap();
    let all = lap_query(&c, "jual_sales", &lf("2026-11-01", "2026-11-30")).unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[1]["namasales"], "Sari", "yang tanpa sales di depan, lalu urut nama sales");
    let satu = lap_query(&c, "jual_sales", &LapFilter { sales: "S1".into(), ..lf("2026-11-01", "2026-11-30") }).unwrap();
    assert_eq!((satu.len(), satu[0]["totaltrans"].as_f64().unwrap()), (1, 6000.0));
}

#[test]
fn laporan_pelunasan_dipisah_piutang_dan_hutang() {
    use crate::report::{lap_query, LapFilter};
    let (c, _d) = setup();
    c.execute_batch(
        "INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E1','Uji');
         INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('P1','Toko Maju');
         INSERT INTO trkartupiutang (nopiutang,kode,kodepelanggan,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan) VALUES ('PS2611-00001','PS','C1','Piutang','TJ2611-00001','2026-12-01',30000,10000,20000);
         INSERT INTO trkartupiutang (nopiutang,kode,kodepemasok,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan) VALUES ('HP2611-00001','HP','P1','Hutang','TB2611-00001','2026-12-01',50000,50000,0);
         INSERT INTO trkartupiutangdetil (nopiutang,tglbayar,kodekaryawan,jmlbayar,total) VALUES
           ('PS2611-00001','2026-11-05','E1',4000,4000),('PS2611-00001','2026-11-20','E1',6000,6000),('HP2611-00001','2026-11-06','E1',50000,50000);",
    ).unwrap();
    // Seperti aslinya, tanggal yang disaring adalah jatuh tempo kartu.
    let f = lf("2026-12-01", "2026-12-31");
    let pi = lap_query(&c, "pelunasan_piutang", &f).unwrap();
    assert_eq!(pi.len(), 2);
    assert_eq!(pi[0]["namapelanggan"], "Bu Rina");
    assert_eq!(pi[0]["namakaryawan"], "Uji");
    assert_eq!(pi.iter().map(|r| r["jmlbayar"].as_f64().unwrap()).sum::<f64>(), 10000.0);
    let hu = lap_query(&c, "pelunasan_hutang", &f).unwrap();
    assert_eq!((hu.len(), hu[0]["namapemasok"].as_str().unwrap()), (1, "Toko Maju"));
    assert!(lap_query(&c, "pelunasan_piutang", &lf("2026-11-01", "2026-11-30")).unwrap().is_empty(), "disaring menurut jatuh tempo, bukan tanggal bayar");
    assert!(lap_query(&c, "pelunasan_piutang", &LapFilter { pelanggan: "ZZ".into(), ..f.clone_f() }).unwrap().is_empty());
    // Daftar hutang ikut mengenali kartu berdasarkan jenis.
    assert_eq!(lap_query(&c, "hutang", &lf("2026-12-01", "2026-12-31")).unwrap().len(), 1);
}

trait CloneF { fn clone_f(&self) -> crate::report::LapFilter; }
impl CloneF for crate::report::LapFilter {
    fn clone_f(&self) -> crate::report::LapFilter { lf(&self.dari, &self.sampai) }
}

#[test]
fn laporan_terlaris_omset_dan_opname() {
    use crate::report::{lap_query, LapFilter};
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('B2','Kopi','Barang','PCS',1000,40000,50,50)", []).unwrap();
    // A1: 10 PCS x 6.000 = 60.000; B2: 2 PCS x 40.000 = 80.000.
    trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 10.0, 6000.0), item("B2", "PCS", 1.0, 2.0, 40000.0)], "Tunai", 140000.0)).unwrap();
    c.execute("UPDATE transaksidetil SET subtotal = 0", []).unwrap();
    // Stok awal dan pembelian tidak ikut dihitung.
    c.execute("INSERT INTO transaksi (tid,notrans,tgltrans,kode) VALUES (99,'SA2611-00001','2026-11-22','SA')", []).unwrap();
    c.execute("INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,jmljual,hrgterjual) VALUES ('SA2611-00001','SA',1,'A1','Sabun','PCS',500,500,5000)", []).unwrap();
    let f = lf("2026-11-01", "2026-11-30");
    let t = lap_query(&c, "terlaris", &f).unwrap();
    assert_eq!(t.iter().map(|r| r["kodebarang"].as_str().unwrap()).collect::<Vec<_>>(), ["A1", "B2"]);
    assert_eq!(t[0]["jmltotal"], 10.0);
    let o = lap_query(&c, "omset", &f).unwrap();
    assert_eq!(o.iter().map(|r| r["kodebarang"].as_str().unwrap()).collect::<Vec<_>>(), ["B2", "A1"]);
    assert_eq!(o[0]["jmlomset"], 80000.0);
    assert_eq!(o[1]["jmlomset"], 60000.0);
    assert_eq!(lap_query(&c, "terlaris", &LapFilter { kode: "B2".into(), ..lf("2026-11-01", "2026-11-30") }).unwrap().len(), 1);
    assert!(lap_query(&c, "terlaris", &lf("2025-01-01", "2025-01-31")).unwrap().is_empty());
    // Stok opname: selisih per barang.
    trans::opname(&mut c, &user("Manager"), "2026-11-23", "Cek gudang", &[
        OpnameItem { kodebarang: "A1".into(), stokfisik: 85.0 },
        OpnameItem { kodebarang: "B2".into(), stokfisik: 51.0 },
    ]).unwrap();
    let op = lap_query(&c, "opname", &lf("2026-11-01", "2026-11-30")).unwrap();
    assert_eq!(op.len(), 2);
    let a1 = op.iter().find(|r| r["kodebarang"] == "A1").unwrap();
    let asal = a1["stokasal"].as_f64().unwrap();
    assert_eq!(a1["selisih"].as_f64().unwrap(), 85.0 - asal);
    assert_eq!(a1["nilai"].as_f64().unwrap(), (85.0 - asal) * 5000.0);
    let b2 = op.iter().find(|r| r["kodebarang"] == "B2").unwrap();
    assert_eq!(b2["selisih"], 3.0);
    assert_eq!(lap_query(&c, "opname", &LapFilter { kode: "B2".into(), ..lf("2026-11-01", "2026-11-30") }).unwrap().len(), 1);
}

#[test]
fn bayar_campuran_tunai_dan_non_tunai_dengan_nominal_sendiri() {
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Tunai", 10000.0);
    inp.bayarnontunai = 25000.0;
    // Jenis non tunai wajib dipilih bila ada nominal non tunai.
    assert!(trans::penjualan(&mut c, &user("Manager"), &inp).unwrap_err().contains("jenis"));
    inp.jenisnontunai = "Kartu Debit".into();
    inp.kartu = "BCA".into();
    let r = trans::penjualan(&mut c, &user("Manager"), &inp).unwrap();
    assert_eq!(r["total"], 30000.0);
    assert_eq!(r["kembali"], 5000.0, "tunai 10.000 + non tunai 25.000 - total 30.000");
    let (cara, tunai, lain, ket, sisa): (String, f64, f64, String, f64) = c
        .query_row("SELECT carabayar, jmlbayar, bayarlain1, ketbayarlain1, sisa FROM transaksi", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .unwrap();
    assert_eq!((cara.as_str(), tunai, lain, ket.as_str(), sisa), ("Tunai", 10000.0, 25000.0, "Kartu Debit", 5000.0));
    // Non tunai tidak boleh melebihi total.
    let mut lebih = input(vec![item("A1", "PCS", 1.0, 1.0, 6000.0)], "Tunai", 0.0);
    lebih.jenisnontunai = "Kartu Debit".into();
    lebih.bayarnontunai = 7000.0;
    assert!(trans::penjualan(&mut c, &user("Manager"), &lebih).unwrap_err().contains("melebihi"));
    // Campuran yang masih kurang tetap ditolak sebagai tunai.
    let mut kurang = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Tunai", 1000.0);
    kurang.jenisnontunai = "Kartu Debit".into();
    kurang.bayarnontunai = 10000.0;
    assert!(trans::penjualan(&mut c, &user("Manager"), &kurang).unwrap_err().contains("kurang"));
}

#[test]
fn bayar_campuran_kredit_menghitung_piutang_dari_semua_pembayaran() {
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 10.0, 6000.0)], "Kredit", 10000.0);
    inp.kodepelanggan = "C1".into();
    inp.jthtempo = "2026-12-22".into();
    inp.jenisnontunai = "E-Wallet".into();
    inp.bayarnontunai = 20000.0;
    trans::penjualan(&mut c, &user("Manager"), &inp).unwrap();
    let (piutang, kas): (f64, f64) = c
        .query_row("SELECT (SELECT jmlpiutang FROM trkartupiutang), (SELECT masuk FROM keuangan)", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((piutang, kas), (30000.0, 30000.0));
}

#[test]
fn total_tanpa_ppn_walau_pengaturan_ppn_aktif() {
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET aktifppn = 1, ppn = 11", []).unwrap();
    let r = trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 2.0, 6000.0)], "Tunai", 12000.0)).unwrap();
    assert_eq!(r["total"], 12000.0);
    let (ppn, nilai, total): (f64, f64, f64) = c.query_row("SELECT ppn, ppnnilai, totaltrans FROM transaksi", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((ppn, nilai, total), (0.0, 0.0, 12000.0));
}

#[test]
fn kas_transaksi_hanya_ditulis_kalau_hubungkan_kas_aktif() {
    use crate::retur::{retur_transaksi, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET aktiftranskas = 0", []).unwrap();
    let no = trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 2.0, 6000.0)], "Tunai", 12000.0)).unwrap()["notrans"].as_str().unwrap().to_string();
    let mut beli = input(vec![item("A1", "PCS", 1.0, 2.0, 5000.0)], "Tunai", 0.0);
    beli.kodepemasok = String::new();
    trans::pembelian(&mut c, &user("Manager"), &beli).unwrap();
    let ri = ReturInput { tgl: "2026-11-22".into(), asal: no, catatan: String::new(), items: vec![ReturLine { nourut: 1, jml: 1.0 }], potong_piutang: true, kodekasir: String::new() };
    retur_transaksi(&mut c, &user("Manager"), &ri, false).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM keuangan"), 0, "penjualan, pembelian, dan retur tidak menulis kas");
    assert_eq!(count(&c, "SELECT COUNT(*) FROM transaksi WHERE kode IN ('TJ','TB','RJ')"), 3);
    c.execute("UPDATE tseting SET aktiftranskas = 1", []).unwrap();
    trans::penjualan(&mut c, &user("Manager"), &input(vec![item("A1", "PCS", 1.0, 1.0, 6000.0)], "Tunai", 6000.0)).unwrap();
    assert_eq!(count(&c, "SELECT COUNT(*) FROM keuangan"), 1);
}

#[test]
fn updateharga_bit_1_harga_beli_dan_bit_2_harga_jual_memperbarui_margin() {
    let (mut c, _d) = setup();
    c.execute("UPDATE tseting SET updateharga = 1", []).unwrap();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 2.0, 6000.0)], "Tunai", 0.0);
    inp.hargajual = vec![trans::HargaJual { kodebarang: "A1".into(), hrgjual: 9000.0 }];
    trans::pembelian(&mut c, &user("Manager"), &inp).unwrap();
    let (beli, jual, mp, mn): (f64, f64, f64, f64) = c
        .query_row("SELECT hrgbeli, hrgjual, marginpersen, marginnilai FROM mdbarang WHERE kodebarang='A1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap();
    assert_eq!((beli, jual), (6000.0, 6000.0), "bit 1 hanya harga beli; harga jual master tetap");
    assert_eq!((mn, mp), (0.0, 0.0), "margin dihitung dari harga jual master - harga beli baru");
    c.execute("UPDATE tseting SET updateharga = 3", []).unwrap();
    trans::pembelian(&mut c, &user("Manager"), &inp).unwrap();
    let (jual, mp, mn): (f64, f64, f64) = c
        .query_row("SELECT hrgjual, marginpersen, marginnilai FROM mdbarang WHERE kodebarang='A1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap();
    assert_eq!((jual, mn, mp), (9000.0, 3000.0, 50.0), "bit 2: harga jual dari kolom Hrg. Jual, margin ikut");
    c.execute("UPDATE tseting SET updateharga = 0", []).unwrap();
    let mut lain = input(vec![item("A1", "PCS", 1.0, 1.0, 1000.0)], "Tunai", 0.0);
    lain.hargajual = vec![trans::HargaJual { kodebarang: "A1".into(), hrgjual: 1500.0 }];
    trans::pembelian(&mut c, &user("Manager"), &lain).unwrap();
    let beli: f64 = c.query_row("SELECT hrgbeli FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(beli, 6000.0, "pengaturan mati: master tidak berubah");
}

#[test]
fn hutang_pembelian_memakai_kode_hp_dan_kas_pembayaran_pembelian() {
    let (mut c, _d) = setup();
    c.execute("INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','Toko Maju')", []).unwrap();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 10.0, 5000.0)], "Kredit", 20000.0);
    inp.kodepemasok = "S1".into();
    inp.jthtempo = "2026-12-22".into();
    trans::pembelian(&mut c, &user("Kasir"), &inp).unwrap();
    let (no, kode, kurang): (String, String, f64) = c.query_row("SELECT nopiutang, kode, kekurangan FROM trkartupiutang", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert!(no.starts_with("HP2611-"));
    assert_eq!((kode.as_str(), kurang), ("HP", 30000.0));
    assert_eq!(kas_terakhir(&c), ("Keluar".into(), 0.0, 20000.0, "Harga pokok penjualan".into()));
    let ket: String = c.query_row("SELECT keterangan FROM keuangan", [], |r| r.get(0)).unwrap();
    assert_eq!(ket, "Pembayaran Pembelian");
}

#[test]
fn retur_jual_boleh_tidak_memotong_piutang() {
    use crate::retur::{retur_transaksi, ReturInput, ReturLine};
    let (mut c, _d) = setup();
    let mut inp = input(vec![item("A1", "PCS", 1.0, 5.0, 6000.0)], "Kredit", 0.0);
    inp.kodepelanggan = "C1".into();
    inp.jthtempo = "2026-12-22".into();
    let asal = trans::penjualan(&mut c, &user("Manager"), &inp).unwrap()["notrans"].as_str().unwrap().to_string();
    let ri = |potong: bool| ReturInput { tgl: "2026-11-22".into(), asal: asal.clone(), catatan: String::new(), items: vec![ReturLine { nourut: 1, jml: 1.0 }], potong_piutang: potong, kodekasir: "E9".into() };
    let h = retur_transaksi(&mut c, &user("Manager"), &ri(false), false).unwrap();
    assert_eq!((h["dipotong"].as_f64().unwrap(), h["kas"].as_f64().unwrap()), (0.0, 6000.0));
    let kurang: f64 = c.query_row("SELECT kekurangan FROM trkartupiutang", [], |r| r.get(0)).unwrap();
    assert_eq!(kurang, 30000.0);
    let kasir: String = c.query_row("SELECT kodekaryawan FROM transaksi WHERE kode='RJ'", [], |r| r.get(0)).unwrap();
    assert_eq!(kasir, "E9", "kasir pilihan layar dicatat");
    let h2 = retur_transaksi(&mut c, &user("Manager"), &ri(true), false).unwrap();
    assert_eq!(h2["dipotong"].as_f64().unwrap(), 6000.0);
}
