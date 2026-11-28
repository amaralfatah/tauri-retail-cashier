//! Konteks satu panggilan perintah, dan pembantu untuk membaca argumen JSON.

use crate::auth::Session;
use crate::db::{e, Db, Res};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

/// Dari mana satu panggilan perintah datang. Perintah yang tidak boleh dijalankan lewat jaringan
/// (mis. `restore_session`) memeriksa `k.asal`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Asal {
    /// Jendela KasirJet di komputer ini.
    Lokal,
    /// Permintaan dari komputer lain lewat server Pusat.
    Jaringan,
}

/// Yang dibutuhkan perintah untuk berjalan: database, sesi pemanggil, dan (bila ada) jendela Tauri.
/// Tes dan server memakai `Konteks::baru` tanpa jendela; perintah yang butuh jendela mengembalikan error.
pub struct Konteks<'a> {
    pub db: &'a Db,
    pub sesi: &'a Session,
    pub asal: Asal,
    app: Option<&'a AppHandle>,
    jendela: Option<&'a WebviewWindow>,
    /// Folder data yang ditentukan pemanggil (server Pusat tidak punya jendela, tetapi tetap perlu folder foto).
    folder_data_tetap: Option<PathBuf>,
}

impl<'a> Konteks<'a> {
    pub fn baru(db: &'a Db, sesi: &'a Session) -> Self {
        Konteks { db, sesi, asal: Asal::Lokal, app: None, jendela: None, folder_data_tetap: None }
    }

    /// Tandai panggilan ini datang dari komputer lain (dipakai server Pusat).
    pub fn dari_jaringan(mut self) -> Self {
        self.asal = Asal::Jaringan;
        self
    }

    /// Tetapkan folder data (dipakai server Pusat dan tes, yang tidak punya `AppHandle`).
    pub fn dengan_folder_data(mut self, folder: Option<PathBuf>) -> Self {
        self.folder_data_tetap = folder;
        self
    }

    pub fn dengan_jendela(mut self, app: &'a AppHandle, jendela: &'a WebviewWindow) -> Self {
        self.app = Some(app);
        self.jendela = Some(jendela);
        self
    }

    pub fn app(&self) -> Res<&AppHandle> {
        self.app.ok_or_else(|| "Perintah ini hanya bisa dijalankan dari jendela KasirJet.".to_string())
    }

    pub fn jendela(&self) -> Res<&WebviewWindow> {
        self.jendela.ok_or_else(|| "Perintah ini hanya bisa dijalankan dari jendela KasirJet.".to_string())
    }

    /// Folder data aplikasi di komputer ini (tempat `tokopro.db` dan folder foto).
    pub fn folder_data(&self) -> Res<PathBuf> {
        if let Some(f) = &self.folder_data_tetap {
            return Ok(f.clone());
        }
        folder_data_aplikasi(self.app()?)
    }

    pub fn folder_foto(&self) -> Res<PathBuf> {
        Ok(self.folder_data()?.join("foto"))
    }

    /// Folder Documents dan Downloads, tempat file ekspor boleh ditulis.
    pub fn folder_tujuan(&self) -> Res<Vec<PathBuf>> {
        let p = self.app()?.path();
        Ok([p.document_dir(), p.download_dir()].into_iter().flatten().collect())
    }
}

/// Folder data aplikasi (`pusat.json`, `foto/`, dan `tokopro.db` bila `TOKOPRO_DB` kosong). Di build debug,
/// `TOKOPRO_DATA_DIR` menggantinya supaya beberapa proses bisa jalan di satu mesin (rancangan 10.2).
pub fn folder_data_aplikasi(app: &AppHandle) -> Res<PathBuf> {
    if cfg!(debug_assertions) {
        if let Ok(d) = std::env::var("TOKOPRO_DATA_DIR") {
            if !d.trim().is_empty() {
                let d = PathBuf::from(d);
                std::fs::create_dir_all(&d).map_err(e)?;
                return Ok(d);
            }
        }
    }
    app.path().app_data_dir().map_err(e)
}

/// Baca satu argumen dari objek JSON. Argumen yang tidak ada dibaca sebagai `null` (jadi `None` untuk `Option`).
pub fn ambil<T: DeserializeOwned>(args: &Map<String, Value>, kunci: &str) -> Res<T> {
    let nilai = args.get(kunci).cloned().unwrap_or(Value::Null);
    serde_json::from_value(nilai).map_err(|err| format!("Argumen \"{kunci}\" tidak sesuai: {err}"))
}

pub fn ke_json<T: Serialize>(hasil: T) -> Res<Value> {
    serde_json::to_value(hasil).map_err(e)
}
