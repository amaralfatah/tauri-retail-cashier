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
