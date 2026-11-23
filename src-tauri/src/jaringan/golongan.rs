//! Golongan perintah: perintah mana yang boleh dijalankan lewat jaringan, dan mana yang hanya di komputer ini.
//! Rancangan bagian 2.3. Perintah yang tidak ada di daftar mana pun ditolak (aman bila lupa didaftarkan);
//! tes `setiap_perintah_masuk_tepat_satu_golongan` memastikan daftar ini selalu lengkap.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Golongan {
    /// Perintah data biasa. Kasir mengirimnya ke Pusat; Pusat menjalankannya untuk komputer yang tersambung.
    Data,
    /// Selalu dijalankan di komputer yang sedang dipakai (mencetak, menulis file). Tidak pernah lewat jaringan.
    Lokal,
    /// Sebagian dikerjakan di komputer kasir (membaca file gambar), sebagian di Pusat. Perintahnya sendiri tidak boleh lewat jaringan.
    Campuran,
    /// Hanya dijalankan di komputer Pusat (folder, file, dan database ada di sana). Ditolak dari jaringan.
    KhususPusat,
    /// Hanya untuk pengembangan. Selalu ditolak dari jaringan.
    Pengembangan,
}

/// Perintah yang selalu jalan di komputer sendiri.
pub const LOKAL: &[&str] = &["cetak", "ekspor_nama", "simpan_file", "simpan_xlsx", "simpan_laporan", "baca_gambar", "lama_pengaturan", "lama_foto_daftar"];

/// Dikerjakan sebagian di kasir, sebagian di Pusat (`foto_simpan`: Kasir membaca file gambarnya lalu mengirim isinya
/// ke `foto_simpan_data` di Pusat).
pub const CAMPURAN: &[&str] = &["foto_simpan"];

/// Hanya di komputer Pusat.
pub const KHUSUS_PUSAT: &[&str] = &[
    "db_daftar_backup", "db_backup", "db_cek", "db_perbaiki", "db_restore", "backup_otomatis", "lama_cari",
    "lama_pindahkan", "alat_sql", "impor_baca", "impor_proses",
];

/// Perintah yang mengganti seluruh isi database di Pusat: dijalankan dalam mode perawatan (rancangan 6.1).
pub const PERAWATAN: &[&str] = &["db_restore", "lama_pindahkan"];

/// Hanya pengembangan.
pub const PENGEMBANGAN: &[&str] = &["restore_session"];

/// Perintah data biasa.
pub const DATA: &[&str] = &[
    "db_path", "login", "login_bawaan", "logout", "current_user", "change_password", "get_settings",
    "save_settings", "list_users", "save_user", "delete_user", "my_menus", "user_akses", "save_user_akses",
    "foto_baca", "foto_perlu_kirim", "foto_hapus", "foto_simpan_data", "master_list", "master_save", "master_delete", "barang_find", "barang_search",
    "pelanggan_jatuh_tempo", "jenis_nontunai", "save_penjualan", "verifikasi_admin", "barang_cari_kasir",
    "barang_find_kasir", "save_pembelian", "save_opname", "preview_notrans", "list_transaksi",
    "get_transaksi", "promo_keranjang", "save_order", "list_order", "get_order", "delete_order",
    "save_penjualan_order", "save_pembelian_order", "save_pending", "list_pending", "get_pending",
    "delete_pending", "pending_selesai", "get_retur_sumber", "save_retur_jual", "save_retur_beli",
    "save_retur_beli_barang", "kartu_kontak", "kartu_list", "save_pelunasan", "dashboard",
    "laporan_penjualan", "laporan_pembelian", "laporan_stok", "laporan_kas", "laporan_piutang",
    "laporan_data", "dashboard_data", "notifikasi", "kas_kategori", "kas_list", "kas_save", "kas_delete",
    "poin_member", "poin_histori", "poin_tukar", "poin_koreksi", "db_info", "alat_item_hapus",
    "alat_hitung_stok", "alat_hitung_kas", "alat_sinkron_harga_beli", "alat_sinkron_jual",
    "alat_daftar_transaksi", "alat_hapus_transaksi", "alat_hapus_data", "impor_jenis", "nt_list", "nt_jenis_save", "nt_jenis_delete", "nt_item_save", "nt_item_delete",
    "save_stok_awal", "barang_label", "save_opname_stok", "label_barang_find", "katalog_barang", "promo_list",
    "promo_save", "promo_delete", "promo_barang",
];

/// Golongan perintah; `None` bila namanya tidak dikenal.
pub fn golongan(nama: &str) -> Option<Golongan> {
    let cocok = |d: &[&str]| d.contains(&nama);
    if cocok(DATA) {
        Some(Golongan::Data)
    } else if cocok(LOKAL) {
        Some(Golongan::Lokal)
    } else if cocok(CAMPURAN) {
        Some(Golongan::Campuran)
    } else if cocok(KHUSUS_PUSAT) {
        Some(Golongan::KhususPusat)
    } else if cocok(PENGEMBANGAN) {
        Some(Golongan::Pengembangan)
    } else {
        None
    }
}

/// Perintah yang mengubah data dan karena itu diberi `idPermintaan` (rancangan 4.2): Kasir membuat ID-nya,
/// dan Pusat mengingat hasilnya supaya simpan yang diulang tidak tercatat dua kali. `login`, `logout`, dan
/// `verifikasi_admin` tidak termasuk karena hasilnya bergantung pada keadaan sesi.
pub fn perintah_simpan(nama: &str) -> bool {
    const SAMA: &[&str] = &["kas_save", "kas_delete", "poin_tukar", "poin_koreksi", "pending_selesai", "foto_hapus", "foto_simpan_data", "alat_item_hapus", "promo_save", "promo_delete"];
    const AWALAN: &[&str] = &["save_", "delete_", "master_save", "master_delete", "alat_hapus_", "alat_hitung_", "alat_sinkron_", "nt_jenis_save", "nt_jenis_delete", "nt_item_save", "nt_item_delete"];
    SAMA.contains(&nama) || AWALAN.iter().any(|p| nama.starts_with(p))
}

/// Perintah yang hanya membaca (batas waktu 10 detik, dan gagal tidak membuat data ragu). Diturunkan dari `perintah_simpan`:
/// semua perintah yang bukan simpan dianggap baca, jadi daftarnya tidak bisa tidak sinkron.
pub fn perintah_baca(nama: &str) -> bool {
    !perintah_simpan(nama)
}
