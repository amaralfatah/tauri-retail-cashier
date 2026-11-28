//! Uji Tahap 6 (rancangan bab 6): mode perawatan, auto-backup di Kasir, foto dari Kasir, kunci versi, cadangan sebelum jadi Kasir,
//! dan keamanan perintah yang menerima alamat file atau folder.

use crate::auth;
use crate::berkas::{base64, dari_base64};
use crate::database::{cadangan_sebelum_kasir, cek_file_backup, pulihkan};
use crate::db::{self, Db};
use crate::jaringan::golongan::{golongan, Golongan, DATA};
use crate::jaringan::klien::{pesan_versi, Status};
use crate::pembaruan_pusat::alamat_versi;
use crate::tests_klien::{data_pusat, jalan, kasir_baru, kasir_baru_versi, nyalakan, tunggu, DataPusat, Kasir};
use crate::PARAMETER_PERINTAH;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn folder_baru(nama: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("tokopro-t6-{nama}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn hubungkan(server: &crate::jaringan::server::ServerJalan) -> Kasir {
    let k = kasir_baru(server.alamat.port());
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(k.klien.sambung(Some(kode))).unwrap();
    k
}

fn masuk(k: &Kasir, iduser: &str) {
    k.perintah("login", json!({ "iduser": iduser, "password": "rahasia" })).unwrap();
}

fn tambah_manager(data: &DataPusat) {
    let conn = data.db.lock().unwrap();
    let hash = auth::hash("rahasia").unwrap();
    conn.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('bos', ?1, '-', 'Manager', 1)", [&hash]).unwrap();
}

/// Kirim `/jalankan` mentah ke Pusat dengan token perangkat milik `k`. `versi` mengganti isi header versi (None = tanpa header).
fn kirim_mentah(server: &crate::jaringan::server::ServerJalan, k: &Kasir, versi: Option<&str>, perintah: &str, args: Value) -> (u16, Value) {
    let s = crate::jaringan::mode::Pengaturan::muat(&k.klien_berkas()).kasir.unwrap();
    let http = crate::jaringan::klien::klien_http();
    jalan(async {
        let mut r = http
            .post(format!("http://{}/api/v1/jalankan", server.alamat))
            .bearer_auth(s.token.unwrap())
            .json(&json!({ "perintah": perintah, "args": args, "sesi": s.sesi.unwrap() }));
        if let Some(v) = versi {
            r = r.header(crate::jaringan::server::HEADER_VERSI, v);
        }
        let res = r.send().await.unwrap();
        (res.status().as_u16(), res.json::<Value>().await.unwrap_or(Value::Null))
    })
}

const VERSI: &str = env!("CARGO_PKG_VERSION");

/* ---------------- perawatan ---------------- */

#[test]
fn restore_saat_kasir_tersambung_kasir_diminta_masuk_lagi_dan_data_baru_terlihat() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "kasir1");
    assert!(kasir.perintah("barang_find", json!({ "code": "B1" })).unwrap()["namabarang"] == "Air Mineral");

    // File cadangan lain: ada pengguna kasir1 yang sama, dan barang B9 (B1 tidak ada).
    let asal = folder_baru("asal");
    let file = asal.join("cadangan.db");
    {
        let hash: String = data.db.lock().unwrap().query_row("SELECT pswduser FROM mduser WHERE iduser = 'kasir1'", [], |r| r.get(0)).unwrap();
        let c = db::open(&file).unwrap();
        c.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('kasir1', ?1, '-', 'Kasir', 1)", [&hash]).unwrap();
        c.execute(
            "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,aktif) VALUES ('B9','Barang Pulih','Barang','PCS',1000,2000,5,5,1)",
            [],
        )
        .unwrap();
    }

    server
        .pusat
        .dengan_perawatan(|| {
            // Selama perawatan Kasir ditahan dengan pesan yang jelas, dan statusnya berubah.
            let err = kasir.perintah("barang_find", json!({ "code": "B1" })).unwrap_err();
            assert!(err.starts_with("[pusat] ") && err.contains("memulihkan data"), "{err}");
            assert_eq!(kasir.klien.status(), Status::Perawatan);
            assert!(jalan(kasir.klien.periksa()));
            assert_eq!(kasir.klien.status(), Status::Perawatan);
            let mut c = data.db.lock()?;
            pulihkan(&mut c, &file, &folder_baru("aman")).map(|_| ())
        })
        .unwrap();

    // Selesai: Pusat melayani lagi, tetapi sesi Kasir sudah diakhiri, jadi Kasir diminta masuk lagi.
    assert!(jalan(kasir.klien.periksa()));
    assert_eq!(kasir.klien.status(), Status::Tersambung);
    let err = kasir.perintah("barang_find", json!({ "code": "B9" })).unwrap_err();
    assert_eq!(err, "Sesi Anda sudah berakhir. Silakan masuk lagi.");
    assert!(kasir.sesi.user().is_err(), "salinan pengguna di komputer Kasir ikut dikosongkan");
    // Komputer Kasir tetap tersambung (daftar perangkat dipertahankan), tidak perlu kode sambung baru.
    assert_ne!(kasir.klien.status(), Status::Ditolak);
    masuk(&kasir, "kasir1");
    assert_eq!(kasir.perintah("barang_find", json!({ "code": "B9" })).unwrap()["namabarang"], "Barang Pulih");
    assert!(kasir.perintah("barang_find", json!({ "code": "B1" })).unwrap().is_null(), "data sebelum restore sudah tidak ada");
    server.pusat.set_perawatan(false);
}

#[test]
fn perawatan_yang_gagal_tidak_mengakhiri_sesi_kasir() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "kasir1");
    let hasil: Result<(), String> = server.pusat.dengan_perawatan(|| Err("gagal".into()));
    assert!(hasil.is_err());
    assert!(jalan(kasir.klien.periksa()));
    assert!(kasir.perintah("barang_find", json!({ "code": "B1" })).unwrap()["namabarang"] == "Air Mineral");
}

/* ---------------- auto-backup ---------------- */

#[test]
fn auto_backup_tidak_jalan_di_kasir() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "kasir1");
    let luar = folder_baru("otomatis");
    let sebelum = kasir.klien.jumlah_diteruskan();
    let r = kasir.perintah("backup_otomatis", json!({ "folder": luar.display().to_string(), "simpan": 10 })).unwrap();
    assert!(r.is_null());
    assert_eq!(kasir.klien.jumlah_diteruskan(), sebelum, "tidak ada yang dikirim ke Pusat");
    assert_eq!(std::fs::read_dir(&luar).unwrap().count(), 0, "tidak ada file cadangan di komputer Kasir");
    assert!(!data.folder.join("backup").exists(), "dan tidak ada di Pusat");
    // Bila perintahnya dipaksa lewat jaringan, Pusat menolak.
    let (st, v) = kirim_mentah(&server, &kasir, Some(VERSI), "backup_otomatis", json!({ "folder": luar.display().to_string() }));
    assert_eq!((st, v["kode"].as_str()), (403, Some("khusus-pusat")));
    assert!(!data.folder.join("backup").exists());
}

/* ---------------- foto ---------------- */

fn berkas_gambar(nama: &str, isi: &[u8]) -> PathBuf {
    let f = folder_baru("gambar").join(nama);
    std::fs::write(&f, isi).unwrap();
    f
}

#[test]
fn foto_dari_kasir_tersimpan_di_pusat_dan_bisa_dibaca() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "kasir1");
    let isi: Vec<u8> = b"\x89PNG\r\n\x1a\n".iter().copied().chain((0..=255u8).cycle().take(5000)).collect();
    let f = berkas_gambar("asli.png", &isi);

    let ext = kasir.perintah("foto_simpan", json!({ "kode": "B1", "path": f.display().to_string(), "hapusAsal": true })).unwrap();
    assert_eq!(ext, "png");
    assert!(!f.exists(), "file asal di komputer Kasir dihapus setelah Pusat menyimpannya");
    assert_eq!(std::fs::read(data.folder.join("foto").join("B1.png")).unwrap(), isi, "isinya sampai utuh di folder foto Pusat");

    let uri = kasir.perintah("foto_baca", json!({ "kode": "B1" })).unwrap();
    let uri = uri.as_str().unwrap();
    assert_eq!(dari_base64(uri.strip_prefix("data:image/png;base64,").unwrap()).unwrap(), isi);

    // Foto baru berekstensi lain mengganti yang lama; tanpa hapusAsal file asal tetap ada.
    let jpg = berkas_gambar("lain.JPG", b"jpegjpeg");
    assert_eq!(kasir.perintah("foto_simpan", json!({ "kode": "B1", "path": jpg.display().to_string() })).unwrap(), "jpg");
    assert!(jpg.exists());
    assert!(!data.folder.join("foto").join("B1.png").exists() && data.folder.join("foto").join("B1.jpg").exists());

    // Bukan gambar dan terlalu besar ditolak di komputer Kasir, tanpa mengirim apa pun.
    let sebelum = kasir.klien.jumlah_diteruskan();
    let txt = berkas_gambar("catatan.txt", b"halo");
    assert!(kasir.perintah("foto_simpan", json!({ "kode": "B1", "path": txt.display().to_string() })).unwrap_err().contains("bukan gambar"));
    let besar = berkas_gambar("besar.png", &vec![0u8; 10 * 1024 * 1024 + 1]);
    assert!(kasir.perintah("foto_simpan", json!({ "kode": "B1", "path": besar.display().to_string() })).unwrap_err().contains("terlalu besar"));
    assert!(kasir.perintah("foto_simpan", json!({ "kode": "B1", "path": "/tidak/ada.png" })).unwrap_err().contains("tidak ditemukan"));
    assert_eq!(kasir.klien.jumlah_diteruskan(), sebelum);

    // Alamat file lewat jaringan tidak pernah dibuka Pusat.
    let (st, v) = kirim_mentah(&server, &kasir, Some(VERSI), "foto_simpan", json!({ "kode": "B2", "path": jpg.display().to_string() }));
    assert_eq!((st, v["kode"].as_str()), (403, Some("khusus-lokal")));
}

#[test]
fn foto_simpan_data_tidak_bisa_menulis_keluar_folder_foto() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "kasir1");
    let isi = base64(b"gambar");
    // Kode barang dengan ../ dijadikan nama aman di dalam folder foto.
    let (st, v) = kirim_mentah(&server, &kasir, Some(VERSI), "foto_simpan_data", json!({ "kode": "../../jahat", "ekstensi": "png", "data": isi }));
    assert_eq!((st, v["ok"].clone()), (200, json!(true)), "{v}");
    let foto = data.folder.join("foto");
    let nama: Vec<String> = std::fs::read_dir(&foto).unwrap().flatten().map(|f| f.file_name().to_string_lossy().into_owned()).collect();
    assert_eq!(nama, vec!["______jahat.png".to_string()]);
    assert!(!data.folder.parent().unwrap().join("jahat.png").exists());
    // Ekstensi di luar daftar gambar, isi rusak, dan isi terlalu besar ditolak.
    for (ext, d) in [("../x", isi.clone()), ("exe", isi.clone()), ("png", "bukan base64!".to_string()), ("png", "A".repeat(14 * 1024 * 1024))] {
        let (_, v) = kirim_mentah(&server, &kasir, Some(VERSI), "foto_simpan_data", json!({ "kode": "B3", "ekstensi": ext, "data": d }));
        assert_eq!(v["ok"], json!(false), "{ext}: {v}");
    }
    assert_eq!(std::fs::read_dir(&foto).unwrap().count(), 1);
}

#[test]
fn base64_bolak_balik() {
    for n in 0..9usize {
        let b: Vec<u8> = (0..n as u8).map(|x| x.wrapping_mul(37)).collect();
        assert_eq!(dari_base64(&base64(&b)).unwrap(), b);
    }
    assert!(dari_base64("abc").is_none());
    assert!(dari_base64("ab!d").is_none());
    assert!(dari_base64("ab==cdef").is_none());
}

/* ---------------- kunci versi ---------------- */

#[test]
fn kasir_dengan_versi_lain_diblokir_dengan_pesan_jelas() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let port = server.alamat.port();

    // Kasir yang lebih lama dari Pusat: terdeteksi saat menyambung, dan semua perintah data ditolak tanpa dikirim.
    let lama = kasir_baru_versi(port, Some("0.0.1"));
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(lama.klien.sambung(Some(kode))).unwrap();
    assert_eq!(lama.klien.status(), Status::VersiBeda);
    let err = lama.perintah("my_menus", json!({})).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("lebih lama dari Pusat") && err.contains(VERSI), "{err}");
    assert_eq!(lama.klien.jumlah_diteruskan(), 0);
    assert_eq!(lama.klien.versi_pusat().as_deref(), Some(VERSI));

    // Kasir yang lebih baru: diminta memperbarui Pusat dulu.
    let baru = kasir_baru_versi(port, Some("99.0.0"));
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(baru.klien.sambung(Some(kode))).unwrap();
    assert_eq!(baru.klien.status(), Status::VersiBeda);
    assert!(baru.perintah("my_menus", json!({})).unwrap_err().contains("Perbarui KasirJet di komputer Pusat dulu"));

    // Pusat sendiri juga menolak: tanpa header versi, atau dengan versi lain, walau Kasir belum tahu bedanya.
    let normal = hubungkan(&server);
    masuk(&normal, "kasir1");
    for v in [None, Some("0.0.1")] {
        let (st, j) = kirim_mentah(&server, &normal, v, "my_menus", json!({}));
        assert_eq!((st, j["kode"].as_str()), (409, Some("versi-beda")), "{v:?}");
    }
    assert_eq!(kirim_mentah(&server, &normal, Some(VERSI), "my_menus", json!({})).0, 200);

    // Kasir yang belum tahu (status belum diperiksa) mengetahuinya dari jawaban 409, lalu berhenti mengirim.
    let tersembunyi = kasir_baru_versi(port, Some("0.0.1"));
    tersembunyi.pengaturan.lock().unwrap().kasir = normal.pengaturan.lock().unwrap().kasir.clone();
    let err = tersembunyi.perintah("my_menus", json!({})).unwrap_err();
    assert!(err.starts_with("[pusat] ") && err.contains("lebih lama dari Pusat"), "{err}");
    assert_eq!(tersembunyi.klien.status(), Status::VersiBeda);
    let n = tersembunyi.klien.jumlah_diteruskan();
    assert!(tersembunyi.perintah("my_menus", json!({})).is_err());
    assert_eq!(tersembunyi.klien.jumlah_diteruskan(), n);

    // Versi sama: berjalan seperti biasa.
    assert!(tunggu(|| jalan(normal.klien.periksa()) && normal.klien.status() == Status::Tersambung, 5));
    normal.perintah("my_menus", json!({})).unwrap();
}

#[test]
fn pesan_versi_dan_alamat_pembaruan_ke_versi_pusat() {
    assert!(pesan_versi("1.2.0", "1.2.0").is_none());
    assert!(pesan_versi("", "1.2.0").is_none());
    assert!(pesan_versi("1.10.0", "1.9.0").unwrap().contains("lebih lama dari Pusat (versi 1.10.0)"));
    assert!(pesan_versi("1.0.0", "1.1.0").unwrap().contains("Pusat dulu"));
    let terbaru = "https://github.com/amaralfatah/tauri-retail-cashier/releases/latest/download/latest.json";
    assert_eq!(
        alamat_versi(terbaru, "0.2.3").unwrap(),
        "https://github.com/amaralfatah/tauri-retail-cashier/releases/download/v0.2.3/latest.json"
    );
    assert_eq!(alamat_versi(terbaru, "v0.2.3"), alamat_versi(terbaru, "0.2.3"));
    assert!(alamat_versi(terbaru, "../x").is_none());
    assert!(alamat_versi(terbaru, "").is_none());
    assert!(alamat_versi("https://contoh.id/latest.json", "1.0.0").is_none());
}

/* ---------------- cadangan sebelum jadi Kasir ---------------- */

#[test]
fn cadangan_database_lama_saat_dijadikan_kasir() {
    let data = data_pusat();
    let hasil = cadangan_sebelum_kasir(&data.db).unwrap().expect("ada data, jadi ada cadangan");
    assert!(
        hasil.canonicalize().unwrap().starts_with(data.folder.join("backup").canonicalize().unwrap()),
        "{hasil:?} vs {:?}",
        data.folder
    );
    assert!( hasil.file_name().unwrap().to_string_lossy().starts_with("sebelum-jadi-kasir-"));
    cek_file_backup(&hasil).unwrap();
    let c = rusqlite::Connection::open(&hasil).unwrap();
    assert_eq!(c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='B1'", [], |r| r.get::<_, String>(0)).unwrap(), "Air Mineral");
    // Database aslinya tidak disentuh.
    assert_eq!(data.db.lock().unwrap().query_row("SELECT COUNT(*) FROM mdbarang", [], |r| r.get::<_, i64>(0)).unwrap(), 1);

    // Database kosong (instalasi baru): tidak ada yang perlu disalin.
    let kosong = Db(Mutex::new(db::open(&folder_baru("kosong").join("k.db")).unwrap()));
    assert!(cadangan_sebelum_kasir(&kosong).unwrap().is_none());
    // Komputer Kasir memegang database kosong di memori: tidak ada yang disalin.
    let memori = Db(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
    assert!(cadangan_sebelum_kasir(&memori).unwrap().is_none());
}

/* ---------------- keamanan alamat file dan folder ---------------- */

#[test]
fn perintah_impor_dengan_alamat_file_ditolak_lewat_jaringan() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    for (perintah, args) in [
        ("impor_baca", json!({ "jenis": "barang", "path": "/etc/hosts" })),
        ("impor_proses", json!({ "jenis": "barang", "path": "/etc/hosts", "hapusLama": true, "folder": "/tmp/luar" })),
        ("alat_sql", json!({ "sql": "SELECT 1", "folder": "/tmp/luar" })),
        ("db_restore", json!({ "file": "/etc/hosts" })),
        ("db_backup", json!({ "folder": "/tmp/luar" })),
        ("lama_pindahkan", json!({ "file": "/etc/hosts" })),
    ] {
        assert_eq!(golongan(perintah), Some(Golongan::KhususPusat), "{perintah}");
        let (st, v) = kirim_mentah(&server, &kasir, Some(VERSI), perintah, args.clone());
        assert_eq!((st, v["kode"].as_str()), (403, Some("khusus-pusat")), "{perintah}");
        // Komputer Kasir sendiri juga tidak mengirimkannya.
        let err = kasir.perintah(perintah, args).unwrap_err();
        assert!(err.contains("hanya bisa dibuka di komputer Pusat"), "{perintah}: {err}");
    }
    assert_eq!(kasir.klien.jumlah_diteruskan(), 0);
}

#[test]
fn folder_cadangan_dari_kasir_tidak_dipakai_pusat() {
    let data = data_pusat();
    tambah_manager(&data);
    let server = nyalakan(&data, 0);
    let kasir = hubungkan(&server);
    masuk(&kasir, "bos");
    let luar = folder_baru("luar").join("tidak-boleh");
    let luar_teks = luar.display().to_string();

    kasir.perintah("alat_sinkron_jual", json!({ "folder": luar_teks })).unwrap();
    kasir.perintah("alat_sinkron_harga_beli", json!({ "folder": luar_teks })).unwrap();
    // Setiap panggilan harus benar-benar berjalan (bukan gagal lebih dulu), supaya pemeriksaan folder di bawah bermakna.
    data.db.lock().unwrap().execute("INSERT INTO transaksi (notrans, kode, tgltrans) VALUES ('TJ-HAPUS', 'TJ', '2026-11-01')", []).unwrap();
    kasir.perintah("alat_hapus_data", json!({ "input": { "item": ["opname"], "dari": "", "sampai": "", "folder": luar_teks } })).unwrap();
    kasir.perintah("alat_hapus_transaksi", json!({ "daftar": ["TJ-HAPUS"], "folder": luar_teks })).unwrap();
    assert!(!luar.exists(), "folder dari komputer Kasir tidak dibuat di Pusat");
    let bawaan: Vec<String> = std::fs::read_dir(data.folder.join("backup")).unwrap().flatten().map(|f| f.file_name().to_string_lossy().into_owned()).collect();
    assert!(bawaan.iter().filter(|n| n.starts_with("sebelum-sinkron-")).count() >= 2, "{bawaan:?}");
    for awalan in ["sebelum-hapus-data", "sebelum-hapus-transaksi"] {
        assert!(bawaan.iter().any(|n| n.starts_with(awalan)), "cadangan {awalan} harus di folder bawaan Pusat: {bawaan:?}");
    }
}

/// Perintah golongan Data tidak boleh punya parameter alamat file atau folder, kecuali `folder` pada empat alat yang
/// mengabaikannya bila datang dari jaringan (`alat::folder_aman`, diuji di `folder_cadangan_dari_kasir_tidak_dipakai_pusat`).
#[test]
fn perintah_data_tidak_menerima_alamat_file_kecuali_yang_sudah_dinetralkan() {
    let dinetralkan = ["alat_sinkron_harga_beli", "alat_sinkron_jual", "alat_hapus_transaksi", "alat_hapus_data"];
    let p: std::collections::HashMap<_, _> = PARAMETER_PERINTAH.iter().copied().collect();
    let curiga = ["path", "folder", "file", "berkas", "dir", "alamat", "lokasi", "sumber", "tujuan"];
    for nama in DATA {
        for (param, _) in p[nama] {
            let kecil = param.to_lowercase();
            if curiga.iter().any(|c| kecil.contains(c)) {
                assert!(dinetralkan.contains(nama) && *param == "folder", "{nama} menerima parameter \"{param}\" yang mirip alamat file");
            }
        }
    }
    // `alat_hapus_data` membawa folder di dalam objek `input`.
    assert!(p["alat_hapus_data"].iter().any(|(n, _)| *n == "input"));
    for nama in dinetralkan {
        assert!(DATA.contains(&nama));
    }
}

#[allow(dead_code)]
fn _pakai(_: Option<Arc<DataPusat>>) {}
