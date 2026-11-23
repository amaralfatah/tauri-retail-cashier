import { invoke } from "@/lib/panggil";

/** Penanda: komputer kasir ini masih punya foto Toko Pro lama yang belum dikirim ke Pusat (rancangan 8.3). */
export const KUNCI_FOTO_KIRIM = "tokopro.fotoKirim";

export const tandaiFotoLama = () => { try { localStorage.setItem(KUNCI_FOTO_KIRIM, "1"); } catch { /* penyimpanan tidak tersedia */ } };
export const adaFotoLama = () => { try { return localStorage.getItem(KUNCI_FOTO_KIRIM) === "1"; } catch { return false; } };

/**
 * Kirim foto Toko Pro lama di komputer kasir ini ke Pusat, hanya untuk barang yang belum punya foto di Pusat.
 * Foto di Pusat tidak pernah ditimpa. Perlu ada pengguna yang masuk; bila Pusat menolak (mis. akun tidak boleh
 * mengubah foto), penandanya dibiarkan dan dicoba lagi saat pengguna lain masuk. Mengembalikan jumlah foto terkirim.
 */
export async function kirimFotoLama(): Promise<number> {
  if (!adaFotoLama()) return 0;
  try {
    const berkas = await invoke<{ nama: string; path: string }[]>("lama_foto_daftar");
    const alamat = new Map(berkas.map((b) => [b.nama, b.path]));
    const r = await invoke<{ perlu: [string, string][] }>("foto_perlu_kirim", { daftar: berkas.map((b) => b.nama) });
    let terkirim = 0;
    for (const [nama, kode] of r.perlu) {
      const path = alamat.get(nama);
      if (path) { await invoke("foto_simpan", { kode, path, hapusAsal: false, hanyaBaru: true }); terkirim += 1; }
    }
    try { localStorage.removeItem(KUNCI_FOTO_KIRIM); } catch { /* penyimpanan tidak tersedia */ }
    return terkirim;
  } catch {
    return 0;
  }
}
