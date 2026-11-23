import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { tanyaCobaLagi } from "@/lib/cobaLagi";
import { idBaru, perintahSimpan } from "@/lib/perintahSimpan";

/** Saluran kemajuan untuk perintah Tauri yang mengirim kejadian berkala (mis. unduhan pembaruan). */
export { Channel } from "@tauri-apps/api/core";

const AWALAN_PUSAT = "[pusat] ";
const BELUM_PASTI = "belum tahu apakah";

const teksError = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "");

/**
 * Pintu tunggal ke backend. Semua perintah data lewat satu perintah Tauri, `jalankan`,
 * yang meneruskannya ke perintah bernama `cmd`. Untuk perintah simpan, `idPermintaan` menandai satu tombol simpan:
 * setiap pemanggilan mendapat ID baru, dan ID yang sama hanya dipakai ulang di dalam pemanggilan ini, saat pengguna memilih
 * "Coba Lagi" (rancangan 4.2). Isi perintah tidak pernah dipakai untuk mengenali ulangan, jadi dua penjualan yang isinya sama
 * tetap dua transaksi. Pusat memakai ID itu untuk memeriksa dulu apakah simpan yang sama sudah selesai.
 * Di komputer kasir, simpan yang gagal karena Pusat tidak terjangkau memunculkan dialog Coba Lagi; layar pemanggil
 * baru mendapat hasilnya setelah pengguna memilih (isian di layar itu tidak berubah).
 */
export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>, idPermintaan?: string): Promise<T> {
  const simpan = perintahSimpan(cmd);
  const id = idPermintaan ?? (simpan ? idBaru() : undefined);
  for (;;) {
    try {
      return await invokeTauri<T>("jalankan", { perintah: cmd, args: args ?? {}, idPermintaan: id });
    } catch (e) {
      const teks = teksError(e);
      const pasti = !teks.includes(BELUM_PASTI);
      // Hanya pesan dari sambungan ke Pusat yang menawarkan Coba Lagi. Kode salah dan perangkat dicabut tidak akan membaik dengan diulang.
      if (!simpan || !teks.startsWith(AWALAN_PUSAT) || !/coba lagi/i.test(teks)) throw e;
      if (!(await tanyaCobaLagi(teks.slice(AWALAN_PUSAT.length), pasti))) {
        // Dialog ditutup: layar pemanggil menampilkan pesannya. Menekan Simpan lagi adalah simpan baru dengan ID baru, jadi bila
        // hasilnya belum pasti, pengguna diminta memeriksa dulu daftar transaksi.
        throw new Error(pasti ? teks.replace(/Tekan Coba Lagi/i, "Tekan Simpan lagi") : teks.replace(/Tekan Coba Lagi\..*$/i, "Lihat dulu daftar transaksi sebelum menyimpan lagi."));
      }
    }
  }
}

/** Perintah Tauri yang berdiri sendiri (bukan perintah data), mis. `kasir_sambung` dan `pusat_status`. */
export function perintahTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invokeTauri<T>(cmd, args);
}
