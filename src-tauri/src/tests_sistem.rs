//! Uji Sistem: login bawaan, nama user tanpa membedakan huruf besar/kecil, satu akun per karyawan, impor update barang dan stok.

use crate::auth::{masuk_bawaan, simpan_user, verifikasi_pengelola, Session, User};
use crate::{db, impor};
use rusqlite::Connection;
use serde_json::{json, Map, Value};

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-sistem-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let c = db::open(&dir.join("t.db")).unwrap();
    (c, dir)
}

fn pemilik() -> User {
    User { iduser: "bos".into(), kodekaryawan: "-".into(), namakaryawan: "Bos".into(), level: "Manager".into(), must_change: false }
}

fn map(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn n(c: &Connection, sql: &str) -> f64 {
    c.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn login_bawaan_mengikuti_pengaturan_aktiflogin() {
    let (c, d) = setup();
    let s = Session::default();
    c.execute("UPDATE tseting SET aktiflogin = 1", []).unwrap();
    assert!(masuk_bawaan(&c, &s).unwrap().is_none());
    assert!(s.user().is_err());
    c.execute("UPDATE tseting SET aktiflogin = 0", []).unwrap();
    let u = masuk_bawaan(&c, &s).unwrap().unwrap();
    assert_eq!(u.iduser, "Administrator");
    assert_eq!(s.user().unwrap().level, "Manager");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn nama_user_tanpa_beda_huruf_dan_satu_akun_per_karyawan() {
    let (c, d) = setup();
    c.execute_batch("INSERT INTO mdkaryawan (kodekaryawan,namakaryawan) VALUES ('E1','Ani'),('E2','Budi')").unwrap();
    simpan_user(&c, &pemilik(), &map(json!({"iduser":"Ani","level":"Supervisor","kodekaryawan":"E1","password":"abc"})), true).unwrap();
    assert_eq!(verifikasi_pengelola(&c, "ANI", "abc").unwrap().iduser, "Ani");
    assert_eq!(verifikasi_pengelola(&c, "ani", "abc").unwrap().iduser, "Ani");
    assert!(verifikasi_pengelola(&c, "ani", "salah").is_err());
    assert!(simpan_user(&c, &pemilik(), &map(json!({"iduser":"ANI","level":"Kasir"})), true).unwrap_err().contains("sudah dipakai"));

    // Akun baru untuk karyawan yang sama menggantikan akun lama (beserta hak aksesnya).
    c.execute("INSERT INTO mdusermenu (iduser,idmenu,akses) VALUES ('Ani','1',1)", []).unwrap();
    simpan_user(&c, &pemilik(), &map(json!({"iduser":"ani2","level":"Kasir","kodekaryawan":"E1"})), true).unwrap();
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mduser WHERE kodekaryawan='E1'"), 1.0);
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mduser WHERE iduser='Ani'"), 0.0);
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mdusermenu WHERE iduser='Ani'"), 0.0);

    // Pengguna tanpa karyawan boleh banyak, dan akun yang sedang dipakai tidak diganti diam-diam.
    simpan_user(&c, &pemilik(), &map(json!({"iduser":"t1","level":"Kasir"})), true).unwrap();
    simpan_user(&c, &pemilik(), &map(json!({"iduser":"t2","level":"Kasir"})), true).unwrap();
    let ani2 = User { iduser: "ani2".into(), level: "Supervisor".into(), ..pemilik() };
    assert!(simpan_user(&c, &ani2, &map(json!({"iduser":"x","level":"Kasir","kodekaryawan":"E1"})), true).is_err());
    assert_eq!(n(&c, "SELECT COUNT(*) FROM mduser WHERE iduser='ani2'"), 1.0);
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn impor_update_data_dan_stok_barang() {
    let (mut c, d) = setup();
    c.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir) VALUES ('A1','Sabun','Barang','PCS',5000,6000,10,10);
         INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan) VALUES ('J1','Ongkir','Jasa','KALI');",
    )
    .unwrap();
    let folder = d.join("backup");

    let f = d.join("upd.csv");
    std::fs::write(&f, "kodebarang,namabarang,rak,hrglevel1\na1,Sabun Mandi,R1,5500\n").unwrap();
    let r = impor::impor(&mut c, "updatebarang", f.to_str().unwrap(), false, &folder).unwrap();
    assert_eq!(r["jumlah"], 1);
    let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(nama, "Sabun Mandi");
    assert_eq!(n(&c, "SELECT hrglevel1 FROM mdbarang WHERE kodebarang='A1'"), 5500.0);
    assert_eq!(n(&c, "SELECT hrgjual FROM mdbarang WHERE kodebarang='A1'"), 6000.0, "kolom yang tidak ada di file tidak berubah");

    let g = d.join("salah.csv");
    std::fs::write(&g, "kodebarang,namabarang\nA1,Baru\nZ9,Tidak ada\n").unwrap();
    let err = impor::impor(&mut c, "updatebarang", g.to_str().unwrap(), false, &folder).unwrap_err();
    assert!(err.contains("Mohon dikoreksi baris no. 3"), "{err}");

    // Update stok: dicatat sebagai stok opname OP dengan catatan dari impor.
    let s = d.join("stok.csv");
    std::fs::write(&s, "kodebarang,stok\na1,25\n").unwrap();
    let r = impor::impor_dengan(&mut c, Some(&pemilik()), "stokbarang", s.to_str().unwrap(), false, &folder).unwrap();
    assert_eq!(r["jumlah"], 1);
    assert_eq!(n(&c, "SELECT stokakhir FROM mdbarang WHERE kodebarang='A1'"), 25.0);
    let cat: String = c.query_row("SELECT catatan FROM transaksi WHERE kode='OP'", [], |r| r.get(0)).unwrap();
    assert_eq!(cat, "Opname From Import Excel");
    let j = d.join("jasa.csv");
    std::fs::write(&j, "kodebarang,stok\nJ1,5\n").unwrap();
    assert!(impor::impor_dengan(&mut c, Some(&pemilik()), "stokbarang", j.to_str().unwrap(), false, &folder).unwrap_err().contains("Mohon dikoreksi baris no. 2"));
    assert!(impor::impor(&mut c, "stokbarang", s.to_str().unwrap(), false, &folder).is_err(), "tanpa user tidak bisa mencatat opname");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn login_akun_senama_beda_huruf() {
    use crate::auth::{hash, masuk};
    let (c, d) = setup();
    let ins = |id: &str, sandi: &str, level: &str, aktif: i64| {
        c.execute(
            "INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES (?1, ?2, '-', ?3, ?4)",
            rusqlite::params![id, hash(sandi).unwrap(), level, aktif],
        )
        .unwrap();
    };
    ins("ADMIN", "sandiBesar", "Manager", 1);
    ins("Admin", "sandiKecil", "Supervisor", 1);
    // Ketik huruf kecil semua: masuk ke akun yang passwordnya cocok.
    assert_eq!(masuk(&c, "admin", "sandiBesar").unwrap().iduser, "ADMIN");
    assert_eq!(masuk(&c, "admin", "sandiKecil").unwrap().iduser, "Admin");
    // Huruf persis sama didahulukan; password akun lain tetap diterima lewat ketikan itu.
    assert_eq!(masuk(&c, "Admin", "sandiKecil").unwrap().iduser, "Admin");
    assert_eq!(masuk(&c, "ADMIN", "sandiBesar").unwrap().iduser, "ADMIN");
    let salah = masuk(&c, "admin", "ngawur").err().unwrap();
    assert!(salah.contains("password salah"), "{salah}");
    assert_eq!(verifikasi_pengelola(&c, "admin", "sandiKecil").unwrap().iduser, "Admin");
    assert_eq!(verifikasi_pengelola(&c, "admin", "sandiBesar").unwrap().iduser, "ADMIN");
    assert!(verifikasi_pengelola(&c, "admin", "ngawur").is_err());

    // Akun nonaktif dilewati; pesan "dinonaktifkan" hanya bila semua akun yang cocok nonaktif.
    c.execute("UPDATE mduser SET aktif = 0 WHERE iduser = 'ADMIN'", []).unwrap();
    assert!(masuk(&c, "admin", "sandiBesar").err().unwrap().contains("dinonaktifkan"));
    assert!(masuk(&c, "admin", "ngawur").err().unwrap().contains("password salah"));
    assert_eq!(masuk(&c, "admin", "sandiKecil").unwrap().iduser, "Admin");
    assert!(verifikasi_pengelola(&c, "admin", "sandiBesar").is_err());
    c.execute("UPDATE mduser SET aktif = 0", []).unwrap();
    assert!(masuk(&c, "admin", "sandiKecil").err().unwrap().contains("dinonaktifkan"));
    assert!(verifikasi_pengelola(&c, "admin", "sandiKecil").is_err());
    let _ = std::fs::remove_dir_all(d);
}

fn tambah_akun(c: &Connection, id: &str, sandi: Option<&str>, level: &str, aktif: i64) {
    use crate::auth::hash;
    let h = sandi.map(|s| hash(s).unwrap());
    c.execute(
        "INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES (?1, ?2, '-', ?3, ?4)",
        rusqlite::params![id, h, level, aktif],
    )
    .unwrap();
}

#[test]
fn password_sementara_tidak_menangkap_login_akun_senama() {
    use crate::auth::masuk;
    let (c, d) = setup();
    c.execute("DELETE FROM mduser", []).unwrap(); // buang akun bawaan 'admin'
    tambah_akun(&c, "ADMIN", None, "Manager", 1);
    tambah_akun(&c, "Admin", Some("rahasia"), "Supervisor", 1);
    // Nama beda huruf dengan akun kosong: password sementara tidak diterima, akun ber-password yang menang.
    assert_eq!(masuk(&c, "admin", "rahasia").unwrap().iduser, "Admin");
    assert_eq!(masuk(&c, "Admin", "rahasia").unwrap().iduser, "Admin");
    assert!(masuk(&c, "Admin", "admin").err().unwrap().contains("password salah"));
    assert!(masuk(&c, "admin", "admin").err().unwrap().contains("password salah"));
    // Hurufnya persis sama dengan akun kosong: password sementara diterima.
    let u = masuk(&c, "ADMIN", "admin").unwrap();
    assert_eq!((u.iduser.as_str(), u.must_change), ("ADMIN", true));
    // Pengelola: sama, password sementara tidak menangkap lewat nama beda huruf.
    assert!(verifikasi_pengelola(&c, "Admin", "admin").is_err());
    assert_eq!(verifikasi_pengelola(&c, "admin", "rahasia").unwrap().iduser, "Admin");
    // Password kosong ("") diperlakukan sama dengan NULL.
    c.execute("UPDATE mduser SET pswduser = '' WHERE iduser = 'ADMIN'", []).unwrap();
    assert!(masuk(&c, "aDMIN", "admin").is_err());
    assert_eq!(masuk(&c, "ADMIN", "admin").unwrap().iduser, "ADMIN");
    // Satu-satunya akun bernama itu: ketik huruf apa pun tetap bisa (perilaku lama).
    c.execute("DELETE FROM mduser WHERE iduser = 'Admin'", []).unwrap();
    assert_eq!(masuk(&c, "admin", "admin").unwrap().iduser, "ADMIN");
    assert_eq!(masuk(&c, "Admin", "admin").unwrap().iduser, "ADMIN");
    // Dua akun kosong: hanya yang hurufnya persis sama.
    tambah_akun(&c, "Admin", None, "Supervisor", 1);
    assert_eq!(masuk(&c, "Admin", "admin").unwrap().iduser, "Admin");
    assert_eq!(masuk(&c, "ADMIN", "admin").unwrap().iduser, "ADMIN");
    assert!(masuk(&c, "admin", "admin").is_err());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn pesan_dinonaktifkan_hanya_bila_password_cocok() {
    use crate::auth::masuk;
    let (c, d) = setup();
    c.execute("DELETE FROM mduser", []).unwrap(); // buang akun bawaan 'admin'
    tambah_akun(&c, "ADMIN", Some("sandiBesar"), "Manager", 0);
    tambah_akun(&c, "Admin", Some("sandiKecil"), "Supervisor", 1);
    assert!(masuk(&c, "ADMIN", "sandiBesar").err().unwrap().contains("dinonaktifkan"));
    assert!(masuk(&c, "admin", "sandiBesar").err().unwrap().contains("dinonaktifkan"));
    // Password tidak cocok dengan akun mana pun: pesan biasa, nama tidak bocor.
    assert!(masuk(&c, "ADMIN", "ngawur").err().unwrap().contains("password salah"));
    assert!(masuk(&c, "ADMIN", "sandiKecil").is_ok(), "password akun aktif senama tetap diterima");
    // Akun nonaktif tunggal.
    tambah_akun(&c, "budi", Some("pb"), "Kasir", 0);
    assert!(masuk(&c, "budi", "pb").err().unwrap().contains("dinonaktifkan"));
    assert!(masuk(&c, "budi", "salah").err().unwrap().contains("password salah"));
    assert!(masuk(&c, "tidakada", "x").err().unwrap().contains("password salah"));
    // Nonaktif tanpa password: pesan dinonaktifkan hanya dengan password sementara dan nama yang sah.
    tambah_akun(&c, "siti", None, "Kasir", 0);
    assert!(masuk(&c, "siti", "admin").err().unwrap().contains("dinonaktifkan"));
    assert!(masuk(&c, "siti", "lain").err().unwrap().contains("password salah"));
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn verifikasi_pengelola_pilih_akun_yang_levelnya_memenuhi() {
    let (c, d) = setup();
    c.execute("DELETE FROM mduser", []).unwrap(); // buang akun bawaan 'admin'
    tambah_akun(&c, "ADMIN", Some("sama"), "Kasir", 1);
    tambah_akun(&c, "Admin", Some("sama"), "Supervisor", 1);
    assert_eq!(verifikasi_pengelola(&c, "admin", "sama").unwrap().iduser, "Admin");
    assert_eq!(verifikasi_pengelola(&c, "ADMIN", "sama").unwrap().iduser, "Admin");
    // Akun pengelola nonaktif tidak dihitung.
    c.execute("UPDATE mduser SET aktif = 0 WHERE iduser = 'Admin'", []).unwrap();
    let m = verifikasi_pengelola(&c, "admin", "sama").unwrap_err();
    assert!(m.contains("berlevel Kasir"), "{m}");
    // Semua akun yang cocok berlevel Kasir.
    c.execute("UPDATE mduser SET aktif = 1, \"level\" = 'Lainnya' WHERE iduser = 'Admin'", []).unwrap();
    assert!(verifikasi_pengelola(&c, "admin", "sama").unwrap_err().contains("berlevel Kasir"));
    // Password tidak cocok: pesan salah biasa.
    assert!(verifikasi_pengelola(&c, "admin", "x").unwrap_err().contains("kata sandi salah"));
    let _ = std::fs::remove_dir_all(d);
}
