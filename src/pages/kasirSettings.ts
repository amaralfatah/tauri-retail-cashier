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
  // 40 kolom seperti struk aplikasi lama (garis 40 karakter). Printer dot matrix 76/80 mm hanya muat 40 karakter;
  // dengan 42, dua karakter paling kanan (angka subtotal dan total) terpotong.
  return { lebar: "72mm", halaman: "80mm auto", fontPx: 11, kolom: 40 };
}

/** Pilihan "Lihat struk dulu" di dialog Bayar, per komputer. Bawaannya mati; pilihan yang sudah tersimpan tetap dipakai. */
export function getLihatStruk(): boolean {
  try {
    return localStorage.getItem("tokopro.lihatStruk") === "1";
  } catch {
    return false;
  }
}

export function setLihatStruk(on: boolean) {
  try {
    localStorage.setItem("tokopro.lihatStruk", on ? "1" : "0");
  } catch { /* penyimpanan tidak tersedia */ }
}

let audio: AudioContext | null = null;

/** Nada rendah pendek (sekitar 150 md) tanda barcode tidak dikenal. Diam saja kalau suara tidak tersedia. */
export function bunyiGagal() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.15);
  } catch { /* suara tidak tersedia */ }
}
