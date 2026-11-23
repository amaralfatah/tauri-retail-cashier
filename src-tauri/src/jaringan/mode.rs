//! Mode komputer ini, disimpan di `pusat.json` (folder data aplikasi).
//! Kolom yang belum dikenal (mis. alamat Pusat dan token perangkat milik komputer kasir) ikut dibawa saat menyimpan.

use crate::db::{e, Res};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::Path;

/// Port bawaan server Pusat (rancangan bagian 5.2).
pub const PORT_BAWAAN: u16 = 47210;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Satu komputer, tanpa jaringan. Bawaan.
    #[default]
    Tunggal,
    /// Komputer ini memegang data dan membuka server.
    Pusat,
    /// Komputer ini tersambung ke Pusat dan tidak membuka database sendiri.
    Kasir,
}

/// Sambungan komputer kasir ke Pusat (bagian `kasir` di `pusat.json`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sambungan {
    /// Nama komputer Pusat atau alamat IP-nya, seperti isian `NamaKomputer` di aplikasi lama.
    pub pusat: String,
    /// Nama komputer yang dijawab Pusat saat pertama tersambung. Alamat yang menjawab dengan nama lain ditolak.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nama_pusat: Option<String>,
    /// Alamat terakhir yang menjawab; dicoba setelah nama komputer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ip_terakhir: Option<String>,
    /// Token perangkat dari Pusat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// Token sesi untuk perangkat ini.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sesi: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Pengaturan {
    #[serde(default)]
    pub mode: Mode,
    /// Port server Pusat; kosong berarti `PORT_BAWAAN`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Hanya terisi di komputer kasir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kasir: Option<Sambungan>,
    #[serde(flatten)]
    pub lainnya: Map<String, Value>,
}

impl Pengaturan {
    /// Baca `pusat.json`. File tidak ada, rusak, atau isinya tidak dikenal berarti mode Tunggal (tidak ada port yang dibuka).
    pub fn muat(berkas: &Path) -> Self {
        std::fs::read_to_string(berkas).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn simpan(&self, berkas: &Path) -> Res<()> {
        if let Some(dir) = berkas.parent() {
            std::fs::create_dir_all(dir).map_err(e)?;
        }
        let teks = serde_json::to_string_pretty(self).map_err(e)?;
        // Tulis ke file sementara lalu ganti, supaya file tidak setengah tertulis bila komputer mati.
        let sementara = berkas.with_extension("json.tmp");
        std::fs::write(&sementara, teks).map_err(e)?;
        std::fs::rename(&sementara, berkas).map_err(e)
    }

    /// Port yang dipakai: `TOKOPRO_PORT` (pengembangan), lalu isi `pusat.json`, lalu bawaan.
    /// Di komputer Pusat ini port yang dibuka; di komputer kasir ini port Pusat yang dituju.
    pub fn port_efektif(&self) -> u16 {
        std::env::var("TOKOPRO_PORT").ok().and_then(|p| p.trim().parse().ok()).or(self.port).unwrap_or(PORT_BAWAAN)
    }
}
