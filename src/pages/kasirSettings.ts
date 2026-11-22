import { getLocal } from "./localSettings";

/** Terapkan pola angka gaya VB (mis. ###,##0.00) pada sebuah angka, dengan pemisah Indonesia. */
export function polaAngka(pola: string, n: number): string {
  const des = (pola.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: des, maximumFractionDigits: des, useGrouping: pola.includes(",") }).format(Number(n) || 0);
}

export const fmtQtyStruk = (n: unknown) => polaAngka(getLocal("formatQty"), Number(n));
export const fmtHrgStruk = (n: unknown) => polaAngka(getLocal("formatHrg"), Number(n));

export interface Kertas {
  /** CSS: lebar area cetak. */
  lebar: string;
  /** Nilai size pada @page. */
  halaman: string;
  fontPx: number;
  /** Jumlah huruf per baris pada teks pratinjau. */
  kolom: number;
}

/** Ukuran kertas struk dari pengaturan Peralatan ("Mini Printer 56mm-58mm", "Mini Printer 75mm-80mm", "Kertas A4", "Kertas A5"). */
export function kertasStruk(ukuran = getLocal("ukuranKertas")): Kertas {
  if (/58/.test(ukuran)) return { lebar: "48mm", halaman: "58mm auto", fontPx: 10, kolom: 32 };
  if (/A4/i.test(ukuran)) return { lebar: "180mm", halaman: "A4", fontPx: 13, kolom: 42 };
  if (/A5/i.test(ukuran)) return { lebar: "128mm", halaman: "A5", fontPx: 12, kolom: 42 };
  return { lebar: "72mm", halaman: "80mm auto", fontPx: 11, kolom: 42 };
}
