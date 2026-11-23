import { invoke } from "@/lib/panggil";
import type { Row, TransInput } from "../api";

/** Awal pesan error dari server yang artinya "perlu izin supervisor" (hanya untuk menghapus data). */
export const TANDA_IZIN = "[izin] ";
/** Awal pesan error dari server yang artinya "tanyakan Ya/Tidak dulu" (batas kredit terlampaui). */
export const TANDA_KONFIRMASI = "[konfirmasi] ";

/** Level yang harus minta izin lewat Verifikasi Admin sebelum menghapus order, pending, dan data kas. */
export const perluVerifikasi = (level: string) => level === "Kasir" || level === "Lainnya";

export const kasirApi = {
  /** Verifikasi Admin: mengembalikan tanda izin sekali pakai kalau nama user dan kata sandi supervisor benar. */
  verifikasiAdmin: (iduser: string, password: string) => invoke<string>("verifikasi_admin", { iduser, password }),
  savePenjualan: (input: TransInput) =>
    invoke<{ notrans: string; total: number; kembali: number; poin?: number }>("save_penjualan", { input }),
  savePembelian: (input: TransInput) => invoke<{ notrans: string; total: number }>("save_pembelian", { input }),
  cariBarang: (search: string, limit = 100) => invoke<Row[]>("barang_cari_kasir", { search, limit }),
  /** Scan kode atau barcode di layar kasir; aturan stoknya sama dengan daftar barang (F10). */
  findBarang: (code: string) => invoke<Row | null>("barang_find_kasir", { code }),
};

/** Kalau `msg` meminta konfirmasi Ya/Tidak, kembalikan pertanyaannya tanpa tanda pengenal; kalau bukan, null. */
export function pesanKonfirmasi(msg: string): string | null {
  return msg.startsWith(TANDA_KONFIRMASI) ? msg.slice(TANDA_KONFIRMASI.length) : null;
}
