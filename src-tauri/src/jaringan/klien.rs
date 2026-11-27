//! Klien komputer Kasir (rancangan bagian 2.2, 5.1, 5.5, 7.3).
//!
//! Komputer Kasir tidak membuka database. Perintah data dikirim ke Pusat lewat `reqwest`; perintah lokal
//! (`cetak`, menulis file) tetap dijalankan di komputer ini. Pemeriksa latar memanggil `GET /halo` berkala
//! dan memancarkan status sambungan (event `status-pusat`).
//!
//! Alamat dicari berurutan: nama komputer Pusat (atau IP yang diketik), lalu IP terakhir yang berhasil.
//! Kesalahan yang berasal dari sambungan atau keadaan Pusat diberi awalan `[pusat] `; kesalahan dari
//! perintah itu sendiri (`[izin]`, `[konfirmasi]`, kata sandi salah) diteruskan apa adanya.

use super::golongan::{golongan, perintah_baca, perintah_simpan, Golongan};
use super::mode::{Mode, Pengaturan, Sambungan};
use crate::auth::{Session, User};
use crate::db::{e, Res};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

/// Awalan error yang berasal dari sambungan atau keadaan Pusat. Dikenali `src/lib/panggil.ts`.
pub const AWALAN_PUSAT: &str = "[pusat] ";

const WAKTU_HALO: Duration = Duration::from_secs(3);
const WAKTU_BACA: Duration = Duration::from_secs(10);
const WAKTU_SIMPAN: Duration = Duration::from_secs(30);

fn kunci<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// `reqwest` di proyek ini dibangun tanpa penyedia kripto (dibawa plugin updater) dan `Client::new()` panik tanpanya,
/// juga untuk http biasa. Penyedia `ring` dipasang sekali untuk seluruh proses.
pub fn klien_http() -> reqwest::Client {
    static SEKALI: std::sync::Once = std::sync::Once::new();
    SEKALI.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::new()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// Belum ada token perangkat (belum pernah menyambung).
    BelumSambung,
    Menyambung,
    Tersambung,
    Terputus,
    VersiBeda,
    Perawatan,
    /// Pusat sudah mencabut perangkat ini. Tetap begini sampai disambungkan ulang.
    Ditolak,
}

/// Jeda pemeriksa `/halo`.
#[derive(Clone, Copy, Debug)]
pub struct Jeda {
    pub tersambung: Duration,
    pub terputus_awal: Duration,
    pub terputus_maks: Duration,
}

impl Default for Jeda {
    fn default() -> Self {
        Jeda { tersambung: Duration::from_secs(15), terputus_awal: Duration::from_secs(3), terputus_maks: Duration::from_secs(10) }
    }
}

/// Ke mana satu perintah dikirim di komputer Kasir.
#[derive(Debug, PartialEq, Eq)]
pub enum Tujuan {
    Lokal,
    Pusat,
    /// Ditolak di komputer ini; isinya pesan untuk pengguna (sudah berawalan bila perlu).
    Tolak(String),
}

/// Pemancar status ke tampilan (event `status-pusat`).
pub type Pemancar = Arc<dyn Fn(&Value) + Send + Sync>;

struct Keadaan {
    status: Status,
    pesan: Option<String>,
    versi_pusat: Option<String>,
}

pub struct Klien {
    berkas: PathBuf,
    pengaturan: Arc<Mutex<Pengaturan>>,
    http: reqwest::Client,
    nama_komputer: String,
    /// Versi aplikasi ini; hanya tes yang menggantinya (`dengan_versi`).
    versi: String,
    jeda: Jeda,
    pemancar: Pemancar,
    keadaan: Mutex<Keadaan>,
    alamat: Mutex<Option<SocketAddr>>,
    ditolak: AtomicBool,
    diteruskan: AtomicU64,
    pemeriksa: Mutex<Option<Arc<AtomicBool>>>,
    /// Selisih jam Pusat, diperbarui setiap `/halo` berhasil.
    selisih_jam: Mutex<Option<SelisihJam>>,
}

/// Selisih jam Pusat terhadap jam komputer ini, dihitung dari `jamDinding` di jawaban `/halo` (rancangan 4.3).
/// Dihitung sebagai selisih **jam dinding** (tanggal dan jam yang terbaca di jam masing-masing komputer), tanpa zona waktu:
/// komputer Kasir yang zona Windows-nya salah, tetapi jamnya sudah diatur supaya tampil benar, tetap mendapat tanggal yang sama dengan Pusat.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SelisihJam {
    /// Jam dinding Pusat dikurangi jam dinding komputer ini, dalam milidetik.
    pub ms: i64,
}

/// Bila selisih jam lebih dari ini (detik), bilah atas memperingatkan kasir.
pub const BATAS_SELISIH_JAM: i64 = 120;

/// Jam dinding Pusat dari `/halo`: teks `YYYY-MM-DD HH:MM:SS`, atau (cadangan) jam RFC 3339 tanpa zonanya.
fn baca_dinding(teks: &str) -> Option<chrono::NaiveDateTime> {
    chrono::NaiveDateTime::parse_from_str(teks.trim(), "%Y-%m-%d %H:%M:%S")
        .ok()
        .or_else(|| chrono::DateTime::parse_from_rfc3339(teks.trim()).ok().map(|j| j.naive_local()))
}

/// Hitung selisih dari jam dinding Pusat dan jam dinding komputer ini saat jawaban diterima.
pub fn hitung_selisih(jam_pusat: &str, dinding_lokal: chrono::NaiveDateTime) -> Option<SelisihJam> {
    Some(SelisihJam { ms: (baca_dinding(jam_pusat)? - dinding_lokal).num_milliseconds() })
}

/// Jam dinding komputer ini sekarang (zona Windows yang dipasang di komputer ini).
fn dinding_sekarang() -> chrono::NaiveDateTime {
    chrono::Local::now().naive_local()
}

/// Tanggal dan jam di Pusat saat jam dinding komputer ini menunjukkan `dinding_lokal`. Tanpa selisih, jam komputer ini yang dipakai.
/// `dinding` adalah teks yang sama (`YYYY-MM-DD HH:MM:SS`) untuk dibaca tampilan sebagai jam dinding.
pub fn jam_pusat_json(selisih: Option<SelisihJam>, dinding_lokal: chrono::NaiveDateTime) -> Value {
    let (waktu, dari_pusat, ms) = match selisih {
        Some(s) => (dinding_lokal + chrono::Duration::milliseconds(s.ms), true, s.ms),
        None => (dinding_lokal, false, 0),
    };
    json!({
        "tanggal": waktu.format("%Y-%m-%d").to_string(),
        "jam": waktu.format("%H:%M:%S").to_string(),
        "dinding": waktu.format("%Y-%m-%d %H:%M:%S").to_string(),
        "selisihDetik": ms / 1000,
        "selisihMs": ms,
        "berbeda": ms.abs() > BATAS_SELISIH_JAM * 1000,
        "dariPusat": dari_pusat,
    })
}

/// Kode unik untuk satu perintah simpan (32 karakter heksa acak).
pub fn id_permintaan_baru() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("sistem tidak bisa membuat angka acak");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Pesan kunci versi (rancangan 6.4), atau `None` bila versinya sama (atau Pusat belum menyebut versinya).
pub fn pesan_versi(versi_pusat: &str, versi_ini: &str) -> Option<String> {
    if versi_pusat.is_empty() || versi_pusat == versi_ini {
        return None;
    }
    Some(if versi_angka(versi_pusat) > versi_angka(versi_ini) {
        format!("Kasir Jet di komputer ini (versi {versi_ini}) lebih lama dari Pusat (versi {versi_pusat}). Perbarui sekarang supaya bisa tersambung lagi.")
    } else {
        format!("Kasir Jet di komputer Pusat masih versi {versi_pusat}. Perbarui Kasir Jet di komputer Pusat dulu, lalu buka lagi komputer ini.")
    })
}

fn versi_angka(v: &str) -> Vec<u64> {
    v.split('.').map(|b| b.trim().parse().unwrap_or(0)).collect()
}

enum Galat {
    /// Tidak ada alamat yang menjawab.
    Tidak,
    /// Ada yang menjawab, tetapi namanya bukan Pusat yang dipasangkan.
    BukanPusat,
}

impl Klien {
    pub fn baru(berkas: PathBuf, pengaturan: Arc<Mutex<Pengaturan>>, nama_komputer: String, pemancar: Pemancar, jeda: Jeda) -> Self {
        Klien {
            berkas,
            pengaturan,
            http: klien_http(),
            nama_komputer,
            versi: env!("CARGO_PKG_VERSION").to_string(),
            jeda,
            pemancar,
            keadaan: Mutex::new(Keadaan { status: Status::BelumSambung, pesan: None, versi_pusat: None }),
            alamat: Mutex::new(None),
            ditolak: AtomicBool::new(false),
            diteruskan: AtomicU64::new(0),
            pemeriksa: Mutex::new(None),
            selisih_jam: Mutex::new(None),
        }
    }

    /// Pura-pura berversi lain (tes kunci versi).
    #[cfg(test)]
    pub fn dengan_versi(mut self, versi: &str) -> Self {
        self.versi = versi.to_string();
        self
    }

    /// Berapa perintah yang sudah dikirim ke Pusat (untuk tes: perintah lokal tidak menambahnya).
    pub fn jumlah_diteruskan(&self) -> u64 {
        self.diteruskan.load(Ordering::SeqCst)
    }

    fn sambungan(&self) -> Option<Sambungan> {
        kunci(&self.pengaturan).kasir.clone()
    }

    fn port(&self) -> u16 {
        kunci(&self.pengaturan).port_efektif()
    }

    fn ubah(&self, f: impl FnOnce(&mut Sambungan)) -> Res<()> {
        let mut p = kunci(&self.pengaturan);
        let s = p.kasir.get_or_insert_with(Sambungan::default);
        f(s);
        p.simpan(&self.berkas)
    }

    fn nama_tampil(&self) -> String {
        self.sambungan().map(|s| s.nama_pusat.filter(|n| !n.is_empty()).unwrap_or(s.pusat)).unwrap_or_default()
    }

    /* ---- jam Pusat ---- */

    /// Tanggal dan jam Pusat sekarang (perintah lokal `jam_pusat`). Hanya komputer Kasir yang memakai jam Pusat.
    pub fn jam_pusat(&self) -> Value {
        let kasir = kunci(&self.pengaturan).mode == Mode::Kasir;
        let selisih = if kasir { *kunci(&self.selisih_jam) } else { None };
        jam_pusat_json(selisih, dinding_sekarang())
    }

    /* ---- status ---- */

    pub fn status(&self) -> Status {
        kunci(&self.keadaan).status
    }

    pub fn status_json(&self) -> Value {
        let k = kunci(&self.keadaan);
        let s = self.sambungan();
        json!({
            "status": k.status,
            "pesan": k.pesan,
            "pusat": s.as_ref().map(|s| s.pusat.clone()),
            "namaPusat": s.as_ref().and_then(|s| s.nama_pusat.clone()),
            "alamat": kunci(&self.alamat).map(|a| a.to_string()),
            "versiPusat": k.versi_pusat,
            "sudahDisambung": s.as_ref().is_some_and(|s| s.token.is_some()),
        })
    }

    fn set_status(&self, status: Status, pesan: Option<String>) {
        {
            let mut k = kunci(&self.keadaan);
            if k.status == status && k.pesan == pesan {
                return;
            }
            k.status = status;
            k.pesan = pesan;
        }
        (self.pemancar)(&self.status_json());
    }

    /* ---- pengaturan ---- */

    /// Isi nama komputer Pusat. Bila namanya berubah, sambungan lama (token, alamat) dilupakan.
    pub fn atur_pusat(&self, pusat: &str, port: Option<u16>) -> Res<()> {
        let pusat = pusat.trim().to_string();
        if pusat.is_empty() {
            return Err("Nama komputer Pusat belum diisi.".into());
        }
        {
            let mut p = kunci(&self.pengaturan);
            p.mode = Mode::Kasir;
            if port.is_some() {
                p.port = port;
            }
            let sama = p.kasir.as_ref().is_some_and(|s| s.pusat.eq_ignore_ascii_case(&pusat));
            if !sama {
                p.kasir = Some(Sambungan { pusat, ..Default::default() });
                *kunci(&self.selisih_jam) = None;
            }
            p.simpan(&self.berkas)?;
        }
        *kunci(&self.alamat) = None;
        self.ditolak.store(false, Ordering::SeqCst);
        let ada_token = self.sambungan().is_some_and(|s| s.token.is_some());
        self.set_status(if ada_token { Status::Terputus } else { Status::BelumSambung }, None);
        Ok(())
    }

    /* ---- mencari Pusat ---- */

    async fn calon(&self, s: &Sambungan) -> Vec<SocketAddr> {
        let port = self.port();
        let mut hasil: Vec<SocketAddr> = vec![];
        if let Some(a) = *kunci(&self.alamat) {
            hasil.push(a);
        }
        if let Ok(ip) = s.pusat.parse::<IpAddr>() {
            hasil.push(SocketAddr::new(ip, port));
        } else if let Ok(Ok(semua)) = tokio::time::timeout(WAKTU_HALO, tokio::net::lookup_host((s.pusat.as_str(), port))).await {
            let mut v: Vec<SocketAddr> = semua
                // IPv6 link-local (fe80::) tidak bisa dipakai tanpa scope id.
                .filter(|a| !matches!(a.ip(), IpAddr::V6(v6) if (v6.segments()[0] & 0xffc0) == 0xfe80))
                .collect();
            v.sort_by_key(|a| a.is_ipv6());
            hasil.extend(v);
        }
        if let Some(ip) = s.ip_terakhir.as_deref().and_then(|t| t.parse::<IpAddr>().ok()) {
            hasil.push(SocketAddr::new(ip, port));
        }
        let mut lihat = std::collections::HashSet::new();
        hasil.retain(|a| lihat.insert(*a));
        hasil
    }

    /// Alamat pertama yang menjawab `/halo` dengan nama komputer yang cocok.
    async fn cari(&self, s: &Sambungan) -> Result<(SocketAddr, Value, Option<String>), (Galat, Option<String>)> {
        let mut lain: Option<String> = None;
        for a in self.calon(s).await {
            let url = format!("http://{a}/api/v1/halo");
            let t0 = chrono::Utc::now();
            let Ok(res) = self.http.get(url).timeout(WAKTU_HALO).send().await else { continue };
            let Ok(v) = res.json::<Value>().await else { continue };
            // Jam Pusat dibandingkan dengan jam lokal di tengah-tengah perjalanan permintaan.
            let tengah = (t0 + (chrono::Utc::now() - t0) / 2).with_timezone(&chrono::Local).naive_local();
            if v["ok"] != true {
                continue;
            }
            let halo = v["hasil"].clone();
            let selisih = halo["jamDinding"].as_str().or(halo["jam"].as_str()).and_then(|j| hitung_selisih(j, tengah));
            let nama = halo["namaKomputer"].as_str().unwrap_or("").to_string();
            if let Some(dipasangkan) = s.nama_pusat.as_deref().filter(|n| !n.is_empty()) {
                if !dipasangkan.eq_ignore_ascii_case(&nama) {
                    lain = Some(nama);
                    continue;
                }
            }
            // Pemeriksaan yang masih berjalan saat komputer berhenti menjadi Kasir tidak boleh menulis jam Pusat lagi.
            if selisih.is_some() && kunci(&self.pengaturan).mode == Mode::Kasir {
                *kunci(&self.selisih_jam) = selisih;
            }
            return Ok((a, halo, Some(nama)));
        }
        match lain {
            Some(n) => Err((Galat::BukanPusat, Some(n))),
            None => Err((Galat::Tidak, None)),
        }
    }

    fn pesan_tidak_terjangkau(&self) -> String {
        format!("Komputer Pusat ({}) tidak bisa dihubungi. Pastikan komputer itu menyala dan Kasir Jet terbuka di sana.", self.nama_tampil())
    }

    fn pesan_galat(&self, g: &Galat, s: &Sambungan) -> String {
        match g {
            Galat::BukanPusat => format!(
                "Alamat ini sekarang dipakai komputer lain, bukan {}. Ketik nama atau alamat terbaru dari layar Komputer Pusat.",
                s.nama_pusat.as_deref().unwrap_or(&s.pusat)
            ),
            Galat::Tidak => format!(
                "Komputer Pusat \"{}\" tidak ditemukan. Periksa nama komputer Pusat dan kabelnya, atau ketik alamat yang tampil di layar Komputer Pusat.",
                s.pusat
            ),
        }
    }

    fn status_dari_halo(&self, halo: &Value) -> (Status, Option<String>) {
        let versi_pusat = halo["versi"].as_str().unwrap_or("").to_string();
        kunci(&self.keadaan).versi_pusat = Some(versi_pusat.clone());
        let versi_ini = self.versi.as_str();
        if self.ditolak.load(Ordering::SeqCst) {
            return (Status::Ditolak, Some(PESAN_DITOLAK.into()));
        }
        if halo["status"] == "perawatan" {
            return (Status::Perawatan, Some("Pusat sedang memulihkan data. Tunggu sebentar, lalu masuk lagi.".into()));
        }
        if let Some(pesan) = pesan_versi(&versi_pusat, versi_ini) {
            return (Status::VersiBeda, Some(pesan));
        }
        (Status::Tersambung, None)
    }

    /// Pesan bila versi Pusat yang terakhir diketahui berbeda dengan versi ini.
    fn pesan_kunci_versi(&self) -> Option<String> {
        let k = kunci(&self.keadaan);
        if k.status != Status::VersiBeda {
            return None;
        }
        k.pesan.clone()
    }

    /// Versi Pusat yang terakhir dilaporkan `/halo`.
    pub fn versi_pusat(&self) -> Option<String> {
        kunci(&self.keadaan).versi_pusat.clone().filter(|v| !v.is_empty())
    }

    /// Satu kali pemeriksaan `/halo`. Mengembalikan `true` bila Pusat menjawab.
    pub async fn periksa(&self) -> bool {
        let Some(s) = self.sambungan().filter(|s| s.token.is_some()) else {
            self.set_status(Status::BelumSambung, None);
            return false;
        };
        match self.cari(&s).await {
            Ok((a, halo, _)) => {
                *kunci(&self.alamat) = Some(a);
                let ip = a.ip().to_string();
                if s.ip_terakhir.as_deref() != Some(ip.as_str()) {
                    let _ = self.ubah(|s| s.ip_terakhir = Some(ip));
                }
                let (st, pesan) = self.status_dari_halo(&halo);
                self.set_status(st, pesan);
                true
            }
            Err((g, _)) => {
                *kunci(&self.alamat) = None;
                if !self.ditolak.load(Ordering::SeqCst) {
                    let pesan = match g {
                        Galat::BukanPusat => self.pesan_galat(&g, &s),
                        Galat::Tidak => self.pesan_tidak_terjangkau(),
                    };
                    self.set_status(Status::Terputus, Some(pesan));
                }
                false
            }
        }
    }

    /// Mulai atau hentikan pemeriksa latar sesuai mode: hanya berjalan di mode Kasir yang sudah disambungkan.
    pub fn selaraskan(self: &Arc<Self>) {
        let perlu = {
            let p = kunci(&self.pengaturan);
            p.mode == Mode::Kasir && p.kasir.as_ref().is_some_and(|s| s.token.is_some())
        };
        if kunci(&self.pengaturan).mode != Mode::Kasir {
            // Bukan komputer Kasir lagi: jam Pusat yang lama tidak berlaku.
            *kunci(&self.selisih_jam) = None;
        }
        let mut pm = kunci(&self.pemeriksa);
        if let Some(lama) = pm.take() {
            lama.store(true, Ordering::SeqCst);
        }
        if !perlu {
            return;
        }
        let henti = Arc::new(AtomicBool::new(false));
        *pm = Some(henti.clone());
        let lemah: Weak<Klien> = Arc::downgrade(self);
        let jeda = self.jeda;
        tauri::async_runtime::spawn(async move {
            let mut gagal: u32 = 0;
            loop {
                let Some(k) = lemah.upgrade() else { return };
                if henti.load(Ordering::SeqCst) {
                    return;
                }
                let tunggu = if k.periksa().await {
                    gagal = 0;
                    jeda.tersambung
                } else {
                    gagal += 1;
                    (jeda.terputus_awal + jeda.terputus_awal / 2 * gagal).min(jeda.terputus_maks)
                };
                drop(k);
                tokio::time::sleep(tunggu).await;
                if henti.load(Ordering::SeqCst) {
                    return;
                }
            }
        });
    }

    /* ---- sambung pertama ---- */

    /// Tukar kode sambung (atau masa terima otomatis di Pusat, bila `kode` kosong) dengan token perangkat, lalu simpan.
    pub async fn sambung(self: &Arc<Self>, kode: Option<String>) -> Res<()> {
        let s = self.sambungan().ok_or("Nama komputer Pusat belum diisi.")?;
        self.set_status(Status::Menyambung, None);
        let balik = if s.token.is_some() { Status::Terputus } else { Status::BelumSambung };
        let (a, halo, nama) = match self.cari(&s).await {
            Ok(x) => x,
            Err((g, _)) => {
                self.set_status(balik, None);
                return Err(format!("{AWALAN_PUSAT}{}", self.pesan_galat(&g, &s)));
            }
        };
        let kode = kode.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        let res = self
            .http
            .post(format!("http://{a}/api/v1/sambung"))
            .timeout(WAKTU_BACA)
            .json(&json!({ "namaKomputer": self.nama_komputer, "kode": kode }))
            .send()
            .await;
        let v: Value = match res {
            Ok(r) => r.json().await.unwrap_or(Value::Null),
            Err(_) => {
                self.set_status(balik, None);
                return Err(format!("{AWALAN_PUSAT}{}", self.pesan_tidak_terjangkau()));
            }
        };
        if v["ok"] != true {
            self.set_status(balik, None);
            let pesan = v["pesan"].as_str().unwrap_or("Pusat tidak mau menerima komputer ini. Coba lagi.");
            return Err(format!("{AWALAN_PUSAT}{pesan}"));
        }
        let token = v["hasil"]["token"].as_str().map(String::from);
        let sesi = v["hasil"]["sesi"].as_str().map(String::from);
        if token.is_none() || sesi.is_none() {
            self.set_status(balik, None);
            return Err(format!("{AWALAN_PUSAT}Jawaban Pusat tidak terbaca. Coba lagi."));
        }
        let ip = a.ip().to_string();
        self.ubah(|s| {
            s.token = token;
            s.sesi = sesi;
            s.nama_pusat = nama.filter(|n| !n.is_empty());
            s.ip_terakhir = Some(ip);
        })?;
        self.ditolak.store(false, Ordering::SeqCst);
        *kunci(&self.alamat) = Some(a);
        let (st, pesan) = self.status_dari_halo(&halo);
        self.set_status(st, pesan);
        self.selaraskan();
        Ok(())
    }

    /// Satu percobaan sambung tanpa kode untuk layar "menunggu Pusat" (rancangan 8.5). Hasil `status`:
    /// `tersambung`, `perawatan` (Pusat sedang mengambil data), `perlu-kode` (masa terima otomatis sudah lewat), atau `menunggu`.
    pub async fn tunggu_pusat(self: &Arc<Self>) -> Value {
        let Some(s) = self.sambungan() else { return json!({ "status": "menunggu" }) };
        match self.cari(&s).await {
            Err(_) => return json!({ "status": "menunggu" }),
            Ok((_, halo, _)) if halo["status"] == "perawatan" => return json!({ "status": "perawatan" }),
            Ok(_) => {}
        }
        match self.sambung(None).await {
            Ok(()) => json!({ "status": "tersambung" }),
            Err(pesan) if pesan.contains("meminta kode sambung") => json!({ "status": "perlu-kode", "pesan": pesan.trim_start_matches(AWALAN_PUSAT) }),
            Err(pesan) => json!({ "status": "menunggu", "pesan": pesan.trim_start_matches(AWALAN_PUSAT) }),
        }
    }

    /* ---- meneruskan perintah ---- */

    /// Tentukan ke mana perintah ini pergi di komputer Kasir.
    pub fn tujuan(&self, perintah: &str) -> Tujuan {
        match golongan(perintah) {
            Some(Golongan::Lokal) => Tujuan::Lokal,
            Some(Golongan::Data) => Tujuan::Pusat,
            Some(Golongan::KhususPusat) => Tujuan::Tolak(format!("Menu ini hanya bisa dibuka di komputer Pusat ({}).", self.nama_tampil())),
            Some(Golongan::Campuran) => Tujuan::Tolak("Perintah ini dikerjakan sebagian di komputer Anda dan sebagian di Pusat.".into()),
            Some(Golongan::Pengembangan) => Tujuan::Tolak("Perintah ini tidak bisa dipakai lewat jaringan.".into()),
            None => Tujuan::Tolak(format!("Perintah \"{perintah}\" tidak dikenal.")),
        }
    }

    /// Jalankan satu perintah di komputer Kasir. Yang lokal dikerjakan `lokal` (di thread terpisah),
    /// yang data dikirim ke Pusat. `sesi_lokal` adalah salinan `User` untuk pemeriksaan izin lokal.
    pub async fn jalankan(
        &self,
        sesi_lokal: &Session,
        perintah: String,
        args: Option<Map<String, Value>>,
        lokal: impl FnOnce(String, Map<String, Value>) -> Res<Value> + Send + 'static,
    ) -> Res<Value> {
        self.jalankan_id(sesi_lokal, perintah, args, None, lokal).await
    }

    /// Sama seperti `jalankan`; `id_permintaan` (bila tampilan sudah punya) dipakai untuk perintah simpan.
    /// Tanpa itu, Kasir membuat sendiri atau memakai ID simpan sama persis yang hasilnya belum pasti.
    pub async fn jalankan_id(
        &self,
        sesi_lokal: &Session,
        perintah: String,
        args: Option<Map<String, Value>>,
        id_permintaan: Option<String>,
        lokal: impl FnOnce(String, Map<String, Value>) -> Res<Value> + Send + 'static,
    ) -> Res<Value> {
        // Auto-backup saat keluar tidak berlaku di komputer Kasir: datanya ada di Pusat (rancangan 6.1). Dijawab kosong, tanpa error.
        if perintah == "backup_otomatis" {
            return Ok(Value::Null);
        }
        if perintah == "foto_simpan" {
            return self.foto_simpan(sesi_lokal, args.unwrap_or_default(), id_permintaan).await;
        }
        match self.tujuan(&perintah) {
            Tujuan::Lokal => {
                let args = args.unwrap_or_default();
                tauri::async_runtime::spawn_blocking(move || lokal(perintah, args)).await.map_err(e)?
            }
            Tujuan::Tolak(pesan) => {
                // Hanya pengembangan: jendela membuka sesi lama lewat `restore_session`; di komputer kasir hasilnya kosong.
                if perintah == "restore_session" { Ok(Value::Null) } else { Err(pesan) }
            }
            Tujuan::Pusat => {
                let hasil = self.teruskan(sesi_lokal, &perintah, args.unwrap_or_default(), id_permintaan).await;
                if hasil.is_ok() {
                    self.catat_pengguna(sesi_lokal, &perintah, hasil.as_ref().ok());
                }
                hasil
            }
        }
    }

    /// `foto_simpan` di komputer Kasir (rancangan 6.5): file gambar dibaca di sini, isinya dikirim ke `foto_simpan_data` di Pusat.
    /// Alamat file tidak pernah dikirim. Bila `hapusAsal`, file di komputer ini dihapus setelah Pusat menyimpannya.
    async fn foto_simpan(&self, sesi_lokal: &Session, args: Map<String, Value>, id_permintaan: Option<String>) -> Res<Value> {
        let kode: String = crate::konteks::ambil(&args, "kode")?;
        let path: String = crate::konteks::ambil(&args, "path")?;
        let hapus_asal = crate::konteks::ambil::<Option<bool>>(&args, "hapusAsal")?.unwrap_or(false);
        let hanya_baru = crate::konteks::ambil::<Option<bool>>(&args, "hanyaBaru")?.unwrap_or(false);
        let sumber = path.clone();
        let (ekstensi, isi) = tauri::async_runtime::spawn_blocking(move || crate::berkas::foto_baca_berkas(&sumber)).await.map_err(e)??;
        let kirim = serde_json::Map::from_iter([
            ("kode".to_string(), json!(kode)),
            ("ekstensi".to_string(), json!(ekstensi)),
            ("data".to_string(), json!(crate::berkas::base64(&isi))),
            ("hanyaBaru".to_string(), json!(hanya_baru)),
        ]);
        let hasil = self.teruskan(sesi_lokal, "foto_simpan_data", kirim, id_permintaan).await?;
        if hapus_asal && !hanya_baru {
            crate::berkas::hapus_berkas_asal(&path)?;
        }
        Ok(hasil)
    }

    fn atur_pengguna(sesi: &Session, user: Option<User>) {
        *sesi.0.lock().unwrap_or_else(|p| p.into_inner()) = user;
    }

    /// Jaga salinan `User` di komputer ini sesuai hasil login, logout, dan ganti kata sandi di Pusat.
    fn catat_pengguna(&self, sesi: &Session, perintah: &str, hasil: Option<&Value>) {
        let baca = |v: Option<&Value>| v.and_then(|v| serde_json::from_value::<User>(v.clone()).ok());
        match perintah {
            "login" | "login_bawaan" | "current_user" => Self::atur_pengguna(sesi, baca(hasil)),
            "logout" => Self::atur_pengguna(sesi, None),
            "change_password" => {
                if let Some(u) = sesi.0.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
                    u.must_change = false;
                }
            }
            _ => {}
        }
    }

    async fn sesi_baru(&self, a: SocketAddr, token: &str) -> Res<String> {
        let res = self.http.post(format!("http://{a}/api/v1/sesi")).bearer_auth(token).timeout(WAKTU_BACA).send().await;
        let v: Value = res.map_err(|_| format!("{AWALAN_PUSAT}{}", self.pesan_tidak_terjangkau()))?.json().await.unwrap_or(Value::Null);
        let sesi = v["hasil"]["sesi"].as_str().ok_or_else(|| format!("{AWALAN_PUSAT}Pusat belum memberi sesi baru. Coba lagi."))?.to_string();
        self.ubah(|s| s.sesi = Some(sesi.clone()))?;
        Ok(sesi)
    }

    async fn alamat_aktif(&self, s: &Sambungan) -> Res<SocketAddr> {
        if let Some(a) = *kunci(&self.alamat) {
            return Ok(a);
        }
        match self.cari(s).await {
            Ok((a, _, _)) => {
                *kunci(&self.alamat) = Some(a);
                Ok(a)
            }
            Err((g, _)) => {
                let pesan = match g {
                    Galat::BukanPusat => self.pesan_galat(&g, s),
                    Galat::Tidak => self.pesan_tidak_terjangkau(),
                };
                self.set_status(Status::Terputus, Some(pesan.clone()));
                Err(format!("{AWALAN_PUSAT}{pesan}"))
            }
        }
    }

    /// ID untuk perintah simpan ini: dari tampilan (dialog Coba Lagi memakai ID yang sama), atau yang baru. Isi perintah
    /// tidak pernah dipakai untuk mengenali ulangan, jadi dua penjualan yang isinya sama tetap dua transaksi.
    fn id_untuk(perintah: &str, dari_tampilan: Option<String>) -> Option<String> {
        if !perintah_simpan(perintah) {
            return None;
        }
        Some(dari_tampilan.filter(|i| !i.trim().is_empty()).unwrap_or_else(id_permintaan_baru))
    }

    async fn teruskan(&self, sesi_lokal: &Session, perintah: &str, args: Map<String, Value>, id_permintaan: Option<String>) -> Res<Value> {
        let baca = perintah_baca(perintah);
        let id = Self::id_untuk(perintah, id_permintaan);
        self.kirim(sesi_lokal, perintah, &args, baca, id.as_deref()).await
    }

    async fn kirim(&self, sesi_lokal: &Session, perintah: &str, args: &Map<String, Value>, baca: bool, id: Option<&str>) -> Res<Value> {
        let mut sudah_ulang = false;
        loop {
            let Some(s) = self.sambungan().filter(|s| s.token.is_some()) else {
                return Err(format!("{AWALAN_PUSAT}Komputer ini belum disambungkan ke Pusat. Sambungkan dulu dengan kode dari komputer Pusat."));
            };
            if self.ditolak.load(Ordering::SeqCst) {
                return Err(format!("{AWALAN_PUSAT}{PESAN_DITOLAK}"));
            }
            // Kunci versi (rancangan 6.4): versi yang sudah diketahui berbeda dengan Pusat, jadi perintah tidak dikirim.
            if let Some(pesan) = self.pesan_kunci_versi() {
                return Err(format!("{AWALAN_PUSAT}{pesan}"));
            }
            let token = s.token.clone().unwrap_or_default();
            let a = match self.alamat_aktif(&s).await {
                Ok(a) => a,
                Err(pesan) if !baca && pesan.contains("tidak bisa dihubungi") => return Err(format!("{AWALAN_PUSAT}{PESAN_BELUM_TERSIMPAN}")),
                Err(pesan) => return Err(pesan),
            };
            let sesi = match s.sesi.clone() {
                Some(x) => x,
                None => self.sesi_baru(a, &token).await?,
            };
            self.diteruskan.fetch_add(1, Ordering::SeqCst);
            let res = self
                .http
                .post(format!("http://{a}/api/v1/jalankan"))
                .bearer_auth(&token)
                .header(super::server::HEADER_VERSI, self.versi.as_str())
                .timeout(if baca { WAKTU_BACA } else { WAKTU_SIMPAN })
                .json(&json!({ "perintah": perintah, "args": args, "sesi": sesi, "idPermintaan": id }))
                .send()
                .await;
            let res = match res {
                Ok(r) => r,
                // Gagal tersambung: permintaan belum sampai, jadi aman dicoba lagi sekali dengan mencari alamat ulang.
                Err(err) if err.is_connect() => {
                    *kunci(&self.alamat) = None;
                    if !sudah_ulang {
                        sudah_ulang = true;
                        continue;
                    }
                    let pesan = self.pesan_tidak_terjangkau();
                    self.set_status(Status::Terputus, Some(pesan.clone()));
                    return Err(if baca {
                        format!("{AWALAN_PUSAT}{pesan}")
                    } else {
                        format!("{AWALAN_PUSAT}{PESAN_BELUM_TERSIMPAN}")
                    });
                }
                // Jawaban hilang sebelum waktu habis (mis. sambungan diputus): Pusat mungkin sudah menyimpan, tetapi karena
                // permintaan ini ber-ID, mengulang sekali dengan ID yang sama aman.
                Err(err) if id.is_some() && !err.is_timeout() && !sudah_ulang => {
                    *kunci(&self.alamat) = None;
                    sudah_ulang = true;
                    continue;
                }
                Err(_) => {
                    *kunci(&self.alamat) = None;
                    self.set_status(Status::Terputus, Some(self.pesan_tidak_terjangkau()));
                    return Err(if baca {
                        format!("{AWALAN_PUSAT}{}", self.pesan_tidak_terjangkau())
                    } else {
                        format!("{AWALAN_PUSAT}{PESAN_BELUM_PASTI}")
                    });
                }
            };
            let v: Value = match res.json().await {
                Ok(v) => v,
                // Jawaban yang bukan JSON (mis. halaman galat dari perantara): untuk perintah simpan belum pasti tersimpan atau tidak.
                Err(_) if id.is_some() => return Err(format!("{AWALAN_PUSAT}{PESAN_BELUM_PASTI}")),
                Err(_) => Value::Null,
            };
            if v["ok"] == true {
                // Pusat menjawab, jadi sambungan sehat (kecuali bila status lain masih berlaku).
                if self.status() == Status::Terputus || self.status() == Status::Menyambung {
                    self.set_status(Status::Tersambung, None);
                }
                return Ok(v["hasil"].clone());
            }
            let pesan = v["pesan"].as_str().unwrap_or("Pusat tidak bisa memproses permintaan ini. Coba lagi.").to_string();
            match v["kode"].as_str().unwrap_or("") {
                "perintah" => return Err(pesan),
                "tidak-sah" => {
                    self.ditolak.store(true, Ordering::SeqCst);
                    self.set_status(Status::Ditolak, Some(PESAN_DITOLAK.into()));
                    return Err(format!("{AWALAN_PUSAT}{PESAN_DITOLAK}"));
                }
                "sesi" => {
                    // Sesi dihapus Pusat (diam terlalu lama): minta yang baru. Pengguna perlu masuk lagi.
                    Self::atur_pengguna(sesi_lokal, None);
                    self.sesi_baru(a, &token).await?;
                    return Err("Sesi Anda sudah berakhir. Silakan masuk lagi.".into());
                }
                "versi-beda" => {
                    let pesan = pesan_versi(v["versiPusat"].as_str().unwrap_or(""), &self.versi).unwrap_or(pesan);
                    kunci(&self.keadaan).versi_pusat = v["versiPusat"].as_str().map(String::from);
                    self.set_status(Status::VersiBeda, Some(pesan.clone()));
                    return Err(format!("{AWALAN_PUSAT}{pesan}"));
                }
                "perawatan" => {
                    self.set_status(Status::Perawatan, Some("Pusat sedang memulihkan data. Tunggu sebentar, lalu masuk lagi.".into()));
                    return Err(format!("{AWALAN_PUSAT}{pesan}"));
                }
                _ => return Err(format!("{AWALAN_PUSAT}{pesan}")),
            }
        }
    }
}

const PESAN_DITOLAK: &str = "Komputer ini sudah diputus dari Pusat. Minta pemilik toko membuat kode sambung baru.";
/// Pesan 7.3. Pusat mengenali simpan yang diulang lewat ID-nya dan memberi hasil yang lama, tetapi bila Pusat mati tepat
/// sesudah menyimpan dan sebelum mencatat ID itu, hasilnya tidak bisa dikenali. Karena itu pesannya tidak berjanji lebih dari yang dikerjakan.
pub const PESAN_BELUM_PASTI: &str = "Kasir Jet belum tahu apakah transaksi ini sudah tersimpan. Tekan Coba Lagi. Kasir Jet akan memeriksa dulu apakah transaksi ini sudah tersimpan.";
const PESAN_BELUM_TERSIMPAN: &str = "Transaksi belum tersimpan karena Pusat tidak terjangkau. Isian Anda masih ada. Tekan Coba Lagi setelah Pusat menyala.";
