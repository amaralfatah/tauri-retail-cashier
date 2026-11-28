mod alat;
mod auth;
mod berkas;
mod database;
mod db;
mod impor;
mod izin;
mod jaringan;
mod konteks;
mod kas;
mod inventori;
mod master;
mod nontunai;
mod poin;
mod pembaruan_pusat;
mod peralatan;
mod pindah_lama;
mod pindah_otomatis;
mod promo;
mod migrasi;
mod order;
mod pelunasan;
mod retur;
mod sesi;
mod report;
mod reset_manager;
mod trans;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_akses;
#[cfg(test)]
mod tests_keuangan;
#[cfg(test)]
mod tests_batal;
#[cfg(test)]
mod tests_transpromo;
#[cfg(test)]
mod tests_izin;
#[cfg(test)]
mod tests_dashboard;
#[cfg(test)]
mod tests_pelunasan;
#[cfg(test)]
mod tests_barang;
#[cfg(test)]
mod tests_sistem;
#[cfg(test)]
mod tests_laporan;
#[cfg(test)]
mod tests_e2e;
#[cfg(test)]
mod tests_pindah_lama;
#[cfg(test)]
mod tests_banding_lama;
#[cfg(test)]
mod tests_migrasi;
#[cfg(test)]
mod tests_dispatch;
#[cfg(test)]
mod tests_sesi;
#[cfg(test)]
mod tests_jaringan;
#[cfg(test)]
mod tests_klien;
#[cfg(test)]
mod tests_data;
#[cfg(test)]
mod tests_tahap6;
#[cfg(test)]
mod tests_pindah_otomatis;
#[cfg(test)]
mod tests_firewall;
#[cfg(test)]
mod tests_perbaikan;
#[cfg(test)]
mod tests_peralatan;
#[cfg(test)]
mod tests_reset_manager;

use konteks::Konteks;
use perintah_macro::{daftar_perintah, perintah};
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::Manager;

/// Buka dialog cetak untuk halaman yang sedang tampil (struk/laporan memakai CSS @media print).
#[perintah]
fn cetak(k: &Konteks) -> Result<(), String> {
    k.jendela()?.print().map_err(|e| e.to_string())
}

#[perintah]
fn db_path(k: &Konteks) -> Result<String, String> {
    Ok(database_path(k.app()?)?.display().to_string())
}

fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(p) = std::env::var("TOKOPRO_DB") {
        return Ok(p.into());
    }
    let dir = konteks::folder_data_aplikasi(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tokopro.db"))
}

// Daftar semua perintah aplikasi. Menghasilkan `dispatch` dan `NAMA_PERINTAH`.
daftar_perintah![
    cetak,
    peralatan::daftar_printer,
    peralatan::cetak_langsung,
    peralatan::buka_laci,
    db_path,
    auth::login,
    auth::login_bawaan,
    auth::logout,
    auth::current_user,
    auth::restore_session,
    auth::change_password,
    auth::get_settings,
    auth::save_settings,
    auth::list_users,
    auth::save_user,
    auth::delete_user,
    auth::my_menus,
    auth::user_akses,
    auth::save_user_akses,
    reset_manager::reset_daftar_manager,
    reset_manager::reset_minta_kode,
    reset_manager::reset_periksa,
    berkas::ekspor_nama,
    berkas::simpan_file,
    berkas::simpan_xlsx,
    berkas::foto_simpan,
    berkas::foto_simpan_data,
    berkas::foto_baca,
    berkas::baca_gambar,
    berkas::foto_hapus,
    master::master_list,
    master::master_save,
    master::master_delete,
    master::barang_find,
    master::barang_search,
    master::pelanggan_jatuh_tempo,
    master::jenis_nontunai,
    trans::save_penjualan,
    izin::verifikasi_admin,
    trans::barang_cari_kasir,
    trans::barang_find_kasir,
    trans::save_pembelian,
    trans::save_opname,
    trans::preview_notrans,
    trans::list_transaksi,
    trans::get_transaksi,
    trans::promo_keranjang,
    order::save_order,
    order::list_order,
    order::get_order,
    order::delete_order,
    order::save_penjualan_order,
    order::save_pembelian_order,
    order::save_pending,
    order::list_pending,
    order::get_pending,
    order::delete_pending,
    order::pending_selesai,
    retur::get_retur_sumber,
    retur::save_retur_jual,
    retur::save_retur_beli,
    retur::save_retur_beli_barang,
    pelunasan::kartu_kontak,
    pelunasan::kartu_list,
    pelunasan::save_pelunasan,
    report::dashboard,
    report::laporan_penjualan,
    report::laporan_pembelian,
    report::laporan_stok,
    report::laporan_kas,
    report::laporan_piutang,
    report::laporan_data,
    report::simpan_laporan,
    report::dashboard_data,
    report::notifikasi,
    kas::kas_kategori,
    kas::kas_list,
    kas::kas_save,
    kas::kas_delete,
    poin::poin_member,
    poin::poin_histori,
    poin::poin_tukar,
    poin::poin_koreksi,
    database::db_info,
    database::db_daftar_backup,
    database::db_backup,
    database::db_cek,
    database::db_perbaiki,
    database::db_restore,
    database::backup_otomatis,
    pindah_lama::lama_cari,
    pindah_lama::lama_pindahkan,
    pindah_otomatis::lama_pengaturan,
    pindah_otomatis::lama_foto_daftar,
    pindah_otomatis::foto_perlu_kirim,
    alat::alat_item_hapus,
    alat::alat_hitung_stok,
    alat::alat_hitung_kas,
    alat::alat_sinkron_harga_beli,
    alat::alat_sinkron_jual,
    alat::alat_daftar_transaksi,
    alat::alat_hapus_transaksi,
    alat::alat_hapus_data,
    alat::alat_sql,
    impor::impor_jenis,
    impor::impor_baca,
    impor::impor_proses,
    nontunai::nt_list,
    nontunai::nt_jenis_save,
    nontunai::nt_jenis_delete,
    nontunai::nt_item_save,
    nontunai::nt_item_delete,
    inventori::save_stok_awal,
    inventori::barang_label,
    inventori::save_opname_stok,
    inventori::label_barang_find,
    inventori::katalog_barang,
    promo::promo_list,
    promo::promo_save,
    promo::promo_delete,
    promo::promo_barang,
];

/// Satu-satunya perintah Tauri untuk data aplikasi: meneruskan ke perintah menurut namanya.
/// Perintah dijalankan di thread terpisah supaya yang lambat (mis. pindah data lama) tidak membekukan jendela.
/// Di komputer Kasir, perintah data dikirim ke Pusat dan hanya perintah lokal yang dijalankan di sini.
#[tauri::command]
async fn jalankan(app: tauri::AppHandle, window: tauri::WebviewWindow, perintah: String, args: Option<Map<String, Value>>, id_permintaan: Option<String>) -> Result<Value, String> {
    let kendali = app.state::<jaringan::kendali::Kendali>();
    let kasir = kendali.mode() == jaringan::mode::Mode::Kasir;
    if !kasir && kendali.perlu_mulai_ulang() {
        return Err("KasirJet perlu dibuka ulang supaya memakai data di komputer ini. Tutup aplikasinya, lalu buka lagi.".into());
    }
    let lokal = {
        let app = app.clone();
        move |perintah: String, args: Map<String, Value>| {
            let db = app.state::<db::Db>();
            let sesi = app.state::<sesi::DaftarSesi>().ambil(sesi::TOKEN_LOKAL);
            let k = Konteks::baru(&db, &sesi).dengan_jendela(&app, &window);
            dispatch(&k, &perintah, &args)
        }
    };
    if kasir {
        let klien = app.state::<std::sync::Arc<jaringan::klien::Klien>>().inner().clone();
        let sesi = app.state::<sesi::DaftarSesi>().ambil(sesi::TOKEN_LOKAL);
        return klien.jalankan_id(&sesi, perintah, args, id_permintaan, lokal).await;
    }
    // Restore dan "Ambil dari Toko Pro Lama" mengganti seluruh isi database: komputer Kasir ditahan (503) dan sesinya diakhiri.
    if jaringan::golongan::PERAWATAN.contains(&perintah.as_str()) {
        if let Ok(pusat) = kendali.pusat() {
            return tauri::async_runtime::spawn_blocking(move || pusat.dengan_perawatan(|| lokal(perintah, args.unwrap_or_default())))
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    tauri::async_runtime::spawn_blocking(move || lokal(perintah, args.unwrap_or_default()))
        .await
        .map_err(|e| e.to_string())?
}

fn manager_lokal(app: &tauri::AppHandle) -> Result<(), String> {
    let user = app.state::<sesi::DaftarSesi>().ambil(sesi::TOKEN_LOKAL).user()?;
    database::hanya_manager(&user)
}

/// Komputer ini akan berhenti memakai `tokopro.db` (jadi Kasir). Bila di dalamnya sudah ada data toko, salinannya dibuat dulu
/// (rancangan 6.2). Hanya saat berpindah dari Tunggal atau Pusat; komputer yang sudah Kasir tidak punya database terbuka.
fn cadangan_sebelum_kasir(app: &tauri::AppHandle, kendali: &jaringan::kendali::Kendali) -> Result<Option<String>, String> {
    if kendali.mode() == jaringan::mode::Mode::Kasir || kendali.perlu_mulai_ulang() {
        return Ok(None);
    }
    let db = app.state::<db::Db>();
    database::cadangan_sebelum_kasir(&db)
        .map(|f| f.map(|f| f.display().to_string()))
        .map_err(|e| format!("Data toko di komputer ini belum bisa disalin, jadi komputer ini belum dijadikan Kasir. Data Anda tidak berubah. ({e})"))
}

/// Status mode Pusat untuk layar Komputer Pusat (tahap tampilan).
#[tauri::command]
fn pusat_status(kendali: tauri::State<jaringan::kendali::Kendali>, klien: tauri::State<std::sync::Arc<jaringan::klien::Klien>>, db: tauri::State<db::Db>) -> serde_json::Value {
    let mut s = kendali.status();
    s["kasir"] = klien.status_json();
    s["perluPilihan"] = serde_json::json!(perlu_pilihan(&kendali, &klien, &db));
    if kendali.mode() == jaringan::mode::Mode::Pusat {
        s["kasirTersambung"] = serde_json::json!(db.lock().map(|c| jaringan::perangkat::jumlah_tersambung(&c)).unwrap_or(0));
    }
    s
}

/// Layar pilihan awal dibutuhkan bila: instalasi baru (belum ada `pusat.json` dan database kosong; rancangan 7.1),
/// atau komputer ini sudah dipilih sebagai kasir tetapi belum pernah berhasil tersambung (pilihannya masih bisa diubah).
/// Komputer yang sudah punya data otomatis memakai mode Tunggal tanpa pertanyaan.
pub(crate) fn perlu_pilihan(kendali: &jaringan::kendali::Kendali, klien: &jaringan::klien::Klien, db: &db::Db) -> bool {
    if kendali.ada_berkas() {
        return kendali.mode() == jaringan::mode::Mode::Kasir && klien.status_json()["sudahDisambung"] != true;
    }
    let Ok(conn) = db.lock() else { return false };
    !database::database_berisi(&conn)
}

/// Pilihan peran saat KasirJet pertama kali dibuka, sebelum ada yang masuk (rancangan 7.1). Hanya diterima sekali,
/// selama `perlu_pilihan`. Berikutnya peran diubah di Pengaturan, Alat Bantu, Komputer Pusat oleh Manager.
#[tauri::command]
fn awal_pilih(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, klien: tauri::State<std::sync::Arc<jaringan::klien::Klien>>, db: tauri::State<db::Db>, mode: jaringan::mode::Mode, pusat: Option<String>) -> Result<serde_json::Value, String> {
    if !perlu_pilihan(&kendali, &klien, &db) {
        return Err("Peran komputer ini sudah dipilih. Manager bisa mengubahnya di Pengaturan, Alat Bantu, Komputer Pusat.".into());
    }
    if mode == jaringan::mode::Mode::Kasir && pusat.as_deref().unwrap_or("").trim().is_empty() {
        return Err("Nama komputer Pusat belum diisi.".into());
    }
    kendali.atur_mode(std::sync::Arc::new(app), mode, None)?;
    if mode == jaringan::mode::Mode::Kasir {
        klien.atur_pusat(pusat.as_deref().unwrap_or(""), None)?;
    }
    klien.inner().selaraskan();
    let mut s = kendali.status();
    s["kasir"] = klien.status_json();
    s["perluPilihan"] = serde_json::json!(false);
    Ok(s)
}

/// Tanggal dan jam Pusat sekarang, untuk `today()` di tampilan (rancangan 4.3). Di komputer Kasir dihitung dari selisih jam
/// terhadap Pusat; di Tunggal dan Pusat memakai jam komputer ini.
#[tauri::command]
fn jam_pusat(klien: tauri::State<std::sync::Arc<jaringan::klien::Klien>>) -> serde_json::Value {
    klien.jam_pusat()
}

/// Ganti mode ("tunggal", "pusat", atau "kasir"). Hanya Manager. Untuk Kasir pakai `kasir_atur`, yang juga mengisi nama Pusat.
#[tauri::command]
fn pusat_atur_mode(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, klien: tauri::State<std::sync::Arc<jaringan::klien::Klien>>, mode: jaringan::mode::Mode, port: Option<u16>) -> Result<serde_json::Value, String> {
    manager_lokal(&app)?;
    let cadangan = if mode == jaringan::mode::Mode::Kasir { cadangan_sebelum_kasir(&app, &kendali)? } else { None };
    kendali.atur_mode(std::sync::Arc::new(app), mode, port)?;
    klien.inner().selaraskan();
    let mut s = kendali.status();
    s["kasir"] = klien.status_json();
    s["cadangan"] = serde_json::json!(cadangan);
    Ok(s)
}

/// Jadikan komputer ini komputer kasir yang menyambung ke `pusat` (nama komputer atau alamat IP).
/// Manager yang masuk di komputer ini, atau komputer yang sudah berupa komputer kasir (menyambung ulang).
#[tauri::command]
fn kasir_atur(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, klien: tauri::State<std::sync::Arc<jaringan::klien::Klien>>, pusat: String, port: Option<u16>) -> Result<serde_json::Value, String> {
    if kendali.mode() != jaringan::mode::Mode::Kasir {
        manager_lokal(&app)?;
    }
    let cadangan = cadangan_sebelum_kasir(&app, &kendali)?;
    kendali.atur_mode(std::sync::Arc::new(app), jaringan::mode::Mode::Kasir, port)?;
    klien.atur_pusat(&pusat, port)?;
    klien.inner().selaraskan();
    let mut s = klien.status_json();
    s["cadangan"] = serde_json::json!(cadangan);
    Ok(s)
}

/// Sambungkan komputer kasir ke Pusat dengan kode sambung (kosong bila Pusat sedang menerima komputer baru tanpa kode).
#[tauri::command]
async fn kasir_sambung(kendali: tauri::State<'_, jaringan::kendali::Kendali>, klien: tauri::State<'_, std::sync::Arc<jaringan::klien::Klien>>, kode: Option<String>) -> Result<serde_json::Value, String> {
    if kendali.mode() != jaringan::mode::Mode::Kasir {
        return Err("Komputer ini belum diatur sebagai komputer kasir.".into());
    }
    let klien = klien.inner().clone();
    klien.sambung(kode).await?;
    Ok(klien.status_json())
}

/// Nama komputer Pusat dari Toko Pro lama di komputer ini, untuk mengisi isian awal. Kosong bila tidak ada.
#[tauri::command]
async fn kasir_nama_lama() -> Option<String> {
    tauri::async_runtime::spawn_blocking(pindah_lama::nama_komputer_lama).await.ok().flatten()
}

/// Satu percobaan menyambung ke Pusat tanpa kode (rancangan 8.5). Dipanggil berulang oleh layar "menunggu Pusat".
#[tauri::command]
async fn kasir_tunggu_pusat(kendali: tauri::State<'_, jaringan::kendali::Kendali>, klien: tauri::State<'_, std::sync::Arc<jaringan::klien::Klien>>) -> Result<serde_json::Value, String> {
    if kendali.mode() != jaringan::mode::Mode::Kasir {
        return Err("Komputer ini belum diatur sebagai komputer kasir.".into());
    }
    let klien = klien.inner().clone();
    Ok(klien.tunggu_pusat().await)
}

/// Beri izin firewall Windows untuk port Pusat (rancangan 5.3). Windows menampilkan dialog UAC; perintah ini menunggu jawabannya.
/// Tidak butuh sesi: dipakai juga sesaat setelah komputer dijadikan Pusat, sebelum ada yang masuk. Yang dibuat hanya satu aturan tetap
/// untuk port Pusat dan program ini, dan Windows tetap meminta persetujuan administrator.
#[tauri::command]
async fn pusat_beri_izin(kendali: tauri::State<'_, jaringan::kendali::Kendali>) -> Result<serde_json::Value, String> {
    if kendali.mode() != jaringan::mode::Mode::Pusat {
        return Err("Komputer ini belum dijadikan Pusat.".into());
    }
    let port = kendali.port_efektif();
    tauri::async_runtime::spawn_blocking(move || jaringan::firewall::beri_izin(port)).await.map_err(|e| e.to_string())??;
    Ok(kendali.status())
}

/// Kode sambung baru (6 angka, berlaku 10 menit, sekali pakai). Hanya Manager.
#[tauri::command]
fn pusat_kode_baru(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>) -> Result<serde_json::Value, String> {
    manager_lokal(&app)?;
    let (kode, sisa) = kendali.pusat()?.kode_baru()?;
    Ok(serde_json::json!({ "kode": kode, "berlakuDetik": sisa.as_secs() }))
}

/// Buka (1 jam) atau tutup masa terima komputer kasir tanpa kode. Hanya Manager.
#[tauri::command]
fn pusat_terima_otomatis(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, buka: bool) -> Result<(), String> {
    manager_lokal(&app)?;
    let p = kendali.pusat()?;
    if buka {
        p.buka_terima_otomatis(std::time::Duration::from_secs(3600));
    } else {
        p.tutup_terima_otomatis();
    }
    Ok(())
}

/// Komputer kasir yang tersambung, dengan pengguna yang sedang masuk. Hanya Manager.
#[tauri::command]
fn pusat_perangkat(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, db: tauri::State<db::Db>) -> Result<Vec<serde_json::Value>, String> {
    manager_lokal(&app)?;
    kendali.pusat()?;
    let conn = db.lock()?;
    jaringan::perangkat::daftar(&conn)
}

/// Putuskan satu komputer kasir: tokennya dicabut dan sesinya berakhir. Hanya Manager.
#[tauri::command]
fn pusat_putuskan(app: tauri::AppHandle, kendali: tauri::State<jaringan::kendali::Kendali>, db: tauri::State<db::Db>, sesi: tauri::State<sesi::DaftarSesi>, id: i64) -> Result<(), String> {
    manager_lokal(&app)?;
    kendali.pusat()?;
    let conn = db.lock()?;
    jaringan::perangkat::putuskan(&conn, &sesi, id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let kendali = jaringan::kendali::Kendali::baru(konteks::folder_data_aplikasi(app.handle())?.join("pusat.json"));
            if kendali.mode() == jaringan::mode::Mode::Kasir {
                // Komputer kasir tidak membuka database. Perintah lokal tetap butuh `Db`, jadi dipasang yang kosong di memori
                // (tanpa file, tanpa tabel); perintah data tidak pernah menyentuhnya karena semuanya dikirim ke Pusat.
                let kosong = rusqlite::Connection::open_in_memory()?;
                app.manage(db::Db(Mutex::new(kosong)));
                app.manage(sesi::DaftarSesi::baru());
                kendali.tandai_db_dibuka(false);
            } else {
                let path = database_path(app.handle())?;
                let conn = db::open(&path)?;
                let daftar = sesi::DaftarSesi::muat(&conn)?;
                app.manage(db::Db(Mutex::new(conn)));
                app.manage(daftar);
                kendali.nyalakan(std::sync::Arc::new(app.handle().clone()));
            }
            let (berkas, pengaturan) = kendali.bersama();
            let pancar = app.handle().clone();
            let klien = std::sync::Arc::new(jaringan::klien::Klien::baru(
                berkas,
                pengaturan,
                jaringan::kendali::nama_komputer(),
                std::sync::Arc::new(move |status| {
                    use tauri::Emitter;
                    let _ = pancar.emit("status-pusat", status);
                }),
                Default::default(),
            ));
            klien.selaraskan();
            app.manage(klien);
            app.manage(kendali);
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.manage(pembaruan_pusat::Tertunda::default());
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![jalankan, kasir_atur, kasir_sambung, kasir_nama_lama, kasir_tunggu_pusat, pindah_otomatis::lama_deteksi, pindah_otomatis::lama_terbuka, pindah_otomatis::lama_pusat_mulai, awal_pilih, pusat_status, jam_pusat, pusat_atur_mode, pusat_beri_izin, pusat_kode_baru, pusat_terima_otomatis, pusat_perangkat, pusat_putuskan, pembaruan_pusat::pembaruan_pusat_cek, pembaruan_pusat::pembaruan_pusat_pasang])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan aplikasi");
}
