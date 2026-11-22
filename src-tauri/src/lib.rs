mod alat;
mod auth;
mod berkas;
mod database;
mod db;
mod impor;
mod izin;
mod kas;
mod inventori;
mod master;
mod nontunai;
mod poin;
mod promo;
mod order;
mod pelunasan;
mod retur;
mod report;
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

use std::sync::Mutex;
use tauri::Manager;

/// Buka dialog cetak untuk halaman yang sedang tampil (struk/laporan memakai CSS @media print).
#[tauri::command]
fn cetak(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(database_path(&app)?.display().to_string())
}

fn database_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(p) = std::env::var("TOKOPRO_DB") {
        return Ok(p.into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tokopro.db"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = database_path(app.handle())?;
            let conn = db::open(&path)?;
            app.manage(db::Db(Mutex::new(conn)));
            app.manage(auth::Session::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cetak,
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
            berkas::ekspor_nama,
            berkas::simpan_file,
            berkas::simpan_xlsx,
            berkas::foto_simpan,
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
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan aplikasi");
}
