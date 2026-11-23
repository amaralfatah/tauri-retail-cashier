//! Uji kebenaran data (rancangan bagian 4): beban penyimpanan bersamaan, simpan yang diulang dengan ID sama, dan jam Pusat.

use crate::jaringan::golongan::{golongan, perintah_simpan, Golongan, DATA};
use crate::jaringan::klien::{hitung_selisih, jam_pusat_json, SelisihJam};
use crate::tests_klien::{data_pusat, jalan, kasir_baru, nyalakan, penjualan, DataPusat, Kasir};
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};

fn masuk(k: &Kasir, server: &crate::jaringan::server::ServerJalan) {
    let (kode, _) = server.pusat.kode_baru().unwrap();
    jalan(k.klien.sambung(Some(kode))).unwrap();
    k.perintah("login", json!({ "iduser": "kasir1", "password": "rahasia" })).unwrap();
}

fn jual_satu(k: &Kasir, jumlah: i64) -> Result<Value, String> {
    let mut p = penjualan();
    p["input"]["items"][0]["jmljual"] = json!(jumlah);
    p["input"]["jmlbayar"] = json!(jumlah * 3000);
    k.perintah("save_penjualan", p)
}

fn kasir_masuk(server: &crate::jaringan::server::ServerJalan) -> Kasir {
    let k = kasir_baru(server.alamat.port());
    masuk(&k, server);
    k
}

fn lokal_tak_dipakai() -> impl FnOnce(String, Map<String, Value>) -> Result<Value, String> + Send + 'static {
    |_, _| Err("tidak dipakai".into())
}

fn simpan_id(k: &Kasir, id: &str, jumlah: i64) -> Result<Value, String> {
    let mut p = penjualan();
    p["input"]["items"][0]["jmljual"] = json!(jumlah);
    p["input"]["jmlbayar"] = json!(jumlah * 3000);
    jalan(k.klien.jalankan_id(&k.sesi, "save_penjualan".into(), p.as_object().cloned(), Some(id.into()), lokal_tak_dipakai()))
}

fn hitung(data: &Arc<DataPusat>, sql: &str) -> i64 {
    data.db.lock().unwrap().query_row(sql, [], |r| r.get::<_, f64>(0)).unwrap().round() as i64
}

/// 4 kasir x 50 penjualan serentak ke satu Pusat (rancangan 10.1).
#[test]
fn beban_empat_kasir_nomor_unik_berurutan_dan_stok_sesuai() {
    let data = data_pusat();
    data.db.lock().unwrap().execute("UPDATE mdbarang SET stokawal = 1000, stokakhir = 1000 WHERE kodebarang = 'B1'", []).unwrap();
    let server = nyalakan(&data, 0);
    let kasir: Vec<Kasir> = (0..4).map(|_| kasir_masuk(&server)).collect();
    let pekerja: Vec<_> = kasir
        .into_iter()
        .map(|k| {
            std::thread::spawn(move || {
                (0..50).map(|_| jual_satu(&k, 2).expect("simpan gagal")["notrans"].as_str().unwrap().to_string()).collect::<Vec<_>>()
            })
        })
        .collect();
    let mut semua: Vec<String> = pekerja.into_iter().flat_map(|t| t.join().unwrap()).collect();
    assert_eq!(semua.len(), 200);
    semua.sort();
    let diharapkan: Vec<String> = (1..=200).map(|n| format!("TJ2611-{n:05}")).collect();
    assert_eq!(semua, diharapkan, "nomor harus unik dan berurutan tanpa lompatan");
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 200);
    assert_eq!(hitung(&data, "SELECT stokakhir FROM mdbarang WHERE kodebarang='B1'"), 1000 - 400);
    assert_eq!(hitung(&data, "SELECT SUM(masuk) FROM keuangan"), 200 * 6000);
    assert_eq!(hitung(&data, "SELECT saldo FROM keuangan ORDER BY idkas DESC LIMIT 1"), 200 * 6000);
    assert_eq!(hitung(&data, "SELECT COUNT(DISTINCT nokas) FROM keuangan"), hitung(&data, "SELECT COUNT(*) FROM keuangan"));
}

/// Stok tepat di batas: IZINSTOKMIN = 0 menolak yang melebihi, walau penjualannya serentak.
#[test]
fn beban_stok_minimal_menolak_tepat_di_batas() {
    let data = data_pusat();
    data.db.lock().unwrap().execute("UPDATE mdbarang SET stokawal = 30, stokakhir = 30 WHERE kodebarang = 'B1'", []).unwrap();
    let server = nyalakan(&data, 0);
    let kasir: Vec<Kasir> = (0..4).map(|_| kasir_masuk(&server)).collect();
    let pekerja: Vec<_> = kasir.into_iter().map(|k| std::thread::spawn(move || (0..15).map(|_| jual_satu(&k, 1).is_ok()).filter(|b| *b).count())).collect();
    let berhasil: usize = pekerja.into_iter().map(|t| t.join().unwrap()).sum();
    assert_eq!(berhasil, 30);
    assert_eq!(hitung(&data, "SELECT stokakhir FROM mdbarang WHERE kodebarang='B1'"), 0);
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 30);
}

#[test]
fn simpan_diulang_dengan_id_sama_tidak_menggandakan_data() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let k = kasir_masuk(&server);

    let a = simpan_id(&k, "id-satu", 2).unwrap();
    let b = simpan_id(&k, "id-satu", 2).unwrap();
    assert_eq!(a["notrans"], b["notrans"], "ulangan harus mendapat hasil yang lama");
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 1);
    assert_eq!(hitung(&data, "SELECT stokakhir FROM mdbarang WHERE kodebarang='B1'"), 48);
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai"), 1);

    // ID lain adalah penyimpanan baru.
    let c = simpan_id(&k, "id-dua", 2).unwrap();
    assert_ne!(a["notrans"], c["notrans"]);
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 2);

    // Tanpa ID dari tampilan, Kasir membuat ID sendiri, jadi dua simpan terpisah tetap dua transaksi.
    jual_satu(&k, 1).unwrap();
    jual_satu(&k, 1).unwrap();
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 4);

    // ID yang sama untuk perintah lain ditolak, bukan dijawab dengan hasil perintah lain.
    let err = jalan(k.klien.jalankan_id(&k.sesi, "kas_save".into(), json!({}).as_object().cloned(), Some("id-satu".into()), lokal_tak_dipakai())).unwrap_err();
    assert!(err.contains("sudah dipakai untuk perintah lain"), "{err}");
}

/// Perintah yang gagal tidak diingat: setelah diperbaiki, simpan dengan ID yang sama berjalan.
#[test]
fn simpan_yang_ditolak_tidak_diingat() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let k = kasir_masuk(&server);
    // Stok hanya 50; jual 60 ditolak.
    assert!(simpan_id(&k, "id-gagal", 60).is_err());
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai"), 0);
    assert!(simpan_id(&k, "id-gagal", 2).is_ok());
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 1);
}

/// Empat permintaan dengan ID sama yang tiba bersamaan hanya menyimpan satu transaksi.
#[test]
fn id_sama_bersamaan_hanya_satu_transaksi() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let kasir: Vec<Kasir> = (0..4).map(|_| kasir_masuk(&server)).collect();
    let pekerja: Vec<_> = kasir.into_iter().map(|k| std::thread::spawn(move || simpan_id(&k, "id-bersamaan", 2).unwrap()["notrans"].as_str().unwrap().to_string())).collect();
    let nomor: Vec<String> = pekerja.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(nomor.iter().all(|n| *n == nomor[0]), "{nomor:?}");
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 1);
}

/// Pusat menyimpan transaksinya, tetapi jawabannya sengaja tidak pernah dikirim (hook tes di server). Kasir menyerah menunggu,
/// lalu mengirim lagi dengan ID yang sama: hasilnya yang lama, dan datanya tidak ganda.
#[test]
fn jawaban_hilang_sesudah_tersimpan_lalu_ulang_dengan_id_sama_tidak_menggandakan_data() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let k = kasir_masuk(&server);
    let (token, sesi) = {
        let p = crate::jaringan::mode::Pengaturan::muat(&k.klien_berkas());
        let s = p.kasir.unwrap();
        (s.token.unwrap(), s.sesi.unwrap())
    };
    server.pusat.hilangkan_jawaban.lock().unwrap().insert("id-hilang".into());
    let url = format!("http://{}/api/v1/jalankan", server.alamat);
    let badan = json!({ "perintah": "save_penjualan", "args": penjualan(), "sesi": sesi, "idPermintaan": "id-hilang" });
    let http = crate::jaringan::klien::klien_http();
    let kirim = |batas: std::time::Duration| {
        jalan(async {
            http.post(&url).bearer_auth(&token).header(crate::jaringan::server::HEADER_VERSI, env!("CARGO_PKG_VERSION")).timeout(batas).json(&badan).send().await
        })
    };
    // Permintaan pertama: jawabannya tidak pernah datang.
    let pertama = kirim(std::time::Duration::from_millis(1500));
    assert!(pertama.as_ref().is_err_and(|e| e.is_timeout()), "jawaban seharusnya hilang: {:?}", pertama.map(|r| r.status()));
    // Datanya sudah tersimpan di Pusat.
    assert!(crate::tests_klien::tunggu(|| hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'") == 1, 10));
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai"), 1);
    // Diulang dengan ID yang sama: hasil yang lama, tanpa menyimpan lagi.
    let kedua = kirim(std::time::Duration::from_secs(10)).expect("pengiriman ulang harus dijawab");
    let v: Value = jalan(kedua.json()).unwrap();
    assert_eq!(v["hasil"]["notrans"], "TJ2611-00001", "{v}");
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM transaksi WHERE kode='TJ'"), 1);
    assert_eq!(hitung(&data, "SELECT stokakhir FROM mdbarang WHERE kodebarang='B1'"), 48);
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai"), 1);
}

#[test]
fn hasil_simpan_lebih_dari_tujuh_hari_dibersihkan() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    {
        let conn = data.db.lock().unwrap();
        let sekarang = chrono::Utc::now().timestamp();
        conn.execute("INSERT INTO permintaan_selesai VALUES ('lama','save_penjualan','{}',?1), ('baru','save_penjualan','{}',?2)", [sekarang - 8 * 86400, sekarang - 86400]).unwrap();
    }
    server.pusat.bersihkan_permintaan_lama();
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai WHERE id='lama'"), 0);
    assert_eq!(hitung(&data, "SELECT COUNT(*) FROM permintaan_selesai WHERE id='baru'"), 1);
}

#[test]
fn perintah_simpan_hanya_di_golongan_data() {
    for n in DATA.iter().filter(|n| perintah_simpan(n)) {
        assert_eq!(golongan(n), Some(Golongan::Data));
    }
    for n in ["save_penjualan", "save_pembelian", "save_opname", "save_retur_jual", "save_pelunasan", "kas_save", "poin_tukar", "poin_koreksi", "alat_hapus_transaksi", "foto_simpan_data"] {
        assert!(perintah_simpan(n), "{n} harus ber-ID");
    }
    for n in ["login", "logout", "verifikasi_admin", "list_transaksi", "get_transaksi", "laporan_penjualan", "preview_notrans", "my_menus", "master_list", "barang_cari_kasir"] {
        assert!(!perintah_simpan(n), "{n} tidak boleh ber-ID");
    }
}

/* ---- jam Pusat (rancangan 4.3) ---- */

fn dinding(s: &str) -> chrono::NaiveDateTime {
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
}

#[test]
fn selisih_jam_dinding_dan_tanggal_pusat_lewat_tengah_malam() {
    // Pusat menunjukkan 00:03 tanggal 23; jam dinding komputer kasir 23:58 tanggal 22 (kurang 5 menit).
    let lokal = dinding("2026-11-22 23:58:00");
    let s = hitung_selisih("2026-11-23 00:03:00", lokal).unwrap();
    assert_eq!(s, SelisihJam { ms: 5 * 60 * 1000 });
    // 90 detik kemudian jam kasir 23:59:30 -> Pusat 00:04:30 tanggal 23, padahal tanggal di komputer kasir masih 22.
    let j = jam_pusat_json(Some(s), dinding("2026-11-22 23:59:30"));
    assert_eq!((j["tanggal"].as_str(), j["jam"].as_str(), j["dinding"].as_str()), (Some("2026-11-23"), Some("00:04:30"), Some("2026-11-23 00:04:30")));
    assert_eq!((j["selisihDetik"].as_i64(), j["berbeda"].as_bool(), j["dariPusat"].as_bool()), (Some(300), Some(true), Some(true)));
    // Selisih kecil tidak memperingatkan; selisih negatif (kasir lebih cepat) juga dihitung.
    let lokal = dinding("2026-11-22 17:25:00");
    let s = hitung_selisih("2026-11-22 17:24:30", lokal).unwrap();
    assert_eq!(s.ms, -30_000);
    assert_eq!(jam_pusat_json(Some(s), lokal)["berbeda"], false);
    let s = hitung_selisih("2026-11-22 17:22:00", lokal).unwrap();
    assert_eq!(jam_pusat_json(Some(s), lokal)["berbeda"], true);
    // Jam rusak ditolak; tanpa selisih, jam komputer ini dipakai dan ditandai bukan dari Pusat.
    assert!(hitung_selisih("kemarin sore", lokal).is_none());
    assert_eq!(jam_pusat_json(None, lokal)["dariPusat"], false);
}

/// D1: zona waktu Windows di komputer kasir salah (mis. bawaan Pacific), tetapi jamnya diatur supaya tampil sama dengan Pusat.
/// Selisih dihitung dari jam dinding, jadi tanggalnya selalu sama dengan Pusat, apa pun zonanya.
#[test]
fn zona_waktu_kasir_salah_tidak_menggeser_tanggal() {
    // Pusat di WIB, 01:30 tanggal 23 (di UTC masih tanggal 22). Jam dinding kasir 30 detik di belakang.
    let kasir = dinding("2026-11-23 01:29:30");
    for halo in ["2026-11-23 01:30:00", "2026-11-23T01:30:00+07:00"] {
        let s = hitung_selisih(halo, kasir).unwrap();
        assert_eq!(s.ms, 30_000, "{halo}");
        let j = jam_pusat_json(Some(s), kasir);
        assert_eq!(j["tanggal"], "2026-11-23", "{halo}");
        assert_eq!(j["dinding"], "2026-11-23 01:30:00", "{halo}");
        assert_eq!(j["berbeda"], false);
    }
}

#[test]
fn klien_menghitung_selisih_jam_dari_halo_pusat() {
    let data = data_pusat();
    let server = nyalakan(&data, 0);
    let k = kasir_masuk(&server);
    assert!(jalan(k.klien.periksa()));
    let j = k.klien.jam_pusat();
    assert_eq!(j["dariPusat"], true);
    assert_eq!(j["berbeda"], false, "Pusat dan Kasir di satu mesin, selisihnya harus kecil: {j}");
    assert_eq!(j["tanggal"].as_str().unwrap(), chrono::Local::now().format("%Y-%m-%d").to_string());
    // Pusat sendiri (`/halo`) melaporkan jam dindingnya sebagai teks tanpa zona, bahan hitungan selisih.
    let halo = jalan(async { crate::jaringan::klien::klien_http().get(format!("http://{}/api/v1/halo", server.alamat)).send().await.unwrap().json::<Value>().await.unwrap() });
    assert!(chrono::NaiveDateTime::parse_from_str(halo["hasil"]["jamDinding"].as_str().unwrap(), "%Y-%m-%d %H:%M:%S").is_ok());
}

#[allow(dead_code)]
fn tidak_dipakai(_: Mutex<()>) {}
