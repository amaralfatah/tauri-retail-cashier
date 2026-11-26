/** Daftar laporan yang bisa dibuka dari menu Laporan dan dialog filter aslinya. */
export type Kind =
  | "jual_detil" | "jual_harian" | "jual_bulanan" | "jual_barang" | "piutang"
  | "beli_detil" | "beli_harian" | "beli_bulanan" | "beli_supplier" | "hutang"
  | "lr_trans" | "lr_harian" | "lr_bulanan" | "kas" | "lr_komparatif"
  | "stok" | "stok_detil" | "stok_max" | "stok_min"
  | "order_jual" | "order_beli" | "jual_sales" | "retur_jual" | "retur_beli"
  | "pelunasan_piutang" | "pelunasan_hutang" | "terlaris" | "omset" | "opname";

export interface LapDef { kind: Kind; form: string; title: string; jenis?: string }

/** Kunci = kolom NAMAMENU pada menu asli. */
export const LAPORAN: Record<string, LapDef> = {
  mnLapPenjualanDetil: { kind: "jual_detil", form: "FrmFilterPenjualan", title: "Daftar Transaksi Penjualan", jenis: "jual_detil" },
  mnLapPenjualanHarian: { kind: "jual_harian", form: "FrmFilterPenjualan", title: "Daftar Penjualan Harian", jenis: "jual_head" },
  mnLapPenjualanBulanan: { kind: "jual_bulanan", form: "FrmFilterPenjualan", title: "Daftar Penjualan Bulanan", jenis: "jual_head" },
  mnLapPenjualanBarang: { kind: "jual_barang", form: "FrmFilterTransaksiBarang", title: "Daftar Penjualan per Barang", jenis: "jual_barang" },
  mnLapPenjualanPiutang: { kind: "piutang", form: "FrmFilterPenjualanPiutang", title: "Daftar Piutang Penjualan", jenis: "piutang" },
  mnLapPembelianDetil: { kind: "beli_detil", form: "FrmFilterPembelian", title: "Transaksi Pembelian", jenis: "beli_detil" },
  mnLapPembelianHarian: { kind: "beli_harian", form: "FrmFilterPembelian", title: "Daftar Pembelian Harian", jenis: "beli_head" },
  mnLapPembelianBualanan: { kind: "beli_bulanan", form: "FrmFilterPembelian", title: "Daftar Pembelian Bulanan", jenis: "beli_head" },
  mnLapPembelianSupplier: { kind: "beli_supplier", form: "FrmFilterPembelian", title: "Daftar Pembelian per Supplier", jenis: "beli_head" },
  mnLapPembelianHutang: { kind: "hutang", form: "FrmFilterPembelianHutang", title: "Daftar Hutang Pembelian", jenis: "hutang" },
  mnLapInvStok: { kind: "stok", form: "FrmFilterBarang", title: "Daftar Barang" },
  mnLapInvBrgDetil: { kind: "stok_detil", form: "FrmFilterBarang", title: "Daftar Barang Detil" },
  mnLapInvMax: { kind: "stok_max", form: "FrmFilterBarang", title: "Daftar Barang di atas Stok Maksimum" },
  mnLapInvMin: { kind: "stok_min", form: "FrmFilterBarang", title: "Daftar Barang di bawah Stok Minimal" },
  mnLapPenjualanOrder: { kind: "order_jual", form: "FrmFilterPenjualan", title: "Order Penjualan", jenis: "order_jual" },
  mnLapPembelianOrder: { kind: "order_beli", form: "FrmFilterPembelian", title: "Order Pembelian", jenis: "order_beli" },
  mnLapPenjualanSales: { kind: "jual_sales", form: "FrmFilterPenjualan", title: "Daftar Penjualan per Sales", jenis: "jual_sales" },
  mnLapPenjualanRetur: { kind: "retur_jual", form: "FrmFilterPenjualan", title: "Retur Penjualan", jenis: "retur_jual" },
  mnLapPembelianRetur: { kind: "retur_beli", form: "FrmFilterPembelian", title: "Retur Pembelian", jenis: "retur_beli" },
  mnLapPenjualanPelunasan: { kind: "pelunasan_piutang", form: "FrmFilterPenjualanPiutang", title: "Daftar Pelunasan Piutang", jenis: "pelunasan_piutang" },
  mnLapPembelianPelunasan: { kind: "pelunasan_hutang", form: "FrmFilterPembelianHutang", title: "Daftar Pelunasan Hutang", jenis: "pelunasan_hutang" },
  mnLapInvTerlaris: { kind: "terlaris", form: "FrmFilterBarang", title: "Daftar Barang Terlaris", jenis: "terlaris" },
  mnLapInvOmset: { kind: "omset", form: "FrmFilterBarang", title: "Daftar Penjualan Barang dengan Omset Tertinggi", jenis: "omset" },
  mnLapInvStokOpname: { kind: "opname", form: "FrmFilterTransaksiBarang", title: "Daftar Stok Opname", jenis: "opname" },
  mnLapLRPerTrans: { kind: "lr_trans", form: "FrmFilterLabaRugi", title: "Daftar Laba Rugi per Transaksi", jenis: "lr_detil" },
  mnLapLRHarian: { kind: "lr_harian", form: "FrmFilterLabaRugi", title: "Daftar Laba Rugi Harian", jenis: "lr_head" },
  mnLapLRBulanan: { kind: "lr_bulanan", form: "FrmFilterLabaRugi", title: "Daftar Laba Rugi per Bulan", jenis: "lr_head" },
  mnLapLRKas: { kind: "lr_komparatif", form: "", title: "LABA RUGI KOMPARATIF", jenis: "lr_komparatif" },
};

/** Stok maksimum dan minimum aslinya hanya membandingkan stok akhir dengan batasnya (`stokakhir>stokmax`, `stokakhir<=stokmin`), tanpa saringan jenis. */
export const lewatBatas = (kind: Kind, r: Record<string, unknown>) =>
  kind === "stok_max" ? Number(r.stokakhir) > Number(r.stokmax) : kind === "stok_min" ? Number(r.stokakhir) <= Number(r.stokmin) : true;
/** Urutan asli: selisih stok terhadap batas, terbesar dahulu (maksimum) atau terkecil dahulu (minimum). */
export const selisihBatas = (kind: Kind, r: Record<string, unknown>) =>
  kind === "stok_max" ? Number(r.stokakhir) - Number(r.stokmax) : Number(r.stokakhir) - Number(r.stokmin);

/** Tab lama (sebelum menu asli dipakai) ke menu laporan yang setara. */
export const TAB_LAMA: Record<string, string> = {
  penjualan: "mnLapPenjualanDetil", pembelian: "mnLapPembelianDetil", stok: "mnLapInvStok",
  kas: "mnLapLRKas", piutang: "mnLapPenjualanPiutang", hutang: "mnLapPembelianHutang",
};

/** Laporan yang boleh dibuka kasir: penjualan dan stok. */
export const KASIR_BOLEH = new Set(["jual_detil", "jual_harian", "jual_bulanan", "jual_barang", "stok", "stok_detil", "stok_max", "stok_min"]);

/**
 * Kertas cetak tiap laporan. Semua laporan aslinya (ActiveReports) memakai A4 atau printer bawaan;
 * hanya Daftar Barang Detil (RptDaftarBarang2, lebar 370 mm) yang berorientasi mendatar.
 * Lebar cetak aslinya 205 mm di atas kertas 210 mm, jadi marginnya sangat tipis (dibulatkan ke 5 mm
 * karena printer tidak bisa mencetak sampai ke tepi).
 */
export interface KertasDef { ukuran: "A4"; arah: "portrait" | "landscape"; lebar: number; tinggi: number; margin: number }
export function kertasLaporan(kind: Kind): KertasDef {
  const mendatar = kind === "stok_detil";
  return { ukuran: "A4", arah: mendatar ? "landscape" : "portrait", lebar: mendatar ? 297 : 210, tinggi: mendatar ? 210 : 297, margin: 5 };
}
