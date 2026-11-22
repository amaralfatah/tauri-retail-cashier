//! Jenis pembayaran non tunai (misalnya Kartu Debit) dan itemnya (misalnya BCA, QRIS).

use crate::auth::{Session, User};
use crate::db::{e, rows, Db, Res};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use tauri::State;

fn hanya_pengelola(user: &User) -> Res<()> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengubah jenis pembayaran non tunai.".into());
    }
    Ok(())
}

pub fn daftar(conn: &Connection) -> Res<Value> {
    Ok(json!({
        "jenis": rows(conn, "SELECT kode, namajenis FROM mdjenisnontunai ORDER BY kode", [])?,
        "item": rows(
            conn,
            "SELECT i.kode, j.namajenis, i.namaitem FROM mdjenisnontunaiitem i LEFT JOIN mdjenisnontunai j ON j.kode = i.kode ORDER BY i.kode, i.namaitem",
            [],
        )?,
    }))
}

pub fn simpan_jenis(conn: &Connection, kode: &str, nama: &str, asli: Option<&str>) -> Res<()> {
    let (kode, nama) = (kode.trim(), nama.trim());
    let _ = asli;
    if kode.is_empty() || nama.is_empty() {
        return Err("Item data harus diisi lengkap!".into());
    }
    // Seperti aslinya (SaveData): kode yang sudah ada diperbarui namanya, kode baru ditambahkan (kode tidak dikunci saat mengubah).
    let ada: i64 = conn.query_row("SELECT COUNT(*) FROM mdjenisnontunai WHERE UPPER(kode) = UPPER(?1)", params![kode], |r| r.get(0)).map_err(e)?;
    if ada > 0 {
        conn.execute("UPDATE mdjenisnontunai SET namajenis = ?1 WHERE UPPER(kode) = UPPER(?2)", params![nama, kode]).map_err(e)?;
    } else {
        conn.execute("INSERT INTO mdjenisnontunai (kode, namajenis) VALUES (?1, ?2)", params![kode, nama]).map_err(e)?;
    }
    Ok(())
}

pub fn hapus_jenis(conn: &Connection, kode: &str) -> Res<()> {
    // Seperti aslinya (ON DELETE CASCADE): semua item jenis ini ikut terhapus.
    conn.execute("DELETE FROM mdjenisnontunaiitem WHERE UPPER(kode) = UPPER(?1)", params![kode]).map_err(e)?;
    let n = conn.execute("DELETE FROM mdjenisnontunai WHERE UPPER(kode) = UPPER(?1)", params![kode]).map_err(e)?;
    if n == 0 {
        return Err("Jenis pembayaran ini tidak ditemukan.".into());
    }
    Ok(())
}

pub fn simpan_item(conn: &Connection, kode: &str, nama: &str, asli: Option<&str>) -> Res<()> {
    let (kode, nama) = (kode.trim(), nama.trim());
    if kode.is_empty() || nama.is_empty() {
        return Err("Item data harus diisi lengkap!".into());
    }
    let jenis: i64 = conn.query_row("SELECT COUNT(*) FROM mdjenisnontunai WHERE UPPER(kode) = UPPER(?1)", params![kode], |r| r.get(0)).map_err(e)?;
    if jenis == 0 {
        return Err("Jenis pembayarannya belum ada. Tambahkan dulu jenisnya.".into());
    }
    let sama = |n: &str| -> Res<i64> {
        conn.query_row(
            "SELECT COUNT(*) FROM mdjenisnontunaiitem WHERE UPPER(kode) = UPPER(?1) AND UPPER(namaitem) = UPPER(?2)",
            params![kode, n],
            |r| r.get(0),
        ).map_err(e)
    };
    match asli {
        Some(a) => {
            // Nama sama dengan item lain di jenis ini: aslinya hanya memperbarui baris bernama sama, tidak menolak.
            if !a.eq_ignore_ascii_case(nama) && sama(nama)? > 0 {
                return Ok(());
            }
            conn.execute(
                "UPDATE mdjenisnontunaiitem SET namaitem = ?1 WHERE UPPER(kode) = UPPER(?2) AND UPPER(namaitem) = UPPER(?3)",
                params![nama, kode, a],
            ).map_err(e)?;
        }
        None => {
            if sama(nama)? > 0 {
                return Ok(());
            }
            conn.execute("INSERT INTO mdjenisnontunaiitem (kode, namaitem) VALUES (?1, ?2)", params![kode, nama]).map_err(e)?;
        }
    }
    Ok(())
}

pub fn hapus_item(conn: &Connection, kode: &str, nama: &str) -> Res<()> {
    let n = conn
        .execute("DELETE FROM mdjenisnontunaiitem WHERE UPPER(kode) = UPPER(?1) AND UPPER(namaitem) = UPPER(?2)", params![kode, nama])
        .map_err(e)?;
    if n == 0 {
        return Err("Item pembayaran ini tidak ditemukan.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn nt_list(db: State<Db>, session: State<Session>) -> Res<Value> {
    session.user()?;
    daftar(&*db.lock()?)
}

#[tauri::command]
pub fn nt_jenis_save(db: State<Db>, session: State<Session>, kode: String, nama: String, asli: Option<String>) -> Res<()> {
    hanya_pengelola(&session.user()?)?;
    simpan_jenis(&*db.lock()?, &kode, &nama, asli.as_deref())
}

#[tauri::command]
pub fn nt_jenis_delete(db: State<Db>, session: State<Session>, kode: String) -> Res<()> {
    hanya_pengelola(&session.user()?)?;
    hapus_jenis(&*db.lock()?, &kode)
}

#[tauri::command]
pub fn nt_item_save(db: State<Db>, session: State<Session>, kode: String, nama: String, asli: Option<String>) -> Res<()> {
    hanya_pengelola(&session.user()?)?;
    simpan_item(&*db.lock()?, &kode, &nama, asli.as_deref())
}

#[tauri::command]
pub fn nt_item_delete(db: State<Db>, session: State<Session>, kode: String, nama: String) -> Res<()> {
    hanya_pengelola(&session.user()?)?;
    hapus_item(&*db.lock()?, &kode, &nama)
}
