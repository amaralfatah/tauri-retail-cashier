import { invoke } from "@/lib/panggil";
import type { Row } from "../api";

export const berkasApi = {
  eksporNama: (nama: string, ext?: string) => invoke<string>("ekspor_nama", { nama, ext }),
  simpanFile: (path: string, isi: string) => invoke<string>("simpan_file", { path, isi }),
  simpanXlsx: (path: string, lembar: string, judul: string[], angka: boolean[], baris: string[][]) => invoke<string>("simpan_xlsx", { path, lembar, judul, angka, baris }),
  fotoSimpan: (kode: string, path: string, hapusAsal = false) => invoke<string>("foto_simpan", { kode, path, hapusAsal }),
  bacaGambar: (path: string) => invoke<string>("baca_gambar", { path }),
  fotoBaca: (kode: string) => invoke<string | null>("foto_baca", { kode }),
  fotoHapus: (kode: string) => invoke<boolean>("foto_hapus", { kode }),
  userAkses: (iduser: string) => invoke<Row[]>("user_akses", { iduser }),
  saveUserAkses: (iduser: string, diizinkan: string[]) => invoke<void>("save_user_akses", { iduser, diizinkan }),
};
