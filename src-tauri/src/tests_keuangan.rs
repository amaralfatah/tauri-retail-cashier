//! Uji kas, poin, database, alat bantu, impor CSV, dan jenis non tunai.

use crate::auth::User;
use crate::db;
use crate::trans::{self, Item, TransInput};
use crate::{alat, database, impor, kas, nontunai, poin};
use rusqlite::Connection;

struct Dir(std::path::PathBuf);
impl Dir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("tokopro-uji2-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
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
         INSERT INTO mdpelanggan (kodepelanggan,namapelanggan,\"level\",poin) VALUES ('C1','Bu Rina','Level 1',30);
         INSERT INTO mdpemasok (kodepemasok,namapemasok) VALUES ('S1','CV Maju');
         INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E1','Uji'),('E2','Dewi');",
    ).unwrap();
    (conn, dir)
}

fn user(level: &str) -> User {
    User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
}

fn jual(c: &mut Connection, jml: f64) -> String {
    let inp = TransInput {
        tgl: "2026-11-22".into(), kodepelanggan: String::new(), kodepemasok: String::new(), kodesales: String::new(), catatan: String::new(),
        items: vec![Item { kodebarang: "A1".into(), namabarang: "Sabun".into(), kodesatuan: "PCS".into(), satuanjual: "PCS".into(), konversi: 1.0, jmljual: jml, harga: 6000.0, disknilai: 0.0 }],
        diskonpersen: 0.0, diskonnilai: 0.0, biaya: 0.0, carabayar: "Tunai".into(), jmlbayar: jml * 6000.0,
        jenisnontunai: String::new(), kartu: String::new(), norefkartu: String::new(), jthtempo: String::new(), update_hrgbeli: false, lanjutkredit: false, bayarnontunai: 0.0, hargajual: vec![], kodekasir: String::new(),
    };
    trans::penjualan(c, &user("Manager"), &inp).unwrap()["notrans"].as_str().unwrap().to_string()
}

fn angka(c: &Connection, sql: &str) -> f64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn input_kas(jenis: &str, jumlah: f64, ket: &str) -> kas::KasInput {
    kas::KasInput {
        tgl: "2026-11-22".into(), noref: String::new(), jenis: jenis.into(), kategori: "Biaya operasional".into(), kodekaryawan: String::new(),
        kodepelanggan: String::new(), kodepemasok: String::new(),
        masuk: if jenis == "Masuk" || jenis == "Saldo Awal" { jumlah } else { 0.0 }, keluar: if jenis == "Keluar" { jumlah } else { 0.0 }, ket: ket.into(),
    }
}

#[test]
fn kas_manual_menghitung_saldo_dan_hapus() {
    let (mut c, _d) = setup();
    kas::simpan(&mut c, &user("Manager"), &input_kas("Masuk", 500000.0, "Modal awal")).unwrap();
    kas::simpan(&mut c, &user("Manager"), &input_kas("Keluar", 120000.0, "Listrik")).unwrap();
    let mut k3 = input_kas("Keluar", 30000.0, "Air");
    k3.kodekaryawan = "E2".into();
    k3.kodepemasok = "S1".into();
    kas::simpan(&mut c, &user("Manager"), &k3).unwrap();
    let (nama, kontak): (String, String) = c.query_row("SELECT namakaryawan, namakontak FROM keuangan WHERE keterangan='Air'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((nama.as_str(), kontak.as_str()), ("Dewi", "CV Maju"));
    let d = kas::daftar(&c, "", "").unwrap();
    assert_eq!(d["masuk"], 500000.0);
    assert_eq!(d["keluar"], 150000.0);
    assert_eq!(d["kas"], 350000.0);
    assert_eq!(angka(&c, "SELECT saldo FROM keuangan ORDER BY idkas DESC LIMIT 1"), 350000.0);

    // Hapus kas tengah: saldo sesudahnya dihitung ulang.
    let id2: i64 = c.query_row("SELECT idkas FROM keuangan WHERE keterangan='Listrik'", [], |r| r.get(0)).unwrap();
    kas::hapus(&mut c, id2).unwrap();
    assert_eq!(angka(&c, "SELECT saldo FROM keuangan ORDER BY idkas DESC LIMIT 1"), 470000.0);
    assert!(kas::hapus(&mut c, id2).is_err());
}

#[test]
fn kas_validasi_dan_hak_akses() {
    let (mut c, _d) = setup();
    // Kasir boleh mencatat kas seperti di aplikasi asli; aksesnya diatur lewat hak akses menu.
    assert!(kas::simpan(&mut c, &user("Kasir"), &input_kas("Masuk", 1000.0, "")).is_ok());
    // Aslinya tidak menolak jumlah nol maupun kategori kosong.
    assert!(kas::simpan(&mut c, &user("Manager"), &input_kas("Masuk", 0.0, "")).is_ok());
    let mut kosong = input_kas("Masuk", 500.0, "");
    kosong.kategori = String::new();
    assert!(kas::simpan(&mut c, &user("Manager"), &kosong).is_ok());
    let sa = kas::simpan(&mut c, &user("Manager"), &input_kas("Saldo Awal", 2000.0, "Modal")).unwrap();
    assert!(sa["idkas"].as_i64().unwrap() > 0);
    let (jenis, masuk): (String, f64) = c.query_row("SELECT jenis, masuk FROM keuangan WHERE keterangan='Modal'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((jenis.as_str(), masuk), ("Saldo Awal", 2000.0));
    let mut x = input_kas("Masuk", 1000.0, "");
    x.tgl = "salah".into();
    assert!(kas::simpan(&mut c, &user("Manager"), &x).is_err());
    let mut x = input_kas("Masuk", 1000.0, "");
    x.kodepelanggan = "ZZZ".into();
    assert!(kas::simpan(&mut c, &user("Manager"), &x).is_err());
    let mut x = input_kas("Lain", 1000.0, "");
    x.jenis = "Lain".into();
    assert!(kas::simpan(&mut c, &user("Manager"), &x).is_err());
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 4.0, "hanya catatan kas yang sah yang tersimpan");
    assert!(kas::KATEGORI.contains(&"Retur pembelian") && !kas::KATEGORI.contains(&"Saldo Awal"));
}

#[test]
fn semua_baris_kas_boleh_dihapus_termasuk_dari_transaksi() {
    let (mut c, _d) = setup();
    jual(&mut c, 2.0);
    let id: i64 = c.query_row("SELECT idkas FROM keuangan", [], |r| r.get(0)).unwrap();
    kas::hapus(&mut c, id).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 0.0);
    c.execute("INSERT INTO keuangan (idkas,nokas,kode,jenis,kategori,noreftrans,tglkas,masuk,keluar,saldo,keterangan) VALUES (99,'KS9','KS','Masuk','Penjualan barang dagang','','2026-11-22',5,0,5,'Pelunasan Piutang C1')", []).unwrap();
    kas::hapus(&mut c, 99).unwrap();
    assert!(kas::hapus(&mut c, 99).is_err(), "baris yang sudah hilang dilaporkan tidak ditemukan");
}

#[test]
fn rumus_poin_transaksi() {
    use poin::{poin_dari_transaksi as p, PoinSetting};
    let s = |aktif, min, jml, kel| PoinSetting { aktif, min_transaksi: min, jml_poin: jml, kelipatan: kel };
    assert_eq!(p(&s(false, 10000.0, 1.0, true), 50000.0), 0.0, "poin tidak aktif");
    assert_eq!(p(&s(true, 10000.0, 1.0, true), 9999.0), 0.0, "di bawah minimal");
    assert_eq!(p(&s(true, 10000.0, 1.0, true), 10000.0), 0.0, "tepat minimal belum cukup: harus lebih besar");
    assert_eq!(p(&s(true, 10000.0, 1.0, true), 10001.0), 1.0, "sedikit di atas minimal");
    assert_eq!(p(&s(true, 10000.0, 2.0, true), 35000.0), 6.0, "kelipatan: 3 x 2");
    assert_eq!(p(&s(true, 10000.0, 2.0, true), 39999.4), 6.0, "total dibulatkan dulu (39999), lalu dibagi bulat: 3 x 2");
    assert_eq!(p(&s(true, 10000.0, 2.0, true), 39999.6), 8.0, "total dibulatkan dulu (40000): 4 x 2");
    assert_eq!(p(&s(true, 10000.0, 2.0, false), 35000.0), 2.0, "tanpa kelipatan: sekali");
    assert_eq!(p(&s(true, 0.0, 1.0, true), 500.0), 0.0, "tanpa minimal: tidak dapat poin");
    assert_eq!(p(&s(true, 10000.0, 0.0, true), 50000.0), 0.0, "jumlah poin 0");
    let (c, _d) = setup();
    c.execute("UPDATE tseting SET aktifpoin=1, mintranspoin=25000, jmlpointrans=3, berlakukelipatanpoin=1", []).unwrap();
    assert_eq!(poin::PoinSetting::dari_db(&c), s(true, 25000.0, 3.0, true));
}

#[test]
fn poin_tukar_dan_koreksi() {
    let (mut c, _d) = setup();
    let m = user("Manager");
    assert!(poin::tukar(&mut c, &m, "C1", 31.0, "Hadiah").unwrap_err().contains("melebihi"));
    assert!(poin::tukar(&mut c, &m, "C1", 0.0, "").is_err());
    assert!(poin::tukar(&mut c, &m, "C1", 2.5, "").is_err());
    assert!(poin::tukar(&mut c, &m, "NONE", 1.0, "").unwrap_err().contains("tidak ditemukan"));
    let r = poin::tukar(&mut c, &m, "c1", 20.0, "Hadiah").unwrap();
    assert_eq!(r["poin"], 10);
    assert!(r["notukar"].as_str().unwrap().starts_with("P2"));
    assert_eq!(angka(&c, "SELECT poin FROM mdpelanggan WHERE kodepelanggan='C1'"), 10.0);

    assert!(poin::koreksi(&mut c, &user("Kasir"), "C1", 50.0).is_err());
    assert!(poin::koreksi(&mut c, &m, "C1", -1.0).is_err());
    assert!(poin::koreksi(&mut c, &m, "C1", 10.0).is_err(), "sama dengan poin saat ini");
    poin::koreksi(&mut c, &m, "C1", 50.0).unwrap();
    poin::koreksi(&mut c, &m, "C1", 5.0).unwrap();
    assert_eq!(angka(&c, "SELECT poin FROM mdpelanggan WHERE kodepelanggan='C1'"), 5.0);

    let h = poin::histori(&c, "C1", 20).unwrap();
    assert_eq!(h.len(), 3);
    // Terbaru di atas; sisa poin = awal + masuk - keluar.
    assert_eq!((h[0]["poinawal"].as_i64(), h[0]["poinkeluar"].as_i64(), h[0]["sisapoin"].as_i64()), (Some(50), Some(45), Some(5)));
    assert_eq!(h[0]["ket1"], "Koreksi Poin Member");
    assert_eq!((h[2]["poinawal"].as_i64(), h[2]["poinkeluar"].as_i64(), h[2]["ket1"].as_str()), (Some(30), Some(20), Some("Hadiah")));
    assert_eq!(poin::histori(&c, "C1", 2).unwrap().len(), 2);
}

#[test]
fn backup_membuat_database_utuh_dan_restore_mengganti_data() {
    let (mut c, d) = setup();
    jual(&mut c, 3.0);
    let folder = d.0.join("backup");
    let file = database::backup_ke(&c, &folder, "tokopro").unwrap();
    assert!(file.is_file());
    {
        let b = Connection::open(&file).unwrap();
        assert_eq!(angka(&b, "SELECT COUNT(*) FROM transaksi"), 1.0);
        assert!(database::periksa(&b, true).unwrap().is_empty());
    }
    assert_eq!(database::daftar_backup(&folder).len(), 1);

    // Data berubah setelah backup, lalu dipulihkan.
    jual(&mut c, 1.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 2.0);
    let aman = database::pulihkan(&mut c, &file, &folder).unwrap();
    assert!(aman.is_file(), "cadangan pengaman dibuat");
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 1.0);
    // Koneksi tetap bisa dipakai menulis.
    jual(&mut c, 1.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 2.0);
    // Cadangan pengaman berisi data sebelum restore (2 transaksi).
    let b = Connection::open(&aman).unwrap();
    assert_eq!(angka(&b, "SELECT COUNT(*) FROM transaksi"), 2.0);
}

#[test]
fn restore_menolak_file_yang_bukan_backup() {
    let (mut c, d) = setup();
    let folder = d.0.join("backup");
    assert!(database::pulihkan(&mut c, &d.0.join("tidak-ada.db"), &folder).unwrap_err().contains("tidak ditemukan"));
    let sampah = d.0.join("sampah.db");
    std::fs::write(&sampah, "bukan database sama sekali, hanya teks biasa yang panjang supaya lebih dari header").unwrap();
    assert!(database::pulihkan(&mut c, &sampah, &folder).is_err());
    let lain = d.0.join("lain.db");
    Connection::open(&lain).unwrap().execute_batch("CREATE TABLE x (a); INSERT INTO x VALUES (1);").unwrap();
    assert!(database::pulihkan(&mut c, &lain, &folder).unwrap_err().contains("bukan file backup"));
    let sendiri = std::path::PathBuf::from(c.path().unwrap());
    assert!(database::pulihkan(&mut c, &sendiri, &folder).is_err(), "tidak boleh memulihkan dari dirinya sendiri");
    // Data semula tidak tersentuh.
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mdbarang"), 1.0);
}

#[test]
fn perbaikan_dan_cek_database() {
    let (c, d) = setup();
    assert!(database::periksa(&c, false).unwrap().is_empty());
    let aman = database::perbaiki(&c, &d.0.join("backup")).unwrap();
    assert!(aman.is_file());
    assert!(database::hanya_manager(&user("Supervisor")).is_err());
    assert!(database::hanya_pengelola(&user("Kasir")).is_err());
}

#[test]
fn hitung_ulang_stok_dan_sinkron() {
    let (mut c, _d) = setup();
    jual(&mut c, 4.0);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 96.0);
    c.execute("UPDATE mdbarang SET stokakhir = 5, stokkeluar = 0", []).unwrap();
    assert_eq!(alat::hitung_ulang_stok(&c).unwrap(), 1);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 96.0);
    assert_eq!(angka(&c, "SELECT stokkeluar FROM mdbarang WHERE kodebarang='A1'"), 4.0);
    assert_eq!(alat::hitung_ulang_stok(&c).unwrap(), 0);

    // Harga beli kosong di baris penjualan diisi dari master; nilai beli di kepala ikut.
    c.execute("UPDATE transaksidetil SET hrgbeli = 0", []).unwrap();
    assert_eq!(alat::sinkron_harga_beli(&mut c).unwrap(), 1);
    assert_eq!(angka(&c, "SELECT hrgbeli FROM transaksidetil"), 5000.0);
    assert_eq!(angka(&c, "SELECT totalnilaibeli FROM transaksi"), 20000.0);

    // Transaksi tanpa baris barang dibersihkan bersama kasnya.
    c.execute("DELETE FROM transaksidetil", []).unwrap();
    assert_eq!(alat::sinkron_jual(&mut c).unwrap(), 1);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM keuangan"), 0.0);
}

#[test]
fn hapus_transaksi_mengembalikan_stok_dan_kas() {
    let (mut c, d) = setup();
    let a = jual(&mut c, 4.0);
    let b = jual(&mut c, 1.0);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 95.0);
    let folder = d.0.join("backup");
    let daftar = alat::daftar_transaksi(&c, "Penjualan", "", "2026-11-01", "2026-11-30").unwrap();
    assert_eq!(daftar.len(), 2);
    assert!(alat::daftar_transaksi(&c, "Retur", "", "", "").is_err());

    let r = alat::hapus_transaksi(&mut c, &[a.clone()], &folder).unwrap();
    assert_eq!(r["dihapus"], 1);
    assert!(std::path::Path::new(r["cadangan"].as_str().unwrap()).is_file());
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 99.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksidetil"), 1.0);
    assert_eq!(angka(&c, "SELECT saldo FROM keuangan"), 6000.0, "saldo kas dihitung ulang");

    // Transaksi yang pernah diretur tidak boleh dihapus, dan tidak ada yang berubah.
    c.execute("UPDATE transaksidetil SET jmlretur = 1 WHERE notrans = ?1", [&b]).unwrap();
    assert!(alat::hapus_transaksi(&mut c, &[b.clone()], &folder).unwrap_err().contains("diretur"));
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 99.0);
    assert!(alat::hapus_transaksi(&mut c, &[], &folder).is_err());
    assert!(alat::hapus_transaksi(&mut c, &["TJ0000-00001".into()], &folder).is_err());
}

#[test]
fn hapus_data_dengan_periode_dan_cadangan() {
    let (mut c, d) = setup();
    jual(&mut c, 2.0);
    c.execute("UPDATE transaksi SET tgltrans='2026-10-05'", []).unwrap();
    c.execute("UPDATE keuangan SET tglkas='2026-10-05'", []).unwrap();
    jual(&mut c, 3.0); // 2026-11-22
    let folder = d.0.join("backup");
    assert!(alat::hapus_data(&mut c, "u", &[], "", "", &folder).is_err());
    assert!(alat::hapus_data(&mut c, "u", &["xyz".into()], "", "", &folder).is_err());
    assert_eq!(std::fs::read_dir(&folder).map(|d| d.count()).unwrap_or(0), 0, "tidak ada cadangan kalau ditolak");

    let r = alat::hapus_data(&mut c, "u", &["jual".into(), "kas".into()], "2026-10-01", "2026-10-31", &folder).unwrap();
    assert_eq!(r["dihapus"]["jual"], 1);
    assert_eq!(r["dihapus"]["kas"], 1);
    assert!(std::path::Path::new(r["cadangan"].as_str().unwrap()).is_file());
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 1.0);
    assert_eq!(angka(&c, "SELECT stokakhir FROM mdbarang"), 97.0, "stok dihitung ulang dari transaksi yang tersisa");
    assert_eq!(angka(&c, "SELECT saldo FROM keuangan"), 18000.0);

    // Pengguna: admin dan akun yang sedang dipakai tetap ada.
    c.execute_batch("INSERT INTO mduser (iduser,level) VALUES ('u','Manager'),('lain','Kasir');").unwrap();
    alat::hapus_data(&mut c, "u", &["pengguna".into()], "", "", &folder).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mduser WHERE iduser IN ('admin','u')"), 2.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mduser WHERE iduser='lain'"), 0.0);

    alat::hapus_data(&mut c, "u", &["barang".into(), "jual".into()], "", "", &folder).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mdbarang"), 0.0);
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM transaksi"), 0.0);
}

#[test]
fn editor_sql_membaca_dan_menulis_dengan_cadangan() {
    let (mut c, d) = setup();
    let folder = d.0.join("backup");
    let r = alat::jalankan_sql(&mut c, "select kodebarang, hrgjual from mdbarang;", &folder).unwrap();
    assert_eq!(r["kolom"][0], "kodebarang");
    assert_eq!(r["baris"][0][1], 6000.0);
    assert!(r["cadangan"].is_null());
    let r = alat::jalankan_sql(&mut c, "update mdbarang set hrgjual = 7000", &folder).unwrap();
    assert!(std::path::Path::new(r["cadangan"].as_str().unwrap()).is_file());
    assert_eq!(angka(&c, "SELECT hrgjual FROM mdbarang"), 7000.0);
    assert!(alat::jalankan_sql(&mut c, "update tabel_tidak_ada set a=1", &folder).is_err());
    assert!(alat::jalankan_sql(&mut c, "  ", &folder).is_err());
    assert!(alat::jalankan_sql(&mut c, "attach database 'x.db' as x", &folder).is_err());
}

#[test]
fn csv_dibaca_dengan_pemisah_dan_kutip() {
    let t = impor::baca_csv("\u{feff}kodebarang;namabarang;hrgjual\r\nA1;\"Sabun; mandi\";\"1.500,50\"\r\n\r\nA2;\"Kecap \"\"Manis\"\"\";2000\r\n");
    assert_eq!(t.len(), 3);
    assert_eq!(t[1], vec!["A1", "Sabun; mandi", "1.500,50"]);
    assert_eq!(t[2][1], "Kecap \"Manis\"");
    assert_eq!(impor::baca_csv("a,b\n1,2")[1], vec!["1", "2"]);
    assert_eq!(impor::parse_angka("1.500,50"), Some(1500.5));
    assert_eq!(impor::parse_angka("1,500.50"), Some(1500.5));
    assert_eq!(impor::parse_angka("12.500"), Some(12500.0));
    assert_eq!(impor::parse_angka("12.5"), Some(12.5));
    assert_eq!(impor::parse_angka("Rp 2.000"), Some(2000.0));
    assert_eq!(impor::parse_angka(""), Some(0.0));
    assert_eq!(impor::parse_angka("abc"), None);
}

#[test]
fn impor_barang_csv() {
    let (mut c, d) = setup();
    let folder = d.0.join("backup");
    let f = d.0.join("barang.csv");
    std::fs::write(&f, "KodeBarang,Nama Barang,Barcode,Jenis,Satuan,HrgBeli,HrgJual,StokAwal,Kolom Asing\nB1,Kecap,111,Barang,PCS,2000,2500,10,x\nB2,Servis,,Jasa,,0,15000,0,y\n").unwrap();
    // Judul tanpa spasi: "Nama Barang" dikenali sebagai namabarang, "Satuan" bukan nama kolom asli.
    let p = impor::pratinjau("barang", f.to_str().unwrap()).unwrap();
    assert_eq!(p["jumlah"], 2);
    assert!(p["wajib_hilang"].as_array().unwrap().is_empty());
    assert!(p["kolom"].as_array().unwrap().iter().any(|k| k == "namabarang"));
    assert!(p["tidak_dikenal"].as_array().unwrap().iter().any(|k| k == "Satuan"));
    let r = impor::impor(&mut c, "barang", f.to_str().unwrap(), false, &folder).unwrap();
    assert_eq!(r["jumlah"], 2);
    let (nama, stok, jenis): (String, f64, String) = c.query_row("SELECT namabarang, stokakhir, jenis FROM mdbarang WHERE kodebarang='B1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!((nama.as_str(), stok, jenis.as_str()), ("Kecap", 10.0, "Barang"));
    assert_eq!(angka(&c, "SELECT hrgjual FROM mdbarang WHERE kodebarang='B2'"), 15000.0);

    // Kode yang sudah ada di database ditolak, dan tidak ada baris yang masuk.
    let g = d.0.join("dobel.csv");
    std::fs::write(&g, "kodebarang,namabarang,hrgjual\nB3,Baru,1000\nB1,Kecap lagi,1\nB4,Salah,abc\nB3,Kembar,5\n").unwrap();
    let err = impor::impor(&mut c, "barang", g.to_str().unwrap(), false, &folder).unwrap_err();
    assert!(err.contains("baris no. 3") && err.contains("sudah ada"), "{err}");
    assert!(err.contains("baris no. 4") && err.contains("bukan angka"), "{err}");
    assert!(err.contains("baris no. 5") && err.contains("lebih dari sekali"), "{err}");
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mdbarang WHERE kodebarang='B3'"), 0.0);

    // Hapus data lama dulu.
    let h = d.0.join("ganti.csv");
    std::fs::write(&h, "kodebarang;namabarang;hrgjual\nZ1;Satu-satunya;100\n").unwrap();
    impor::impor(&mut c, "barang", h.to_str().unwrap(), true, &folder).unwrap();
    assert_eq!(angka(&c, "SELECT COUNT(*) FROM mdbarang"), 1.0);

    // Kolom wajib hilang, file Excel, dan file kosong.
    let k = d.0.join("tanpa-nama.csv");
    std::fs::write(&k, "kodebarang,hrgjual\nX1,5\n").unwrap();
    assert!(impor::impor(&mut c, "barang", k.to_str().unwrap(), false, &folder).unwrap_err().contains("namabarang"));
    assert!(impor::impor(&mut c, "barang", "/tmp/tidak-ada-data.xlsx", false, &folder).unwrap_err().contains("tidak bisa dibuka"));
    let kosong = d.0.join("kosong.csv");
    std::fs::write(&kosong, "kodebarang,namabarang\n").unwrap();
    assert!(impor::impor(&mut c, "barang", kosong.to_str().unwrap(), false, &folder).is_err());
    assert!(impor::impor(&mut c, "tidak_ada", h.to_str().unwrap(), false, &folder).is_err());
}

#[test]
fn impor_pelanggan_dengan_tanggal() {
    let (mut c, d) = setup();
    let folder = d.0.join("backup");
    let f = d.0.join("pel.csv");
    std::fs::write(&f, "kodepelanggan,namapelanggan,kota,masaaktif,level\nC9,Pak Budi,Solo,31/12/2027,Level 2\nC8,Bu Sari,,,\n").unwrap();
    impor::impor(&mut c, "pelanggan", f.to_str().unwrap(), false, &folder).unwrap();
    let (tgl, lv): (String, String) = c.query_row("SELECT masaaktif, level FROM mdpelanggan WHERE kodepelanggan='C9'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((tgl.as_str(), lv.as_str()), ("2027-12-31", "Level 2"));
    let g = d.0.join("pel2.csv");
    std::fs::write(&g, "kodepelanggan,namapelanggan,masaaktif\nC7,X,kemarin\n").unwrap();
    assert!(impor::impor(&mut c, "pelanggan", g.to_str().unwrap(), false, &folder).unwrap_err().contains("bukan tanggal"));
}

#[test]
fn jenis_non_tunai() {
    let (c, _d) = setup();
    nontunai::simpan_jenis(&c, "09", "Voucher", None).unwrap();
    assert!(nontunai::simpan_jenis(&c, "", "X", None).unwrap_err().contains("diisi lengkap"));
    // Kode yang sudah ada diperbarui (tidak ditolak), seperti aslinya.
    nontunai::simpan_jenis(&c, "09", "Voucher Belanja", None).unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mdjenisnontunai WHERE kode='09'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    nontunai::simpan_item(&c, "09", "Alfa", None).unwrap();
    nontunai::simpan_item(&c, "09", "alfa", None).unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mdjenisnontunaiitem WHERE kode='09'", [], |r| r.get::<_, i64>(0)).unwrap(), 1, "nama kembar tidak menambah baris");
    assert!(nontunai::simpan_item(&c, "99", "X", None).is_err(), "jenis belum ada");
    nontunai::simpan_item(&c, "09", "Alfamart", Some("Alfa")).unwrap();
    let d = nontunai::daftar(&c).unwrap();
    assert!(d["item"].as_array().unwrap().iter().any(|i| i["namaitem"] == "Alfamart" && i["namajenis"] == "Voucher Belanja"));
    nontunai::hapus_item(&c, "09", "Alfamart").unwrap();
    assert!(nontunai::hapus_item(&c, "09", "Alfamart").is_err());
    // Hapus jenis ikut menghapus semua itemnya (ON DELETE CASCADE di aslinya).
    nontunai::simpan_item(&c, "09", "Gopay", None).unwrap();
    nontunai::hapus_jenis(&c, "09").unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mdjenisnontunaiitem WHERE kode='09'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}
