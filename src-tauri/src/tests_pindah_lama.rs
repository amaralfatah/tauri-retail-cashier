//! Uji pemindahan data dari Toko Pro lama: dekode cp1252, urai baris isql, Settings.ini, bangun SQLite dari sumber palsu,
//! dan (hanya bila `TOKOPRO_FB_DOCKER` diisi) pemindahan penuh dari Firebird sungguhan di Docker.

use crate::db::{self, Db, Res};
use crate::pindah_lama::*;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn tmp(nama: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("tokopro-pl-{nama}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn cp1252_dekode() {
    assert_eq!(dekode_cp1252(b"Toko Maju"), "Toko Maju");
    assert_eq!(dekode_cp1252(&[0x80, 0x93, 0x94, 0x96, 0x99]), "\u{20AC}\u{201C}\u{201D}\u{2013}\u{2122}");
    assert_eq!(dekode_cp1252(&[0xE9, 0xA0, 0xFF]), "é\u{A0}ÿ");
    assert_eq!(dekode_cp1252(&[0x81, 0x90]), "\u{81}\u{90}");
    assert_eq!(enkode_cp1252(&dekode_cp1252(&(0u8..=255).collect::<Vec<_>>())).unwrap(), (0u8..=255).collect::<Vec<_>>());
}

fn dari_hex(h: &str) -> Vec<u8> {
    (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
}

const HEX_ADMIN: &str = "93b8beb2c2a4b36f90bea6b8c8bbc463aab0b97087abb2bdc9b3ba6fb4be";
const HEX_KASIR: &str = "9db5c4b2c6aeb07590c2b0b5cebbc86da7b6b97491a8b8bdcdbdb775b4c2";

#[test]
fn lama_password_vektor_installer() {
    assert_eq!(lama_enkripsi(b"admin"), dari_hex(HEX_ADMIN));
    assert_eq!(lama_enkripsi(b"kasir"), dari_hex(HEX_KASIR));
    assert_eq!(lama_buka_password(&dari_hex(HEX_ADMIN)).as_deref(), Some("admin"));
    assert_eq!(lama_buka_password(&dari_hex(HEX_KASIR)).as_deref(), Some("kasir"));
    let panjang = "Sandi Panjang !@#~ 123 dengan spasi dan tanda baca yang melewati 49 huruf";
    assert_eq!(lama_buka_password(&lama_enkripsi(panjang.as_bytes())).as_deref(), Some(panjang));
}

#[test]
fn lama_password_data_rusak_none() {
    let mut ok = dari_hex(HEX_ADMIN);
    assert!(lama_buka_password(&[]).is_none());
    assert!(lama_buka_password(&ok[..29]).is_none(), "panjang bukan kelipatan 6");
    ok[7] = ok[7].wrapping_add(1);
    assert!(lama_buka_password(&ok).is_none(), "ulangan berbeda");
    assert!(lama_buka_password(b"rahasia").is_none());
    assert!(lama_buka_password(&lama_enkripsi("caf\u{e9}".as_bytes())).is_none(), "di luar ASCII");
    assert!(lama_buka_password(&lama_enkripsi(&[b'a', 9, b'b'])).is_none(), "karakter kontrol");
}

#[test]
fn password_pindahan_hash_atau_null() {
    let teks = dekode_cp1252(&dari_hex(HEX_ADMIN));
    let h = password_pindahan(Some(&teks)).unwrap();
    assert!(h.starts_with("$argon2"), "{h}");
    assert!(!h.contains("admin"));
    assert!(password_pindahan(None).is_none());
    assert!(password_pindahan(Some("")).is_none());
    assert!(password_pindahan(Some("rahasia")).is_none());
    assert!(password_pindahan(Some("\u{4e2d}")).is_none(), "huruf di luar cp1252");
    // Teks yang tidak bisa kembali ke byte asal (U+FFFD) tidak dianggap terbaca: hasilnya NULL.
    let t: String = std::iter::once('\u{FFFD}').chain(dekode_cp1252(&dari_hex(HEX_ADMIN)).chars().skip(1)).collect();
    assert!(password_pindahan(Some(&t)).is_none());
}

#[test]
fn password_pindahan_data_rusak_satu_byte_jadi_null() {
    // Satu byte diubah: validasi enam ulangan di `lama_buka_password` menolaknya, hasilnya NULL.
    for n in [0usize, 7, 29] {
        let mut b = dari_hex(HEX_ADMIN);
        b[n] = b[n].wrapping_add(1);
        assert!(lama_buka_password(&b).is_none(), "byte {n}");
        assert!(password_pindahan(Some(&dekode_cp1252(&b))).is_none(), "byte {n}");
    }
}

#[test]
fn password_byte_tinggi_cp1252_kembali_utuh() {
    // Hasil enkripsi memuat byte di atas 0x7F; harus lolos dekode cp1252 lalu kembali ke byte asal.
    let b = lama_enkripsi(b"zzzzzz");
    assert!(b.iter().any(|&x| x >= 0x80));
    assert_eq!(enkode_cp1252(&dekode_cp1252(&b)).unwrap(), b);
    assert!(password_pindahan(Some(&dekode_cp1252(&b))).is_some());
}

#[test]
fn pindah_mduser_isi_hash_dan_login_password_lama() {
    use crate::auth::{masuk, verifikasi_pengelola as v};
    let d = tmp("sandi");
    let file = d.join("baru.db");
    let mut p = Palsu::default();
    let (a, k) = (dekode_cp1252(&dari_hex(HEX_ADMIN)), dekode_cp1252(&dari_hex(HEX_KASIR)));
    p.isi("MDUSER", &["IDUSER", "PSWDUSER", "KODEKARYAWAN", "LEVEL", "AKTIF"], &[
        &[s("Admin"), s(&a), s("-"), s("Supervisor"), s("1")],
        &[s("kasir"), s(&k), s("-"), s("Kasir"), s("1")],
        &[s("rusak"), s("rahasia"), s("-"), s("Kasir"), s("1")],
        &[s("kosong"), None, s("-"), s("Kasir"), s("1")],
    ]);
    bangun_sqlite(&p, &file, &mut |_| {}).unwrap();
    let c = Connection::open(&file).unwrap();
    let psw = |id: &str| c.query_row("SELECT pswduser FROM mduser WHERE iduser=?1", [id], |r| r.get::<_, Option<String>>(0)).unwrap();
    assert!(psw("Admin").unwrap().starts_with("$argon2"));
    assert!(psw("kasir").unwrap().starts_with("$argon2"));
    assert!(psw("rusak").is_none() && psw("kosong").is_none());

    assert_eq!(v(&c, "admin", "admin").unwrap().iduser, "Admin");
    assert!(v(&c, "Admin", "salah").is_err());
    assert!(!masuk(&c, "kasir", "kasir").unwrap().must_change);
    assert!(masuk(&c, "kasir", "admin").is_err(), "password sementara tidak berlaku untuk akun yang sudah punya password");
    // Yang tidak terbaca masuk dengan password sementara dan wajib menggantinya.
    assert!(masuk(&c, "rusak", "rahasia").is_err());
    assert!(masuk(&c, "rusak", "admin").unwrap().must_change);
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn urai_baris_null_dan_pemisah() {
    let out = "R   @@R@@A\x1fB\x1e\x1fC@@E@@\r\nbaris lain tanpa penanda\nR   @@R@@x@@E@@y\x1f\x1e\x1f@@E@@\n";
    let r = urai_baris("T", out, 3).unwrap();
    assert_eq!(r.len(), 2);
    assert_eq!(r[0], vec![Some("A".to_string()), Some("B\x1e".to_string()), Some("C".to_string())]);
    // Nilai yang hanya berisi penanda NULL jadi None; "@@E@@" di tengah nilai ikut terbawa karena yang dipotong hanya yang terakhir.
    assert_eq!(r[1], vec![Some("x@@E@@y".to_string()), None, Some(String::new())]);
}

#[test]
fn urai_baris_null_murni() {
    let r = urai_baris("T", "R @@R@@1\x1f\x1e\x1f3@@E@@\n", 3).unwrap();
    assert_eq!(r[0], vec![Some("1".into()), None, Some("3".into())]);
}

#[test]
fn urai_baris_jumlah_salah_galat() {
    let err = urai_baris("MDBARANG", "R @@R@@a\x1fb\x1fc@@E@@\n", 2).unwrap_err();
    assert!(err.contains("MDBARANG") && err.contains("rusak"), "{err}");
}

#[test]
fn urai_kolom_dari_isql() {
    let out = "c  @@R@@KODEBARANG@@E@@\nc  @@R@@NAMABARANG@@E@@\n\n";
    assert_eq!(urai_kolom(out), vec!["KODEBARANG", "NAMABARANG"]);
}

#[test]
fn settings_ini() {
    let ini = "\u{FEFF}[Database]\r\nNamaKomputer=localhost\r\nLokasiData=E:\\Toko\\_data\\DATAPOS.FDB\r\nLokasiBackup=E:\\Toko\\_backup\\\r\nFirebirdLocation=C:\\Program Files\\Firebird\\Firebird_2_5\\bin\r\n; komentar\r\n[Lain]\r\nLokasiData=x\r\n";
    let kv = baca_ini(ini);
    assert_eq!(kv["database.lokasidata"], "E:\\Toko\\_data\\DATAPOS.FDB");
    assert_eq!(kv["database.firebirdlocation"], "C:\\Program Files\\Firebird\\Firebird_2_5\\bin");
    assert_eq!(kv["database.lokasibackup"], "E:\\Toko\\_backup\\");
    assert_eq!(kv["lain.lokasidata"], "x");
}

#[test]
fn cari_di_menemukan_data_dan_backup() {
    let akar = tmp("cari");
    let app = akar.join("TokoPro");
    std::fs::create_dir_all(app.join("_data")).unwrap();
    std::fs::write(app.join("_data").join("DATAPOS.FDB"), b"x").unwrap();
    let bk = akar.join("bk");
    std::fs::create_dir_all(&bk).unwrap();
    for i in 0..7 {
        std::fs::write(bk.join(format!("b{i}.fdk")), b"y").unwrap();
    }
    std::fs::write(bk.join("bukan.txt"), b"z").unwrap();
    // Settings.ini menunjuk file yang sama (harus tidak dobel) dan folder backup.
    let ini = format!(
        "[Database]\nLokasiData={}\nLokasiBackup={}\nFirebirdLocation=C:\\FB\\bin\n",
        app.join("_data").join("DATAPOS.FDB").display(),
        bk.display()
    );
    std::fs::write(app.join("Settings.ini"), ini).unwrap();
    // Folder yang terlalu dalam (kedalaman 3) tidak dipindai.
    let dalam = akar.join("a").join("b").join("c");
    std::fs::create_dir_all(dalam.join("_data")).unwrap();
    std::fs::write(dalam.join("_data").join("DATAPOS.FDB"), b"x").unwrap();

    let t = cari_di(&[akar.clone(), akar.join("tidak-ada")]);
    let fdb: Vec<_> = t.kandidat.iter().filter(|k| k.jenis == "fdb").collect();
    let fdk: Vec<_> = t.kandidat.iter().filter(|k| k.jenis == "fdk").collect();
    assert_eq!(fdb.len(), 1, "{:?}", t.kandidat);
    assert_eq!(fdb[0].ukuran, 1);
    assert_eq!(fdk.len(), 5);
    assert_eq!(t.folder_firebird, vec![PathBuf::from("C:\\FB\\bin")]);
    assert_eq!(fdb[0].waktu.len(), 16);
    let _ = std::fs::remove_dir_all(akar);
}

#[test]
fn nama_komputer_lama_dibersihkan() {
    let b = |m: &str| bersihkan_nama_komputer(m, "KASIR-2");
    // Komputer ini sendiri server lama: diabaikan.
    assert_eq!(b("localhost"), None);
    assert_eq!(b("LOCALHOST"), None);
    assert_eq!(b("127.0.0.1"), None);
    assert_eq!(b("::1"), None);
    assert_eq!(b("kasir-2"), None);
    assert_eq!(b("KASIR-2/3050"), None);
    assert_eq!(b(""), None);
    assert_eq!(b("   "), None);
    // Komputer lain: dipakai, port Firebird dipotong.
    assert_eq!(b("SERVER"), Some("SERVER".into()));
    assert_eq!(b("  SERVER  "), Some("SERVER".into()));
    assert_eq!(b("SERVER/3050"), Some("SERVER".into()));
    assert_eq!(b("SERVER:3050"), Some("SERVER".into()));
    assert_eq!(b("192.168.1.5"), Some("192.168.1.5".into()));
    assert_eq!(b("192.168.1.5/3050"), Some("192.168.1.5".into()));
    assert_eq!(b("192.168.1.5:3050"), Some("192.168.1.5".into()));
    assert_eq!(b("fe80::1"), Some("fe80::1".into()));
}

#[test]
fn nama_komputer_lama_dibaca_dari_settings_ini() {
    let akar = tmp("namakomp");
    let tulis = |sub: &str, isi: &str| {
        let d = akar.join(sub);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("Settings.ini"), isi).unwrap();
    };
    // Tidak ada instalasi lama.
    assert_eq!(nama_komputer_lama_di(&[akar.clone()], "KASIR-2"), None);
    // Kosong, localhost, dan nama sendiri: komputer ini server lama.
    for nilai in ["", "localhost", "KASIR-2"] {
        tulis("TokoPro", &format!("[Database]\nNamaKomputer={nilai}\n"));
        assert_eq!(nama_komputer_lama_di(&[akar.clone()], "KASIR-2"), None, "{nilai}");
    }
    tulis("TokoPro", "[Database]\r\nNamaKomputer=SERVER/3050\r\n");
    assert_eq!(nama_komputer_lama_di(&[akar.clone()], "KASIR-2"), Some("SERVER".into()));
    tulis("TokoPro", "[Database]\nNamaKomputer=192.168.1.5\n");
    assert_eq!(nama_komputer_lama_di(&[akar.clone()], "KASIR-2"), Some("192.168.1.5".into()));
    let _ = std::fs::remove_dir_all(akar);
}

// ---- sumber palsu

#[derive(Default)]
struct Palsu {
    tabel: HashMap<String, (Vec<String>, Vec<Vec<Option<String>>>)>,
}

impl Palsu {
    fn isi(&mut self, t: &str, kolom: &[&str], baris: &[&[Option<&str>]]) {
        self.tabel.insert(
            t.to_string(),
            (kolom.iter().map(|c| c.to_string()).collect(), baris.iter().map(|r| r.iter().map(|v| v.map(String::from)).collect()).collect()),
        );
    }
}

impl Sumber for Palsu {
    fn kolom(&self, tabel: &str) -> Res<Vec<String>> {
        Ok(self.tabel.get(tabel).map(|t| t.0.clone()).unwrap_or_default())
    }
    fn baris(&self, tabel: &str, _: &[String]) -> Res<Vec<Vec<Option<String>>>> {
        Ok(self.tabel.get(tabel).map(|t| t.1.clone()).unwrap_or_default())
    }
}

fn s(x: &str) -> Option<&str> {
    Some(x)
}

fn palsu_dasar() -> Palsu {
    let mut p = Palsu::default();
    p.isi("MDUSER", &["IDUSER", "PSWDUSER", "KODEKARYAWAN", "LEVEL", "AKTIF", "JAMUPDATE"], &[&[s("budi"), s("rahasia"), s("K1"), s("Manager"), s("1"), s("10:11:12.3456")]]);
    p.isi("MDBARANG", &["KODEBARANG", "NAMABARANG", "JENIS", "STOKAWAL", "STOKMASUK", "STOKKELUAR", "STOKAKHIR", "KOLOMBARU"],
        &[&[s("B1"), s("Kopi Tubruk"), s("Barang"), s("10"), s("0"), s("3"), s("7"), s("x")]]);
    p.isi("TRANSAKSI", &["NOTRANS", "KODE", "TGLTRANS"], &[&[s("TJ001"), s("TJ"), s("2020-01-02")]]);
    p.isi("TRANSAKSIDETIL", &["NOTRANS", "KODE", "KODEBARANG", "JML"], &[&[s("TJ001"), s("TJ"), s("B1"), s("3")]]);
    p
}

#[test]
fn bangun_sqlite_dari_sumber_palsu() {
    let d = tmp("bangun");
    let file = d.join("baru.db");
    let mut log = vec![];
    let (hasil, peringatan) = bangun_sqlite(&palsu_dasar(), &file, &mut |p| log.push(p)).unwrap();
    assert_eq!(hasil.len(), 24);
    assert_eq!(hasil.last().unwrap().tabel, "MDBARANG", "MDBARANG harus paling akhir");
    assert_eq!(hasil.iter().find(|h| h.tabel == "MDPEMASOK").unwrap().nama, "Supplier");
    assert_eq!(log.len(), 24);
    assert_eq!((log[0].ke, log[0].dari, log[0].tahap), (1, 24, "baca"));
    assert!(peringatan.iter().any(|w| w.contains("KOLOMBARU")), "{peringatan:?}");

    let c = Connection::open(&file).unwrap();
    // Tanpa data awal bawaan: hanya yang dipindahkan.
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mduser", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    assert_eq!(c.query_row("SELECT COUNT(*) FROM mdsatuan", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    assert!(c.query_row("SELECT pswduser FROM mduser", [], |r| r.get::<_, Option<String>>(0)).unwrap().is_none());
    assert_eq!(c.query_row("SELECT jamupdate FROM mduser", [], |r| r.get::<_, String>(0)).unwrap(), "10:11:12");
    // Stok tidak dihitung dua kali oleh trigger (barang masuk terakhir).
    let st: (f64, f64, f64) = c.query_row("SELECT stokawal, stokkeluar, stokakhir FROM mdbarang", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!(st, (10.0, 3.0, 7.0));
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn bangun_sqlite_lapor_foreign_key() {
    let d = tmp("fk");
    let mut p = palsu_dasar();
    p.isi("TRANSAKSIDETIL", &["NOTRANS", "KODE", "KODEBARANG", "JML"], &[&[s("TIDAKADA"), s("TJ"), s("B1"), s("1")]]);
    let (_, w) = bangun_sqlite(&p, &d.join("baru.db"), &mut |_| {}).unwrap();
    assert!(w.iter().any(|x| x.contains("transaksidetil")), "{w:?}");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn pulihkan_hasil_bangun_ke_database_hidup() {
    // Hasil bangun_sqlite harus lolos validasi `pulihkan` dan terbuka lewat db::open.
    let d = tmp("hidup");
    let live = db::open(&d.join("tokopro.db")).unwrap();
    let baru = d.join("baru.db");
    bangun_sqlite(&palsu_dasar(), &baru, &mut |_| {}).unwrap();
    let mut conn = live;
    let aman = crate::database::pulihkan(&mut conn, &baru, &d.join("backup")).unwrap();
    assert!(aman.exists());
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM mdbarang", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    let _ = std::fs::remove_dir_all(d);
}

// ---- integrasi Docker (dilewati kalau TOKOPRO_FB_DOCKER tidak diisi)

fn angka(v: &Option<String>) -> f64 {
    v.as_deref().and_then(|x| x.trim().parse().ok()).unwrap_or(0.0)
}

#[test]
fn pindahkan_dari_firebird_docker() {
    let Ok(container) = std::env::var("TOKOPRO_FB_DOCKER") else {
        eprintln!("dilewati: TOKOPRO_FB_DOCKER tidak diisi");
        return;
    };
    let d = tmp("docker");
    let contoh = d.join("DATAPOS.FDB");
    let asal = std::env::var("TOKOPRO_FB_CONTOH").unwrap_or_else(|_| "/data/DATAPOS.FDB".into());
    let cp = std::process::Command::new("docker").args(["cp", &format!("{container}:{asal}"), &contoh.display().to_string()]).status().unwrap();
    assert!(cp.success());

    let db = Db(Mutex::new(db::open(&d.join("tokopro.db")).unwrap()));
    let fb = Firebird::docker(&container);
    let mut log: Vec<Progres> = vec![];
    let h = pindahkan(&db, &contoh, Some(&d.join("backup").display().to_string()), &fb, &mut |p| log.push(p)).unwrap();

    let jumlah = |t: &str| h.hasil.iter().find(|x| x.tabel == t).unwrap().jumlah;
    assert_eq!(jumlah("MDBARANG"), 2535);
    assert_eq!(jumlah("TRANSAKSI"), 762);
    assert_eq!(jumlah("TRANSAKSIDETIL"), 2379);
    assert_eq!(jumlah("MDUSER"), 3);
    assert!(h.cadangan.exists());
    assert_eq!(log.first().unwrap().tahap, "salin");
    assert_eq!(log.last().unwrap().tahap, "selesai");
    assert!(!d.join("pindah-lama").exists(), "folder kerja harus dibersihkan");

    {
        let c = db.lock().unwrap();
        let n = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(n("SELECT COUNT(*) FROM mdbarang"), 2535);
        assert_eq!(n("SELECT COUNT(*) FROM transaksi"), 762);
        assert_eq!(n("SELECT COUNT(*) FROM transaksidetil"), 2379);
        assert_eq!(n("SELECT COUNT(*) FROM mduser"), 3);
        // Data contoh memakai password bawaan installer: ketiganya terbaca dan disimpan sebagai hash Argon2.
        assert_eq!(n("SELECT COUNT(*) FROM mduser WHERE pswduser LIKE '$argon2%'"), 3);
        assert_eq!(crate::auth::masuk(&c, "kasir", "kasir").unwrap().iduser, "kasir");
        assert_eq!(crate::auth::masuk(&c, "admin", "admin").unwrap().iduser, "Admin");
    }

    // Stok di SQLite harus sama dengan Firebird (trigger tidak menghitung dobel).
    let sumber = SumberFirebird { fb: &fb, db_path: asal };
    let kolom = sumber.kolom("MDBARANG").unwrap();
    let pos = |nama: &str| kolom.iter().position(|c| c.eq_ignore_ascii_case(nama)).unwrap();
    let baris = sumber.baris("MDBARANG", &kolom).unwrap();
    assert_eq!(baris.len(), 2535);
    let c = db.lock().unwrap();
    let mut berstok = 0;
    for r in &baris {
        let kode = r[pos("kodebarang")].clone().unwrap();
        let (a, m, k, o, ak): (f64, f64, f64, f64, f64) = c
            .query_row(
                "SELECT stokawal, stokmasuk, stokkeluar, stokopname, stokakhir FROM mdbarang WHERE kodebarang=?1",
                [&kode],
                |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?, x.get(3)?, x.get(4)?)),
            )
            .unwrap();
        let cocok = |a: f64, b: f64| (a - b).abs() < 0.001;
        assert!(cocok(a, angka(&r[pos("stokawal")])), "{kode} stokawal");
        assert!(cocok(m, angka(&r[pos("stokmasuk")])), "{kode} stokmasuk");
        assert!(cocok(k, angka(&r[pos("stokkeluar")])), "{kode} stokkeluar");
        assert!(cocok(o, angka(&r[pos("stokopname")])), "{kode} stokopname");
        assert!(cocok(ak, angka(&r[pos("stokakhir")])), "{kode} stokakhir");
        if ak != 0.0 {
            berstok += 1;
        }
    }
    assert!(berstok > 0);
    drop(c);
    let _ = Path::new(&d);
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn bukan_data_toko_pro_ditolak() {
    let Ok(container) = std::env::var("TOKOPRO_FB_DOCKER") else { return };
    let d = tmp("bukan");
    let palsu = d.join("sembarang.fdb");
    std::fs::write(&palsu, vec![0u8; 8192]).unwrap();
    let db = Db(Mutex::new(db::open(&d.join("tokopro.db")).unwrap()));
    let err = pindahkan(&db, &palsu, None, &Firebird::docker(&container), &mut |_| {}).err().expect("harus gagal");
    assert!(err.contains("bukan data Toko Pro lama") || err.contains("belum bisa dibuka"), "{err}");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn pindahkan_dari_backup_fdk_docker() {
    let Ok(container) = std::env::var("TOKOPRO_FB_DOCKER") else { return };
    let d = tmp("fdk");
    let sh = |args: &[&str]| {
        let o = std::process::Command::new("docker").args(args).output().unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    };
    let dir = format!("/tmp/uji-fdk-{}", std::process::id());
    sh(&["exec", "-u", "root", &container, "sh", "-c", &format!("mkdir -p {dir} && chmod 777 {dir}")]);
    sh(&["exec", &container, "/usr/local/firebird/bin/gbak", "-b", "-t", "-user", "SYSDBA", "-password", "masterkey", "/data/DATAPOS.FDB", &format!("{dir}/lama.fdk")]);
    let fdk = d.join("lama.fdk");
    sh(&["cp", &format!("{container}:{dir}/lama.fdk"), &fdk.display().to_string()]);
    sh(&["exec", "-u", "root", &container, "rm", "-rf", &dir]);

    let db = Db(Mutex::new(db::open(&d.join("tokopro.db")).unwrap()));
    let h = pindahkan(&db, &fdk, Some(&d.join("backup").display().to_string()), &Firebird::docker(&container), &mut |_| {}).unwrap();
    assert_eq!(h.hasil.iter().find(|x| x.tabel == "MDBARANG").unwrap().jumlah, 2535);
    assert_eq!(db.lock().unwrap().query_row("SELECT COUNT(*) FROM transaksi", [], |r| r.get::<_, i64>(0)).unwrap(), 762);
    let _ = std::fs::remove_dir_all(d);
}
