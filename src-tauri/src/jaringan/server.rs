//! Server HTTP di komputer Pusat (axum). Semua rute berawalan `/api/v1`:
//!
//! | Rute | Token perangkat | Isi |
//! |---|---|---|
//! | `GET /halo` | tidak | nama toko, nama komputer Pusat, versi, `user_version`, jam, status |
//! | `POST /sambung` | tidak (kode sambung, atau masa terima otomatis) | tukar kode dengan token perangkat dan token sesi |
//! | `POST /sesi` | ya | token sesi baru untuk perangkat ini (bila sesi lama sudah dihapus) |
//! | `POST /jalankan` | ya | jalankan satu perintah data dengan sesi si pengirim |
//!
//! Jawaban selalu `{ ok: true, hasil }` atau `{ ok: false, pesan, kode }`. Status HTTP: 401 tanpa token yang sah,
//! 403 untuk perintah yang tidak boleh lewat jaringan, 429 untuk yang terkunci. Kesalahan dari perintah itu sendiri
//! (mis. kata sandi salah) tetap berstatus 200 dengan `ok: false`.

use super::batas::{Pembatas, LAMA_KUNCI, MAKS_SALAH};
use super::golongan::{golongan, perintah_simpan, Golongan};
use super::perangkat;
use crate::db::{e, Db, Res};
use crate::dispatch;
use crate::konteks::Konteks;
use crate::sesi::{catat_setelah_perintah, DaftarSesi};
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Header yang dikirim komputer Kasir di setiap `/jalankan`: versi aplikasinya.
pub const HEADER_VERSI: &str = "x-versi-kasir";
/// Badan `/jalankan` (foto barang ikut di sini). Hanya dibaca setelah token perangkat lolos.
const BATAS_BADAN: usize = 20 * 1024 * 1024;
/// Badan `/sambung`: hanya nama komputer dan kode.
const BATAS_BADAN_KECIL: usize = 16 * 1024;
/// Perangkat yang diterima tanpa kode dalam satu masa terima; sesudah itu masa terima ditutup (rancangan 5.4).
pub const MAKS_TERIMA_OTOMATIS: usize = 10;
const MASA_KODE: Duration = Duration::from_secs(10 * 60);
/// Setelah sekian tebakan salah (dari alamat mana pun), kode dibatalkan dan Manager perlu membuat kode baru.
/// Hasil simpan diingat selama 7 hari.
const MASA_HASIL_SIMPAN: i64 = 7 * 24 * 3600;
pub(crate) const MAKS_SALAH_PER_KODE: u32 = 20;
/// Perintah yang memeriksa kata sandi: salah berulang kali mengunci perangkat pengirimnya.
const PERINTAH_KATA_SANDI: &[&str] = &["login", "verifikasi_admin"];

/// Sumber data server: database dan daftar sesi. Aplikasi memakai `AppHandle`; tes memakai struktur sendiri.
pub trait Data: Send + Sync + 'static {
    fn db(&self) -> &Db;
    fn sesi(&self) -> &DaftarSesi;
    /// Folder data aplikasi di komputer Pusat (tempat folder foto). `None` bila tidak diketahui.
    fn folder_data(&self) -> Option<std::path::PathBuf> {
        None
    }
}

impl Data for tauri::AppHandle {
    fn db(&self) -> &Db {
        use tauri::Manager;
        self.state::<Db>().inner()
    }
    fn sesi(&self) -> &DaftarSesi {
        use tauri::Manager;
        self.state::<DaftarSesi>().inner()
    }
    fn folder_data(&self) -> Option<std::path::PathBuf> {
        crate::konteks::folder_data_aplikasi(self).ok()
    }
}

/// Alamat dan panjang awalan (prefix) setiap kartu jaringan komputer ini.
pub type Antarmuka = Arc<dyn Fn() -> Vec<(IpAddr, u8)> + Send + Sync>;

/// Kartu jaringan komputer ini yang sedang aktif.
pub fn antarmuka_sistem() -> Vec<(IpAddr, u8)> {
    if_addrs::get_if_addrs()
        .map(|v| {
            v.into_iter()
                .map(|i| match i.addr {
                    if_addrs::IfAddr::V4(a) => (IpAddr::V4(a.ip), u32::from(a.netmask).count_ones() as u8),
                    if_addrs::IfAddr::V6(a) => (IpAddr::V6(a.ip), u128::from(a.netmask).count_ones() as u8),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Apakah `klien` satu subnet dengan salah satu kartu jaringan?
pub fn satu_subnet(klien: IpAddr, antarmuka: &[(IpAddr, u8)]) -> bool {
    let klien = klien.to_canonical();
    antarmuka.iter().any(|&(ip, prefix)| {
        if prefix == 0 {
            return false;
        }
        match (klien, ip.to_canonical()) {
            (IpAddr::V4(a), IpAddr::V4(b)) if prefix <= 32 => {
                let mask = u32::MAX << (32 - prefix as u32);
                u32::from(a) & mask == u32::from(b) & mask
            }
            (IpAddr::V6(a), IpAddr::V6(b)) if prefix <= 128 => {
                let mask = u128::MAX << (128 - prefix as u32);
                u128::from(a) & mask == u128::from(b) & mask
            }
            _ => false,
        }
    })
}

/// Satu masa terima komputer baru tanpa kode (rancangan 8.5): berapa yang sudah diterima, dan dari alamat mana.
struct MasaTerima {
    sampai: Instant,
    diterima: usize,
    /// Perangkat yang diterima dari tiap alamat. Satu alamat hanya boleh punya satu; yang baru menggantikan yang lama.
    per_ip: HashMap<IpAddr, i64>,
}

struct KodeSambung {
    kode: String,
    berlaku_sampai: Instant,
    salah: u32,
}

/// Keadaan server Pusat yang dipakai bersama semua permintaan.
pub struct Pusat {
    data: Arc<dyn Data>,
    nama_komputer: String,
    antarmuka: Antarmuka,
    kode: Mutex<Option<KodeSambung>>,
    terima_otomatis: Mutex<Option<MasaTerima>>,
    pembatas_kode: Pembatas<IpAddr>,
    /// Percobaan kata sandi dihitung per perangkat dan per alamat pengirim, supaya perangkat baru dari alamat yang sama
    /// tidak memulai hitungan dari nol.
    pembatas_login: Pembatas<i64>,
    pembatas_login_ip: Pembatas<IpAddr>,
    perawatan: AtomicBool,
    /// Menyerialkan pemeriksaan-lalu-simpan untuk permintaan ber-`idPermintaan`, supaya dua permintaan dengan ID yang sama
    /// yang tiba bersamaan (mis. Kasir mengulang saat jawaban pertama masih berjalan) tidak sama-sama menjalankan perintahnya.
    kunci_simpan: Mutex<()>,
    /// Hanya tes: ID simpan yang jawabannya sengaja tidak pernah dikirim (sesudah datanya tersimpan).
    #[cfg(test)]
    pub hilangkan_jawaban: Mutex<std::collections::HashSet<String>>,
}

fn kunci<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Perbandingan yang waktunya tidak bergantung pada letak karakter pertama yang berbeda.
fn sama(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |r, (x, y)| r | (x ^ y)) == 0
}

impl Pusat {
    pub fn baru(data: Arc<dyn Data>, nama_komputer: String, antarmuka: Antarmuka) -> Self {
        Pusat {
            data,
            nama_komputer,
            antarmuka,
            kode: Mutex::new(None),
            terima_otomatis: Mutex::new(None),
            pembatas_kode: Pembatas::baru(MAKS_SALAH, LAMA_KUNCI),
            pembatas_login: Pembatas::baru(MAKS_SALAH, LAMA_KUNCI),
            pembatas_login_ip: Pembatas::baru(MAKS_SALAH, LAMA_KUNCI),
            perawatan: AtomicBool::new(false),
            kunci_simpan: Mutex::new(()),
            #[cfg(test)]
            hilangkan_jawaban: Mutex::new(Default::default()),
        }
    }

    /// Buat kode sambung 6 angka (menggantikan kode sebelumnya). Berlaku 10 menit dan hanya sekali pakai.
    pub fn kode_baru(&self) -> Res<(String, Duration)> {
        let mut b = [0u8; 4];
        getrandom::fill(&mut b).map_err(e)?;
        let kode = format!("{:06}", u32::from_le_bytes(b) % 1_000_000);
        *kunci(&self.kode) = Some(KodeSambung { kode: kode.clone(), berlaku_sampai: Instant::now() + MASA_KODE, salah: 0 });
        Ok((kode, MASA_KODE))
    }

    /// Kode yang sedang berlaku dan sisa waktunya.
    pub fn kode_aktif(&self) -> Option<(String, Duration)> {
        let mut k = kunci(&self.kode);
        match k.as_ref() {
            Some(c) if c.berlaku_sampai > Instant::now() => Some((c.kode.clone(), c.berlaku_sampai - Instant::now())),
            _ => {
                *k = None;
                None
            }
        }
    }

    pub fn tutup_kode(&self) {
        *kunci(&self.kode) = None;
    }

    /// Buka masa terima otomatis: komputer satu subnet boleh tersambung tanpa kode sampai `durasi` habis, paling banyak
    /// `MAKS_TERIMA_OTOMATIS` perangkat (rancangan 8.5). Membuka lagi memulai hitungan dari nol.
    pub fn buka_terima_otomatis(&self, durasi: Duration) {
        *kunci(&self.terima_otomatis) = Some(MasaTerima { sampai: Instant::now() + durasi, diterima: 0, per_ip: HashMap::new() });
    }

    pub fn tutup_terima_otomatis(&self) {
        *kunci(&self.terima_otomatis) = None;
    }

    /// Sisa masa terima otomatis, bila sedang terbuka.
    pub fn terima_otomatis_sisa(&self) -> Option<Duration> {
        let mut t = kunci(&self.terima_otomatis);
        match t.as_ref() {
            Some(m) if m.sampai > Instant::now() => Some(m.sampai - Instant::now()),
            _ => {
                *t = None;
                None
            }
        }
    }

    /// Berapa perangkat yang sudah diterima dalam masa terima yang sedang terbuka, dan batasnya.
    pub fn terima_otomatis_jumlah(&self) -> Option<(usize, usize)> {
        self.terima_otomatis_sisa()?;
        kunci(&self.terima_otomatis).as_ref().map(|m| (m.diterima, MAKS_TERIMA_OTOMATIS))
    }

    /// Mode perawatan (restore atau pindah data): `/jalankan` ditolak dan `/halo` melaporkan `perawatan`.
    pub fn set_perawatan(&self, aktif: bool) {
        self.perawatan.store(aktif, Ordering::SeqCst);
    }

    /// Jalankan `kerja` (restore atau pindah data lama) dalam mode perawatan (rancangan 6.1). Selama berjalan, komputer Kasir
    /// mendapat 503. Bila berhasil, data pengguna bisa berubah, jadi semua sesi Kasir diakhiri dan Kasir diminta masuk lagi.
    /// Daftar komputer yang sudah disambungkan (`perangkat`) bukan bagian dari data toko: isinya dipertahankan, supaya
    /// komputer Kasir tidak perlu disambungkan ulang dengan kode baru.
    pub fn dengan_perawatan<T>(&self, kerja: impl FnOnce() -> Res<T>) -> Res<T> {
        let simpan = {
            let conn = self.data.db().lock()?;
            perangkat::salin(&conn)?
        };
        self.set_perawatan(true);
        let hasil = kerja().and_then(|v| {
            let conn = self.data.db().lock()?;
            perangkat::pulihkan(&conn, &simpan)?;
            self.data.sesi().bersihkan(&conn)?;
            Ok(v)
        });
        self.set_perawatan(false);
        hasil
    }

    pub fn nama_komputer(&self) -> &str {
        &self.nama_komputer
    }

    /// Hapus hasil simpan yang lebih tua dari 7 hari (rancangan 4.2). Gagal tidak mengganggu apa pun.
    pub fn bersihkan_permintaan_lama(&self) {
        if let Ok(conn) = self.data.db().lock() {
            let _ = conn.execute("DELETE FROM permintaan_selesai WHERE waktu < ?1", [chrono::Utc::now().timestamp() - MASA_HASIL_SIMPAN]);
        }
    }

    /// Jalankan `kerja` untuk perintah simpan ber-ID. Bila ID ini sudah selesai, hasil lamanya dikembalikan tanpa menjalankan
    /// perintahnya lagi. Hasil yang berhasil disimpan di `permintaan_selesai` sebelum jawaban dikirim. Kesalahan tidak disimpan,
    /// karena perintah yang gagal tidak mengubah data dan boleh dicoba lagi.
    fn sekali(&self, id: &str, perintah: &str, kerja: impl FnOnce() -> Res<Value>) -> Res<Value> {
        let _giliran = kunci(&self.kunci_simpan);
        {
            let conn = self.data.db().lock()?;
            let lama: Option<(String, String)> = conn
                .query_row("SELECT perintah, hasil_json FROM permintaan_selesai WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
                .ok();
            if let Some((p, hasil)) = lama {
                if p != perintah {
                    return Err("Kode permintaan ini sudah dipakai untuk perintah lain.".into());
                }
                return serde_json::from_str(&hasil).map_err(e);
            }
        }
        let hasil = kerja()?;
        let conn = self.data.db().lock()?;
        conn.execute(
            "INSERT OR IGNORE INTO permintaan_selesai (id, perintah, hasil_json, waktu) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, perintah, hasil.to_string(), chrono::Utc::now().timestamp()],
        )
        .map_err(e)?;
        Ok(hasil)
    }

    /// Cocokkan kode dari komputer kasir; kode yang cocok langsung dipakai habis.
    fn pakai_kode(&self, dari: &str) -> bool {
        let dari: String = dari.chars().filter(|c| !c.is_whitespace()).collect();
        let mut k = kunci(&self.kode);
        let Some(c) = k.as_mut() else { return false };
        if c.berlaku_sampai <= Instant::now() {
            *k = None;
            return false;
        }
        if sama(&c.kode, &dari) {
            *k = None;
            return true;
        }
        c.salah += 1;
        if c.salah >= MAKS_SALAH_PER_KODE {
            *k = None;
        }
        false
    }
}

/// Server yang sedang berjalan. Menjatuhkannya (atau `henti`) menghentikan server.
pub struct ServerJalan {
    pub pusat: Arc<Pusat>,
    pub alamat: SocketAddr,
    henti: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ServerJalan {
    pub fn henti(&mut self) {
        if let Some(h) = self.henti.take() {
            let _ = h.send(());
        }
    }
}

impl Drop for ServerJalan {
    fn drop(&mut self) {
        self.henti();
    }
}

/// Buka port dan jalankan server di `tauri::async_runtime`. Port yang sudah dipakai dilaporkan sebagai error.
/// `ip` biasanya `0.0.0.0` (semua kartu jaringan); `port` 0 memilih port acak (tes).
pub fn mulai(data: Arc<dyn Data>, ip: IpAddr, port: u16, nama_komputer: String, antarmuka: Antarmuka) -> Res<ServerJalan> {
    let soket = std::net::TcpListener::bind((ip, port)).map_err(|err| {
        use std::io::ErrorKind::{AddrInUse, PermissionDenied};
        if matches!(err.kind(), AddrInUse | PermissionDenied) {
            format!("KasirJet belum bisa menerima komputer kasir karena ada program lain yang memakai jalurnya (port {port}). Tutup program itu, lalu buka lagi KasirJet. KasirJet di komputer ini tetap bisa dipakai.")
        } else {
            format!("Port {port} tidak bisa dibuka ({err}). Komputer kasir belum bisa tersambung, tetapi KasirJet di komputer ini tetap bisa dipakai.")
        }
    })?;
    soket.set_nonblocking(true).map_err(e)?;
    let alamat = soket.local_addr().map_err(e)?;
    let pusat = Arc::new(Pusat::baru(data, nama_komputer, antarmuka));
    pusat.bersihkan_permintaan_lama();
    let (henti, tunggu) = tokio::sync::oneshot::channel::<()>();
    let rute = rute(pusat.clone());
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = tokio::net::TcpListener::from_std(soket) else { return };
        let _ = axum::serve(listener, rute.into_make_service_with_connect_info::<SocketAddr>())
            .with_graceful_shutdown(async move {
                let _ = tunggu.await;
            })
            .await;
    });
    Ok(ServerJalan { pusat, alamat, henti: Some(henti) })
}

fn rute(pusat: Arc<Pusat>) -> Router {
    Router::new()
        .route("/api/v1/halo", get(halo))
        .route("/api/v1/sambung", post(sambung))
        .route("/api/v1/sesi", post(sesi_baru))
        .route("/api/v1/jalankan", post(jalankan))
        .with_state(pusat)
}

/* ---- Jawaban ---- */

fn ok(hasil: Value) -> Response {
    Json(json!({ "ok": true, "hasil": hasil })).into_response()
}

fn tolak(status: StatusCode, kode: &str, pesan: impl Into<String>) -> Response {
    (status, Json(json!({ "ok": false, "pesan": pesan.into(), "kode": kode }))).into_response()
}

fn terkunci(sisa: Duration) -> Response {
    let menit = sisa.as_secs().div_ceil(60).max(1);
    tolak(StatusCode::TOO_MANY_REQUESTS, "terkunci", format!("Terlalu banyak percobaan yang salah. Coba lagi {menit} menit lagi."))
}

fn galat_dalam(err: impl std::fmt::Display) -> Response {
    tolak(StatusCode::INTERNAL_SERVER_ERROR, "galat", format!("Pusat gagal memproses permintaan ini ({err}). Coba lagi."))
}

/// Jalankan pekerjaan yang memakai database (sinkron) di thread terpisah.
async fn di_thread<T: Send + 'static>(kerja: impl FnOnce() -> T + Send + 'static) -> Result<T, Response> {
    tauri::async_runtime::spawn_blocking(kerja).await.map_err(galat_dalam)
}

/* ---- Rute ---- */

async fn halo(State(p): State<Arc<Pusat>>) -> Response {
    let data = p.data.clone();
    let info = di_thread(move || {
        let conn = data.db().lock().ok()?;
        let toko: String = conn.query_row("SELECT COALESCE(namausaha,'') FROM tseting LIMIT 1", [], |r| r.get(0)).unwrap_or_default();
        Some((toko, crate::migrasi::versi(&conn).unwrap_or(0)))
    })
    .await;
    let (toko, versi_db) = match info {
        Ok(Some(x)) => x,
        Ok(None) => (String::new(), 0),
        Err(r) => return r,
    };
    ok(json!({
        "namaToko": toko,
        "namaKomputer": p.nama_komputer,
        "versi": env!("CARGO_PKG_VERSION"),
        "userVersion": versi_db,
        "jam": chrono::Local::now().to_rfc3339(),
        // Tanggal dan jam dinding Pusat, tanpa zona. Komputer Kasir menghitung selisihnya terhadap jam dinding sendiri (rancangan 4.3).
        "jamDinding": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "status": if p.perawatan.load(Ordering::SeqCst) { "perawatan" } else { "siap" },
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermintaanSambung {
    nama_komputer: String,
    kode: Option<String>,
}

/// Alamat pengirim. Hanya di tes, header `x-uji-ip` menggantikannya supaya beberapa "komputer" bisa ditiru dari satu mesin.
fn ip_pengirim(dari: SocketAddr, _h: &HeaderMap) -> IpAddr {
    #[cfg(test)]
    if let Some(ip) = _h.get("x-uji-ip").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()) {
        return ip;
    }
    dari.ip()
}

fn terlalu_besar() -> Response {
    tolak(StatusCode::PAYLOAD_TOO_LARGE, "terlalu-besar", "Permintaan ini terlalu besar atau terputus sebelum selesai dikirim.")
}

/// Baca badan permintaan sampai `batas` byte. Panjang yang diumumkan header diperiksa lebih dulu, jadi badan yang jelas
/// terlalu besar tidak dibaca sama sekali.
async fn baca_badan(h: &HeaderMap, badan: Body, batas: usize) -> Result<axum::body::Bytes, Response> {
    let umum = h.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<usize>().ok());
    if umum.is_some_and(|n| n > batas) {
        return Err(terlalu_besar());
    }
    axum::body::to_bytes(badan, batas).await.map_err(|_| terlalu_besar())
}

fn urai<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, Response> {
    serde_json::from_slice(bytes).map_err(|_| tolak(StatusCode::BAD_REQUEST, "badan-salah", "Permintaan ini tidak bisa dibaca. Coba lagi."))
}

async fn sambung(State(p): State<Arc<Pusat>>, ConnectInfo(dari): ConnectInfo<SocketAddr>, headers: HeaderMap, badan: Body) -> Response {
    let ip = ip_pengirim(dari, &headers);
    if let Some(sisa) = p.pembatas_kode.sisa_kunci(&ip, Instant::now()) {
        return terkunci(sisa);
    }
    let bytes = match baca_badan(&headers, badan, BATAS_BADAN_KECIL).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let req: PermintaanSambung = match urai(&bytes) {
        Ok(r) => r,
        Err(r) => return r,
    };
    let nama = req.nama_komputer.trim().to_string();
    if nama.is_empty() || nama.chars().count() > 64 {
        return tolak(StatusCode::BAD_REQUEST, "nama", "Nama komputer kosong atau terlalu panjang.");
    }
    let kode = req.kode.as_deref().map(str::trim).filter(|k| !k.is_empty());
    let perlu_kode = || tolak(StatusCode::FORBIDDEN, "perlu-kode", "Komputer Pusat meminta kode sambung. Ketik kode yang tampil di layar komputer Pusat.");
    let otomatis = match kode {
        Some(k) => {
            if !p.pakai_kode(k) {
                p.pembatas_kode.gagal(ip, Instant::now());
                return tolak(StatusCode::FORBIDDEN, "kode-salah", "Kode sambung salah atau sudah tidak berlaku. Lihat kode terbaru di komputer Pusat.");
            }
            false
        }
        // Tanpa kode: hanya selama masa terima otomatis dan dari subnet yang sama. Tidak dihitung sebagai tebakan.
        None => {
            if p.terima_otomatis_sisa().is_none() || !satu_subnet(ip, &(p.antarmuka)()) {
                return perlu_kode();
            }
            true
        }
    };
    p.pembatas_kode.berhasil(&ip);
    let data = p.data.clone();
    let pusat = p.clone();
    let hasil = di_thread(move || -> Res<Option<Value>> {
        let gabung = |id: i64, token: String, sesi: String| json!({ "token": token, "sesi": sesi, "idPerangkat": id, "otomatis": otomatis });
        if !otomatis {
            let conn = data.db().lock()?;
            let (id, token) = perangkat::tambah(&conn, &nama, false)?;
            let sesi = data.sesi().buat(&conn, &id.to_string())?;
            return Ok(Some(gabung(id, token, sesi)));
        }
        // Masa terima dikunci selama perangkat dibuat, supaya dua permintaan dari alamat yang sama tidak sama-sama lolos.
        let mut t = kunci(&pusat.terima_otomatis);
        let (lama, penuh) = match t.as_ref() {
            Some(m) if m.sampai > Instant::now() => (m.per_ip.get(&ip).copied(), m.diterima >= MAKS_TERIMA_OTOMATIS),
            _ => {
                *t = None;
                return Ok(None);
            }
        };
        if lama.is_none() && penuh {
            *t = None;
            return Ok(None);
        }
        let conn = data.db().lock()?;
        let (id, token) = perangkat::tambah(&conn, &nama, true)?;
        let sesi = data.sesi().buat(&conn, &id.to_string())?;
        // Satu alamat satu perangkat: yang lama dari alamat ini diputus, dan tidak menambah hitungan.
        if let Some(lama) = lama {
            perangkat::putuskan(&conn, data.sesi(), lama)?;
        }
        if let Some(m) = t.as_mut() {
            if lama.is_none() {
                m.diterima += 1;
            }
            m.per_ip.insert(ip, id);
            if m.diterima >= MAKS_TERIMA_OTOMATIS {
                *t = None;
            }
        }
        Ok(Some(gabung(id, token, sesi)))
    })
    .await;
    match hasil {
        Ok(Ok(Some(v))) => ok(v),
        Ok(Ok(None)) => perlu_kode(),
        Ok(Err(err)) => galat_dalam(err),
        Err(r) => r,
    }
}

fn token_perangkat(h: &HeaderMap) -> Option<String> {
    let nilai = h.get(header::AUTHORIZATION)?.to_str().ok()?;
    nilai.strip_prefix("Bearer ").map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

fn tidak_sah() -> Response {
    tolak(StatusCode::UNAUTHORIZED, "tidak-sah", "Komputer ini belum disambungkan ke Pusat, atau sambungannya sudah diputuskan.")
}

/// Perangkat pemilik token di header, atau jawaban 401.
async fn kenali(p: &Arc<Pusat>, h: &HeaderMap) -> Result<perangkat::Perangkat, Response> {
    let Some(token) = token_perangkat(h) else { return Err(tidak_sah()) };
    let data = p.data.clone();
    match di_thread(move || -> Res<Option<perangkat::Perangkat>> {
        let conn = data.db().lock()?;
        perangkat::cari_token(&conn, &token)
    }).await? {
        Ok(Some(x)) => Ok(x),
        Ok(None) => Err(tidak_sah()),
        Err(err) => Err(galat_dalam(err)),
    }
}

/// Badan `/sesi` tidak dipakai dan tidak dibaca.
async fn sesi_baru(State(p): State<Arc<Pusat>>, headers: HeaderMap) -> Response {
    let dev = match kenali(&p, &headers).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    let data = p.data.clone();
    let hasil = di_thread(move || -> Res<String> {
        let conn = data.db().lock()?;
        data.sesi().cabut_perangkat(&conn, &dev.id.to_string())?;
        data.sesi().buat(&conn, &dev.id.to_string())
    })
    .await;
    match hasil {
        Ok(Ok(sesi)) => ok(json!({ "sesi": sesi })),
        Ok(Err(err)) => galat_dalam(err),
        Err(r) => r,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PermintaanJalankan {
    perintah: String,
    #[serde(default)]
    args: Option<Map<String, Value>>,
    sesi: String,
    /// Kode unik satu perintah simpan; dipakai ulang saat Kasir mengulang (rancangan 4.2).
    #[serde(default)]
    id_permintaan: Option<String>,
}

async fn jalankan(State(p): State<Arc<Pusat>>, ConnectInfo(dari): ConnectInfo<SocketAddr>, headers: HeaderMap, badan: Body) -> Response {
    let ip = ip_pengirim(dari, &headers);
    // Token perangkat, versi, dan mode perawatan diperiksa dari header, sebelum badan permintaan dibaca atau diurai.
    let dev = match kenali(&p, &headers).await {
        Ok(d) => d,
        Err(r) => return r,
    };
    // Kunci versi (rancangan 6.4): isi dan argumen perintah bisa berubah di setiap rilis, jadi hanya versi yang sama persis yang dilayani.
    let versi_pusat = env!("CARGO_PKG_VERSION");
    if headers.get(HEADER_VERSI).and_then(|v| v.to_str().ok()).map(str::trim) != Some(versi_pusat) {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "ok": false, "kode": "versi-beda", "versiPusat": versi_pusat,
                "pesan": format!("Versi KasirJet di komputer ini berbeda dengan Pusat (versi {versi_pusat}). Samakan dulu versinya."),
            })),
        )
            .into_response();
    }
    if p.perawatan.load(Ordering::SeqCst) {
        return tolak(StatusCode::SERVICE_UNAVAILABLE, "perawatan", "Pusat sedang memulihkan data. Tunggu sebentar, lalu coba lagi.");
    }
    let bytes = match baca_badan(&headers, badan, BATAS_BADAN).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let req: PermintaanJalankan = match urai(&bytes) {
        Ok(r) => r,
        Err(r) => return r,
    };
    drop(bytes);
    match golongan(&req.perintah) {
        Some(Golongan::Data) => {}
        Some(Golongan::KhususPusat) => return tolak(StatusCode::FORBIDDEN, "khusus-pusat", "Menu ini hanya bisa dibuka di komputer Pusat."),
        Some(Golongan::Lokal | Golongan::Campuran) => {
            return tolak(StatusCode::FORBIDDEN, "khusus-lokal", "Perintah ini hanya bisa dijalankan di komputer Anda sendiri, bukan lewat Pusat.");
        }
        Some(Golongan::Pengembangan) => return tolak(StatusCode::FORBIDDEN, "ditolak", "Perintah ini tidak bisa dipakai lewat jaringan."),
        None => return tolak(StatusCode::NOT_FOUND, "tidak-dikenal", format!("Perintah \"{}\" tidak dikenal.", req.perintah)),
    }
    let kata_sandi = PERINTAH_KATA_SANDI.contains(&req.perintah.as_str());
    // Sesi harus milik perangkat yang mengirim dan belum diam lebih dari 12 jam (`pemilik` membuang sesi yang sudah lewat).
    let data = p.data.clone();
    let token_sesi = req.sesi.clone();
    let id_dev = dev.id.to_string();
    let sesi = di_thread(move || -> Res<Option<Arc<crate::auth::Session>>> {
        let conn = data.db().lock()?;
        if data.sesi().pemilik(&conn, &token_sesi)?.as_deref() != Some(id_dev.as_str()) {
            return Ok(None);
        }
        Ok(data.sesi().cari(&token_sesi))
    })
    .await;
    let sesi = match sesi {
        Ok(Ok(Some(s))) => s,
        Ok(Ok(None)) => return tolak(StatusCode::UNAUTHORIZED, "sesi", "Sesi komputer ini tidak dikenal Pusat. Minta sesi baru, lalu coba lagi."),
        Ok(Err(err)) => return galat_dalam(err),
        Err(r) => return r,
    };
    // Percobaan kata sandi dicatat sebelum perintahnya dijalankan (reservasi), jadi permintaan paralel tidak bisa lolos
    // bersamaan melewati batas. Percobaan yang benar mengembalikan hitungan ke nol.
    if kata_sandi {
        let sekarang = Instant::now();
        if let Err(sisa) = p.pembatas_login_ip.coba(ip, sekarang) {
            return terkunci(sisa);
        }
        if let Err(sisa) = p.pembatas_login.coba(dev.id, sekarang) {
            p.pembatas_login_ip.batalkan(&ip);
            return terkunci(sisa);
        }
    }
    let data = p.data.clone();
    let PermintaanJalankan { perintah, args, sesi: token_sesi, id_permintaan } = req;
    let id_permintaan = id_permintaan.map(|i| i.trim().to_string()).filter(|i| !i.is_empty() && i.len() <= 100 && perintah_simpan(&perintah));
    #[cfg(test)]
    let id_hook = id_permintaan.clone();
    let pusat = p.clone();
    let hasil = di_thread(move || {
        let jalan = || {
            let k = Konteks::baru(data.db(), &sesi).dari_jaringan().dengan_folder_data(data.folder_data());
            let hasil = dispatch(&k, &perintah, &args.unwrap_or_default());
            catat_setelah_perintah(data.db(), data.sesi(), &token_sesi, &sesi);
            hasil
        };
        match &id_permintaan {
            Some(id) => pusat.sekali(id, &perintah, jalan),
            None => jalan(),
        }
    })
    .await;
    let hasil = match hasil {
        Ok(h) => h,
        Err(r) => return r,
    };
    if kata_sandi && hasil.is_ok() {
        p.pembatas_login.berhasil(&dev.id);
        p.pembatas_login_ip.berhasil(&ip);
    }
    // Hanya tes: data sudah tersimpan, tetapi jawabannya tidak pernah sampai ke Kasir.
    #[cfg(test)]
    if let Some(id) = id_hook {
        if kunci(&p.hilangkan_jawaban).remove(&id) {
            std::future::pending::<()>().await;
        }
    }
    match hasil {
        Ok(v) => ok(v),
        Err(pesan) => Json(json!({ "ok": false, "pesan": pesan, "kode": "perintah" })).into_response(),
    }
}
