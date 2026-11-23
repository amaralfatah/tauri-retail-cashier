//! Pengendali mode Pusat: membaca `pusat.json`, menyalakan atau mematikan server, dan menjawab status.
//! Dipasang sebagai state Tauri; perintah Tauri untuk layar Komputer Pusat (tahap tampilan) memanggilnya.

use super::mode::{Mode, Pengaturan};
use super::server::{antarmuka_sistem, mulai, Data, Pusat, ServerJalan};
use crate::db::Res;
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

fn kunci<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// Nama komputer ini, seperti yang dikenal jaringan.
pub fn nama_komputer() -> String {
    ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))
        .or_else(|| {
            let o = std::process::Command::new("hostname").output().ok()?;
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "Komputer".to_string())
}

/// Sisa waktu sampai pukul 23.59 hari ini (masa terima otomatis setelah pindah dari Toko Pro lama, rancangan 8.5).
pub fn sisa_sampai_tengah_malam() -> Duration {
    use chrono::Timelike;
    let n = chrono::Local::now();
    let detik = 86_400 - n.num_seconds_from_midnight() as u64;
    Duration::from_secs(detik.saturating_sub(60))
}

pub struct Kendali {
    berkas: PathBuf,
    pengaturan: Arc<Mutex<Pengaturan>>,
    jalan: Mutex<Option<ServerJalan>>,
    galat: Mutex<Option<String>>,
    /// Apakah database komputer ini dibuka. Komputer Kasir tidak membukanya; berpindah dari Kasir ke mode lain
    /// baru bisa dipakai setelah aplikasi dibuka ulang.
    db_dibuka: AtomicBool,
}

impl Kendali {
    pub fn baru(berkas: PathBuf) -> Self {
        let pengaturan = Pengaturan::muat(&berkas);
        Kendali { berkas, pengaturan: Arc::new(Mutex::new(pengaturan)), jalan: Mutex::new(None), galat: Mutex::new(None), db_dibuka: AtomicBool::new(true) }
    }

    /// Berkas `pusat.json` dan pengaturan yang dipakai bersama klien Kasir (satu sumber, supaya tidak saling menimpa).
    pub fn bersama(&self) -> (PathBuf, Arc<Mutex<Pengaturan>>) {
        (self.berkas.clone(), self.pengaturan.clone())
    }

    /// Apakah `pusat.json` sudah pernah ditulis (komputer ini sudah pernah memilih perannya).
    pub fn ada_berkas(&self) -> bool {
        self.berkas.exists()
    }

    pub fn tandai_db_dibuka(&self, dibuka: bool) {
        self.db_dibuka.store(dibuka, Ordering::SeqCst);
    }

    /// Database komputer ini tidak dibuka (aplikasi dimulai sebagai Kasir) padahal modenya bukan Kasir lagi.
    pub fn perlu_mulai_ulang(&self) -> bool {
        !self.db_dibuka.load(Ordering::SeqCst) && self.mode() != Mode::Kasir
    }

    /// Dipanggil saat aplikasi dibuka: hanya mode Pusat yang membuka server. Tunggal dan Kasir tidak membuka port.
    pub fn nyalakan(&self, data: Arc<dyn Data>) {
        let p = kunci(&self.pengaturan).clone();
        if p.mode == Mode::Pusat {
            self.buka_server(data, p.port_efektif());
        }
    }

    fn buka_server(&self, data: Arc<dyn Data>, port: u16) {
        let mut jalan = kunci(&self.jalan);
        *jalan = None;
        match mulai(data, IpAddr::V4(Ipv4Addr::UNSPECIFIED), port, nama_komputer(), Arc::new(antarmuka_sistem)) {
            Ok(s) => {
                *jalan = Some(s);
                *kunci(&self.galat) = None;
            }
            // Port terpakai: jendela ini tetap bisa dipakai seperti mode Tunggal (rancangan 5.2).
            Err(err) => *kunci(&self.galat) = Some(err),
        }
    }

    /// Ubah mode lalu simpan ke `pusat.json`. Mode Kasir menutup server; nama Pusat diisi lewat `Klien::atur_pusat`.
    pub fn atur_mode(&self, data: Arc<dyn Data>, mode: Mode, port: Option<u16>) -> Res<()> {
        let baru = {
            let mut p = kunci(&self.pengaturan);
            p.mode = mode;
            if port.is_some() {
                p.port = port;
            }
            p.simpan(&self.berkas)?;
            p.clone()
        };
        if mode == Mode::Pusat && !self.db_dibuka.load(Ordering::SeqCst) {
            // Database belum dibuka di sesi ini: server baru menyala setelah aplikasi dibuka ulang.
            *kunci(&self.jalan) = None;
        } else if mode == Mode::Pusat {
            self.buka_server(data, baru.port_efektif());
        } else {
            *kunci(&self.jalan) = None;
            *kunci(&self.galat) = None;
        }
        Ok(())
    }

    pub fn mode(&self) -> Mode {
        kunci(&self.pengaturan).mode
    }

    /// Server yang sedang berjalan, atau error yang bisa dibaca pengguna.
    pub fn pusat(&self) -> Res<Arc<Pusat>> {
        kunci(&self.jalan).as_ref().map(|s| s.pusat.clone()).ok_or_else(|| {
            kunci(&self.galat).clone().unwrap_or_else(|| "Komputer ini belum dijadikan Pusat.".to_string())
        })
    }

    /// Port yang dibuka (atau akan dibuka) bila komputer ini Pusat.
    pub fn port_efektif(&self) -> u16 {
        kunci(&self.pengaturan).port_efektif()
    }

    pub fn status(&self) -> Value {
        let mode = self.mode();
        // Izin firewall hanya ditanyakan di komputer Pusat (di luar Windows selalu "tidak-perlu").
        let izin = if mode == Mode::Pusat { super::firewall::periksa(self.port_efektif()).kode() } else { "tidak-perlu" };
        let jalan = kunci(&self.jalan);
        let (kode, otomatis) = jalan.as_ref().map_or((None, None), |s| (s.pusat.kode_aktif(), s.pusat.terima_otomatis_sisa()));
        let jumlah_otomatis = jalan.as_ref().and_then(|s| s.pusat.terima_otomatis_jumlah());
        json!({
            "mode": mode,
            "berjalan": jalan.is_some(),
            "perluMulaiUlang": self.perlu_mulai_ulang(),
            "port": jalan.as_ref().map(|s| s.alamat.port()),
            "galat": *kunci(&self.galat),
            "izinFirewall": izin,
            "namaKomputer": nama_komputer(),
            "kodeSambung": kode.as_ref().map(|k| k.0.clone()),
            "kodeSisaDetik": kode.map(|k| k.1.as_secs()),
            "terimaOtomatisSisaDetik": otomatis.map(|d| d.as_secs()),
            "terimaOtomatisDiterima": jumlah_otomatis.map(|j| j.0),
            "terimaOtomatisMaks": jumlah_otomatis.map(|j| j.1),
            "alamatIp": antarmuka_sistem().into_iter().filter_map(|(ip, _)| match ip {
                IpAddr::V4(v) if !v.is_loopback() => Some(v.to_string()),
                _ => None,
            }).collect::<Vec<_>>(),
        })
    }
}
