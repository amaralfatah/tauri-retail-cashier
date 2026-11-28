//! Uji "Lupa password" Manager: vektor HMAC (sama dengan tools/kode-reset.test.mjs), kode benar/salah, kedaluwarsa, dan akun.

use crate::auth::{self, Session};
use crate::db::Db;
use crate::jaringan::golongan::{golongan, Golongan};
use crate::konteks::Konteks;
use crate::reset_manager::*;
use crate::dispatch;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Mutex;

fn siapkan() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    crate::migrasi::siapkan(&mut conn).unwrap();
    conn.execute("DELETE FROM mduser", []).unwrap();
    let h = auth::hash("lama123").unwrap();
    for (id, level, aktif) in [("ADMIN", "Manager", 1), ("Admin", "Supervisor", 1), ("bos2", "Manager", 0), ("kasir1", "Kasir", 1)] {
        conn.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES (?1, ?2, '-', ?3, ?4)", rusqlite::params![id, h, level, aktif]).unwrap();
    }
    conn
}

fn kode_benar(conn: &Connection, iduser: &str) -> String {
    let permintaan: String = conn.query_row("SELECT kode FROM reset_manager WHERE iduser = ?1", [iduser], |r| r.get(0)).unwrap();
    hitung_kode_reset(&KUNCI_UJI, &permintaan)
}

fn salah(conn: &Connection, iduser: &str) -> i64 {
    conn.query_row("SELECT salah FROM reset_manager WHERE iduser = ?1", [iduser], |r| r.get(0)).unwrap()
}

fn ada_baris(conn: &Connection, iduser: &str) -> bool {
    conn.query_row("SELECT COUNT(*) FROM reset_manager WHERE iduser = ?1", [iduser], |r| r.get::<_, i64>(0)).unwrap() > 0
}

#[test]
fn vektor_uji_hmac_sama_dengan_alat_js() {
    for (permintaan, kode) in [("7KQ2M9XA", "31RV9R1HEZQY"), ("01234567", "2J84SSFYP5RE"), ("ZZZZZZZZ", "KXGV1V5H8YSK")] {
        assert_eq!(hitung_kode_reset(&KUNCI_UJI, permintaan), kode, "{permintaan}");
    }
    assert_eq!(normalisasi(" 7kq2-m9xa "), "7KQ2M9XA");
    assert_eq!(normalisasi("OIL0-1111"), "01101111");
}

#[test]
fn kode_benar_mengganti_password_dan_bisa_login() {
    let mut conn = siapkan();
    let minta = minta_kode_pada(&conn, "ADMIN", 1000).unwrap();
    assert_eq!(minta.len(), 9);
    assert_eq!(minta.as_bytes()[4], b'-');
    // Permintaan yang masih berlaku mengembalikan kode yang sama.
    assert_eq!(minta_kode_pada(&conn, "ADMIN", 2000).unwrap(), minta);
    let kode = kode_benar(&conn, "ADMIN");
    let tampil = format!("{}-{}-{}", &kode[..4], &kode[4..8], &kode[8..]).to_lowercase();
    // Password kosong tidak menghabiskan permintaan.
    assert!(periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", &tampil, "", 3000).is_err());
    assert!(ada_baris(&conn, "ADMIN"));
    let u = periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", &tampil, "baru456", 3000).unwrap();
    assert_eq!(u.iduser, "ADMIN");
    assert_eq!(u.level, "Manager");
    assert!(!u.must_change);
    assert!(!ada_baris(&conn, "ADMIN"));
    assert_eq!(auth::masuk(&conn, "ADMIN", "baru456").unwrap().iduser, "ADMIN");
    // Password lama kini hanya cocok dengan akun senama berlevel Supervisor, bukan Manager.
    assert_eq!(auth::masuk(&conn, "ADMIN", "lama123").unwrap().iduser, "Admin");
    // Akun senama berlevel lain tidak ikut berubah.
    let lain: String = conn.query_row("SELECT pswduser FROM mduser WHERE iduser = 'Admin'", [], |r| r.get(0)).unwrap();
    assert!(lain.starts_with("$argon2"));
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM applog WHERE keterangan LIKE 'Password Manager ADMIN direset%'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn salah_lima_kali_hangus() {
    let mut conn = siapkan();
    minta_kode_pada(&conn, "ADMIN", 1000).unwrap();
    let benar = kode_benar(&conn, "ADMIN");
    for i in 1..5 {
        let err = periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", "AAAA-AAAA-AAAA", "x", 1100).unwrap_err();
        assert!(err.contains(&format!("Sisa kesempatan: {}", 5 - i)), "{err}");
        assert_eq!(salah(&conn, "ADMIN"), i);
    }
    let err = periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", "AAAA-AAAA-AAAA", "x", 1100).unwrap_err();
    assert!(err.contains("minta kode baru"), "{err}");
    assert!(!ada_baris(&conn, "ADMIN"));
    // Kode yang tadinya benar tidak berlaku lagi.
    assert!(periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", &benar, "baru", 1200).unwrap_err().contains("Belum ada permintaan"));
    assert_eq!(auth::masuk(&conn, "ADMIN", "lama123").unwrap().iduser, "ADMIN");
}

#[test]
fn kedaluwarsa_setelah_24_jam() {
    let mut conn = siapkan();
    minta_kode_pada(&conn, "ADMIN", 1000).unwrap();
    let kode = kode_benar(&conn, "ADMIN");
    let err = periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", &kode, "baru", 1000 + 24 * 3600).unwrap_err();
    assert!(err.contains("24 jam"), "{err}");
    assert!(!ada_baris(&conn, "ADMIN"));
    // Permintaan lama yang kedaluwarsa diganti kode baru.
    let a = minta_kode_pada(&conn, "ADMIN", 5000).unwrap();
    conn.execute("UPDATE reset_manager SET dibuat = 1 WHERE iduser = 'ADMIN'", []).unwrap();
    let b = minta_kode_pada(&conn, "ADMIN", 1 + 24 * 3600).unwrap();
    assert_ne!(a, b);
}

#[test]
fn akun_bukan_manager_nonaktif_atau_beda_huruf_ditolak() {
    let mut conn = siapkan();
    for id in ["Admin", "bos2", "kasir1", "admin", "tidak-ada"] {
        assert!(minta_kode_pada(&conn, id, 1000).is_err(), "{id}");
        assert!(periksa_pada(&mut conn, &KUNCI_UJI, id, "AAAA-AAAA-AAAA", "x", 1000).is_err(), "{id}");
    }
    let daftar = daftar_manager(&conn).unwrap();
    assert_eq!(daftar.len(), 1);
    assert_eq!(daftar[0]["iduser"], "ADMIN");
}

#[test]
fn kode_dengan_panjang_salah_tidak_memakai_kesempatan() {
    let mut conn = siapkan();
    minta_kode_pada(&conn, "ADMIN", 1000).unwrap();
    assert!(periksa_pada(&mut conn, &KUNCI_UJI, "ADMIN", "ABC", "x", 1100).is_err());
    assert_eq!(salah(&conn, "ADMIN"), 0);
}

#[test]
fn perintah_lewat_dispatch_mengatur_sesi_dan_masuk_golongan_khusus_pusat() {
    for n in ["reset_daftar_manager", "reset_minta_kode", "reset_periksa"] {
        assert_eq!(golongan(n), Some(Golongan::KhususPusat), "{n}");
    }
    let db = Db(Mutex::new(siapkan()));
    let sesi = Session::default();
    let k = Konteks::baru(&db, &sesi);
    let panggil = |n: &str, a: Value| {
        let Value::Object(m) = a else { panic!() };
        dispatch(&k, n, &m)
    };
    assert_eq!(panggil("reset_daftar_manager", json!({})).unwrap().as_array().unwrap().len(), 1);
    panggil("reset_minta_kode", json!({ "iduser": "ADMIN" })).unwrap();
    let kode = kode_benar(&db.lock().unwrap(), "ADMIN");
    let u = panggil("reset_periksa", json!({ "iduser": "ADMIN", "kodeReset": kode, "passwordBaru": "baru456" })).unwrap();
    assert_eq!(u["iduser"], "ADMIN");
    assert_eq!(sesi.user().unwrap().iduser, "ADMIN");
}
