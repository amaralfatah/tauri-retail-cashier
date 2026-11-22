/**
 * Pengaturan per komputer. Aslinya disimpan di registry Windows; di sini di localStorage.
 * Nilai disimpan sebagai teks ("1"/"0" untuk kotak centang) di bawah kunci `tokopro.<nama>`.
 */
const PREFIX = "tokopro.";

export const LOCAL_DEFAULTS = {
  modeScan: "0",
  konfirmasiCetak: "0",
  formatQty: "###,##0.00",
  formatHrg: "###,##0",
  ukuranKertas: "Mini Printer 75mm-80mm",
  jnsPrinter: "Direct",
  jnsPort: "USB",
  portPrinter: "",
  drawer: "0",
  portDrawer: "",
  kodeDrawer: "",
  defaultJmlByr: "0",
  updateHargaJual: "0",
  autoLoad: "0",
  kursor: "0",
  aktifFoto: "0",
  lokasiFoto: "",
  home: "Home",
  aktifSkin: "0",
  logo: "",
  background: "",
};
export type LocalSettings = typeof LOCAL_DEFAULTS;
export type LocalKey = keyof LocalSettings;

export function getLocal<K extends LocalKey>(key: K): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? LOCAL_DEFAULTS[key];
  } catch {
    return LOCAL_DEFAULTS[key];
  }
}

export function setLocal(key: LocalKey, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch { /* penyimpanan tidak tersedia */ }
}

export const loadLocal = (): LocalSettings =>
  Object.fromEntries((Object.keys(LOCAL_DEFAULTS) as LocalKey[]).map((k) => [k, getLocal(k)])) as LocalSettings;

export function saveLocal(v: LocalSettings) {
  (Object.keys(v) as LocalKey[]).forEach((k) => setLocal(k, v[k]));
}
