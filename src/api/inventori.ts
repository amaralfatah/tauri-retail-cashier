import { invoke } from "@tauri-apps/api/core";
import type { Row } from "../api";

export type PromoJenis = "diskon" | "bonus" | "pdp";

export interface PromoRowIn {
  bid?: number | null;
  kodebarang: string;
  minbeli?: number;
  kodebonus?: string;
  jmlbonus?: number;
  minbelanja?: number;
  diskon?: number;
  hrgdiskon?: number;
  tglawal: string;
  tglakhir: string;
}

export const inventoriApi = {
  saveStokAwal: (tgl: string, catatan: string, items: { kodebarang: string; stokawal: number }[], kodekasir?: string) =>
    invoke<{ notrans: string; jumlah: number }>("save_stok_awal", { tgl, catatan, items, kodekasir }),
  saveOpname: (tgl: string, catatan: string, items: { kodebarang: string; stokbuku: number; stokfisik: number }[], kodekasir?: string) =>
    invoke<{ notrans: string; jumlah: number }>("save_opname_stok", { tgl, catatan, items, kodekasir }),
  labelFind: (code: string) => invoke<Row | null>("label_barang_find", { code }),
  barangLabel: (kodes: string[], tgl: string) => invoke<Row[]>("barang_label", { kodes, tgl }),
  katalog: (search = "") => invoke<Row[]>("katalog_barang", { search }),
  promoList: (jenis: PromoJenis, dari?: string, sampai?: string) => invoke<Row[]>("promo_list", { jenis, dari, sampai }),
  promoSave: (jenis: PromoJenis, data: PromoRowIn[]) => invoke<{ jumlah: number }>("promo_save", { jenis, data }),
  promoDelete: (jenis: PromoJenis, bid: number) => invoke<void>("promo_delete", { jenis, bid }),
};
