//! Tabel `perangkat`: komputer kasir yang sudah disambungkan ke Pusat. Token perangkat tidak disimpan, hanya sidik SHA-256.

use crate::db::{e, Res};
use crate::sesi::{sidik, token_acak, DaftarSesi};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

pub struct Perangkat {
    pub id: i64,
    pub nama: String,
}

/// Daftarkan perangkat baru dan kembalikan id serta token-nya (token hanya diberikan sekali).
pub fn tambah(conn: &Connection, nama: &str, otomatis: bool) -> Res<(i64, String)> {
    let token = token_acak()?;
    conn.execute(
        "INSERT INTO perangkat (nama_komputer, token_hash, dibuat, terakhir_terlihat, aktif, otomatis) VALUES (?1, ?2, unixepoch(), unixepoch(), 1, ?3)",
        params![nama, sidik(&token), otomatis as i64],
    )
    .map_err(e)?;
    Ok((conn.last_insert_rowid(), token))
}

/// Perangkat dengan token ini, bila masih aktif. Sekaligus mencatat waktu terakhir terlihat.
pub fn cari_token(conn: &Connection, token: &str) -> Res<Option<Perangkat>> {
    let hash = sidik(token);
    let p = conn
        .query_row("SELECT id, nama_komputer FROM perangkat WHERE token_hash = ?1 AND aktif = 1", params![hash], |r| {
            Ok(Perangkat { id: r.get(0)?, nama: r.get(1)? })
        })
        .optional()
        .map_err(e)?;
    if let Some(p) = &p {
        conn.execute("UPDATE perangkat SET terakhir_terlihat = unixepoch() WHERE id = ?1", params![p.id]).map_err(e)?;
    }
    Ok(p)
}

/// Perangkat aktif, dengan pengguna yang sedang masuk di dalamnya (bila ada).
pub fn daftar(conn: &Connection) -> Res<Vec<Value>> {
    let mut st = conn
        .prepare(
            "SELECT p.id, p.nama_komputer, p.dibuat, p.terakhir_terlihat, p.otomatis,
                    (SELECT s.iduser FROM sesi_perangkat s WHERE s.idperangkat = CAST(p.id AS TEXT) AND s.iduser IS NOT NULL
                     ORDER BY s.terakhir DESC LIMIT 1)
             FROM perangkat p WHERE p.aktif = 1 ORDER BY p.id",
        )
        .map_err(e)?;
    let v = st
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "namaKomputer": r.get::<_, String>(1)?,
                "dibuat": r.get::<_, i64>(2)?,
                "terakhirTerlihat": r.get::<_, i64>(3)?,
                "otomatis": r.get::<_, i64>(4)? != 0,
                "pengguna": r.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(v)
}

/// Jumlah komputer kasir yang dianggap tersambung: ada pengguna yang sedang masuk, atau terlihat dalam 3 menit terakhir.
pub fn jumlah_tersambung(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM perangkat p WHERE p.aktif = 1 AND (p.terakhir_terlihat >= unixepoch() - 180
           OR EXISTS (SELECT 1 FROM sesi_perangkat s WHERE s.idperangkat = CAST(p.id AS TEXT) AND s.iduser IS NOT NULL))",
        [],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// Cabut perangkat: tokennya tidak lagi diterima dan semua sesinya berakhir.
pub fn putuskan(conn: &Connection, sesi: &DaftarSesi, id: i64) -> Res<()> {
    conn.execute("UPDATE perangkat SET aktif = 0 WHERE id = ?1", params![id]).map_err(e)?;
    sesi.cabut_perangkat(conn, &id.to_string())
}

/// Salinan isi tabel `perangkat` (semua kolom, urut kolom di tabel), untuk dikembalikan setelah data toko dipulihkan.
pub fn salin(conn: &Connection) -> Res<Vec<Vec<rusqlite::types::Value>>> {
    let mut st = conn.prepare("SELECT id, nama_komputer, token_hash, dibuat, terakhir_terlihat, aktif, otomatis FROM perangkat").map_err(e)?;
    let v = st
        .query_map([], |r| (0..7).map(|i| r.get::<_, rusqlite::types::Value>(i)).collect::<Result<Vec<_>, _>>())
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(v)
}

/// Ganti isi `perangkat` dengan `baris` dari `salin`, dan hapus semua sesi komputer Kasir (di database; `DaftarSesi::bersihkan` membuang yang di memori).
pub fn pulihkan(conn: &Connection, baris: &[Vec<rusqlite::types::Value>]) -> Res<()> {
    conn.execute("DELETE FROM perangkat", []).map_err(e)?;
    conn.execute("DELETE FROM sesi_perangkat", []).map_err(e)?;
    for b in baris {
        conn.execute(
            "INSERT INTO perangkat (id, nama_komputer, token_hash, dibuat, terakhir_terlihat, aktif, otomatis) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params_from_iter(b.iter()),
        )
        .map_err(e)?;
    }
    Ok(())
}
