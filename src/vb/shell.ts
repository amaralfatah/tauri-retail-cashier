import {
  ChartColumnIcon, CircleHelpIcon, HouseIcon, LogOutIcon, type LucideIcon, PackageIcon, PowerIcon,
  SettingsIcon, ShoppingCartIcon, TruckIcon, WalletIcon, WarehouseIcon,
} from "lucide-react";
import menuData from "./menu.json";
import type { MasterTable } from "../api";
import type { Tab } from "../pages/Laporan";

export type Page = "panduan" | "keuangan" | "database" | "alat" | "poin" | "nontunai" | "stokawal" | "barcode" | "pricetag" | "katalog" | "promodiskon" | "promobonus" | "promopdp" | "home" | "jual" | "beli" | "orderjual" | "orderbeli" | "opname" | "master" | "satuan" | "kelompok" | "kategori" | "laporan" | "pengaturan" | "pengguna" | "returjual" | "returbeli" | "returbelibrg" | "piutang" | "hutang";

export interface MenuNode { id: string; nama: string; caption: string; children: MenuNode[] }
export const MENU = menuData as MenuNode[];

export interface Target { page: Page; tab?: MasterTable | Tab }

/** Menu yang diawali garis pemisah, seperti di menu aplikasi lama. */
export const SEP_BEFORE: ReadonlySet<string> = new Set([
  "mnMDDataSupplier", "mnTRReturJual", "mnTRReturBeliPerTrans", "mnTRPelunasanHutang", "mnInvCetakBarcode", "mnInvPromoJual",
]);

/** Menu asli (kolom namamenu) ke halaman yang sudah ada. */
export const TARGETS: Record<string, Target> = {
  mnMDDataBarang: { page: "master", tab: "mdbarang" },
  mnMDDataKelompok: { page: "kelompok" },
  mnMDDataKategori: { page: "kategori" },
  mnMDDataSatuan: { page: "satuan" },
  mnMDDataSupplier: { page: "master", tab: "mdpemasok" },
  mnMDDataPelanggan: { page: "master", tab: "mdpelanggan" },
  mnMDDataKaryawan: { page: "master", tab: "mdkaryawan" },
  mnMDDataJenisNonTunai: { page: "nontunai" },
  mnTRTrPenjualan: { page: "jual" },
  mnTRPelunasanPiutang: { page: "piutang" },
  mnTRReturJual: { page: "returjual" },
  mnTRReturBeliPerTrans: { page: "returbeli" },
  mnTRReturBeliperBarang: { page: "returbelibrg" },
  mnTRTransPembelian: { page: "beli" },
  mnTROrderJual: { page: "orderjual" },
  mnTROrderPembelian: { page: "orderbeli" },
  mnTRPelunasanHutang: { page: "hutang" },
  mnInvStokOpname: { page: "opname" },
  mnInvStokAwal: { page: "stokawal" },
  mnInvCetakBarcode: { page: "barcode" },
  mnInvCetakPriceTag: { page: "pricetag" },
  mnInvKatalogBrg: { page: "katalog" },
  mnInvPromoJual: { page: "promodiskon" },
  mnInvPromoBonus: { page: "promobonus" },
  mnLapPenjualanDetil: { page: "laporan", tab: "penjualan" },
  mnLapPenjualanHarian: { page: "laporan", tab: "penjualan" },
  mnLapPenjualanBulanan: { page: "laporan", tab: "penjualan" },
  mnLapPenjualanBarang: { page: "laporan", tab: "penjualan" },
  mnLapPenjualanPiutang: { page: "laporan", tab: "piutang" },
  mnLapPembelianDetil: { page: "laporan", tab: "pembelian" },
  mnLapPembelianHarian: { page: "laporan", tab: "pembelian" },
  mnLapPembelianBualanan: { page: "laporan", tab: "pembelian" },
  mnLapPembelianSupplier: { page: "laporan", tab: "pembelian" },
  mnLapPembelianHutang: { page: "laporan", tab: "hutang" },
  mnLapInvStok: { page: "laporan", tab: "stok" },
  mnLapInvBrgDetil: { page: "laporan", tab: "stok" },
  mnLapInvMax: { page: "laporan", tab: "stok" },
  mnLapInvMin: { page: "laporan", tab: "stok" },
  mnLapLRKas: { page: "laporan", tab: "kas" },
  mnLapLRPerTrans: { page: "laporan", tab: "labarugi" },
  mnLapLRHarian: { page: "laporan", tab: "labarugi" },
  mnLapLRBulanan: { page: "laporan", tab: "labarugi" },
  mnLapPenjualanOrder: { page: "laporan", tab: "lain" },
  mnLapPembelianOrder: { page: "laporan", tab: "lain" },
  mnLapPenjualanSales: { page: "laporan", tab: "lain" },
  mnLapPenjualanRetur: { page: "laporan", tab: "lain" },
  mnLapPembelianRetur: { page: "laporan", tab: "lain" },
  mnLapPenjualanPelunasan: { page: "laporan", tab: "lain" },
  mnLapPembelianPelunasan: { page: "laporan", tab: "lain" },
  mnLapInvTerlaris: { page: "laporan", tab: "lain" },
  mnLapInvOmset: { page: "laporan", tab: "lain" },
  mnLapInvStokOpname: { page: "laporan", tab: "lain" },
  mnKeuangan: { page: "keuangan" },
  mnPengaturanDatabase: { page: "database" },
  mnPengaturanAlat: { page: "alat" },
  mnPengaturanProgram: { page: "pengaturan" },
  mnPengaturanPengguna: { page: "pengguna" },
  mnBantuanPanduan: { page: "panduan" },
};

/**
 * Hanya dialog kecil (Pengaturan Database) yang tampil sebagai modal;
 * layar kerja lainnya tampil full-size memenuhi ruang kerja utama.
 */
export const DIALOG_FORM: Partial<Record<Page, string>> = {
  database: "FrmZDatabase",
};
export const isDialog = (p: Page) => p in DIALOG_FORM;

/** Halaman dan tab laporan yang boleh dibuka kasir. */
export const KASIR_PAGES: Page[] = ["home", "jual", "keuangan", "laporan", "pengaturan", "panduan"];
export const KASIR_LAPORAN: string[] = ["penjualan", "stok"];

/**
 * Apakah menu boleh dibuka. `ditolak` = menu yang dimatikan di Hak Akses pengguna (dimuat saat masuk);
 * kasir tetap dibatasi aturan halaman kasir di atas.
 */
export function allowedFor(kasir: boolean, node: MenuNode, ditolak?: ReadonlySet<string>): boolean {
  if (node.children.length) return node.children.some((c) => allowedFor(kasir, c, ditolak));
  if (ditolak?.has(node.nama)) return false;
  const t = TARGETS[node.nama];
  if (!kasir) return true;
  if (!t || !KASIR_PAGES.includes(t.page)) return false;
  return t.page !== "laporan" || KASIR_LAPORAN.includes(t.tab as string);
}

/**
 * Tombol bilah alat utama (tbMenu) dan menu yang dibukanya.
 * Ikon dari Lucide (sama dengan ikon lain di aplikasi), jadi mengganti ikon cukup mengganti satu nama di sini.
 */
export interface ToolBtn { key: string; caption: string; icon: LucideIcon; menu?: string; sepBefore?: boolean }
export const TOOLBAR: ToolBtn[] = [
  { key: "home", caption: "Home", icon: HouseIcon },
  { key: "logoff", caption: "Log Off", icon: LogOutIcon },
  { key: "master", caption: "Master Data", icon: PackageIcon, menu: "mnMasterData", sepBefore: true },
  { key: "jual", caption: "Penjualan", icon: ShoppingCartIcon, menu: "mnTRPenjualan" },
  { key: "beli", caption: "Pembelian", icon: TruckIcon, menu: "mnTRPembelian" },
  { key: "inv", caption: "Inventori", icon: WarehouseIcon, menu: "mnInventori" },
  { key: "lap", caption: "Laporan", icon: ChartColumnIcon, menu: "mnLaporan" },
  { key: "keu", caption: "Keuangan", icon: WalletIcon, menu: "mnKeuangan" },
  { key: "atur", caption: "Pengaturan", icon: SettingsIcon, menu: "mnPengaturan", sepBefore: true },
  { key: "bantu", caption: "Bantuan", icon: CircleHelpIcon, menu: "mnBantuan" },
  { key: "keluar", caption: "Keluar", icon: PowerIcon, sepBefore: true },
];

/** Caption jendela anak untuk halaman tanpa pilihan menu (sama dengan caption form aslinya). */
export const DEFAULT_CAPTION: Record<Page, string> = {
  panduan: "Panduan Penggunaan",
  keuangan: "Transaksi Kas",
  database: "Pengaturan Database",
  alat: "Alat Bantu",
  poin: "Transaksi Penukaran Poin",
  nontunai: "Data Jenis Non Tunai",
  satuan: "Data Satuan",
  kelompok: "Data Kelompok",
  kategori: "Data Kategori",
  returjual: "Transaksi Retur Penjualan",
  returbeli: "Transaksi Retur Pembelian",
  returbelibrg: "Retur Pembelian per Barang",
  piutang: "Pelunasan Piutang",
  hutang: "Pelunasan Hutang",
  home: "Home",
  jual: "Transaksi Penjualan",
  beli: "Transaksi Pembelian",
  orderjual: "Order Penjualan",
  orderbeli: "Order Pembelian",
  opname: "Stok Opname",
  master: "Data Barang",
  laporan: "Laporan",
  pengaturan: "Pengaturan Program",
  pengguna: "Daftar Pengguna",
  stokawal: "Stok Awal",
  barcode: "Cetak Barcode",
  pricetag: "Cetak Price Tag",
  katalog: "Katalog Barang",
  promodiskon: "Data Barang Diskon",
  promobonus: "Data Barang Bonus",
  promopdp: "Data Barang Diskon PDP",
};
