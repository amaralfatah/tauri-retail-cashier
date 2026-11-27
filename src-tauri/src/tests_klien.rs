//! Uji klien Kasir: Pusat sungguhan (server tahap 3) di port acak, klien Kasir di proses yang sama
//! dengan folder sendiri dan tanpa database.

use crate::auth::Session;
use crate::db::{self, Db};
use crate::jaringan::klien::{Jeda, Klien, Status, Tujuan};
use crate::jaringan::mode::{Mode, Pengaturan};
use crate::jaringan::server::{mulai, Antarmuka, Data, ServerJalan};
use crate::sesi::DaftarSesi;
use serde_json::{json, Map, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub(crate) struct DataPusat {
    pub(crate) db: Db,
    pub(crate) sesi: DaftarSesi,
    /// Folder data Pusat (tempat folder foto dan file database).
    pub(crate) folder: PathBuf,
}
impl Data for DataPusat {
    fn db(&self) -> &Db {
        &self.db
    }
    fn sesi(&self) -> &DaftarSesi {
        &self.sesi
    }
    fn folder_data(&self) -> Option<PathBuf> {
        Some(self.folder.clone())
    }
}

fn folder(nama: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("tokopro-kl-{nama}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub(crate) fn jalan<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

pub(crate) fn data_pusat() -> Arc<DataPusat> {
    let folder_pusat = folder("pusat");
    let conn = db::open(&folder_pusat.join("pusat.db")).unwrap();
    let hash = crate::auth::hash("rahasia").unwrap();
    conn.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('kasir1', ?1, '-', 'Kasir', 1)", [&hash]).unwrap();
    conn.execute("UPDATE tseting SET aktiftranskas = 1, izinstokmin = 0, izinharga = 0, izindiskon = 0", []).unwrap();
    conn.execute(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,aktif) VALUES ('B1','Air Mineral','Barang','PCS',2000,3000,50,50,1)",
        [],
    )
    .unwrap();
    Arc::new(DataPusat { db: Db(Mutex::new(conn)), sesi: DaftarSesi::baru(), folder: folder_pusat })
}

pub(crate) fn nyalakan(data: &Arc<DataPusat>, port: u16) -> ServerJalan {
    let a: Antarmuka = Arc::new(|| vec![(IpAddr::V4(Ipv4Addr::LOCALHOST), 8)]);
    mulai(data.clone(), IpAddr::V4(Ipv4Addr::LOCALHOST), port, "PUSAT-UJI".into(), a).unwrap()
}

pub(crate) fn tunggu(mut sampai: impl FnMut() -> bool, detik: u64) -> bool {
    let batas = Instant::now() + Duration::from_secs(detik);
    while Instant::now() < batas {
        if sampai() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    sampai()
}

pub(crate) struct Kasir {
    pub(crate) klien: Arc<Klien>,
    pub(crate) sesi: Session,
    pub(crate) kejadian: Arc<Mutex<Vec<String>>>,
    folder: PathBuf,
    pub(crate) pengaturan: Arc<Mutex<Pengaturan>>,
}

pub(crate) fn kasir_baru(port: u16) -> Kasir {
    kasir_baru_versi(port, None)
}

/// Komputer Kasir yang mengaku berversi `versi` (bukan versi aplikasi ini) untuk menguji kunci versi.
pub(crate) fn kasir_baru_versi(port: u16, versi: Option<&str>) -> Kasir {
    let folder = folder("kasir");
    let berkas = folder.join("pusat.json");
    let pengaturan = Arc::new(Mutex::new(Pengaturan::default()));
    let kejadian = Arc::new(Mutex::new(vec![]));
    let k = kejadian.clone();
    let pancar: crate::jaringan::klien::Pemancar = Arc::new(move |v: &Value| k.lock().unwrap().push(v["status"].as_str().unwrap().to_string()));
    let jeda = Jeda { tersambung: Duration::from_millis(80), terputus_awal: Duration::from_millis(40), terputus_maks: Duration::from_millis(120) };
    let mut klien = Klien::baru(berkas, pengaturan.clone(), "KASIR-UJI".into(), pancar, jeda);
    if let Some(v) = versi {
        klien = klien.dengan_versi(v);
    }
    let klien = Arc::new(klien);
    klien.atur_pusat("127.0.0.1", Some(port)).unwrap();
    Kasir { klien, sesi: Session::default(), kejadian, folder, pengaturan }
}

impl Kasir {
    pub(crate) fn klien_berkas(&self) -> PathBuf {
        self.folder.join("pusat.json")
    }

    /// Seperti `jalankan` di aplikasi: yang lokal dikerjakan di sini dengan Db kosong di memori (tanpa file).
    pub(crate) fn perintah(&self, nama: &str, args: Value) -> Result<Value, String> {
        let lokal = |p: String, a: Map<String, Value>| {
            let kosong = Db(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
            let sesi = Session::default();
            let k = crate::konteks::Konteks::baru(&kosong, &sesi);
            crate::dispatch(&k, &p, &a)
        };
        let args = args.as_object().cloned();
        jalan(self.klien.jalankan(&self.sesi, nama.into(), args, lokal))
    }
}

pub(crate) fn penjualan() -> Value {
    json!({ "input": {
        "tgl": "2026-11-22", "kodepelanggan": "", "kodepemasok": "", "kodesales": "", "catatan": "",
        "items": [{ "kodebarang": "B1", "namabarang": "Air Mineral", "kodesatuan": "PCS", "satuanjual": "PCS", "konversi": 1, "jmljual": 2, "harga": 3000, "disknilai": 0 }],
        "diskonpersen": 0, "diskonnilai": 0, "biaya": 0, "carabayar": "Tunai", "jmlbayar": 10000, "jenisnontunai": "", "kartu": "", "norefkartu": "",
        "jthtempo": "", "update_hrgbeli": false, "lanjutkredit": false, "bayarnontunai": 0, "hargajual": [], "kodekasir": ""
    }})
}

#[test]
fn kasir_sambung_login_simpan_perintah_lokal_dan_pulih_setelah_pusat_mati() {
    let data = data_pusat();
    let mut server = nyalakan(&data, 0);
    let port = server.alamat.port();
    let kasir = kasir_baru(port);
    assert_eq!(kasir.klien.status(), Status::BelumSambung);

    // Belum disambungkan: perintah data ditolak dengan pesan yang bisa dipahami.
    let err = kasir.perintah("my_menus", json!({})).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("belum disambungkan"), "{err}");

    // Kode salah ditolak, kode benar menyambung dan token disimpan di pusat.json.
    let err = jalan(kasir.klien.sambung(Some("000000".into()))).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("Kode sambung"), "{err}");
    assert_eq!(kasir.klien.status(), Status::BelumSambung);
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(kasir.klien.sambung(Some(kode))).unwrap();
    assert_eq!(kasir.klien.status(), Status::Tersambung);
    let tersimpan = Pengaturan::muat(&kasir.folder.join("pusat.json"));
    assert_eq!(tersimpan.mode, Mode::Kasir);
    let s = tersimpan.kasir.unwrap();
    assert!(s.token.is_some() && s.sesi.is_some());
    assert_eq!((s.nama_pusat.as_deref(), s.ip_terakhir.as_deref()), (Some("PUSAT-UJI"), Some("127.0.0.1")));

    // Login lewat Pusat; salinan User ada di komputer kasir untuk pemeriksaan izin lokal.
    assert!(kasir.sesi.user().is_err());
    let salah = kasir.perintah("login", json!({ "iduser": "kasir1", "password": "salah" })).unwrap_err();
    assert!(!salah.starts_with("[pusat]"), "kesalahan perintah diteruskan apa adanya: {salah}");
    let user = kasir.perintah("login", json!({ "iduser": "kasir1", "password": "rahasia" })).unwrap();
    assert_eq!(user["level"], "Kasir");
    assert_eq!(kasir.sesi.user().unwrap().iduser, "kasir1");

    // Simpan satu penjualan dengan perintah yang dipakai layar kasir; datanya masuk ke database Pusat.
    let hasil = kasir.perintah("save_penjualan", penjualan()).unwrap();
    let notrans = hasil["notrans"].as_str().unwrap().to_string();
    assert_eq!(hasil["total"], 6000.0);
    {
        let conn = data.db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM transaksi WHERE notrans = ?1", [&notrans], |r| r.get(0)).unwrap();
        let stok: f64 = conn.query_row("SELECT stokakhir FROM mdbarang WHERE kodebarang = 'B1'", [], |r| r.get(0)).unwrap();
        assert_eq!((n, stok), (1, 48.0));
    }

    // Perintah lokal tidak diteruskan; perintah khusus Pusat ditolak di komputer ini.
    assert_eq!(kasir.klien.tujuan("cetak"), Tujuan::Lokal);
    assert_eq!(kasir.klien.tujuan("save_penjualan"), Tujuan::Pusat);
    let sebelum = kasir.klien.jumlah_diteruskan();
    let err = kasir.perintah("cetak", json!({})).unwrap_err();
    assert!(err.contains("jendela Kasir Jet"), "cetak harus jalan di komputer ini: {err}");
    let err = kasir.perintah("db_backup", json!({})).unwrap_err();
    assert!(err.contains("hanya bisa dibuka di komputer Pusat") && err.contains("PUSAT-UJI"), "{err}");
    assert!(kasir.perintah("restore_session", json!({ "iduser": "kasir1" })).unwrap().is_null());
    assert_eq!(kasir.klien.jumlah_diteruskan(), sebelum, "perintah lokal atau khusus Pusat ikut dikirim ke Pusat");

    // Kasir tidak membuka database: tidak ada file .db di foldernya.
    let ada_db = std::fs::read_dir(&kasir.folder).unwrap().flatten().any(|f| f.path().extension().is_some_and(|x| x == "db"));
    assert!(!ada_db, "komputer kasir membuka database");

    // Pusat dimatikan: status berubah dan pesan error ramah (bukan teks teknis).
    server.henti();
    assert!(tunggu(|| std::net::TcpStream::connect(("127.0.0.1", port)).is_err(), 5), "port Pusat masih terbuka");
    assert!(tunggu(|| kasir.klien.status() == Status::Terputus, 5), "status {:?}", kasir.klien.status());
    let baca = kasir.perintah("my_menus", json!({})).unwrap_err();
    assert!(baca.starts_with("[pusat] ") && baca.contains("PUSAT-UJI") && baca.contains("tidak bisa dihubungi"), "{baca}");
    let tulis = kasir.perintah("save_penjualan", penjualan()).unwrap_err();
    assert!(tulis.starts_with("[pusat] ") && tulis.contains("belum tersimpan") && tulis.contains("Isian Anda masih ada"), "{tulis}");
    assert!(!tulis.contains("error sending request") && !tulis.contains("tcp connect"), "{tulis}");
    // Salinan User tetap ada: kasir tidak dipaksa login hanya karena Pusat mati sebentar.
    assert!(kasir.sesi.user().is_ok());

    // Pusat dinyalakan lagi di port yang sama: tersambung kembali tanpa sambung ulang.
    let mut server = {
        let mut coba = None;
        assert!(tunggu(|| { coba = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| nyalakan(&data, port))).ok(); coba.is_some() }, 5));
        coba.unwrap()
    };
    assert!(tunggu(|| kasir.klien.status() == Status::Tersambung, 5), "status {:?}", kasir.klien.status());
    kasir.perintah("my_menus", json!({})).unwrap();
    // Sesi login bertahan, jadi simpan langsung bisa lagi.
    let lagi = kasir.perintah("save_penjualan", penjualan()).unwrap();
    assert_ne!(lagi["notrans"].as_str().unwrap(), notrans);

    // Urutan status yang sampai ke tampilan (event `status-pusat`).
    let kj = kasir.kejadian.lock().unwrap().clone();
    let urut: Vec<&str> = kj.iter().map(String::as_str).collect();
    let pos = |s: &str, dari: usize| urut.iter().skip(dari).position(|x| *x == s).map(|i| i + dari).unwrap_or_else(|| panic!("tidak ada {s} setelah {dari}: {urut:?}"));
    let a = pos("tersambung", 0);
    let b = pos("terputus", a);
    pos("tersambung", b);

    // Pusat mencabut perangkat: status Ditolak dengan pesan yang jelas, dan tetap begitu.
    {
        let conn = data.db.lock().unwrap();
        let id: i64 = conn.query_row("SELECT id FROM perangkat", [], |r| r.get(0)).unwrap();
        crate::jaringan::perangkat::putuskan(&conn, &data.sesi, id).unwrap();
    }
    let err = kasir.perintah("my_menus", json!({})).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("diputus dari Pusat"), "{err}");
    assert_eq!(kasir.klien.status(), Status::Ditolak);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(kasir.klien.status(), Status::Ditolak);
    server.henti();
}

#[test]
fn nama_lain_di_alamat_yang_sama_ditolak() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = kasir_baru(server.alamat.port());
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(kasir.klien.sambung(Some(kode))).unwrap();
    let j = kasir.klien.status_json();
    assert_eq!((j["status"].clone(), j["namaPusat"].clone(), j["sudahDisambung"].clone()), (json!("tersambung"), json!("PUSAT-UJI"), json!(true)));
    // Alamat yang sama sekarang dijawab komputer dengan nama lain: tidak dipakai, dan pesannya jelas.
    kasir.pengaturan.lock().unwrap().kasir.as_mut().unwrap().nama_pusat = Some("TOKO-LAIN".into());
    assert!(!jalan(kasir.klien.periksa()));
    let j = kasir.klien.status_json();
    assert_eq!(j["status"], "terputus");
    assert!(j["pesan"].as_str().unwrap().contains("dipakai komputer lain, bukan TOKO-LAIN"), "{j}");
    let err = kasir.perintah("my_menus", json!({})).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("komputer lain"), "{err}");
}
