import { perintahTauri } from "@/lib/panggil";
import { terapkanJamPusat } from "@/format";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Awalan error yang berasal dari sambungan atau keadaan Pusat (bukan dari perintahnya). */
export const AWALAN_PUSAT = "[pusat] ";

export type StatusPusat = "belum-sambung" | "menyambung" | "tersambung" | "terputus" | "versi-beda" | "perawatan" | "ditolak";

/** Keadaan sambungan komputer kasir ke Pusat. Dikirim sebagai event `status-pusat` setiap kali berubah. */
export interface SambunganKasir {
  status: StatusPusat;
  pesan: string | null;
  pusat: string | null;
  namaPusat: string | null;
  alamat: string | null;
  versiPusat: string | null;
  sudahDisambung: boolean;
  /** Lokasi cadangan database lama di komputer ini, bila baru saja dijadikan Kasir dan sudah ada datanya. */
  cadangan?: string | null;
}

export type ModePusat = "tunggal" | "pusat" | "kasir";

/** Status komputer ini dari `pusat_status`. */
export interface StatusKomputer {
  mode: ModePusat;
  berjalan: boolean;
  perluMulaiUlang: boolean;
  port: number | null;
  /** Pesan bila server Pusat tidak bisa menyala (mis. jalurnya dipakai program lain). */
  galat: string | null;
  namaKomputer: string;
  kodeSambung: string | null;
  kodeSisaDetik: number | null;
  terimaOtomatisSisaDetik: number | null;
  /** Komputer yang sudah diterima tanpa kode dalam masa terima yang sedang terbuka, dan batasnya (null bila masanya tertutup). */
  terimaOtomatisDiterima: number | null;
  terimaOtomatisMaks: number | null;
  alamatIp: string[];
  /** Izin firewall Windows untuk port Pusat: "ada", "belum", "berbeda" (lokasi program atau port berubah), atau "tidak-perlu" (bukan Pusat, atau bukan Windows). */
  izinFirewall: "ada" | "belum" | "berbeda" | "tidak-perlu";
  kasir: SambunganKasir;
  /** Instalasi baru yang belum memilih peran: tampilkan layar pilihan awal. */
  perluPilihan: boolean;
  /** Jumlah komputer kasir yang tersambung (hanya di Pusat). */
  kasirTersambung?: number;
  cadangan?: string | null;
}

export interface PerangkatKasir {
  id: number;
  namaKomputer: string;
  dibuat: number;
  terakhirTerlihat: number;
  otomatis: boolean;
  pengguna: string | null;
}

export const pusat = {
  status: () => perintahTauri<StatusKomputer>("pusat_status"),
  /** Pilihan peran saat pertama dibuka (sebelum ada yang masuk). Hanya diterima sekali. */
  awalPilih: (mode: ModePusat, namaPusat?: string) => perintahTauri<StatusKomputer>("awal_pilih", { mode, pusat: namaPusat ?? null }),
  /** Ganti peran komputer ini. Hanya Manager yang masuk. Untuk Kasir pakai `kasir.atur`. */
  aturMode: (mode: ModePusat) => perintahTauri<StatusKomputer>("pusat_atur_mode", { mode, port: null }),
  /** Minta izin firewall Windows untuk port Pusat. Windows menampilkan dialog izin administrator. */
  beriIzin: () => perintahTauri<StatusKomputer>("pusat_beri_izin"),
  kodeBaru: () => perintahTauri<{ kode: string; berlakuDetik: number }>("pusat_kode_baru"),
  perangkat: () => perintahTauri<PerangkatKasir[]>("pusat_perangkat"),
  putuskan: (id: number) => perintahTauri<void>("pusat_putuskan", { id }),
  /** Tutup masa terima komputer kasir tanpa kode ("Selesai menyambungkan"). */
  tutupTerimaOtomatis: () => perintahTauri<void>("pusat_terima_otomatis", { buka: false }),
};

export const kasir = {
  /** Jadikan komputer ini komputer kasir yang menyambung ke `pusat` (nama komputer atau IP). */
  atur: (pusat: string, port?: number) => perintahTauri<SambunganKasir>("kasir_atur", { pusat, port: port ?? null }),
  /** Sambungkan dengan kode dari komputer Pusat. Kode kosong hanya diterima saat Pusat membuka masa terima komputer baru. */
  sambung: (kode?: string) => perintahTauri<SambunganKasir>("kasir_sambung", { kode: kode ?? null }),
  /** Nama komputer Pusat dari Toko Pro lama di komputer ini (untuk isian awal), atau null. */
  namaLama: () => perintahTauri<string | null>("kasir_nama_lama"),
  /** Pantau perubahan status sambungan. */
  pantau: (aksi: (s: SambunganKasir) => void): Promise<UnlistenFn> => listen<SambunganKasir>("status-pusat", (e) => aksi(e.payload)),
};

export const dariPusat = (pesan: string): boolean => pesan.startsWith(AWALAN_PUSAT);

/** Tanggal dan jam Pusat dari perintah lokal `jam_pusat` (rancangan 4.3). */
export interface JamPusat {
  tanggal: string;
  jam: string;
  /** Tanggal dan jam dinding Pusat, `YYYY-MM-DD HH:MM:SS`, tanpa zona waktu. */
  dinding: string;
  selisihDetik: number;
  selisihMs: number;
  /** Selisih lebih dari 2 menit: bilah atas menampilkan "Jam di komputer ini berbeda dengan Pusat". */
  berbeda: boolean;
  dariPusat: boolean;
}

/** Ambil jam dinding Pusat lalu pakai untuk `today()`. Dipanggil saat dibuka dan setiap status Pusat berubah. Selisih kembali ke nol bila bukan dari Pusat. */
export async function sinkronJamPusat(): Promise<JamPusat | null> {
  try {
    const j = await perintahTauri<JamPusat | null>("jam_pusat");
    terapkanJamPusat(j);
    return j ?? null;
  } catch {
    return null;
  }
}

/** Hasil `lama_deteksi`: Toko Pro lama di komputer ini dan peran komputer ini menurut `Settings.ini`-nya (rancangan 8.1). */
export type DeteksiLama =
  | { ada: false }
  | { ada: true; peran: "pusat" | "kasir" | "tidakJelas"; pusat: string | null; folder: string; terbuka: boolean };

export interface RingkasanPindah {
  barang: number;
  transaksi: number;
  pelanggan: number;
  pengguna: number;
  foto: { tersalin: number; tidakCocok: number; gagal: number };
  cadangan: string;
  peringatan: string[];
  /** Pesan bila server Pusat tidak bisa menyala (mis. jalurnya dipakai program lain). */
  galatServer: string | null;
  /** Pesan bila izin firewall Windows tidak diberikan (komputer tetap jadi Pusat). */
  izinWindows: string | null;
}

export type TungguPusat = { status: "tersambung" | "perawatan" | "perlu-kode" | "menunggu"; pesan?: string };

export interface PengaturanLama {
  ada: boolean;
  /** Isi `Settings.ini` lama: kunci huruf kecil tanpa nama bagian. */
  nilai?: Record<string, string>;
  fotoFolder?: string | null;
}

export const lama = {
  deteksi: () => perintahTauri<DeteksiLama>("lama_deteksi"),
  terbuka: (folder: string) => perintahTauri<boolean>("lama_terbuka", { folder }),
  /** Ambil data lama, salin foto, lalu jadikan komputer ini Pusat. `paksa`: abaikan peran dari Settings.ini lama (komputer yang dianggap kasir tetapi datanya ada di sini). Kemajuan lewat event `pindah-lama`. */
  pusatMulai: (paksa = false) => perintahTauri<RingkasanPindah>("lama_pusat_mulai", { paksa }),
  pengaturan: () => perintahTauri<PengaturanLama>("lama_pengaturan"),
  /** Satu percobaan menyambung ke Pusat tanpa kode (rancangan 8.5). */
  tungguPusat: () => perintahTauri<TungguPusat>("kasir_tunggu_pusat"),
  pantauKemajuan: (aksi: (p: { nama: string; ke: number; dari: number }) => void): Promise<UnlistenFn> => listen("pindah-lama", (e) => aksi(e.payload as { nama: string; ke: number; dari: number })),
};
