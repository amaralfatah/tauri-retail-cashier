import { invoke } from "@/lib/panggil";
import type { Row, TransInput, TransItem } from "../api";

export interface OrderInput {
  jual: boolean;
  tgl: string;
  kodepelanggan?: string;
  kodepemasok?: string;
  kodesales?: string;
  catatan?: string;
  dp?: number;
  items: TransItem[];
  /** Diisi saat koreksi order. */
  notrans?: string;
  kodekasir?: string;
}

export interface PendingInput {
  nopending?: string;
  tgl: string;
  kodepelanggan?: string;
  kodesales?: string;
  catatan?: string;
  items: TransItem[];
  kodekasir?: string;
}

export interface OrderData { header: Row; detail: Row[] }

export const orderApi = {
  saveOrder: (input: OrderInput) => invoke<{ notrans: string; total: number }>("save_order", { input }),
  listOrder: (jual: boolean, dari: string, sampai: string, search = "") => invoke<Row[]>("list_order", { jual, dari, sampai, search }),
  getOrder: (notrans: string) => invoke<OrderData>("get_order", { notrans }),
  deleteOrder: (notrans: string, izin?: string | null) => invoke<void>("delete_order", { notrans, izin: izin ?? null }),
  savePenjualanOrder: (input: TransInput, noorder: string) =>
    invoke<{ notrans: string; total: number; kembali: number }>("save_penjualan_order", { input, noorder }),
  savePembelianOrder: (input: TransInput, noorder: string) =>
    invoke<{ notrans: string; total: number }>("save_pembelian_order", { input, noorder }),

  savePending: (input: PendingInput) => invoke<{ nopending: string; total: number }>("save_pending", { input }),
  listPending: (dari: string, sampai: string, search = "") => invoke<Row[]>("list_pending", { dari, sampai, search }),
  getPending: (nopending: string) => invoke<OrderData>("get_pending", { nopending }),
  deletePending: (nopending: string, izin?: string | null) => invoke<void>("delete_pending", { nopending, izin: izin ?? null }),
  /** Pending yang sudah dipakai untuk menyimpan penjualan ikut dibersihkan, tanpa izin. */
  pendingSelesai: (nopending: string) => invoke<void>("pending_selesai", { nopending }),
};
