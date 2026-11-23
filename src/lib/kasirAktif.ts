import { createContext, useContext } from "react";

/**
 * Layar kasir dibiarkan hidup (disembunyikan) saat Anda membuka layar lain, supaya keranjang tidak hilang.
 * `aktif` false = layar sedang disembunyikan: jangan tanggapi tombol keyboard global.
 * `laporIsi(n)` memberi tahu aplikasi berapa baris yang ada di keranjang.
 */
export interface KasirAktif { aktif: boolean; laporIsi: (jumlahBaris: number) => void }
export const KasirAktifCtx = createContext<KasirAktif>({ aktif: true, laporIsi: () => undefined });
export const useKasirAktif = () => useContext(KasirAktifCtx);
