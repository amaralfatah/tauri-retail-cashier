//! Verifikasi Admin (FrmZOtentikasi) dan aturan izin kasir.
//!
//! Verifikasi Admin hanya dipakai untuk menghapus order beli, order jual, pending jual, dan data kas,
//! kalau user yang masuk berlevel Kasir atau Lainnya. Yang boleh memberi izin: user berlevel selain Kasir dan Lainnya.
//! Alurnya: layar meminta nama user dan kata sandi pengelola -> `verifikasi_admin` mengembalikan tanda izin sekali pakai
//! yang berlaku beberapa menit -> tanda itu ikut dikirim ke perintah hapus, dan server yang memeriksanya.
//!
//! Pengaturan penjualan (TSETING) tidak memakai izin supervisor; layar mengunci isiannya dan server menolak sebagai pengaman:
//! - IZINHARGA = 0: Kasir tidak boleh mengubah harga jual di tabel.
//! - IZINDISKON = 0: Kasir tidak boleh memberi diskon di layar bayar.
//! - IZINSTOKMIN = 0: semua level tidak boleh menjual lebih banyak dari stok.

use crate::auth::{self, Session, User};
use crate::db::{Db, Res};
use crate::trans::{self, Item, TransInput};
use rusqlite::{params, Connection};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

/// Awal pesan error yang artinya "perlu izin supervisor"; layar kasir mengenalinya lalu membuka Verifikasi Admin.
pub const TANDA: &str = "[izin] ";
/// Lama tanda izin berlaku.
pub const BERLAKU: Duration = Duration::from_secs(300);

/// Tanda izin yang sudah diterbitkan: (tanda, user pemohon, waktu terbit).
#[derive(Default)]
pub struct Brankas(Mutex<Vec<(String, String, Instant)>>);

impl Brankas {
    pub fn terbit_pada(&self, pemohon: &str, waktu: Instant) -> String {
        let mut h1 = RandomState::new().build_hasher();
        let mut h2 = RandomState::new().build_hasher();
        h1.write(pemohon.as_bytes());
        h2.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        let tanda = format!("{:016x}{:016x}", h1.finish(), h2.finish());
        let mut daftar = self.0.lock().unwrap_or_else(|p| p.into_inner());
        daftar.retain(|(_, _, t)| waktu.saturating_duration_since(*t) < BERLAKU);
        daftar.push((tanda.clone(), pemohon.to_string(), waktu));
        tanda
    }

    pub fn terbit(&self, pemohon: &str) -> String {
        self.terbit_pada(pemohon, Instant::now())
    }

    /// Tanda masih berlaku dan memang diterbitkan untuk `pemohon`. Tidak menghabiskan tanda.
    pub fn sah_pada(&self, tanda: &str, pemohon: &str, sekarang: Instant) -> bool {
        let daftar = self.0.lock().unwrap_or_else(|p| p.into_inner());
        daftar.iter().any(|(t, u, w)| t == tanda && u == pemohon && sekarang.saturating_duration_since(*w) < BERLAKU)
    }

    pub fn sah(&self, tanda: &str, pemohon: &str) -> bool {
        self.sah_pada(tanda, pemohon, Instant::now())
    }

    /// Habiskan tanda (sekali pakai).
    pub fn pakai(&self, tanda: &str) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).retain(|(t, _, _)| t != tanda);
    }
}

pub fn brankas() -> &'static Brankas {
    static B: OnceLock<Brankas> = OnceLock::new();
    B.get_or_init(Brankas::default)
}

/// Layar Verifikasi Admin: cocokkan nama user dan kata sandi pengelola, lalu terbitkan tanda izin.
#[tauri::command]
pub fn verifikasi_admin(db: State<Db>, session: State<Session>, iduser: String, password: String) -> Res<String> {
    let pemohon = session.user()?;
    let conn = db.lock()?;
    auth::verifikasi_pengelola(&conn, &iduser, &password)?;
    Ok(brankas().terbit(&pemohon.iduser))
}

fn flag(conn: &Connection, kolom: &str) -> bool {
    conn.query_row(&format!("SELECT COALESCE({kolom},0) FROM tseting LIMIT 1"), [], |r| r.get::<_, i64>(0)).unwrap_or(0) == 1
}

fn mirip(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

/// Harga yang dianggap harga resmi barang ini untuk satuan transaksi `it` (harga master, level, grosir, multi satuan, promo).
fn harga_resmi(conn: &Connection, it: &Item) -> Res<Vec<f64>> {
    let mut hasil = vec![];
    let cols = "COALESCE(hrgjual,0), COALESCE(hrglevel1,0), COALESCE(hrglevel2,0), COALESCE(hrglevel3,0), COALESCE(hrglevel4,0), COALESCE(hrglevel5,0),
                COALESCE(hrgtingkat1,0), COALESCE(hrgtingkat2,0), COALESCE(hrgtingkat3,0), COALESCE(hrgtingkat4,0), COALESCE(hrgtingkat5,0),
                COALESCE(hrgmultisatuan1,0), COALESCE(hrgmultisatuan2,0), COALESCE(hrgmultisatuan3,0), COALESCE(hrgmultisatuan4,0), COALESCE(hrgmultisatuan5,0),
                COALESCE(hrgsatuan1,0), COALESCE(hrgsatuan2,0), COALESCE(hrgsatuan3,0), COALESCE(hrgsatuan4,0), COALESCE(hrgsatuan5,0),
                COALESCE(konversi1,0), COALESCE(konversi2,0), COALESCE(konversi3,0), COALESCE(konversi4,0), COALESCE(konversi5,0)";
    let v: Vec<f64> = conn
        .query_row(&format!("SELECT {cols} FROM mdbarang WHERE kodebarang = ?1"), params![it.kodebarang], |r| (0..26).map(|i| r.get::<_, f64>(i)).collect::<rusqlite::Result<Vec<f64>>>())
        .map_err(|_| format!("Barang {} tidak ditemukan di master barang.", it.kodebarang))?;
    // Harga dasar, level, dan grosir berlaku per satuan dasar; ikut dikalikan isi satuan transaksi.
    for h in &v[0..11] {
        if *h > 0.0 {
            hasil.push(h * it.konversi);
            hasil.push(*h);
        }
    }
    for n in 0..5 {
        if v[11 + n] > 0.0 {
            hasil.push(v[11 + n]);
        }
        if v[16 + n] > 0.0 {
            hasil.push(v[16 + n] * v[21 + n]);
        }
    }
    Ok(hasil)
}

/// Level yang harus minta izin lewat Verifikasi Admin sebelum menghapus order, pending, dan data kas.
pub fn perlu_verifikasi(user: &User) -> bool {
    user.level == "Kasir" || user.level == "Lainnya"
}

/// Tanda izin dari layar masih berlaku untuk user ini.
pub fn tanda_sah(izin: &Option<String>, user: &User) -> bool {
    izin.as_deref().is_some_and(|t| brankas().sah(t, &user.iduser))
}

/// Aturan hapus order, pending, dan kas: Kasir dan Lainnya butuh tanda izin yang sah; level lain langsung boleh.
pub fn periksa_hapus(user: &User, izin_sah: bool) -> Res<()> {
    if perlu_verifikasi(user) && !izin_sah {
        return Err(format!("{TANDA}Untuk menghapus data ini, Anda perlu izin supervisor atau pemilik toko."));
    }
    Ok(())
}

/// Habiskan tanda izin yang tadi dipakai.
pub fn habiskan(izin: &Option<String>) {
    if let Some(t) = izin.as_deref() {
        brankas().pakai(t);
    }
}

/// Pengaman di server untuk aturan yang di layar sudah dikunci (harga, diskon, stok). Tidak ada izin supervisor.
pub fn periksa_penjualan(conn: &Connection, user: &User, input: &TransInput) -> Res<()> {
    if user.level == "Kasir" && !flag(conn, "izinharga") {
        // Harga dari layar sudah memuat promo, jadi harga promo ikut dianggap resmi.
        let sangat_besar = 1e12;
        let probe: Vec<Item> = input.items.iter().map(|i| Item { harga: sangat_besar, disknilai: 0.0, ..i.clone() }).collect();
        let promo_harga = trans::promo_hitung(conn, &input.tgl, &probe)?;
        let diubah = input.items.iter().enumerate().any(|(i, it)| {
            let Ok(resmi) = harga_resmi(conn, it) else { return false };
            let ph = promo_harga.baris[i].harga;
            !resmi.iter().any(|h| mirip(*h, it.harga)) && !(ph < sangat_besar / 2.0 && mirip(ph, it.harga))
        });
        if diubah {
            return Err("Harga jual tidak bisa diubah oleh Kasir.".into());
        }
    }
    if user.level == "Kasir" && !flag(conn, "izindiskon") {
        let probe: Vec<Item> = input.items.iter().map(|i| Item { disknilai: 0.0, ..i.clone() }).collect();
        let promo_disk = trans::promo_hitung(conn, &input.tgl, &probe)?;
        let diskon_item = input.items.iter().zip(&promo_disk.baris).any(|(it, p)| it.disknilai > p.disknilai + 0.01);
        if input.diskonnilai > 0.005 || input.diskonpersen > 0.005 || diskon_item {
            return Err("Diskon tidak bisa diberikan oleh Kasir.".into());
        }
    }
    if !flag(conn, "izinstokmin") {
        let mut butuh: Vec<(String, f64)> = vec![];
        for it in &input.items {
            let dasar = it.jmljual * it.konversi;
            match butuh.iter_mut().find(|(k, _)| *k == it.kodebarang) {
                Some(x) => x.1 += dasar,
                None => butuh.push((it.kodebarang.clone(), dasar)),
            }
        }
        for (kode, jml) in butuh {
            let stok: Option<f64> = conn
                .query_row("SELECT COALESCE(stokakhir,0) FROM mdbarang WHERE kodebarang = ?1 AND jenis = 'Barang'", params![kode], |r| r.get(0))
                .ok();
            if stok.is_some_and(|s| jml > s + 0.005) {
                return Err("Stok tidak mencukupi".into());
            }
        }
    }
    Ok(())
}
