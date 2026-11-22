import { invoke } from "@tauri-apps/api/core";

export type Row = Record<string, any>;

export interface User {
  iduser: string;
  kodekaryawan: string;
  namakaryawan: string;
  level: string;
  must_change: boolean;
}

export interface TransItem {
  kodebarang: string;
  namabarang: string;
  kodesatuan: string;
  satuanjual: string;
  konversi: number;
  jmljual: number;
  harga: number;
  disknilai?: number;
}

export interface TransInput {
  tgl: string;
  kodepelanggan?: string;
  kodepemasok?: string;
  kodesales?: string;
  catatan?: string;
  items: TransItem[];
  diskonpersen?: number;
  diskonnilai?: number;
  biaya?: number;
  carabayar: "Tunai" | "Non Tunai" | "Kredit";
  jmlbayar?: number;
  jenisnontunai?: string;
  kartu?: string;
  norefkartu?: string;
  jthtempo?: string;
  update_hrgbeli?: boolean;
  /** Penjualan kredit: pengguna sudah menjawab Ya pada pertanyaan batas kredit terlampaui. */
  lanjutkredit?: boolean;
  /** Penjualan: bagian yang dibayar non tunai (nominal sendiri, jenis di `jenisnontunai`). */
  bayarnontunai?: number;
  /** Pembelian: harga jual per satuan dasar dari kolom Hrg. Jual. */
  hargajual?: { kodebarang: string; hrgjual: number }[];
  /** Kasir yang dipilih di layar; kosong = user yang masuk. */
  kodekasir?: string;
}

export type MasterTable = "mdbarang" | "mdsatuan" | "mdkelompok" | "mdkategori" | "mdpelanggan" | "mdpemasok" | "mdkaryawan";

export const api = {
  login: (iduser: string, password: string) => invoke<User>("login", { iduser, password }),
  logout: () => invoke<void>("logout"),
  loginBawaan: () => invoke<User | null>("login_bawaan"),
  currentUser: () => invoke<User | null>("current_user"),
  restoreSession: (iduser: string) => invoke<User | null>("restore_session", { iduser }),
  changePassword: (old: string, nw: string) => invoke<void>("change_password", { old, new: nw }),
  getSettings: () => invoke<Row>("get_settings"),
  saveSettings: (data: Row) => invoke<void>("save_settings", { data }),
  myMenus: () => invoke<string[]>("my_menus"),
  listUsers: () => invoke<Row[]>("list_users"),
  saveUser: (data: Row, baru: boolean) => invoke<void>("save_user", { data, baru }),
  deleteUser: (iduser: string) => invoke<void>("delete_user", { iduser }),
  dbPath: () => invoke<string>("db_path"),
  cetak: () => invoke<void>("cetak"),

  masterList: (tableName: MasterTable, opts: { search?: string; limit?: number; offset?: number; onlyActive?: boolean; kelompok?: string; kategori?: string; sort?: string; hanyaKodeNama?: boolean } = {}) =>
    invoke<{ rows: Row[]; total: number }>("master_list", { tableName, ...opts }),
  masterSave: (tableName: MasterTable, data: Row, originalKey?: string | null) =>
    invoke<void>("master_save", { tableName, data, originalKey: originalKey ?? null }),
  masterDelete: (tableName: MasterTable, key: string) => invoke<void>("master_delete", { tableName, key }),
  pelangganJatuhTempo: (search: string) => invoke<Row[]>("pelanggan_jatuh_tempo", { search }),
  barangFind: (code: string) => invoke<Row | null>("barang_find", { code }),
  barangSearch: (search: string, limit = 50, stokMin = false) => invoke<Row[]>("barang_search", { search, limit, stokMin }),
  jenisNonTunai: () => invoke<Row[]>("jenis_nontunai"),

  savePenjualan: (input: TransInput) => invoke<{ notrans: string; total: number; kembali: number }>("save_penjualan", { input }),
  savePembelian: (input: TransInput) => invoke<{ notrans: string; total: number }>("save_pembelian", { input }),
  saveOpname: (tgl: string, catatan: string, items: { kodebarang: string; stokfisik: number }[]) =>
    invoke<{ notrans: string; jumlah: number }>("save_opname", { tgl, catatan, items }),
  previewNotrans: (kode: string, tgl: string) => invoke<string>("preview_notrans", { kode, tgl }),
  listTransaksi: (kode: string, dari: string, sampai: string, search = "") =>
    invoke<Row[]>("list_transaksi", { kode, dari, sampai, search }),
  getTransaksi: (notrans: string) => invoke<{ header: Row; detail: Row[] }>("get_transaksi", { notrans }),

  dashboard: (tgl: string) => invoke<Row>("dashboard", { tgl }),
  laporanPenjualan: (dari: string, sampai: string) => invoke<{ rows: Row[]; terlaris: Row[] }>("laporan_penjualan", { dari, sampai }),
  laporanPembelian: (dari: string, sampai: string) => invoke<Row[]>("laporan_pembelian", { dari, sampai }),
  laporanStok: (mode: string, search = "") => invoke<Row[]>("laporan_stok", { mode, search }),
  laporanKas: (dari: string, sampai: string) => invoke<Row[]>("laporan_kas", { dari, sampai }),
  laporanPiutang: (kode: "PS" | "HS") => invoke<Row[]>("laporan_piutang", { kode }),
  laporanData: (jenis: string, filter: Record<string, string>) => invoke<Row[]>("laporan_data", { jenis, filter }),
};

export function errText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Terjadi kesalahan. Silakan coba lagi.";
}
