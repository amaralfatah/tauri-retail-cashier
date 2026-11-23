import { invoke } from "@/lib/panggil";
import type { Row, TransItem } from "../api";

export interface ReturSumber { header: Row; detail: Row[]; piutang_terbuka?: number }
export interface ReturHasil { notrans: string; total: number; dipotong: number; kas: number }

export const returApi = {
  sumber: (notrans: string, kode: "TJ" | "TB") => invoke<ReturSumber>("get_retur_sumber", { notrans, kode }),
  simpanJual: (input: { tgl: string; asal: string; catatan: string; items: { nourut: number; jml: number }[]; potong_piutang?: boolean; kodekasir?: string }) =>
    invoke<ReturHasil>("save_retur_jual", { input }),
  simpanBeli: (input: { tgl: string; asal: string; catatan: string; items: { nourut: number; jml: number }[]; kodekasir?: string }) =>
    invoke<ReturHasil>("save_retur_beli", { input }),
  simpanBeliBarang: (input: { tgl: string; kodepemasok: string; catatan: string; items: TransItem[]; kodekasir?: string }) =>
    invoke<ReturHasil>("save_retur_beli_barang", { input }),
};

export const pelunasanApi = {
  kontak: (jenis: "Piutang" | "Hutang") => invoke<Row[]>("kartu_kontak", { jenis }),
  kartu: (jenis: "Piutang" | "Hutang", kode: string) => invoke<Row[]>("kartu_list", { jenis, kode }),
  simpan: (input: {
    jenis: "Piutang" | "Hutang"; kode: string; tgl: string;
    /** Kasir yang dicatat; kosong = user yang masuk. */
    kodekaryawan: string;
    /** "nominal" = Sesuai Nominal Bayar, "transaksi" = Per Transaksi. */
    mode: "nominal" | "transaksi";
    nominal: number;
    kartu: string[];
  }) => invoke<{ total: number; jumlah: number; kas: number }>("save_pelunasan", { input }),
};
