import { useSyncExternalStore } from "react";

/**
 * Dialog "Coba Lagi" untuk simpan yang gagal atau hasilnya belum pasti di komputer kasir (rancangan 4.2 dan 7.3).
 * `src/lib/panggil.ts` menunggu jawaban pengguna, jadi layar yang menyimpan tidak perlu diubah: isiannya tetap ada,
 * dan Coba Lagi memakai `idPermintaan` yang sama.
 */
export interface PertanyaanCobaLagi { pesan: string; pasti: boolean; jawab: (lagi: boolean) => void }

let sekarang: PertanyaanCobaLagi | null = null;
const antre: PertanyaanCobaLagi[] = [];
const pendengar = new Set<() => void>();
const kabari = () => pendengar.forEach((f) => f());
export const useCobaLagi = () => useSyncExternalStore((f) => { pendengar.add(f); return () => { pendengar.delete(f); }; }, () => sekarang);

/** Tampilkan dialog dan tunggu jawabannya: true = Coba Lagi, false = Tutup. `pasti` = Pusat sudah pasti belum menyimpan. */
export function tanyaCobaLagi(pesan: string, pasti: boolean): Promise<boolean> {
  return new Promise((selesai) => {
    const t: PertanyaanCobaLagi = {
      pesan, pasti,
      jawab: (lagi) => { sekarang = antre.shift() ?? null; kabari(); selesai(lagi); },
    };
    if (sekarang) antre.push(t); else { sekarang = t; kabari(); }
  });
}
