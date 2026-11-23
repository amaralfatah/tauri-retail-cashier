//! Pembaruan komputer Kasir ke versi Pusat (rancangan 6.4). Plugin updater di sisi JS hanya memeriksa alamat dari
//! `tauri.conf.json` (rilis terbaru), padahal Kasir harus naik tepat ke versi Pusat. Karena itu pemeriksaan dan pemasangan
//! lewat Rust, dengan `updater_builder().endpoints(...)` yang menunjuk ke `latest.json` milik tag versi Pusat.

use crate::jaringan::klien::Klien;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Pembaruan hasil pemeriksaan terakhir, menunggu dipasang.
#[derive(Default)]
pub struct Tertunda(Mutex<Option<Update>>);

/// Alamat `latest.json` milik tag `v<versi>`, dari alamat rilis terbaru di konfigurasi
/// (`.../releases/latest/download/latest.json` menjadi `.../releases/download/v<versi>/latest.json`).
pub fn alamat_versi(alamat_terbaru: &str, versi: &str) -> Option<String> {
    let (depan, nama) = alamat_terbaru.split_once("/releases/latest/download/")?;
    let versi = versi.trim().trim_start_matches('v');
    if versi.is_empty() || !versi.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+') {
        return None;
    }
    Some(format!("{depan}/releases/download/v{versi}/{nama}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    version: String,
    current_version: String,
    body: Option<String>,
}

const GAGAL_CEK: &str = "Pembaruan belum bisa diperiksa. Pastikan komputer ini tersambung ke internet, lalu coba lagi.";

/// Cari pembaruan ke versi Pusat. `None` bila komputer ini sudah di versi itu (atau lebih baru: tidak pernah turun versi).
#[tauri::command]
pub async fn pembaruan_pusat_cek(app: AppHandle, klien: State<'_, Arc<Klien>>, tertunda: State<'_, Tertunda>) -> Result<Option<Info>, String> {
    let versi = klien.versi_pusat().ok_or("Toko Pro belum tahu versi Pusat. Sambungkan komputer ini ke Pusat dulu.")?;
    let terbaru = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u["endpoints"].get(0))
        .and_then(Value::as_str)
        .ok_or(GAGAL_CEK)?
        .to_string();
    let alamat: tauri::Url = alamat_versi(&terbaru, &versi).and_then(|a| a.parse().ok()).ok_or(GAGAL_CEK)?;
    let hasil = app
        .updater_builder()
        .endpoints(vec![alamat])
        .map_err(|e| format!("{GAGAL_CEK} ({e})"))?
        .build()
        .map_err(|e| format!("{GAGAL_CEK} ({e})"))?
        .check()
        .await
        .map_err(|e| format!("{GAGAL_CEK} ({e})"))?;
    let info = hasil.as_ref().map(|u| Info { version: u.version.clone(), current_version: u.current_version.clone(), body: u.body.clone() });
    *tertunda.0.lock().unwrap_or_else(|p| p.into_inner()) = hasil;
    Ok(info)
}

/// Unduh dan pasang pembaruan hasil `pembaruan_pusat_cek`. Kemajuan dikirim dengan bentuk yang sama seperti plugin updater.
#[tauri::command]
pub async fn pembaruan_pusat_pasang(tertunda: State<'_, Tertunda>, kemajuan: Channel<Value>) -> Result<(), String> {
    let update = tertunda.0.lock().unwrap_or_else(|p| p.into_inner()).take().ok_or("Belum ada pembaruan yang siap dipasang. Periksa pembaruan dulu.")?;
    let mut mulai = false;
    let k = kemajuan.clone();
    let hasil = update
        .download_and_install(
            |potong, total| {
                if !mulai {
                    mulai = true;
                    let _ = k.send(json!({ "event": "Started", "data": { "contentLength": total } }));
                }
                let _ = k.send(json!({ "event": "Progress", "data": { "chunkLength": potong } }));
            },
            || {
                let _ = kemajuan.send(json!({ "event": "Finished" }));
            },
        )
        .await;
    match hasil {
        Ok(()) => Ok(()),
        Err(e) => {
            *tertunda.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(update);
            Err(format!("Pembaruan belum berhasil dipasang. Coba lagi. ({e})"))
        }
    }
}
