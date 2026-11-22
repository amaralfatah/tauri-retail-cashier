import { getLocal, setLocal } from "./localSettings";

/** Pengaturan per komputer: tampilkan kotak scan barcode di atas tabel kasir. Bawaannya mati. */
export function getModeScan(): boolean {
  return getLocal("modeScan") === "1";
}

export function setModeScan(on: boolean) {
  setLocal("modeScan", on ? "1" : "0");
}
