import { invoke } from "@tauri-apps/api/core";
import { folderBackup } from "./keuangan";

/** Pilihan "Auto Backup saat keluar aplikasi". Disimpan per komputer, seperti di aplikasi lama. */
const KEY_AUTO = "tokopro.autoBackup";
export const autoBackup = {
  get: (): boolean => { try { return localStorage.getItem(KEY_AUTO) === "1"; } catch { return false; } },
  set: (v: boolean) => { try { if (v) localStorage.setItem(KEY_AUTO, "1"); else localStorage.removeItem(KEY_AUTO); } catch { /* penyimpanan tidak tersedia */ } },
};

/**
 * Buat cadangan otomatis kalau pilihannya aktif. Dipanggil sebelum keluar dari program, selagi pengguna masih masuk.
 * Tidak pernah melempar error supaya program tetap bisa ditutup; mengembalikan lokasi file cadangan, atau null.
 */
export async function cadanganSaatKeluar(): Promise<string | null> {
  if (!autoBackup.get()) return null;
  try {
    const r = await invoke<{ path: string }>("backup_otomatis", { folder: folderBackup.get() || null, simpan: 10 });
    return r.path;
  } catch {
    return null;
  }
}
