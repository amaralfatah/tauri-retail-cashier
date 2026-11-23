import { invoke } from "@/lib/panggil";
import type { Row } from "../api";

export interface KasInput {
  tgl: string;
  noref: string;
  jenis: "Saldo Awal" | "Masuk" | "Keluar";
  kategori: string;
  kodekaryawan: string;
  kodepelanggan: string;
  kodepemasok: string;
  masuk: number;
  keluar: number;
  ket: string;
}

export interface KasDaftar { rows: Row[]; masuk: number; keluar: number; kas: number }
export interface FileBackup { nama: string; path: string; ukuran: number; waktu: string }
export interface PratinjauImpor { kolom: string[]; baris: string[][]; jumlah: number; wajib_hilang: string[]; tidak_dikenal: string[] }
export interface HasilSql { kolom: string[]; baris: unknown[][]; terpotong: boolean; cadangan: string | null }

export const kasApi = {
  kategori: () => invoke<string[]>("kas_kategori"),
  list: (dari = "", sampai = "") => invoke<KasDaftar>("kas_list", { dari, sampai }),
  simpan: (input: KasInput) => invoke<{ idkas: number; nokas: string }>("kas_save", { input }),
  hapus: (idkas: number, izin?: string | null) => invoke<void>("kas_delete", { idkas, izin: izin ?? null }),
};

export const poinApi = {
  member: (kode: string) => invoke<{ kodepelanggan: string; namapelanggan: string; poin: number }>("poin_member", { kode }),
  histori: (kode: string, jumlah = 20) => invoke<Row[]>("poin_histori", { kode, jumlah }),
  tukar: (kode: string, jumlah: number, catatan: string) => invoke<{ notukar: string; poin: number }>("poin_tukar", { kode, jumlah, catatan }),
  koreksi: (kode: string, poinBaru: number) => invoke<{ notukar: string; poin: number }>("poin_koreksi", { kode, poinBaru }),
};

export const dbApi = {
  info: () => invoke<{ path: string; ukuran: number; folder_backup: string }>("db_info"),
  daftarBackup: (folder?: string) => invoke<FileBackup[]>("db_daftar_backup", { folder: folder || null }),
  backup: (folder?: string) => invoke<{ path: string; ukuran: number }>("db_backup", { folder: folder || null }),
  cek: (penuh: boolean) => invoke<{ ok: boolean; masalah: string[] }>("db_cek", { penuh }),
  perbaiki: (folder?: string) => invoke<{ cadangan: string }>("db_perbaiki", { folder: folder || null }),
  restore: (file: string, folder?: string) => invoke<{ cadangan: string }>("db_restore", { file, folder: folder || null }),
};

export const alatApi = {
  itemHapus: () => invoke<{ kunci: string; nama: string }[]>("alat_item_hapus"),
  hitungStok: () => invoke<{ berubah: number }>("alat_hitung_stok"),
  hitungKas: () => invoke<{ berubah: number }>("alat_hitung_kas"),
  sinkronHargaBeli: (folder?: string) => invoke<{ berubah: number; cadangan: string }>("alat_sinkron_harga_beli", { folder: folder || null }),
  sinkronJual: (folder?: string) => invoke<{ dihapus: number; cadangan: string }>("alat_sinkron_jual", { folder: folder || null }),
  daftarTransaksi: (jenis: string, no: string, dari: string, sampai: string) =>
    invoke<Row[]>("alat_daftar_transaksi", { jenis, no, dari, sampai }),
  hapusTransaksi: (daftar: string[], folder?: string) => invoke<{ dihapus: number; cadangan: string }>("alat_hapus_transaksi", { daftar, folder: folder || null }),
  hapusData: (item: string[], dari: string, sampai: string, folder?: string) =>
    invoke<{ dihapus: Record<string, number>; cadangan: string }>("alat_hapus_data", { input: { item, dari, sampai, folder: folder || null } }),
  sql: (sql: string, folder?: string) => invoke<HasilSql>("alat_sql", { sql, folder: folder || null }),
};

export const imporApi = {
  jenis: () => invoke<{ kunci: string; nama: string }[]>("impor_jenis"),
  baca: (jenis: string, path: string) => invoke<PratinjauImpor>("impor_baca", { jenis, path }),
  proses: (jenis: string, path: string, hapusLama: boolean, folder?: string) =>
    invoke<{ jumlah: number; cadangan: string; notrans?: string }>("impor_proses", { jenis, path, hapusLama, folder: folder || null }),
};

export const ntApi = {
  list: () => invoke<{ jenis: Row[]; item: Row[] }>("nt_list"),
  simpanJenis: (kode: string, nama: string, asli: string | null) => invoke<void>("nt_jenis_save", { kode, nama, asli }),
  hapusJenis: (kode: string) => invoke<void>("nt_jenis_delete", { kode }),
  simpanItem: (kode: string, nama: string, asli: string | null) => invoke<void>("nt_item_save", { kode, nama, asli }),
  hapusItem: (kode: string, nama: string) => invoke<void>("nt_item_delete", { kode, nama }),
};

/** Lokasi folder backup yang dipilih pengguna di komputer ini (kosong = folder bawaan). */
const KEY_FOLDER = "tokopro.folderBackup";
export const folderBackup = {
  get: (): string => { try { return localStorage.getItem(KEY_FOLDER) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { if (v.trim()) localStorage.setItem(KEY_FOLDER, v.trim()); else localStorage.removeItem(KEY_FOLDER); } catch { /* penyimpanan tidak tersedia */ } },
};

export type KandidatLama = { path: string; jenis: "fdb" | "fdk"; ukuran: number; waktu: string };
export type CariLama = {
  kandidat: KandidatLama[];
  firebird: { ada: boolean; lokasi: string | null };
  data_sekarang: { barang: number; transaksi: number };
};
export type HasilLama = {
  hasil: { tabel: string; nama: string; jumlah: number }[];
  cadangan: string;
  peringatan: string[];
};
export type KemajuanLama = { tahap: "salin" | "baca" | "selesai"; tabel?: string; nama?: string; ke: number; dari: number; jumlah?: number };

export const lamaApi = {
  cari: () => invoke<CariLama>("lama_cari"),
  pindahkan: (file: string, folder?: string) => invoke<HasilLama>("lama_pindahkan", { file, folder: folder || null }),
};
