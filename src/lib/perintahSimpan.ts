/** Cermin `perintah_simpan` di `src-tauri/src/jaringan/golongan.rs`: perintah yang mengubah data dan diberi `idPermintaan`.
 *  Tes `npm run tes:simpan` memastikan daftar ini sama dengan yang di Rust. */
export const SIMPAN_SAMA = ["kas_save", "kas_delete", "poin_tukar", "poin_koreksi", "pending_selesai", "foto_hapus", "foto_simpan_data", "alat_item_hapus", "promo_save", "promo_delete"];
export const SIMPAN_AWALAN = ["save_", "delete_", "master_save", "master_delete", "alat_hapus_", "alat_hitung_", "alat_sinkron_", "nt_jenis_save", "nt_jenis_delete", "nt_item_save", "nt_item_delete"];
export const perintahSimpan = (cmd: string) => SIMPAN_SAMA.includes(cmd) || SIMPAN_AWALAN.some((p) => cmd.startsWith(p));

/** Kode unik satu perintah simpan (32 karakter heksa acak). */
export const idBaru = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
