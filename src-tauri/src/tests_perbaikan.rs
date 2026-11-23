//! Uji perbaikan hasil tinjauan: perintah baca/simpan di klien (S6), ID simpan (D3), jawaban Pusat yang bukan JSON (D5),
//! dan jam Pusat yang dibuang saat mode berganti (D2). Pusat palsu di sini hanya menjawab sesuai skrip.

use crate::jaringan::golongan::{perintah_baca, perintah_simpan, DATA};
use crate::jaringan::mode::Mode;
use crate::tests_klien::{data_pusat, jalan, kasir_baru, nyalakan, penjualan, Kasir};
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

pub(crate) enum Jawaban {
    /// Badan jawaban apa adanya (status 200).
    Teks(String),
    /// Sambungan ditutup tanpa jawaban.
    Putus,
}

/// Server HTTP seadanya: `/halo` dijawab seperti Pusat yang sehat, `/jalankan` dijawab `jawab(urutan, badan)`.
pub(crate) struct PusatPalsu {
    pub(crate) port: u16,
    /// Badan setiap permintaan `/jalankan` yang diterima, berurutan.
    pub(crate) diterima: Arc<Mutex<Vec<Value>>>,
}

pub(crate) fn pusat_palsu(jawab: impl Fn(usize, &Value) -> Jawaban + Send + 'static) -> PusatPalsu {
    let soket = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = soket.local_addr().unwrap().port();
    let diterima = Arc::new(Mutex::new(Vec::<Value>::new()));
    let catat = diterima.clone();
    std::thread::spawn(move || {
        for sambungan in soket.incoming() {
            let Ok(mut s) = sambungan else { continue };
            let mut mentah = Vec::new();
            let mut buf = [0u8; 4096];
            let (kepala, mut badan) = loop {
                let Ok(n) = s.read(&mut buf) else { break (String::new(), vec![]) };
                if n == 0 {
                    break (String::new(), vec![]);
                }
                mentah.extend_from_slice(&buf[..n]);
                if let Some(i) = mentah.windows(4).position(|w| w == b"\r\n\r\n") {
                    break (String::from_utf8_lossy(&mentah[..i]).to_string(), mentah[i + 4..].to_vec());
                }
            };
            let panjang = kepala
                .lines()
                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()))
                .unwrap_or(0);
            while badan.len() < panjang {
                let Ok(n) = s.read(&mut buf) else { break };
                if n == 0 {
                    break;
                }
                badan.extend_from_slice(&buf[..n]);
            }
            let jalur = kepala.split_whitespace().nth(1).unwrap_or("").to_string();
            let teks = if jalur.ends_with("/halo") {
                let sekarang = chrono::Local::now();
                json!({ "ok": true, "hasil": {
                    "namaToko": "T", "namaKomputer": "PUSAT-PALSU", "versi": env!("CARGO_PKG_VERSION"), "userVersion": 1,
                    "jam": sekarang.to_rfc3339(), "jamDinding": sekarang.format("%Y-%m-%d %H:%M:%S").to_string(), "status": "siap",
                } })
                .to_string()
            } else {
                let v: Value = serde_json::from_slice(&badan).unwrap_or(Value::Null);
                let urutan = {
                    let mut d = catat.lock().unwrap();
                    d.push(v.clone());
                    d.len() - 1
                };
                match jawab(urutan, &v) {
                    Jawaban::Teks(t) => t,
                    Jawaban::Putus => continue,
                }
            };
            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{teks}", teks.len()).as_bytes());
        }
    });
    PusatPalsu { port, diterima }
}

impl PusatPalsu {
    pub(crate) fn id_permintaan(&self) -> Vec<Value> {
        self.diterima.lock().unwrap().iter().map(|v| v["idPermintaan"].clone()).collect()
    }
}

/// Kasir yang sudah punya token dan sesi, langsung menunjuk ke `port`.
pub(crate) fn kasir_tersambung(port: u16) -> Kasir {
    let k = kasir_baru(port);
    {
        let mut p = k.pengaturan.lock().unwrap();
        let s = p.kasir.as_mut().unwrap();
        s.token = Some("token-uji".into());
        s.sesi = Some("sesi-uji".into());
    }
    k
}

fn simpan(k: &Kasir, id: Option<&str>) -> Result<Value, String> {
    let tidak_dipakai = |_: String, _: Map<String, Value>| -> Result<Value, String> { Err("tidak dipakai".into()) };
    jalan(k.klien.jalankan_id(&k.sesi, "save_penjualan".into(), penjualan().as_object().cloned(), id.map(String::from), tidak_dipakai))
}

/* ---- S6 ---- */

#[test]
fn s6_perintah_baca_diturunkan_dari_perintah_simpan() {
    // Daftar yang dulu terlewat, dan terlanjur dianggap simpan (batas waktu 30 detik, "transaksi belum tersimpan").
    for n in ["master_list", "kas_list", "kas_kategori", "jenis_nontunai", "poin_member", "poin_histori", "user_akses", "katalog_barang", "db_info", "foto_baca", "foto_perlu_kirim", "alat_daftar_transaksi", "impor_jenis", "list_users", "get_settings", "label_barang_find", "login", "current_user"] {
        assert!(perintah_baca(n), "{n} hanya membaca");
        assert!(!perintah_simpan(n), "{n} tidak boleh ber-ID");
    }
    for n in ["save_penjualan", "kas_save", "poin_tukar", "master_save", "alat_hapus_data", "foto_simpan_data", "promo_save"] {
        assert!(!perintah_baca(n), "{n} mengubah data");
    }
}

#[test]
fn s6_setiap_perintah_data_tepat_satu_baca_atau_simpan() {
    for n in DATA {
        assert_ne!(perintah_baca(n), perintah_simpan(n), "{n} harus baca atau simpan, tidak keduanya dan tidak kosong");
    }
}

/* ---- D3 ---- */

#[test]
fn d3_simpan_identik_berikutnya_tidak_memakai_id_lama() {
    let palsu = pusat_palsu(|_, _| Jawaban::Putus);
    let k = kasir_tersambung(palsu.port);
    let err = simpan(&k, None).unwrap_err();
    assert!(err.contains("belum tahu apakah"), "{err}");
    // Pengulangan otomatis di dalam satu panggilan memakai ID yang sama.
    let ids = palsu.id_permintaan();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert_eq!(ids[0], ids[1]);
    assert!(ids[0].as_str().is_some_and(|i| !i.is_empty()));
    // Penjualan berikutnya yang isinya identik adalah transaksi baru: ID baru.
    let _ = simpan(&k, None);
    let ids = palsu.id_permintaan();
    assert_ne!(ids[2], ids[0], "isi yang sama tidak boleh memakai ID lama: {ids:?}");
    // ID dari tampilan (dialog Coba Lagi) dipakai apa adanya.
    let _ = simpan(&k, Some("dari-dialog"));
    assert_eq!(palsu.id_permintaan()[4], json!("dari-dialog"));
}

/* ---- D5 ---- */

#[test]
fn d5_jawaban_bukan_json_untuk_simpan_dianggap_belum_pasti() {
    let palsu = pusat_palsu(|_, _| Jawaban::Teks("<html>502 Bad Gateway</html>".into()));
    let k = kasir_tersambung(palsu.port);
    let err = simpan(&k, None).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("belum tahu apakah"), "{err}");
    // Perintah baca tidak bicara soal tersimpan atau tidaknya.
    let tidak_dipakai = |_: String, _: Map<String, Value>| -> Result<Value, String> { Err("tidak dipakai".into()) };
    let err = jalan(k.klien.jalankan(&k.sesi, "list_transaksi".into(), None, tidak_dipakai)).unwrap_err();
    assert!(!err.contains("belum tahu apakah") && !err.contains("tersimpan"), "{err}");
}

/* ---- D2 ---- */

#[test]
fn d2_selisih_jam_dibuang_saat_mode_bukan_kasir() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let k = kasir_baru(server.alamat.port());
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(k.klien.sambung(Some(kode))).unwrap();
    assert!(jalan(k.klien.periksa()));
    assert_eq!(k.klien.jam_pusat()["dariPusat"], true);
    // Komputer ini berhenti menjadi Kasir: jam Pusat yang lama tidak boleh dipakai lagi.
    k.pengaturan.lock().unwrap().mode = Mode::Tunggal;
    k.klien.selaraskan();
    let j = k.klien.jam_pusat();
    assert_eq!((j["dariPusat"].clone(), j["selisihMs"].clone()), (json!(false), json!(0)), "{j}");
    // Kembali menjadi Kasir tanpa pemeriksaan baru: tetap belum ada selisih (tidak memakai nilai usang).
    k.pengaturan.lock().unwrap().mode = Mode::Kasir;
    assert_eq!(k.klien.jam_pusat()["dariPusat"], false);
}

/* ---- D7 ---- */

fn db_baru() -> crate::db::Db {
    let dir = std::env::temp_dir().join(format!("tokopro-d7-{}-{}", std::process::id(), crate::jaringan::klien::id_permintaan_baru()));
    std::fs::create_dir_all(&dir).unwrap();
    crate::db::Db(Mutex::new(crate::db::open(&dir.join("t.db")).unwrap()))
}

/// Satu isian dari tiap tabel yang bisa diisi pengguna (selain barang dan transaksi), dan perubahan pada data bawaan.
const ISIAN_PENGGUNA: &[(&str, &str)] = &[
    ("barang", "INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('X1','Barang')"),
    ("transaksi", "INSERT INTO transaksi (notrans, kode) VALUES ('TJ-1','TJ')"),
    ("pelanggan", "INSERT INTO mdpelanggan (kodepelanggan, namapelanggan) VALUES ('P1','Ani')"),
    ("supplier", "INSERT INTO mdpemasok (kodepemasok, namapemasok) VALUES ('S1','CV Maju')"),
    ("karyawan", "INSERT INTO mdkaryawan (kodekaryawan, namakaryawan) VALUES ('K1','Budi')"),
    ("kas", "INSERT INTO keuangan (nokas, kode) VALUES ('KS-1','KM')"),
    ("piutang", "INSERT INTO trkartupiutang (nopiutang) VALUES ('PU-1')"),
    ("poin", "INSERT INTO transaksipoin (notukar) VALUES ('TP-1')"),
    ("pending", "INSERT INTO pendingjual (nopending) VALUES ('PN-1')"),
    ("promo bonus", "INSERT INTO mdbarangbonus (kodebarang) VALUES ('X1')"),
    ("promo diskon", "INSERT INTO mdbarangdiskon (kodebarang) VALUES ('X1')"),
    ("promo belanja", "INSERT INTO mdbarangpdp (kodebarang) VALUES ('X1')"),
    ("kategori", "INSERT INTO mdkategori (kodekategori) VALUES ('KT1')"),
    ("kelompok", "INSERT INTO mdkelompok (kodekelompok) VALUES ('KL1')"),
    ("pengguna lain", "INSERT INTO mduser (iduser, pswduser, \"level\", aktif) VALUES ('kasir9', NULL, 'Kasir', 1)"),
    ("kata sandi admin diatur", "UPDATE mduser SET pswduser = 'x' WHERE iduser = 'admin'"),
    ("jenis non tunai ditambah", "INSERT INTO mdjenisnontunai VALUES ('09','Voucher')"),
    ("jenis non tunai diganti nama", "UPDATE mdjenisnontunai SET namajenis = 'Debit Toko' WHERE kode = '01'"),
    ("item non tunai", "INSERT INTO mdjenisnontunaiitem VALUES ('03','Dana')"),
    ("satuan ditambah", "INSERT INTO mdsatuan VALUES ('LSN','Lusin')"),
];

#[test]
fn d7_database_baru_dianggap_kosong() {
    let db = db_baru();
    assert!(!crate::database::database_berisi(&db.lock().unwrap()), "data bawaan tidak dihitung");
}

#[test]
fn d7_setiap_tabel_isian_pengguna_membuat_database_dianggap_berisi() {
    for (nama, sql) in ISIAN_PENGGUNA {
        let db = db_baru();
        let conn = db.lock().unwrap();
        conn.execute(sql, []).unwrap_or_else(|e| panic!("{nama}: {e}"));
        assert!(crate::database::database_berisi(&conn), "{nama} harus dihitung sebagai data");
    }
}

#[test]
fn d7_layar_pilihan_awal_tidak_muncul_bila_hanya_ada_pelanggan() {
    // Dulu hanya barang dan transaksi yang dihitung, jadi database yang baru berisi pelanggan dianggap kosong.
    let db = db_baru();
    db.lock().unwrap().execute("INSERT INTO mdpelanggan (kodepelanggan, namapelanggan) VALUES ('P1','Ani')", []).unwrap();
    let kendali = crate::jaringan::kendali::Kendali::baru(std::env::temp_dir().join(format!("tokopro-d7-{}.json", crate::jaringan::klien::id_permintaan_baru())));
    let kasir = kasir_baru(1);
    assert!(!crate::perlu_pilihan(&kendali, &kasir.klien, &db));
    let kosong = db_baru();
    assert!(crate::perlu_pilihan(&kendali, &kasir.klien, &kosong), "database kosong tetap menampilkan pilihan awal");
}

#[test]
fn d7_cadangan_sebelum_kasir_dibuat_bila_ada_data_selain_barang() {
    let db = db_baru();
    assert!(crate::database::cadangan_sebelum_kasir(&db).unwrap().is_none(), "database kosong: tidak ada cadangan");
    db.lock().unwrap().execute("INSERT INTO mdpelanggan (kodepelanggan, namapelanggan) VALUES ('P1','Ani')", []).unwrap();
    let file = crate::database::cadangan_sebelum_kasir(&db).unwrap().expect("pelanggan juga harus dicadangkan");
    assert!(file.exists(), "{file:?}");
}

/* ---- D9 ---- */

fn foto_di_pusat(data: &Arc<crate::tests_klien::DataPusat>, nama: &str) -> Option<String> {
    std::fs::read_to_string(data.folder.join("foto").join(nama)).ok()
}

fn kasir_login(server: &crate::jaringan::server::ServerJalan) -> Kasir {
    let k = kasir_baru(server.alamat.port());
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(k.klien.sambung(Some(kode))).unwrap();
    k.perintah("login", json!({ "iduser": "kasir1", "password": "rahasia" })).unwrap();
    k
}

#[test]
fn d9_foto_lama_tidak_menimpa_foto_di_pusat() {
    let data = data_pusat();
    std::fs::create_dir_all(data.folder.join("foto")).unwrap();
    std::fs::write(data.folder.join("foto").join("B1.jpg"), "FOTO-PUSAT").unwrap();
    let server = nyalakan(&data, 0);
    let k = kasir_login(&server);
    let berkas = std::env::temp_dir().join(format!("tokopro-d9-{}", crate::jaringan::klien::id_permintaan_baru()));
    std::fs::create_dir_all(&berkas).unwrap();
    let lama = berkas.join("B1.png");
    std::fs::write(&lama, "FOTO-LAMA").unwrap();
    // Foto dari Toko Pro lama (hanyaBaru): foto yang sudah ada di Pusat tetap, dan file asal tidak dihapus.
    k.perintah("foto_simpan", json!({ "kode": "B1", "path": lama.display().to_string(), "hapusAsal": true, "hanyaBaru": true })).unwrap();
    assert_eq!(foto_di_pusat(&data, "B1.jpg").as_deref(), Some("FOTO-PUSAT"));
    assert!(foto_di_pusat(&data, "B1.png").is_none(), "foto lama tidak boleh ikut tertulis");
    assert!(lama.exists());
    // Barang yang belum punya foto di Pusat mendapatkannya.
    data.db.lock().unwrap().execute("INSERT INTO mdbarang (kodebarang,namabarang) VALUES ('B2','Teh')", []).unwrap();
    let lama2 = berkas.join("B2.png");
    std::fs::write(&lama2, "FOTO-B2").unwrap();
    k.perintah("foto_simpan", json!({ "kode": "B2", "path": lama2.display().to_string(), "hanyaBaru": true })).unwrap();
    assert_eq!(foto_di_pusat(&data, "B2.png").as_deref(), Some("FOTO-B2"));
    // Tanpa hanyaBaru (pengguna memilih foto sendiri di layar Data Barang): foto diganti seperti biasa.
    k.perintah("foto_simpan", json!({ "kode": "B1", "path": lama.display().to_string() })).unwrap();
    assert_eq!(foto_di_pusat(&data, "B1.png").as_deref(), Some("FOTO-LAMA"));
    assert!(foto_di_pusat(&data, "B1.jpg").is_none());
}

#[test]
fn d9_pemeriksaan_dan_penulisan_foto_satu_kunci_di_pusat() {
    // Banyak kasir mengirim foto barang yang sama bersamaan: hanya satu yang menang, dan fotonya utuh.
    let dir = std::env::temp_dir().join(format!("tokopro-d9k-{}", crate::jaringan::klien::id_permintaan_baru()));
    let hasil: Vec<String> = std::thread::scope(|s| {
        let t: Vec<_> = (0..8).map(|i| { let dir = dir.clone(); s.spawn(move || crate::berkas::foto_tulis_opsi(&dir, "B9", "png", format!("ISI-{i}").as_bytes(), true).unwrap()) }).collect();
        t.into_iter().map(|t| t.join().unwrap()).collect()
    });
    assert!(hasil.iter().all(|e| e == "png"));
    let isi = std::fs::read_to_string(dir.join("B9.png")).unwrap();
    assert!(isi.starts_with("ISI-"), "{isi}");
    // Penulis pertama yang menang; yang lain melihat foto itu dan tidak menimpanya.
    assert_eq!(crate::berkas::foto_tulis_opsi(&dir, "B9", "png", b"LAIN", true).unwrap(), "png");
    assert_eq!(std::fs::read_to_string(dir.join("B9.png")).unwrap(), isi);
}
