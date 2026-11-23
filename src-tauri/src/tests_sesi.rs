//! Uji sesi per komputer: dua sesi terpisah, bertahan setelah dimuat ulang, dan asal panggilan.

use crate::auth;
use crate::db::{self, Db};
use crate::konteks::Konteks;
use crate::sesi::{catat_setelah_perintah, DaftarSesi, TOKEN_LOKAL};
use crate::dispatch;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

fn siapkan() -> (Db, PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-sesi-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    let hash = auth::hash("rahasia").unwrap();
    conn.execute(
        "INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('bos', ?1, '-', 'Manager', 1), ('kasir1', ?1, '-', 'Kasir', 1)",
        [&hash],
    )
    .unwrap();
    // Kasir1 hanya boleh membuka satu menu.
    let mgr = auth::User { iduser: "bos".into(), kodekaryawan: "-".into(), namakaryawan: "bos".into(), level: "Manager".into(), must_change: false };
    let mut conn = conn;
    let id: String = conn.query_row("SELECT idmenu FROM mdmenu WHERE namamenu='mnTRTrPenjualan'", [], |r| r.get(0)).unwrap_or_else(|_| {
        // MDMENU diisi saat pertama kali dibutuhkan.
        auth::daftar_akses(&conn, &mgr, "kasir1").unwrap();
        conn.query_row("SELECT idmenu FROM mdmenu WHERE namamenu='mnTRTrPenjualan'", [], |r| r.get(0)).unwrap()
    });
    auth::simpan_akses(&mut conn, &mgr, "kasir1", &[id]).unwrap();
    (Db(Mutex::new(conn)), dir)
}

/// Satu perintah seperti yang dilakukan `jalankan`: pilih sesi menurut token, jalankan, lalu catat.
fn panggil(db: &Db, daftar: &DaftarSesi, token: &str, nama: &str, args: Value) -> Result<Value, String> {
    let Value::Object(m) = args else { panic!() };
    let sesi = daftar.cari(token).expect("token dikenal");
    let hasil = dispatch(&Konteks::baru(db, &sesi), nama, &m);
    catat_setelah_perintah(db, daftar, token, &sesi);
    hasil
}

fn login(db: &Db, d: &DaftarSesi, token: &str, id: &str) {
    panggil(db, d, token, "login", json!({"iduser": id, "password": "rahasia"})).unwrap();
}

#[test]
fn dua_sesi_berbeda_pengguna_dan_hak_menu() {
    let (db, _dir) = siapkan();
    let d = DaftarSesi::baru();
    let (t1, t2) = {
        let c = db.lock().unwrap();
        (d.buat(&c, "komputer-a").unwrap(), d.buat(&c, "komputer-b").unwrap())
    };
    assert_ne!(t1, t2);
    login(&db, &d, &t1, "bos");
    login(&db, &d, &t2, "kasir1");

    let u1 = panggil(&db, &d, &t1, "current_user", json!({})).unwrap();
    let u2 = panggil(&db, &d, &t2, "current_user", json!({})).unwrap();
    assert_eq!(u1["iduser"], "bos");
    assert_eq!(u2["iduser"], "kasir1");
    // Sesi "lokal" tidak ikut masuk.
    assert!(panggil(&db, &d, TOKEN_LOKAL, "current_user", json!({})).unwrap().is_null());

    let m1 = panggil(&db, &d, &t1, "my_menus", json!({})).unwrap();
    let m2 = panggil(&db, &d, &t2, "my_menus", json!({})).unwrap();
    assert_ne!(m1, m2, "menu berbeda per sesi");
    // `my_menus` mengembalikan menu yang ditolak: Manager tidak ada, Kasir banyak.
    assert!(m1.as_array().unwrap().is_empty());
    let ditolak: Vec<&str> = m2.as_array().unwrap().iter().filter_map(|x| x.as_str()).collect();
    assert!(ditolak.contains(&"mnMDDataBarang") && !ditolak.contains(&"mnTRTrPenjualan"));

    let k1 = d.cari(&t1).unwrap();
    let k2 = d.cari(&t2).unwrap();
    let conn = db.lock().unwrap();
    assert!(auth::require_menu(&conn, &k1.user().unwrap(), "mnMDDataBarang").is_ok());
    assert!(auth::require_menu(&conn, &k2.user().unwrap(), "mnMDDataBarang").is_err());
    assert!(auth::require_menu(&conn, &k2.user().unwrap(), "mnTRTrPenjualan").is_ok());
    drop(conn);

    // Logout di satu komputer tidak memengaruhi yang lain.
    panggil(&db, &d, &t2, "logout", json!({})).unwrap();
    assert!(panggil(&db, &d, &t2, "current_user", json!({})).unwrap().is_null());
    assert_eq!(panggil(&db, &d, &t1, "current_user", json!({})).unwrap()["iduser"], "bos");
}

#[test]
fn sesi_bertahan_setelah_dimuat_ulang() {
    let (db, _dir) = siapkan();
    let d = DaftarSesi::baru();
    let (t1, t2) = {
        let c = db.lock().unwrap();
        (d.buat(&c, "a").unwrap(), d.buat(&c, "b").unwrap())
    };
    login(&db, &d, &t1, "bos");
    login(&db, &d, &t2, "kasir1");
    login(&db, &d, TOKEN_LOKAL, "bos");

    // Pusat dinyalakan ulang: daftar dimuat dari database.
    let d2 = DaftarSesi::muat(&db.lock().unwrap()).unwrap();
    assert_eq!(d2.cari(&t1).unwrap().user().unwrap().iduser, "bos");
    assert_eq!(d2.cari(&t2).unwrap().user().unwrap().iduser, "kasir1");
    // "lokal" selalu mulai kosong, seperti sebelumnya.
    assert!(d2.cari(TOKEN_LOKAL).unwrap().user().is_err());
    assert!(d2.cari("token-asal-asalan").is_none());
    // Hak menu tetap dihitung dari pengguna yang dimuat.
    let m2 = panggil(&db, &d2, &t2, "my_menus", json!({})).unwrap();
    assert!(m2.as_array().unwrap().iter().any(|x| x == "mnMDDataBarang"));

    // Akun dinonaktifkan: sesinya keluar saat dimuat ulang.
    db.lock().unwrap().execute("UPDATE mduser SET aktif = 0 WHERE iduser = 'kasir1'", []).unwrap();
    let d3 = DaftarSesi::muat(&db.lock().unwrap()).unwrap();
    assert!(d3.cari(&t2).unwrap().user().is_err());
    assert_eq!(d3.cari(&t1).unwrap().user().unwrap().iduser, "bos");

    // Logout tercatat: sesi tetap ada tetapi kosong setelah dimuat ulang.
    panggil(&db, &d3, &t1, "logout", json!({})).unwrap();
    let d4 = DaftarSesi::muat(&db.lock().unwrap()).unwrap();
    assert!(d4.cari(&t1).unwrap().user().is_err());

    // Sesi yang lama diam dibuang; dicabut tidak bisa dipakai lagi.
    db.lock().unwrap().execute("UPDATE sesi_perangkat SET terakhir = terakhir - 13*3600", []).unwrap();
    let d5 = DaftarSesi::muat(&db.lock().unwrap()).unwrap();
    assert!(d5.cari(&t1).is_none());
    let t3 = d5.buat(&db.lock().unwrap(), "c").unwrap();
    d5.cabut(&db.lock().unwrap(), &t3).unwrap();
    assert!(d5.cari(&t3).is_none());
}

#[test]
fn restore_session_ditolak_lewat_jaringan() {
    let (db, _dir) = siapkan();
    let d = DaftarSesi::baru();
    let sesi = d.cari(TOKEN_LOKAL).unwrap();
    let Value::Object(m) = json!({"iduser": "bos"}) else { unreachable!() };
    let hasil = dispatch(&Konteks::baru(&db, &sesi).dari_jaringan(), "restore_session", &m).unwrap();
    assert!(hasil.is_null());
    assert!(sesi.user().is_err(), "sesi tidak boleh terisi lewat jaringan");
    // Dari jendela lokal (build debug) tetap berfungsi seperti sebelumnya.
    let hasil = dispatch(&Konteks::baru(&db, &sesi), "restore_session", &m).unwrap();
    assert_eq!(hasil["iduser"], "bos");
}
