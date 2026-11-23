//! Uji pindah otomatis dari Toko Pro lama (rancangan bagian 8): peran komputer, foto, gambar, pengaturan lama.

use crate::pindah_lama::cari_di;
use crate::pindah_otomatis::*;
use std::collections::HashMap;
use std::path::PathBuf;

fn tmp(nama: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("tokopro-po-{nama}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Folder instalasi tiruan: `<akar>/TokoPro` dengan `Settings.ini`, dan `_data/DATAPOS.FDB` bila `dengan_data`.
fn instalasi(nama: &str, ini: &str, dengan_data: bool) -> (PathBuf, PathBuf) {
    let akar = tmp(nama);
    let folder = akar.join("TokoPro");
    std::fs::create_dir_all(folder.join("_data")).unwrap();
    std::fs::write(folder.join("Settings.ini"), ini).unwrap();
    if dengan_data {
        std::fs::write(folder.join("_data").join("DATAPOS.FDB"), b"fdb").unwrap();
    }
    (akar, folder)
}

fn peran(nama: &str, nama_komputer: &str, dengan_data: bool, ip: &[&str], sendiri: &str) -> Peran {
    let (akar, _) = instalasi(nama, &format!("[Database]\nNamaKomputer={nama_komputer}\n"), dengan_data);
    let t = cari_di(&[akar.clone()]);
    let ip: Vec<String> = ip.iter().map(|s| s.to_string()).collect();
    let p = tentukan_peran(&t.instalasi.expect("instalasi ditemukan"), sendiri, &ip);
    let _ = std::fs::remove_dir_all(akar);
    p
}

#[test]
fn peran_pusat_untuk_nama_sendiri_dan_data_ada() {
    for nilai in ["", "localhost", "127.0.0.1", "KASIR-2", "kasir-2/3050", "192.168.1.9"] {
        let p = peran("pusat", nilai, true, &["192.168.1.9"], "KASIR-2");
        assert!(matches!(p, Peran::Pusat { .. }), "{nilai}: {p:?}");
    }
}

#[test]
fn peran_kasir_untuk_komputer_lain() {
    assert_eq!(peran("k1", "SERVER/3050", false, &[], "KASIR-2"), Peran::Kasir { pusat: "SERVER".into() });
    assert_eq!(peran("k2", "SERVER", true, &[], "KASIR-2"), Peran::Kasir { pusat: "SERVER".into() });
    assert_eq!(peran("k3", "192.168.1.5", false, &["192.168.1.9"], "KASIR-2"), Peran::Kasir { pusat: "192.168.1.5".into() });
}

#[test]
fn peran_tidak_jelas_bila_server_sendiri_tanpa_data() {
    for nilai in ["", "localhost", "KASIR-2", "192.168.1.9"] {
        assert_eq!(peran("tj", nilai, false, &["192.168.1.9"], "KASIR-2"), Peran::TidakJelas, "{nilai}");
    }
}

#[test]
fn peran_pusat_memakai_lokasi_data_dari_ini() {
    let akar = tmp("lokdata");
    let folder = akar.join("TokoPro");
    std::fs::create_dir_all(&folder).unwrap();
    let data = akar.join("D").join("DATAPOS.FDB");
    std::fs::create_dir_all(data.parent().unwrap()).unwrap();
    std::fs::write(&data, b"x").unwrap();
    std::fs::write(folder.join("Settings.ini"), format!("[Database]\nNamaKomputer=localhost\nLokasiData={}\n", data.display())).unwrap();
    let t = cari_di(&[akar.clone()]);
    assert_eq!(tentukan_peran(&t.instalasi.unwrap(), "X", &[]), Peran::Pusat { data });
    let _ = std::fs::remove_dir_all(akar);
}

#[test]
fn instalasi_terbaru_dipilih_dan_ini_tanpa_database_diabaikan() {
    let akar = tmp("banyak");
    for (sub, isi) in [("Lain", "[Foo]\nA=1\n"), ("TokoPro", "[Database]\nNamaKomputer=SERVER\n")] {
        let d = akar.join(sub);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("Settings.ini"), isi).unwrap();
    }
    let t = cari_di(&[akar.clone()]);
    assert_eq!(t.instalasi.unwrap().folder, akar.join("TokoPro"));
    let _ = std::fs::remove_dir_all(akar);
}

#[test]
fn jalur_lama_relatif_dan_mutlak() {
    let f = PathBuf::from("/x/TokoPro");
    assert_eq!(jalur_lama(&f, "\\_foto\\"), f.join("_foto"));
    assert_eq!(jalur_lama(&f, "_image\\logo.gif"), f.join("_image").join("logo.gif"));
    assert_eq!(jalur_lama(&f, "\"\\_data\\DATAPOS.FDB\""), f.join("_data").join("DATAPOS.FDB"));
    #[cfg(not(windows))]
    assert_eq!(jalur_lama(&f, "D:\\Backup"), PathBuf::from("D:/Backup"));
}

#[test]
fn pengaturan_datar_bagian_aplikasi_didahulukan() {
    let ini = crate::pindah_lama::baca_ini("[Database]\nNamaKomputer=SERVER\nUkuranKertas=A\n[Application]\nUkuranKertas=B\nNamaKomputer=X\n[Lain]\nPortPrinter=USB001\n");
    let d = pengaturan_datar(&ini);
    assert_eq!(d["namakomputer"], "SERVER");
    assert_eq!(d["ukurankertas"], "B");
    assert_eq!(d["portprinter"], "USB001");
}

#[test]
fn foto_kode_jpg_tersalin_dan_yang_tidak_cocok_dihitung() {
    let lama = tmp("foto-lama");
    let tujuan = tmp("foto-baru").join("foto");
    let png = [0x89u8, b'P', b'N', b'G'];
    for n in ["B001.jpg", "b002.JPG", "B003.bmp", "SALAH.jpg", "tanpa-barang.gif"] {
        std::fs::write(lama.join(n), png).unwrap();
    }
    std::fs::write(lama.join("catatan.txt"), "x").unwrap();
    let ada: HashMap<String, String> = ["B001", "B002", "B003", "B004"].iter().map(|k| (k.to_lowercase(), k.to_string())).collect();
    let h = salin_foto(&lama, &tujuan, &ada);
    assert_eq!(h, HasilFoto { tersalin: 3, tidak_cocok: 2, gagal: 0 });
    assert!(tujuan.join("B001.jpg").is_file());
    assert!(tujuan.join("B002.jpg").is_file(), "nama pakai kode asli");
    assert!(tujuan.join("B003.bmp").is_file());
    assert!(lama.join("B001.jpg").is_file(), "file asli tetap ada");
}

#[test]
fn pilah_foto_kasir() {
    let ada: HashMap<String, String> = [("b001", "B001"), ("b002", "B002")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    let nama: Vec<String> = ["b001", "B002", "zzz"].iter().map(|s| s.to_string()).collect();
    let p = pilah_foto(&nama, &ada, |k| k == "B002");
    assert_eq!(p, PilahFoto { perlu: vec![("b001".into(), "B001".into())], sudah_ada: 1, tidak_cocok: 1 });
}

#[test]
fn proses_lama_dikenali_dari_tasklist() {
    let (akar, folder) = instalasi("proses", "[Database]\n", false);
    std::fs::write(folder.join("TokoPro.exe"), b"").unwrap();
    std::fs::write(folder.join("unins000.exe"), b"").unwrap();
    let exe = exe_di_folder(&folder);
    assert_eq!(exe, vec!["tokopro.exe".to_string()]);
    let daftar = "\"System\",\"4\",\"Services\"\r\n\"TOKOPRO.EXE\",\"1234\",\"Console\"\r\n";
    assert!(ada_proses(daftar, &exe));
    assert!(!ada_proses("\"explorer.exe\",\"1\"\r\n", &exe));
    let _ = std::fs::remove_dir_all(akar);
}

#[test]
fn lama_pengaturan_membaca_settings_ini_contoh() {
    let ini = "[Database]\nNamaKomputer=SERVER\nLokasiData=\\_data\\DATAPOS.FDB\nLokasiBackup=\\_file\\\n[Application]\nUkuranKertas=Kertas A4\nPilihanHome=1\nLokasiLogo=\\_image\\logo.gif\nLokasiBcGrnd=\\_image\\hilang.jpg\nlokasiFoto=\\_foto\\\nAutoLoadData=-1\n";
    let (akar, folder) = instalasi("pengaturan", ini, true);
    std::fs::create_dir_all(folder.join("_image")).unwrap();
    std::fs::create_dir_all(folder.join("_foto")).unwrap();
    std::fs::write(folder.join("_image").join("logo.gif"), b"GIF8").unwrap();
    let data = tmp("pengaturan-data");
    let inst = cari_di(&[akar.clone()]).instalasi.unwrap();
    let j = pengaturan_lama(&inst, &data);
    assert_eq!(j["ada"], true);
    let n = &j["nilai"];
    assert_eq!(n["ukurankertas"], "Kertas A4");
    assert_eq!(n["pilihanhome"], "1");
    assert_eq!(n["autoloaddata"], "-1");
    assert_eq!(n["namakomputer"], "SERVER");
    // Logo disalin dan nilainya jadi alamat baru; latar yang tidak ada dibuang; cadangan di folder lama tidak dipakai.
    assert_eq!(n["lokasilogo"], data.join("gambar").join("logo.gif").display().to_string());
    assert!(data.join("gambar").join("logo.gif").is_file());
    assert!(n.get("lokasibcgrnd").is_none());
    assert!(n.get("lokasibackup").is_none());
    assert_eq!(j["fotoFolder"], folder.join("_foto").display().to_string());
    let _ = std::fs::remove_dir_all(akar);
    let _ = std::fs::remove_dir_all(data);
}

#[test]
fn folder_backup_sendiri_dipakai_bila_bisa_ditulis() {
    let folder = tmp("bk-lama");
    let luar = tmp("bk-luar");
    #[cfg(windows)]
    let (ada, tidak) = (luar.display().to_string(), "D:\\TidakAda\\Backup".to_string());
    #[cfg(not(windows))]
    let (ada, tidak) = (luar.display().to_string(), "D:/TidakAda".to_string());
    // Di non-Windows alamat mutlak tanpa huruf drive tidak dikenali; uji hanya bagian yang berlaku di kedua sistem.
    assert_eq!(folder_backup_layak(&folder, "\\_file\\"), None);
    assert_eq!(folder_backup_layak(&folder, &tidak), None);
    if cfg!(windows) {
        assert_eq!(folder_backup_layak(&folder, &ada), Some(luar.clone()));
    }
    let _ = std::fs::remove_dir_all(folder);
    let _ = std::fs::remove_dir_all(luar);
}

/* ---- D6: komputer data lama yang salah dianggap Kasir ---- */

#[test]
fn d6_pusat_dipaksa_memakai_data_di_komputer_ini_walau_dianggap_kasir() {
    // IP komputer berubah atau namanya diganti, jadi NamaKomputer di Settings.ini tidak lagi dikenali sebagai komputer ini.
    let (akar, _) = instalasi("paksa", "[Database]\nNamaKomputer=NAMA-LAMA-PC\n", true);
    let inst = cari_di(&[akar]).instalasi.unwrap();
    assert!(matches!(tentukan_peran(&inst, "KASIR-2", &[]), Peran::Kasir { .. }));
    // Cara biasa menolak: komputer ini dianggap kasir.
    assert!(data_untuk_pusat(&inst, "KASIR-2", &[], false).unwrap_err().contains("bukan tempat data toko"));
    // Dengan tombol "Jadikan komputer ini Pusat": data di komputer ini dipakai.
    let data = data_untuk_pusat(&inst, "KASIR-2", &[], true).unwrap();
    assert!(data.ends_with("DATAPOS.FDB") && data.is_file(), "{data:?}");
}

#[test]
fn d6_pusat_dipaksa_tanpa_file_data_ditolak_dengan_pesan_jelas() {
    let (akar, _) = instalasi("paksa-kosong", "[Database]\nNamaKomputer=NAMA-LAMA-PC\n", false);
    let inst = cari_di(&[akar]).instalasi.unwrap();
    let err = data_untuk_pusat(&inst, "KASIR-2", &[], true).unwrap_err();
    assert!(err.contains("tidak menemukan data toko"), "{err}");
}

#[test]
fn d6_komputer_pusat_biasa_tetap_diterima_tanpa_dipaksa() {
    let (akar, _) = instalasi("biasa", "[Database]\nNamaKomputer=\n", true);
    let inst = cari_di(&[akar]).instalasi.unwrap();
    assert!(data_untuk_pusat(&inst, "KASIR-2", &[], false).is_ok());
}
