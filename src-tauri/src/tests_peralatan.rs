//! Uji modul `peralatan`: urai kode laci ESC/POS, penentuan jalur USB/LPT/COM,
//! persiapan byte struk mentah, dan pemanggilan lewat `dispatch`.

use crate::auth::Session;
use crate::db::{self, Db};
use crate::jaringan::golongan::{golongan, perintah_simpan, Golongan};
use crate::konteks::Konteks;
use crate::peralatan::{adalah_port_perangkat, siapkan_struk_mentah, tentukan_jalur, urai_kode_laci, Jalur};
use crate::dispatch;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

fn tmp_dir(tag: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let d = std::env::temp_dir().join(format!("tokopro-alat-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn panggil(nama: &str, args: Value) -> Result<Value, String> {
    let dir = tmp_dir("disp");
    let conn = db::open(&dir.join("t.db")).unwrap();
    let db = Db(Mutex::new(conn));
    let sesi = Session::default();
    let Value::Object(m) = args else { panic!("args harus objek") };
    dispatch(&Konteks::baru(&db, &sesi), nama, &m)
}

#[test]
fn urai_kode_laci_bawaan_dan_variasi() {
    assert_eq!(urai_kode_laci("").unwrap(), vec![27, 112, 0, 64, 240]);
    assert_eq!(urai_kode_laci("   ").unwrap(), vec![27, 112, 0, 64, 240]);
    assert_eq!(urai_kode_laci("27,112,0,64,240").unwrap(), vec![27, 112, 0, 64, 240]);
    assert_eq!(urai_kode_laci("27, 112; 0 25 250").unwrap(), vec![27, 112, 0, 25, 250]);
    assert_eq!(urai_kode_laci("0x1B,0x70,0,0x40,0xF0").unwrap(), vec![27, 112, 0, 64, 240]);
}

#[test]
fn urai_kode_laci_menolak_tidak_valid() {
    assert!(urai_kode_laci("27,256,0").is_err());
    assert!(urai_kode_laci("27,-1,0").is_err());
    assert!(urai_kode_laci("buka").is_err());
    assert!(urai_kode_laci(",,,").is_err());
}

#[test]
fn deteksi_port_perangkat() {
    for p in ["LPT1", "lpt2:", "COM1", "com12", "COM3:"] {
        assert!(adalah_port_perangkat(p), "{p} seharusnya dikenali sebagai port");
    }
    for p in ["", "LPT0", "COM0", "USB001", "EPSON TM-T82", r"\\SERVER\EPSON", "COM100"] {
        assert!(!adalah_port_perangkat(p), "{p} bukan port LPT/COM langsung");
    }
}

#[test]
fn penentuan_jalur_usb_lpt_dan_bawaan() {
    assert_eq!(tentukan_jalur("USB", "EPSON TM-T82", false).unwrap(), Jalur::Spooler(Some("EPSON TM-T82".into())));
    assert_eq!(tentukan_jalur("USB", "", true).unwrap(), Jalur::Spooler(None));
    assert!(tentukan_jalur("USB", "", false).is_err());
    assert_eq!(tentukan_jalur("USB", "LPT1", false).unwrap(), Jalur::Port("LPT1".into()));
    assert_eq!(tentukan_jalur("USB", "COM1", true).unwrap(), Jalur::Port("COM1".into()));
    assert_eq!(tentukan_jalur("LPT", "LPT1", false).unwrap(), Jalur::Port("LPT1".into()));
    assert!(tentukan_jalur("LPT", "", true).is_err());
}

#[test]
fn struk_mentah_memuat_reset_crlf_dan_potong() {
    let b = siapkan_struk_mentah("TOKO MAJU\nItem – 1 × 5.000", true);
    assert!(b.starts_with(&[0x1B, 0x40]));
    assert!(b.ends_with(&[0x1D, 0x56, 0x01]));
    let teks = String::from_utf8_lossy(&b[2..b.len() - 3]);
    assert!(teks.contains("TOKO MAJU\r\nItem - 1 x 5.000\r\n"));

    let tanpa_potong = siapkan_struk_mentah("Halo", false);
    assert!(!tanpa_potong.ends_with(&[0x1D, 0x56, 0x01]));
}

#[test]
fn dispatch_buka_laci_dan_cetak_langsung_ke_berkas_port() {
    let dir = tmp_dir("tulis");
    let target_laci = dir.join("laci.bin");
    std::fs::write(&target_laci, b"").unwrap();
    panggil(
        "buka_laci",
        json!({
            "jenisPort": "LPT",
            "tujuan": target_laci.to_string_lossy(),
            "kode": "27,112,0,64,240",
        }),
    )
    .unwrap();
    assert_eq!(std::fs::read(&target_laci).unwrap(), vec![27, 112, 0, 64, 240]);

    let target_struk = dir.join("struk.bin");
    std::fs::write(&target_struk, b"").unwrap();
    panggil(
        "cetak_langsung",
        json!({
            "jenisPort": "LPT",
            "tujuan": target_struk.to_string_lossy(),
            "isi": "TOKO CONTOH\nTOTAL 10.000",
            "potong": true,
        }),
    )
    .unwrap();
    let isi = std::fs::read(&target_struk).unwrap();
    assert!(isi.starts_with(&[0x1B, 0x40]));
    assert!(isi.ends_with(&[0x1D, 0x56, 0x01]));
    assert!(String::from_utf8_lossy(&isi).contains("TOTAL 10.000\r\n"));
}

#[test]
fn perintah_peralatan_masuk_golongan_lokal() {
    for nama in ["daftar_printer", "cetak_langsung", "buka_laci"] {
        assert_eq!(golongan(nama), Some(Golongan::Lokal), "{nama} harus Lokal");
        assert!(!perintah_simpan(nama), "{nama} bukan perintah simpan data");
    }
}
