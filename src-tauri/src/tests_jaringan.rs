//! Uji server Pusat: server sungguhan di port acak (127.0.0.1), diakses dengan klien `reqwest`.

use crate::auth;
use crate::db::{self, Db};
use crate::jaringan::batas::Pembatas;
use crate::jaringan::golongan::{golongan, Golongan, CAMPURAN, DATA, KHUSUS_PUSAT, LOKAL, PENGEMBANGAN};
use crate::jaringan::kendali::Kendali;
use crate::jaringan::mode::{Mode, Pengaturan, PORT_BAWAAN};
use crate::jaringan::server::{mulai, satu_subnet, Antarmuka, Data, ServerJalan};
use crate::sesi::DaftarSesi;
use crate::NAMA_PERINTAH;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct DataUji {
    db: Db,
    sesi: DaftarSesi,
}
impl Data for DataUji {
    fn db(&self) -> &Db {
        &self.db
    }
    fn sesi(&self) -> &DaftarSesi {
        &self.sesi
    }
}

fn folder() -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-jar-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn data_uji() -> Arc<DataUji> {
    let conn = db::open(&folder().join("t.db")).unwrap();
    let hash = auth::hash("rahasia").unwrap();
    conn.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('bos', ?1, '-', 'Manager', 1), ('kasir1', ?1, '-', 'Kasir', 1)", [&hash]).unwrap();
    Arc::new(DataUji { db: Db(Mutex::new(conn)), sesi: DaftarSesi::baru() })
}

const LOOPBACK: (IpAddr, u8) = (IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), 8);
const LAIN: (IpAddr, u8) = (IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3)), 24);

/// Antarmuka palsu yang bisa diganti di tengah tes.
fn antarmuka(awal: (IpAddr, u8)) -> (Antarmuka, Arc<Mutex<Vec<(IpAddr, u8)>>>) {
    let daftar = Arc::new(Mutex::new(vec![awal]));
    let d = daftar.clone();
    (Arc::new(move || d.lock().unwrap().clone()), daftar)
}

struct Uji {
    data: Arc<DataUji>,
    server: ServerJalan,
    antarmuka: Arc<Mutex<Vec<(IpAddr, u8)>>>,
    http: reqwest::Client,
}

fn klien() -> reqwest::Client {
    static SEKALI: std::sync::Once = std::sync::Once::new();
    SEKALI.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::new()
}

fn nyalakan() -> Uji {
    let data = data_uji();
    let (a, daftar) = antarmuka(LOOPBACK);
    let server = mulai(data.clone(), IpAddr::V4(Ipv4Addr::LOCALHOST), 0, "PUSAT-UJI".into(), a).unwrap();
    Uji { data, server, antarmuka: daftar, http: klien() }
}

fn jalan<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

impl Uji {
    fn url(&self, jalur: &str) -> String {
        format!("http://{}/api/v1/{jalur}", self.server.alamat)
    }

    fn kirim(&self, jalur: &str, token: Option<&str>, badan: Option<Value>) -> (StatusCode, Value) {
        self.kirim_dari(None, jalur, token, badan)
    }

    /// Seperti `kirim`, tetapi berpura-pura datang dari alamat `ip` (hanya di tes).
    fn kirim_dari(&self, ip: Option<&str>, jalur: &str, token: Option<&str>, badan: Option<Value>) -> (StatusCode, Value) {
        jalan(async {
            let mut r = if badan.is_some() || jalur != "halo" { self.http.post(self.url(jalur)) } else { self.http.get(self.url(jalur)) };
            if let Some(t) = token {
                r = r.bearer_auth(t);
            }
            if let Some(ip) = ip {
                r = r.header("x-uji-ip", ip);
            }
            if jalur == "jalankan" {
                r = r.header(crate::jaringan::server::HEADER_VERSI, env!("CARGO_PKG_VERSION"));
            }
            if let Some(b) = badan {
                r = r.json(&b);
            }
            let res = r.send().await.unwrap();
            let st = res.status();
            (st, res.json::<Value>().await.unwrap_or(Value::Null))
        })
    }

    fn sambung(&self, kode: Option<&str>) -> (StatusCode, Value) {
        self.kirim("sambung", None, Some(json!({ "namaKomputer": "KASIR-1", "kode": kode })))
    }

    fn sambung_dari(&self, ip: &str, kode: Option<&str>) -> (StatusCode, Value) {
        self.kirim_dari(Some(ip), "sambung", None, Some(json!({ "namaKomputer": "KASIR-1", "kode": kode })))
    }

    fn perintah_dari(&self, ip: &str, tok: &(String, String), nama: &str, args: Value) -> (StatusCode, Value) {
        self.kirim_dari(Some(ip), "jalankan", Some(&tok.0), Some(json!({ "perintah": nama, "args": args, "sesi": tok.1 })))
    }

    /// Sambung dengan kode baru; kembalikan (token perangkat, token sesi).
    fn sambung_baru(&self) -> (String, String) {
        let (kode, _) = self.server.pusat.kode_baru().unwrap();
        let (st, v) = self.sambung(Some(&kode));
        assert_eq!(st, StatusCode::OK, "{v}");
        (v["hasil"]["token"].as_str().unwrap().into(), v["hasil"]["sesi"].as_str().unwrap().into())
    }

    fn perintah(&self, tok: &(String, String), nama: &str, args: Value) -> (StatusCode, Value) {
        self.kirim("jalankan", Some(&tok.0), Some(json!({ "perintah": nama, "args": args, "sesi": tok.1 })))
    }
}

#[test]
fn server_di_port_acak_dan_halo_tanpa_token() {
    let u = nyalakan();
    assert_ne!(u.server.alamat.port(), 0);
    let (st, v) = u.kirim("halo", None, None);
    assert_eq!(st, StatusCode::OK);
    assert_eq!(v["ok"], true);
    assert_eq!(v["hasil"]["namaKomputer"], "PUSAT-UJI");
    assert_eq!(v["hasil"]["status"], "siap");
    assert_eq!(v["hasil"]["userVersion"], crate::migrasi::versi_terbaru());
    assert_eq!(v["hasil"]["versi"], env!("CARGO_PKG_VERSION"));
    u.server.pusat.set_perawatan(true);
    assert_eq!(u.kirim("halo", None, None).1["hasil"]["status"], "perawatan");
}

#[test]
fn sambung_dengan_kode_sekali_pakai() {
    let u = nyalakan();
    let (kode, _) = u.server.pusat.kode_baru().unwrap();
    assert_eq!(kode.len(), 6);
    let (st, v) = u.sambung(Some(&format!("{} {}", &kode[..3], &kode[3..])));
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["hasil"]["otomatis"], false);
    let tok = (v["hasil"]["token"].as_str().unwrap().to_string(), v["hasil"]["sesi"].as_str().unwrap().to_string());
    // Kode sudah habis dipakai.
    let (st, v) = u.sambung(Some(&kode));
    assert_eq!(st, StatusCode::FORBIDDEN);
    assert_eq!(v["kode"], "kode-salah");
    // Token dari sambung tadi berlaku.
    let (st, v) = u.perintah(&tok, "current_user", json!({}));
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["ok"], true);
    // Token disimpan sebagai sidik, dan perangkat muncul di daftar.
    let conn = u.data.db.lock().unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM perangkat WHERE token_hash = ?1", [&tok.0], |r| r.get(0)).unwrap();
    assert_eq!(n, 0, "token asli tidak boleh tersimpan");
    assert_eq!(crate::jaringan::perangkat::daftar(&conn).unwrap().len(), 1);
}

#[test]
fn perintah_tanpa_token_atau_token_salah_ditolak_401() {
    let u = nyalakan();
    let tok = u.sambung_baru();
    let badan = json!({ "perintah": "current_user", "args": {}, "sesi": tok.1 });
    let (st, v) = u.kirim("jalankan", None, Some(badan.clone()));
    assert_eq!(st, StatusCode::UNAUTHORIZED);
    assert_eq!(v["ok"], false);
    assert_eq!(u.kirim("jalankan", Some("bukan-token"), Some(badan.clone())).0, StatusCode::UNAUTHORIZED);
    // Token sesi saja tidak cukup, dan token perangkat tanpa sesi yang sah juga ditolak.
    assert_eq!(u.kirim("jalankan", Some(&tok.1), Some(badan)).0, StatusCode::UNAUTHORIZED);
    let (st, v) = u.kirim("jalankan", Some(&tok.0), Some(json!({ "perintah": "current_user", "sesi": "ngawur" })));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::UNAUTHORIZED, Some("sesi")));
    // Perangkat diputuskan: tokennya langsung ditolak.
    {
        let conn = u.data.db.lock().unwrap();
        let id = crate::jaringan::perangkat::daftar(&conn).unwrap()[0]["id"].as_i64().unwrap();
        crate::jaringan::perangkat::putuskan(&conn, &u.data.sesi, id).unwrap();
    }
    assert_eq!(u.perintah(&tok, "current_user", json!({})).0, StatusCode::UNAUTHORIZED);
}

#[test]
fn sesi_milik_perangkat_lain_ditolak_dan_sesi_baru_bisa_diminta() {
    let u = nyalakan();
    let a = u.sambung_baru();
    let b = u.sambung_baru();
    let (st, v) = u.kirim("jalankan", Some(&a.0), Some(json!({ "perintah": "current_user", "sesi": b.1 })));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::UNAUTHORIZED, Some("sesi")));
    let (st, v) = u.kirim("sesi", Some(&a.0), Some(json!({})));
    assert_eq!(st, StatusCode::OK, "{v}");
    let baru = (a.0.clone(), v["hasil"]["sesi"].as_str().unwrap().to_string());
    assert_eq!(u.perintah(&baru, "current_user", json!({})).0, StatusCode::OK);
    assert_eq!(u.perintah(&a, "current_user", json!({})).0, StatusCode::UNAUTHORIZED, "sesi lama sudah dicabut");
}

#[test]
fn perintah_khusus_pusat_dan_lokal_ditolak_dari_jaringan() {
    let u = nyalakan();
    let tok = u.sambung_baru();
    // Login dulu sebagai Manager: yang menolak adalah golongan perintah, bukan izin pengguna.
    assert_eq!(u.perintah(&tok, "login", json!({"iduser": "bos", "password": "rahasia"})).1["ok"], true);
    for nama in ["db_backup", "db_restore", "db_cek", "backup_otomatis", "lama_cari", "lama_pindahkan", "alat_sql"] {
        let (st, v) = u.perintah(&tok, nama, json!({}));
        assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("khusus-pusat")), "{nama}");
        assert_eq!(v["pesan"], "Menu ini hanya bisa dibuka di komputer Pusat.");
    }
    for nama in ["cetak", "simpan_file", "simpan_xlsx", "ekspor_nama", "baca_gambar", "foto_simpan"] {
        let (st, v) = u.perintah(&tok, nama, json!({}));
        assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("khusus-lokal")), "{nama}");
    }
    let (st, v) = u.perintah(&tok, "tidak_ada", json!({}));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::NOT_FOUND, Some("tidak-dikenal")));
    // Perintah data biasa jalan.
    assert_eq!(u.perintah(&tok, "my_menus", json!({})).1["ok"], true);
}

#[test]
fn sambung_tanpa_kode_hanya_selama_masa_terima_otomatis_dan_satu_subnet() {
    let u = nyalakan();
    // Masa belum dibuka.
    let (st, v) = u.sambung(None);
    assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("perlu-kode")));
    // Masa dibuka, tetapi klien (127.0.0.1) bukan satu subnet dengan kartu jaringan Pusat.
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(60));
    *u.antarmuka.lock().unwrap() = vec![LAIN];
    assert_eq!(u.sambung(None).0, StatusCode::FORBIDDEN);
    // Satu subnet: diterima dan ditandai otomatis.
    *u.antarmuka.lock().unwrap() = vec![LAIN, LOOPBACK];
    let (st, v) = u.sambung(None);
    assert_eq!(st, StatusCode::OK, "{v}");
    assert_eq!(v["hasil"]["otomatis"], true);
    let tok = (v["hasil"]["token"].as_str().unwrap().to_string(), v["hasil"]["sesi"].as_str().unwrap().to_string());
    assert_eq!(u.perintah(&tok, "current_user", json!({})).0, StatusCode::OK);
    {
        let conn = u.data.db.lock().unwrap();
        assert_eq!(crate::jaringan::perangkat::daftar(&conn).unwrap()[0]["otomatis"], true);
    }
    // Ditutup lebih awal: ditolak lagi.
    u.server.pusat.tutup_terima_otomatis();
    assert_eq!(u.sambung(None).0, StatusCode::FORBIDDEN);
    // Masa yang sudah lewat: ditolak.
    u.server.pusat.buka_terima_otomatis(Duration::from_millis(30));
    std::thread::sleep(Duration::from_millis(80));
    assert_eq!(u.sambung(None).0, StatusCode::FORBIDDEN);
    assert!(u.server.pusat.terima_otomatis_sisa().is_none());
}

#[test]
fn kode_salah_berulang_mengunci_sambung() {
    let u = nyalakan();
    let (kode, _) = u.server.pusat.kode_baru().unwrap();
    let salah = if kode == "000000" { "000001" } else { "000000" };
    for _ in 0..5 {
        let (st, v) = u.sambung(Some(salah));
        assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("kode-salah")));
    }
    // Sudah terkunci: kode yang benar pun ditolak, juga tanpa kode saat masa terima otomatis.
    let (st, v) = u.sambung(Some(&kode));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("terkunci")));
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(60));
    assert_eq!(u.sambung(None).0, StatusCode::TOO_MANY_REQUESTS);
}

#[test]
fn login_lewat_jaringan_memakai_sesi_bertoken_dan_restore_session_ditolak() {
    let u = nyalakan();
    let a = u.sambung_baru();
    let b = u.sambung_baru();
    assert_eq!(u.perintah(&a, "current_user", json!({})).1["hasil"], Value::Null);
    let (_, v) = u.perintah(&a, "login", json!({"iduser": "bos", "password": "rahasia"}));
    assert_eq!(v["hasil"]["iduser"], "bos", "{v}");
    assert_eq!(u.perintah(&b, "login", json!({"iduser": "kasir1", "password": "rahasia"})).1["hasil"]["level"], "Kasir");
    // Dua sesi terpisah, dan sesi "lokal" milik jendela Pusat tidak ikut berubah.
    assert_eq!(u.perintah(&a, "current_user", json!({})).1["hasil"]["iduser"], "bos");
    assert_eq!(u.perintah(&b, "current_user", json!({})).1["hasil"]["iduser"], "kasir1");
    assert!(u.data.sesi.ambil(crate::sesi::TOKEN_LOKAL).user().is_err());
    // Siapa yang masuk tersimpan di sesi_perangkat dan tampil di daftar perangkat.
    {
        let conn = u.data.db.lock().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM sesi_perangkat WHERE iduser IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        let d = crate::jaringan::perangkat::daftar(&conn).unwrap();
        assert_eq!(d[0]["pengguna"], "bos");
    }
    // Keluar dari sesi A tidak memengaruhi B.
    u.perintah(&a, "logout", json!({}));
    assert_eq!(u.perintah(&a, "current_user", json!({})).1["hasil"], Value::Null);
    assert_eq!(u.perintah(&b, "current_user", json!({})).1["hasil"]["iduser"], "kasir1");
    // restore_session tidak pernah dilayani lewat jaringan, dan tidak memasukkan siapa pun.
    let (st, v) = u.perintah(&a, "restore_session", json!({"iduser": "bos"}));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("ditolak")));
    assert_eq!(u.perintah(&a, "current_user", json!({})).1["hasil"], Value::Null);
}

#[test]
fn login_salah_berulang_mengunci_perangkat_dan_alamatnya() {
    let u = nyalakan();
    let a = u.sambung_baru();
    let b = u.sambung_baru();
    let salah = json!({"iduser": "bos", "password": "ngawur"});
    for i in 0..4 {
        let (st, v) = u.perintah(&a, "login", salah.clone());
        assert_eq!((st, v["ok"].clone()), (StatusCode::OK, json!(false)), "percobaan {i}");
    }
    // Login benar mengembalikan hitungan ke nol.
    assert_eq!(u.perintah(&a, "login", json!({"iduser": "bos", "password": "rahasia"})).1["ok"], true);
    for _ in 0..5 {
        u.perintah(&a, "login", salah.clone());
    }
    let (st, v) = u.perintah(&a, "login", json!({"iduser": "bos", "password": "rahasia"}));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("terkunci")));
    // Perintah lain dari perangkat itu tetap jalan. Perangkat lain dari alamat yang sama ikut terkunci (S2),
    // sedangkan alamat lain tidak terpengaruh.
    assert_eq!(u.perintah(&a, "current_user", json!({})).0, StatusCode::OK);
    assert_eq!(u.perintah(&b, "login", json!({"iduser": "bos", "password": "rahasia"})).0, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(u.perintah_dari("127.0.0.9", &b, "login", json!({"iduser": "bos", "password": "rahasia"})).1["ok"], true);
}

#[test]
fn pembatas_membuka_kunci_setelah_waktunya() {
    let p = Pembatas::baru(3, Duration::from_secs(60));
    let t0 = Instant::now();
    assert!(!p.gagal("x", t0));
    assert!(!p.gagal("x", t0));
    assert!(p.gagal("x", t0));
    assert!(p.sisa_kunci(&"x", t0 + Duration::from_secs(30)).is_some());
    assert!(p.sisa_kunci(&"y", t0).is_none());
    assert!(p.sisa_kunci(&"x", t0 + Duration::from_secs(61)).is_none());
    // Hitungan mulai dari nol lagi.
    assert!(!p.gagal("x", t0 + Duration::from_secs(62)));
    p.berhasil(&"x");
    assert!(!p.gagal("x", t0 + Duration::from_secs(63)));
}

#[test]
fn satu_subnet_menurut_kartu_jaringan() {
    let ip = |a: u8, b: u8, c: u8, d: u8| IpAddr::V4(Ipv4Addr::new(a, b, c, d));
    let kartu = [(ip(192, 168, 1, 10), 24)];
    assert!(satu_subnet(ip(192, 168, 1, 50), &kartu));
    assert!(!satu_subnet(ip(192, 168, 2, 50), &kartu));
    assert!(!satu_subnet(ip(8, 8, 8, 8), &kartu));
    // Kabel langsung: alamat otomatis 169.254.x.x
    let link = [(ip(169, 254, 7, 7), 16)];
    assert!(satu_subnet(ip(169, 254, 200, 1), &link));
    assert!(!satu_subnet(ip(192, 168, 1, 50), &link));
    // Awalan 0 tidak boleh cocok dengan semua alamat.
    assert!(!satu_subnet(ip(1, 2, 3, 4), &[(ip(10, 0, 0, 1), 0)]));
    assert!(!satu_subnet(ip(1, 2, 3, 4), &[]));
    let v6: IpAddr = "fe80::1".parse().unwrap();
    assert!(satu_subnet("fe80::abcd".parse().unwrap(), &[(v6, 64)]));
    assert!(!satu_subnet("fd00::1".parse().unwrap(), &[(v6, 64)]));
    // Alamat IPv4 yang datang sebagai IPv6-mapped tetap dikenali.
    assert!(satu_subnet("::ffff:192.168.1.50".parse().unwrap(), &kartu));
}

#[test]
fn setiap_perintah_masuk_tepat_satu_golongan() {
    let semua = [DATA, LOKAL, CAMPURAN, KHUSUS_PUSAT, PENGEMBANGAN];
    for n in NAMA_PERINTAH {
        let jumlah = semua.iter().filter(|d| d.contains(n)).count();
        assert_eq!(jumlah, 1, "perintah \"{n}\" harus ada di tepat satu golongan di jaringan/golongan.rs (ada di {jumlah})");
    }
    for d in semua {
        for n in d {
            assert!(NAMA_PERINTAH.contains(n), "golongan.rs menyebut \"{n}\" yang tidak ada di daftar_perintah!");
        }
    }
    assert_eq!(golongan("cetak"), Some(Golongan::Lokal));
    assert_eq!(golongan("lama_pindahkan"), Some(Golongan::KhususPusat));
    assert_eq!(golongan("save_penjualan"), Some(Golongan::Data));
    assert_eq!(golongan("restore_session"), Some(Golongan::Pengembangan));
    assert_eq!(golongan("tidak_ada"), None);
}

#[test]
fn pengaturan_mode_dibaca_dan_disimpan_di_pusat_json() {
    let berkas = folder().join("pusat.json");
    // Belum ada file: Tunggal.
    assert_eq!(Pengaturan::muat(&berkas).mode, Mode::Tunggal);
    // File rusak atau isinya tidak dikenal: tetap Tunggal.
    std::fs::write(&berkas, "{rusak").unwrap();
    assert_eq!(Pengaturan::muat(&berkas).mode, Mode::Tunggal);
    std::fs::write(&berkas, r#"{"mode":"entah"}"#).unwrap();
    assert_eq!(Pengaturan::muat(&berkas).mode, Mode::Tunggal);
    // Kolom lain (milik tahap klien Kasir) ikut terbawa.
    std::fs::write(&berkas, r#"{"mode":"pusat","port":5000,"namaPusat":"TOKO-PC"}"#).unwrap();
    let mut p = Pengaturan::muat(&berkas);
    assert_eq!((p.mode, p.port), (Mode::Pusat, Some(5000)));
    p.mode = Mode::Tunggal;
    p.simpan(&berkas).unwrap();
    let teks = std::fs::read_to_string(&berkas).unwrap();
    assert!(teks.contains("\"tunggal\"") && teks.contains("TOKO-PC"), "{teks}");
    assert_eq!(Pengaturan::default().port, None);
    assert_eq!(PORT_BAWAAN, 47210);
}

#[test]
fn mode_tunggal_tidak_membuka_port_dan_mode_pusat_membukanya() {
    let data = data_uji();
    let berkas = folder().join("pusat.json");
    let kendali = Kendali::baru(berkas.clone());
    kendali.nyalakan(data.clone());
    assert_eq!(kendali.mode(), Mode::Tunggal);
    assert_eq!(kendali.status()["berjalan"], false);
    assert!(kendali.pusat().is_err());
    // Pindah ke Pusat di port acak (0), lalu kembali ke Tunggal: servernya mati.
    kendali.atur_mode(data.clone(), Mode::Pusat, Some(0)).unwrap();
    let st = kendali.status();
    assert_eq!((st["mode"].clone(), st["berjalan"].clone()), (json!("pusat"), json!(true)));
    assert_eq!(Pengaturan::muat(&berkas).mode, Mode::Pusat);
    let port = st["port"].as_u64().unwrap();
    let http = klien();
    let url = format!("http://127.0.0.1:{port}/api/v1/halo");
    assert!(jalan(async { http.get(&url).send().await }).is_ok());
    kendali.atur_mode(data.clone(), Mode::Tunggal, None).unwrap();
    assert_eq!(kendali.status()["berjalan"], false);
    std::thread::sleep(Duration::from_millis(200));
    assert!(jalan(async { http.get(&url).send().await }).is_err(), "port masih terbuka setelah kembali ke Tunggal");
    // Mode Kasir dibuka (tahap klien Kasir): tidak ada server yang berjalan.
    kendali.atur_mode(data, Mode::Kasir, None).unwrap();
    assert_eq!((kendali.mode(), kendali.status()["berjalan"].clone()), (Mode::Kasir, json!(false)));
    // Dibuka ulang dari pusat.json yang sama pada mode Kasir: tidak ada server.
    let lagi = Kendali::baru(berkas);
    assert_eq!(lagi.mode(), Mode::Kasir);
    lagi.nyalakan(data_uji());
    assert_eq!(lagi.status()["berjalan"], false);
}

#[test]
fn port_terpakai_dilaporkan_tanpa_menjatuhkan_aplikasi() {
    let data = data_uji();
    let pakai = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = pakai.local_addr().unwrap().port();
    let (a, _) = antarmuka(LOOPBACK);
    let err = mulai(data, IpAddr::V4(Ipv4Addr::LOCALHOST), port, "X".into(), a).err().expect("harus gagal");
    assert!(err.contains("program lain yang memakai jalurnya"), "{err}");
    assert!(err.contains(&port.to_string()), "{err}");
}

/* ---- Keamanan jaringan (S1-S5) ---- */

fn salah_login() -> Value {
    json!({"iduser": "bos", "password": "ngawur"})
}

#[test]
fn s1_terima_otomatis_dibatasi_sepuluh_perangkat_lalu_ditutup() {
    let u = nyalakan();
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(600));
    for n in 1..=10 {
        let (st, v) = u.sambung_dari(&format!("127.0.0.{n}"), None);
        assert_eq!(st, StatusCode::OK, "perangkat ke-{n}: {v}");
    }
    assert!(u.server.pusat.terima_otomatis_sisa().is_none(), "masa terima harus tertutup setelah 10 perangkat");
    let (st, v) = u.sambung_dari("127.0.0.11", None);
    assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("perlu-kode")));
    // Kode sambung dari Manager tetap bisa dipakai.
    let (kode, _) = u.server.pusat.kode_baru().unwrap();
    assert_eq!(u.sambung_dari("127.0.0.11", Some(&kode)).0, StatusCode::OK);
}

#[test]
fn s1_masa_terima_dibuka_lagi_mulai_dari_nol() {
    let u = nyalakan();
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(600));
    for n in 1..=3 {
        assert_eq!(u.sambung_dari(&format!("127.0.0.{n}"), None).0, StatusCode::OK);
    }
    assert_eq!(u.server.pusat.terima_otomatis_jumlah(), Some((3, 10)));
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(600));
    assert_eq!(u.server.pusat.terima_otomatis_jumlah(), Some((0, 10)));
}

#[test]
fn s2_sambung_tanpa_kode_satu_perangkat_per_alamat_dan_yang_lama_diganti() {
    let u = nyalakan();
    u.server.pusat.buka_terima_otomatis(Duration::from_secs(600));
    let (_, a) = u.sambung_dari("127.0.0.5", None);
    let (st, b) = u.sambung_dari("127.0.0.5", None);
    assert_eq!(st, StatusCode::OK, "{b}");
    {
        let conn = u.data.db.lock().unwrap();
        assert_eq!(crate::jaringan::perangkat::daftar(&conn).unwrap().len(), 1, "satu alamat hanya boleh punya satu perangkat otomatis");
    }
    // Perangkat yang lama dicabut, yang baru berlaku.
    let lama = (a["hasil"]["token"].as_str().unwrap().to_string(), a["hasil"]["sesi"].as_str().unwrap().to_string());
    let baru = (b["hasil"]["token"].as_str().unwrap().to_string(), b["hasil"]["sesi"].as_str().unwrap().to_string());
    assert_eq!(u.perintah(&lama, "current_user", json!({})).0, StatusCode::UNAUTHORIZED);
    assert_eq!(u.perintah(&baru, "current_user", json!({})).0, StatusCode::OK);
    // Mengganti tidak menambah hitungan perangkat yang diterima.
    assert_eq!(u.server.pusat.terima_otomatis_jumlah(), Some((1, 10)));
}

#[test]
fn s2_login_salah_dari_alamat_sama_mengunci_walau_perangkat_baru() {
    let u = nyalakan();
    let a = u.sambung_baru();
    for _ in 0..5 {
        assert_eq!(u.perintah(&a, "login", salah_login()).1["ok"], false);
    }
    // Perangkat baru dari alamat yang sama langsung terkunci.
    let b = u.sambung_baru();
    let (st, v) = u.perintah(&b, "login", json!({"iduser": "bos", "password": "rahasia"}));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::TOO_MANY_REQUESTS, Some("terkunci")));
    // Alamat lain tidak ikut terkunci.
    assert_eq!(u.perintah_dari("127.0.0.7", &b, "login", json!({"iduser": "bos", "password": "rahasia"})).1["ok"], true);
}

#[test]
fn s3_tiga_puluh_login_paralel_paling_banyak_lima_diproses() {
    let u = nyalakan();
    let a = u.sambung_baru();
    let hasil: Vec<(StatusCode, Value)> = std::thread::scope(|s| {
        let pekerja: Vec<_> = (0..30).map(|_| s.spawn(|| u.perintah(&a, "login", salah_login()))).collect();
        pekerja.into_iter().map(|t| t.join().unwrap()).collect()
    });
    let diproses = hasil.iter().filter(|(st, v)| *st == StatusCode::OK && v["kode"] == "perintah").count();
    let terkunci = hasil.iter().filter(|(st, _)| *st == StatusCode::TOO_MANY_REQUESTS).count();
    assert!(diproses <= 5, "{diproses} percobaan diproses");
    assert_eq!(diproses + terkunci, 30, "semua jawaban harus berupa salah-diproses atau 429");
}

#[test]
fn s3_verifikasi_admin_paralel_juga_dibatasi() {
    let u = nyalakan();
    let a = u.sambung_baru();
    assert_eq!(u.perintah(&a, "login", json!({"iduser": "kasir1", "password": "rahasia"})).1["ok"], true);
    let hasil: Vec<(StatusCode, Value)> = std::thread::scope(|s| {
        let pekerja: Vec<_> = (0..20).map(|_| s.spawn(|| u.perintah(&a, "verifikasi_admin", json!({"password": "ngawur"})))).collect();
        pekerja.into_iter().map(|t| t.join().unwrap()).collect()
    });
    let diproses = hasil.iter().filter(|(st, v)| *st == StatusCode::OK && v["kode"] == "perintah").count();
    assert!(diproses <= 5, "{diproses} percobaan diproses");
}

#[test]
fn s4_sesi_diam_lebih_dari_dua_belas_jam_ditolak_seperti_sesi_tak_dikenal() {
    let u = nyalakan();
    let a = u.sambung_baru();
    assert_eq!(u.perintah(&a, "login", json!({"iduser": "bos", "password": "rahasia"})).1["ok"], true);
    // Hampir 12 jam: masih berlaku.
    u.data.db.lock().unwrap().execute("UPDATE sesi_perangkat SET terakhir = unixepoch() - 11 * 3600", []).unwrap();
    assert_eq!(u.perintah(&a, "current_user", json!({})).1["hasil"]["iduser"], "bos");
    // Lewat 12 jam: ditolak, dan tidak ada yang masuk lagi.
    u.data.db.lock().unwrap().execute("UPDATE sesi_perangkat SET terakhir = unixepoch() - 13 * 3600", []).unwrap();
    let (st, v) = u.perintah(&a, "current_user", json!({}));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::UNAUTHORIZED, Some("sesi")), "{v}");
    // Sesi baru yang diminta perangkat itu kosong: harus masuk lagi.
    let (st, v) = u.kirim("sesi", Some(&a.0), Some(json!({})));
    assert_eq!(st, StatusCode::OK, "{v}");
    let baru = (a.0.clone(), v["hasil"]["sesi"].as_str().unwrap().to_string());
    assert_eq!(u.perintah(&baru, "current_user", json!({})).1["hasil"], Value::Null);
}

/// Kirim hanya kepala permintaan yang mengaku membawa `panjang` byte badan, lalu baca baris status jawabannya.
/// Badannya tidak pernah dikirim: server yang membaca badan lebih dulu akan menunggu sampai waktu habis.
fn status_tanpa_badan(u: &Uji, jalur: &str, token: Option<&str>, panjang: usize) -> Option<u16> {
    use std::io::{Read, Write};
    let mut s = std::net::TcpStream::connect(u.server.alamat).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
    let kepala = format!(
        "POST /api/v1/{jalur} HTTP/1.1\r\nHost: x\r\n{auth}{}: {}\r\nContent-Type: application/json\r\nContent-Length: {panjang}\r\n\r\n",
        crate::jaringan::server::HEADER_VERSI,
        env!("CARGO_PKG_VERSION")
    );
    s.write_all(kepala.as_bytes()).unwrap();
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).ok()?;
    String::from_utf8_lossy(&buf[..n]).split_whitespace().nth(1)?.parse().ok()
}

#[test]
fn s5_token_diperiksa_sebelum_badan_dibaca() {
    let u = nyalakan();
    // Tanpa token atau dengan token palsu: 401 langsung, walau badan yang dijanjikan belum datang (atau sangat besar).
    assert_eq!(status_tanpa_badan(&u, "jalankan", None, 5_000_000), Some(401));
    assert_eq!(status_tanpa_badan(&u, "jalankan", Some("palsu"), 25 * 1024 * 1024), Some(401));
    assert_eq!(status_tanpa_badan(&u, "sesi", Some("palsu"), 5_000_000), Some(401));
    // Perangkat sah yang menjanjikan lebih dari 20 MB ditolak tanpa membaca.
    let tok = u.sambung_baru();
    assert_eq!(status_tanpa_badan(&u, "jalankan", Some(&tok.0), 25 * 1024 * 1024), Some(413));
    // /sambung hanya menerima badan kecil.
    assert_eq!(status_tanpa_badan(&u, "sambung", None, 1_000_000), Some(413));
}

#[test]
fn s5_badan_sambung_dan_sesi_dibatasi_kecil() {
    let u = nyalakan();
    let tok = u.sambung_baru();
    let isi = "x".repeat(100 * 1024);
    let (st, v) = u.kirim("sambung", None, Some(json!({ "namaKomputer": "KASIR-1", "kode": null, "sampah": isi })));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::PAYLOAD_TOO_LARGE, Some("terlalu-besar")), "{v}");
    let (st, v) = u.kirim("sesi", Some(&tok.0), Some(json!({ "sampah": isi })));
    assert_eq!(st, StatusCode::OK, "badan /sesi tidak dibaca: {v}");
    let tok = (tok.0, v["hasil"]["sesi"].as_str().unwrap().to_string());
    // /jalankan dari perangkat sah boleh membawa badan besar (foto), sampai 20 MB.
    let foto = "y".repeat(3 * 1024 * 1024);
    let (st, _) = u.kirim("jalankan", Some(&tok.0), Some(json!({ "perintah": "my_menus", "sesi": tok.1, "args": { "sampah": foto } })));
    assert_eq!(st, StatusCode::OK);
}

/// Tebakan salah dari beberapa alamat (tiap alamat masih di bawah batas kuncinya) tetap dihitung untuk kodenya.
fn tebak_salah(u: &Uji, jumlah: u32, salah: &str) {
    for n in 0..jumlah {
        // Empat tebakan per alamat, supaya tidak ada alamat yang terkunci sendiri.
        let ip = format!("127.0.1.{}", n / 4 + 1);
        let (st, v) = u.sambung_dari(&ip, Some(salah));
        assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("kode-salah")), "tebakan {n}");
    }
}

#[test]
fn kode_masih_berlaku_setelah_sembilan_belas_tebakan_salah() {
    let u = nyalakan();
    let (kode, _) = u.server.pusat.kode_baru().unwrap();
    let salah = if kode == "000000" { "000001" } else { "000000" };
    tebak_salah(&u, crate::jaringan::server::MAKS_SALAH_PER_KODE - 1, salah);
    assert_eq!(u.sambung_dari("127.0.2.1", Some(&kode)).0, StatusCode::OK);
}

#[test]
fn kode_dibatalkan_setelah_dua_puluh_tebakan_salah_dari_alamat_mana_pun() {
    let u = nyalakan();
    let (kode, _) = u.server.pusat.kode_baru().unwrap();
    let salah = if kode == "000000" { "000001" } else { "000000" };
    tebak_salah(&u, crate::jaringan::server::MAKS_SALAH_PER_KODE, salah);
    assert!(u.server.pusat.kode_aktif().is_none(), "kode harus dibatalkan");
    // Kode yang benar pun sudah tidak berlaku: Manager harus membuat kode baru.
    let (st, v) = u.sambung_dari("127.0.2.1", Some(&kode));
    assert_eq!((st, v["kode"].as_str()), (StatusCode::FORBIDDEN, Some("kode-salah")));
    let (baru, _) = u.server.pusat.kode_baru().unwrap();
    assert_eq!(u.sambung_dari("127.0.2.1", Some(&baru)).0, StatusCode::OK);
}

#[test]
fn pembatas_coba_mereservasi_dan_berhasil_tidak_menghapus_kunci_yang_berlaku() {
    let p = Pembatas::baru(3, Duration::from_secs(60));
    let t0 = Instant::now();
    assert!(p.coba("x", t0).is_ok());
    assert!(p.coba("x", t0).is_ok());
    assert!(p.coba("x", t0).is_ok());
    // Percobaan keempat sudah ditolak dan memasang kunci.
    assert!(p.coba("x", t0).is_err());
    assert!(p.sisa_kunci(&"x", t0).is_some());
    // Percobaan lain yang berjalan bersamaan dan berhasil tidak menghapus kunci.
    p.berhasil(&"x");
    assert!(p.coba("x", t0 + Duration::from_secs(1)).is_err());
    // Sesudah kunci lewat, mulai dari nol; batalkan mengembalikan satu jatah.
    assert!(p.coba("x", t0 + Duration::from_secs(61)).is_ok());
    p.batalkan(&"x");
    assert!(p.coba("x", t0 + Duration::from_secs(61)).is_ok());
    assert!(p.coba("x", t0 + Duration::from_secs(61)).is_ok());
    assert!(p.coba("x", t0 + Duration::from_secs(61)).is_ok());
    assert!(p.coba("x", t0 + Duration::from_secs(61)).is_err());
}
