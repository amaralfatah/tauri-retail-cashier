import { open, save } from "@tauri-apps/plugin-dialog";

/** Pemilih file bawaan sistem. Mengembalikan null kalau dibatalkan atau tidak bisa dibuka. */
const satu = async (opsi: Parameters<typeof open>[0]): Promise<string | null> => {
  try {
    const r = await open({ multiple: false, ...opsi });
    return typeof r === "string" ? r : null;
  } catch {
    return null;
  }
};

export const pilihGambar = () =>
  satu({ title: "Pilih Gambar", filters: [{ name: "Graphic Files (*.bmp;*.gif;*.jpg;*.jpeg;*.png)", extensions: ["bmp", "gif", "jpg", "jpeg", "png"] }] });

export const pilihExcel = () =>
  satu({ title: "Pilih File Excel", filters: [{ name: "Excel (*.xlsx;*.xls;*.csv)", extensions: ["xlsx", "xls", "csv"] }] });

export const pilihDataLama = () =>
  satu({ title: "Pilih Data Toko Pro Lama", filters: [{ name: "Data Toko Pro lama (*.fdb;*.fdk)", extensions: ["fdb", "fdk"] }] });

export const pilihBackup = () =>
  satu({ title: "Pilih File Backup", filters: [{ name: "File Backup Toko Pro (*.db)", extensions: ["db"] }] });

export const pilihFolder = () => satu({ title: "Pilih Folder", directory: true });

export async function pilihSimpan(defaultPath: string, ext: string, nama: string): Promise<string | null> {
  try {
    return (await save({ title: "Simpan File", defaultPath, filters: [{ name: nama, extensions: [ext] }] })) ?? null;
  } catch {
    return null;
  }
}
