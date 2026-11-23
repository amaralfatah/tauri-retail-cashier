//! Pembatas percobaan: terlalu banyak yang salah berturut-turut mengunci sementara.
//! Dipakai untuk kode sambung (per alamat IP) dan login (per perangkat). Waktu diberikan pemanggil supaya mudah diuji.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Jumlah salah berturut-turut sebelum dikunci.
pub const MAKS_SALAH: u32 = 5;
/// Lama kunci.
pub const LAMA_KUNCI: Duration = Duration::from_secs(5 * 60);

#[derive(Default)]
struct Catatan {
    salah: u32,
    kunci_sampai: Option<Instant>,
}

pub struct Pembatas<K> {
    maks: u32,
    lama: Duration,
    peta: Mutex<HashMap<K, Catatan>>,
}

impl<K: Eq + Hash + Clone> Pembatas<K> {
    pub fn baru(maks: u32, lama: Duration) -> Self {
        Pembatas { maks, lama, peta: Mutex::new(HashMap::new()) }
    }

    fn peta(&self) -> std::sync::MutexGuard<'_, HashMap<K, Catatan>> {
        self.peta.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Sisa waktu kunci bila `kunci` sedang dikunci.
    pub fn sisa_kunci(&self, kunci: &K, sekarang: Instant) -> Option<Duration> {
        let mut peta = self.peta();
        let sampai = peta.get(kunci)?.kunci_sampai?;
        if sampai > sekarang {
            return Some(sampai - sekarang);
        }
        // Kunci sudah lewat: mulai dari nol lagi.
        peta.remove(kunci);
        None
    }

    /// Catat satu percobaan salah. Mengembalikan `true` bila sekarang terkunci.
    pub fn gagal(&self, kunci: K, sekarang: Instant) -> bool {
        let mut peta = self.peta();
        if peta.len() > 1000 {
            peta.retain(|_, c| c.kunci_sampai.is_some_and(|s| s > sekarang));
        }
        let c = peta.entry(kunci).or_default();
        c.salah += 1;
        if c.salah >= self.maks {
            c.salah = 0;
            c.kunci_sampai = Some(sekarang + self.lama);
            return true;
        }
        false
    }

    /// Catat satu percobaan SEBELUM dikerjakan (reservasi), dalam satu langkah dengan pemeriksaan kunci. Percobaan paralel
    /// tidak bisa lolos bersamaan: yang ke-`maks` + 1 sudah ditolak. `Err` berisi sisa waktu kunci.
    pub fn coba(&self, kunci: K, sekarang: Instant) -> Result<(), Duration> {
        let mut peta = self.peta();
        if peta.len() > 1000 {
            peta.retain(|_, c| c.kunci_sampai.is_some_and(|s| s > sekarang));
        }
        let c = peta.entry(kunci).or_default();
        if let Some(sampai) = c.kunci_sampai {
            if sampai > sekarang {
                return Err(sampai - sekarang);
            }
            c.kunci_sampai = None;
            c.salah = 0;
        }
        if c.salah >= self.maks {
            c.salah = 0;
            c.kunci_sampai = Some(sekarang + self.lama);
            return Err(self.lama);
        }
        c.salah += 1;
        Ok(())
    }

    /// Batalkan satu reservasi `coba` (percobaan ternyata tidak dikerjakan).
    pub fn batalkan(&self, kunci: &K) {
        if let Some(c) = self.peta().get_mut(kunci) {
            c.salah = c.salah.saturating_sub(1);
        }
    }

    /// Percobaan yang benar menghapus hitungan salah, kecuali kunci sedang berlaku (mis. dipasang percobaan lain
    /// yang berjalan bersamaan).
    pub fn berhasil(&self, kunci: &K) {
        let mut peta = self.peta();
        if peta.get(kunci).and_then(|c| c.kunci_sampai).is_some_and(|s| s > Instant::now()) {
            return;
        }
        peta.remove(kunci);
    }
}
