//! Lupa password Manager tanpa internet: tanya-jawab dengan HMAC-SHA256 dan kunci rahasia bersama.
//!
//! Aplikasi membuat kode permintaan acak (`XXXX-XXXX`), pemilik toko mengirimnya ke pengembang, dan pengembang
//! membalas kode reset (`XXXX-XXXX-XXXX`) dari `tools/kode_reset.mjs`. Rumusnya harus sama dengan alat itu:
//! HMAC-SHA256(kunci, kode permintaan yang sudah dinormalisasi), 60 bit pertama, ditulis dalam Base32 Crockford.

use crate::auth::{self, Session, User};
use crate::db::{e, Db, Res};
use hmac::{Hmac, KeyInit, Mac};
use perintah_macro::perintah;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::Sha256;

mod tertanam {
    include!(concat!(env!("OUT_DIR"), "/kunci_reset.rs"));
}

const ALFABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// Kunci uji: 32 byte 0x00..0x1f. Dipakai tes, dan build debug yang tidak punya kunci asli.
pub const KUNCI_UJI: [u8; 32] = {
    let mut k = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        k[i] = i as u8;
        i += 1;
    }
    k
};
/// Permintaan berlaku 24 jam.
const BERLAKU_DETIK: i64 = 24 * 3600;
const MAKS_SALAH: i64 = 5;

/// Kunci yang dipakai aplikasi. Tes selalu memakai kunci uji supaya hasilnya tetap.
fn kunci() -> [u8; 32] {
    if cfg!(test) {
        return KUNCI_UJI;
    }
    let mut k = [0u8; 32];
    for (i, b) in k.iter_mut().enumerate() {
        *b = tertanam::KUNCI_TERSAMAR[i] ^ tertanam::KUNCI_MASKER[i];
    }
    k
}

/// Huruf besar, buang spasi dan "-", lalu aturan Crockford: O jadi 0, I dan L jadi 1.
pub fn normalisasi(teks: &str) -> String {
    teks.to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

fn sah(norm: &str, panjang: usize) -> bool {
    norm.len() == panjang && norm.bytes().all(|b| ALFABET.contains(&b))
}

fn crockford(bit: u64, jumlah: usize) -> String {
    (0..jumlah).rev().map(|i| ALFABET[((bit >> (i * 5)) & 31) as usize] as char).collect()
}

/// Kode reset 12 karakter (tanpa "-") untuk kode permintaan yang sudah dinormalisasi.
pub fn hitung_kode_reset(kunci: &[u8], permintaan_norm: &str) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(kunci).expect("HMAC menerima kunci berapa pun panjangnya");
    mac.update(permintaan_norm.as_bytes());
    let h = mac.finalize().into_bytes();
    let awal = u64::from_be_bytes(h[..8].try_into().unwrap());
    crockford(awal >> 4, 12)
}

fn kelompok(s: &str, lebar: usize) -> String {
    s.as_bytes().chunks(lebar).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("-")
}

/// Bandingkan dalam waktu tetap.
fn sama(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn kode_permintaan_baru() -> Res<String> {
    let mut b = [0u8; 5];
    getrandom::fill(&mut b).map_err(|x| format!("Komputer ini belum bisa membuat kode. Coba lagi. ({x})"))?;
    Ok(crockford(b.iter().fold(0u64, |a, x| (a << 8) | *x as u64), 8))
}

pub fn sekarang_detik() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Akun Manager aktif yang `iduser`-nya persis sama (huruf besar-kecil dibedakan).
fn manager_aktif(conn: &Connection, iduser: &str) -> Res<User> {
    let Some((_, user, aktif)) = auth::load(conn, iduser)? else { return Err("Akun Manager itu tidak ditemukan.".into()) };
    if user.iduser != iduser || user.level != "Manager" {
        return Err("Akun Manager itu tidak ditemukan.".into());
    }
    if aktif == 0 {
        return Err("Akun ini sedang dinonaktifkan, jadi passwordnya tidak bisa direset.".into());
    }
    Ok(user)
}

/// Akun Manager yang aktif: `iduser` persis seperti tersimpan dan nama karyawan.
pub fn daftar_manager(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn
        .prepare(
            "SELECT u.iduser, COALESCE(k.namakaryawan, u.iduser) FROM mduser u LEFT JOIN mdkaryawan k ON k.kodekaryawan = u.kodekaryawan
             WHERE u.\"level\" = 'Manager' AND COALESCE(u.aktif,1) != 0 ORDER BY u.iduser",
        )
        .map_err(e)?;
    let v = st
        .query_map([], |r| Ok(json!({ "iduser": r.get::<_, String>(0)?, "nama": r.get::<_, String>(1)? })))
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(v)
}

/// Kode permintaan untuk satu Manager (`XXXX-XXXX`). Permintaan yang masih berlaku dipakai lagi.
pub fn minta_kode_pada(conn: &Connection, iduser: &str, sekarang: i64) -> Res<String> {
    manager_aktif(conn, iduser)?;
    let ada: Option<(String, i64, i64)> = conn
        .query_row("SELECT kode, dibuat, salah FROM reset_manager WHERE iduser = ?1", params![iduser], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()
        .map_err(e)?;
    if let Some((kode, dibuat, salah)) = ada {
        if sekarang - dibuat < BERLAKU_DETIK && salah < MAKS_SALAH {
            return Ok(kelompok(&kode, 4));
        }
    }
    let kode = kode_permintaan_baru()?;
    conn.execute("INSERT OR REPLACE INTO reset_manager (iduser, kode, dibuat, salah) VALUES (?1, ?2, ?3, 0)", params![iduser, kode, sekarang]).map_err(e)?;
    Ok(kelompok(&kode, 4))
}

/// Periksa kode reset. Kalau cocok, password baru disimpan dan akunnya dikembalikan (untuk langsung masuk).
pub fn periksa_pada(conn: &mut Connection, kunci: &[u8], iduser: &str, kode_reset: &str, password_baru: &str, sekarang: i64) -> Res<User> {
    let mut user = manager_aktif(conn, iduser)?;
    let minta_lagi = "Silakan minta kode baru, lalu kirim ke pengembang KasirJet.";
    let Some((kode, dibuat, salah)) = conn
        .query_row("SELECT kode, dibuat, salah FROM reset_manager WHERE iduser = ?1", params![iduser], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
        .optional()
        .map_err(e)?
    else {
        return Err(format!("Belum ada permintaan reset untuk akun ini. {minta_lagi}"));
    };
    if sekarang - dibuat >= BERLAKU_DETIK {
        conn.execute("DELETE FROM reset_manager WHERE iduser = ?1", params![iduser]).map_err(e)?;
        return Err(format!("Kode permintaan sudah lewat 24 jam. {minta_lagi}"));
    }
    let masuk = normalisasi(kode_reset);
    if !sah(&masuk, 12) {
        return Err("Kode reset terdiri dari 12 huruf dan angka, mis. XXXX-XXXX-XXXX. Periksa lagi kode dari pengembang.".into());
    }
    if !sama(&masuk, &hitung_kode_reset(kunci, &kode)) {
        let baru = salah + 1;
        if baru >= MAKS_SALAH {
            conn.execute("DELETE FROM reset_manager WHERE iduser = ?1", params![iduser]).map_err(e)?;
            return Err(format!("Kode reset salah {MAKS_SALAH} kali, jadi permintaan ini dibatalkan. {minta_lagi}"));
        }
        conn.execute("UPDATE reset_manager SET salah = ?1 WHERE iduser = ?2", params![baru, iduser]).map_err(e)?;
        return Err(format!("Kode reset belum cocok. Periksa lagi kodenya. Sisa kesempatan: {}.", MAKS_SALAH - baru));
    }
    if password_baru.is_empty() {
        return Err("Kata sandi baru belum diisi.".into());
    }
    let hash = auth::hash(password_baru)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    tx.execute(
        "UPDATE mduser SET pswduser = ?1, tglupdate = date('now','localtime'), jamupdate = time('now','localtime') WHERE iduser = ?2",
        params![hash, iduser],
    )
    .map_err(e)?;
    tx.execute("DELETE FROM reset_manager WHERE iduser = ?1", params![iduser]).map_err(e)?;
    tx.execute(
        "INSERT INTO applog (tgl, jam, kodekaryawan, keterangan, noref) VALUES (date('now','localtime'), time('now','localtime'), ?1, ?2, '')",
        params![user.kodekaryawan, format!("Password Manager {iduser} direset dengan kode dari pengembang")],
    )
    .map_err(e)?;
    tx.commit().map_err(e)?;
    user.must_change = false;
    Ok(user)
}

#[perintah]
pub fn reset_daftar_manager(db: &Db) -> Res<Vec<Value>> {
    { let c = db.lock()?; daftar_manager(&c) }
}

#[perintah]
pub fn reset_minta_kode(db: &Db, iduser: String) -> Res<String> {
    { let c = db.lock()?; minta_kode_pada(&c, &iduser, sekarang_detik()) }
}

#[perintah]
pub fn reset_periksa(db: &Db, session: &Session, iduser: String, kode_reset: String, password_baru: String) -> Res<User> {
    let user = {
        let mut conn = db.lock()?;
        periksa_pada(&mut conn, &kunci(), &iduser, &kode_reset, &password_baru, sekarang_detik())?
    };
    *session.0.lock().map_err(e)? = Some(user.clone());
    Ok(user)
}
