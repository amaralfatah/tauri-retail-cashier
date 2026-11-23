import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getLocal } from "../pages/localSettings";

/**
 * Ukuran tampilan per komputer: memperbesar seluruh jendela (huruf, tabel, tombol) secara merata,
 * seperti zoom di browser. Satu pengaturan global, bukan per layar, supaya semua layar tetap konsisten.
 */
export const UKURAN_TAMPILAN: ReadonlyArray<readonly [string, string]> = [
  ["100", "Normal (100%)"],
  ["115", "Besar (115%)"],
  ["125", "Sangat besar (125%)"],
];

export async function terapkanUkuran(nilai: string = getLocal("ukuranTampilan")) {
  const f = (Number(nilai) || 100) / 100;
  try {
    await getCurrentWebview().setZoom(f);
  } catch {
    /* bukan di jendela Tauri */
  }
}
