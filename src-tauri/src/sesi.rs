//! Sesi per komputer: satu `Session` untuk setiap token. Jendela komputer ini memakai token `"lokal"`;
//! komputer Kasir (tahap berikutnya) memakai token yang dibuat di sini. Sesi bertoken disimpan di tabel
//! `sesi_perangkat` supaya tetap ada setelah aplikasi dinyalakan ulang.

// Sebagian pembantu baru dipakai server Pusat (tahap 3); sekarang hanya diuji.
#![allow(dead_code)]

use crate::auth::{self, Session};
use crate::db::{e, Db, Res};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Token untuk jendela di komputer ini. Tidak disimpan ke database, jadi mode Tunggal tidak berubah.
pub const TOKEN_LOKAL: &str = "lokal";

/// Sesi yang tidak dipakai selama ini dihapus.
pub(crate) const BATAS_DIAM_DETIK: i64 = 12 * 3600;

#[derive(Default)]
pub struct DaftarSesi(Mutex<HashMap<String, Arc<Session>>>);

/// Sidik token yang disimpan di database (token aslinya tidak pernah disimpan).
pub(crate) fn sidik(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn token_acak() -> Res<String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(e)?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

impl DaftarSesi {
    /// Daftar kosong yang sudah berisi sesi `"lokal"`.
    pub fn baru() -> Self {
        let d = DaftarSesi::default();
        d.ambil(TOKEN_LOKAL);
        d
    }

    /// Daftar berisi sesi `"lokal"` ditambah sesi tersimpan di database. `User` dibaca ulang dari `mduser`;
    /// akun yang sudah dinonaktifkan atau dihapus tidak ikut masuk, dan sesi yang terlalu lama diam dibuang.
    pub fn muat(conn: &Connection) -> Res<Self> {
        let d = DaftarSesi::baru();
        conn.execute("DELETE FROM sesi_perangkat WHERE terakhir < unixepoch() - ?1", params![BATAS_DIAM_DETIK]).map_err(e)?;
        let baris: Vec<(String, Option<String>)> = {
            let mut st = conn.prepare("SELECT token_hash, iduser FROM sesi_perangkat").map_err(e)?;
            let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
            v
        };
        let mut peta = d.0.lock().map_err(e)?;
        for (hash, iduser) in baris {
            let user = match iduser {
                Some(id) => auth::user_aktif(conn, &id)?,
                None => None,
            };
            if user.is_none() {
                // Akun sudah tidak aktif: sesinya keluar sekarang juga.
                conn.execute("UPDATE sesi_perangkat SET iduser = NULL WHERE token_hash = ?1", params![hash]).map_err(e)?;
            }
            // Token asli tidak disimpan, jadi daftar di memori berkunci sidik token (kecuali "lokal").
            peta.insert(hash, Arc::new(Session(Mutex::new(user))));
        }
        drop(peta);
        Ok(d)
    }

    /// Sesi untuk token ini; dibuat kosong bila belum ada. Dipakai untuk `"lokal"`.
    pub fn ambil(&self, token: &str) -> Arc<Session> {
        let kunci = if token == TOKEN_LOKAL { token.to_string() } else { sidik(token) };
        self.0.lock().unwrap_or_else(|p| p.into_inner()).entry(kunci).or_default().clone()
    }

    /// Sesi untuk token yang sudah pernah dibuat; `None` bila tidak dikenal (permintaan jaringan ditolak 401).
    pub fn cari(&self, token: &str) -> Option<Arc<Session>> {
        let kunci = if token == TOKEN_LOKAL { token.to_string() } else { sidik(token) };
        self.0.lock().unwrap_or_else(|p| p.into_inner()).get(&kunci).cloned()
    }

    /// Buat sesi baru (kosong) untuk satu perangkat dan kembalikan token-nya.
    pub fn buat(&self, conn: &Connection, idperangkat: &str) -> Res<String> {
        let token = token_acak()?;
        conn.execute(
            "INSERT INTO sesi_perangkat (token_hash, idperangkat, iduser, mulai, terakhir) VALUES (?1, ?2, NULL, unixepoch(), unixepoch())",
            params![sidik(&token), idperangkat],
        )
        .map_err(e)?;
        self.0.lock().map_err(e)?.insert(sidik(&token), Arc::new(Session::default()));
        Ok(token)
    }

    /// Simpan keadaan sesi (siapa yang masuk, kapan terakhir dipakai) sesudah satu perintah. `"lokal"` tidak disimpan.
    pub fn catat(&self, conn: &Connection, token: &str, sesi: &Session) -> Res<()> {
        if token == TOKEN_LOKAL {
            return Ok(());
        }
        let iduser = sesi.0.lock().map_err(e)?.as_ref().map(|u| u.iduser.clone());
        conn.execute("UPDATE sesi_perangkat SET iduser = ?2, terakhir = unixepoch() WHERE token_hash = ?1", params![sidik(token), iduser]).map_err(e)?;
        Ok(())
    }

    /// Cabut sesi (mis. perangkat diputuskan).
    pub fn cabut(&self, conn: &Connection, token: &str) -> Res<()> {
        conn.execute("DELETE FROM sesi_perangkat WHERE token_hash = ?1", params![sidik(token)]).map_err(e)?;
        self.0.lock().map_err(e)?.remove(&sidik(token));
        Ok(())
    }

    /// Perangkat pemilik sesi ini (`idperangkat` di `sesi_perangkat`); `None` bila token tidak dikenal atau sesinya sudah
    /// diam lebih dari 12 jam (sesi itu dicabut sekarang, jadi perilakunya sama dengan sesi yang tidak dikenal).
    pub fn pemilik(&self, conn: &Connection, token: &str) -> Res<Option<String>> {
        match conn.query_row(
            "SELECT idperangkat, terakhir < unixepoch() - ?2 FROM sesi_perangkat WHERE token_hash = ?1",
            params![sidik(token), BATAS_DIAM_DETIK],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)),
        ) {
            Ok((_, true)) => {
                self.cabut(conn, token)?;
                Ok(None)
            }
            Ok((id, false)) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(e(err)),
        }
    }

    /// Cabut semua sesi milik satu perangkat (perangkat diputuskan, atau meminta sesi baru).
    pub fn cabut_perangkat(&self, conn: &Connection, idperangkat: &str) -> Res<()> {
        conn.execute("DELETE FROM sesi_perangkat WHERE idperangkat = ?1", params![idperangkat]).map_err(e)?;
        self.bersihkan(conn)
    }

    /// Buang sesi yang lama tidak dipakai, dari database dan memori.
    pub fn bersihkan(&self, conn: &Connection) -> Res<()> {
        conn.execute("DELETE FROM sesi_perangkat WHERE terakhir < unixepoch() - ?1", params![BATAS_DIAM_DETIK]).map_err(e)?;
        let ada: std::collections::HashSet<String> = {
            let mut st = conn.prepare("SELECT token_hash FROM sesi_perangkat").map_err(e)?;
            let v = st.query_map([], |r| r.get(0)).map_err(e)?.collect::<Result<_, _>>().map_err(e)?;
            v
        };
        self.0.lock().map_err(e)?.retain(|k, _| k == TOKEN_LOKAL || ada.contains(k));
        Ok(())
    }
}

/// Dipakai `jalankan` sesudah dispatch: simpan keadaan sesi bertoken.
pub fn catat_setelah_perintah(db: &Db, daftar: &DaftarSesi, token: &str, sesi: &Session) {
    if token == TOKEN_LOKAL {
        return;
    }
    if let Ok(conn) = db.lock() {
        let _ = daftar.catat(&conn, token, sesi);
    }
}
