import { useSyncExternalStore } from "react";
import { kasir, pusat, sinkronJamPusat, type JamPusat, type SambunganKasir, type StatusKomputer } from "@/api/pusat";

/**
 * Keadaan komputer ini terhadap Pusat, dipegang di satu tempat supaya ikon di bilah atas, peringatan,
 * layar Komputer Pusat, dan konfirmasi menutup selalu sama.
 */
interface Keadaan {
  /** Sudah pernah membaca status dari backend. */
  dimuat: boolean;
  komputer: StatusKomputer | null;
  jam: JamPusat | null;
}

let keadaan: Keadaan = { dimuat: false, komputer: null, jam: null };
const pendengar = new Set<() => void>();
const ubah = (p: Partial<Keadaan>) => { keadaan = { ...keadaan, ...p }; pendengar.forEach((f) => f()); };
export const useStatusPusat = () => useSyncExternalStore((f) => { pendengar.add(f); return () => { pendengar.delete(f); }; }, () => keadaan);

/** Baca ulang status dari backend. Tidak pernah melempar error. */
export async function muatStatusPusat(): Promise<StatusKomputer | null> {
  try {
    const s = await pusat.status();
    ubah({ dimuat: true, komputer: s });
    return s;
  } catch {
    ubah({ dimuat: true });
    return keadaan.komputer;
  }
}

export async function muatJamPusat(): Promise<void> {
  const j = await sinkronJamPusat();
  ubah({ jam: j });
}

/** Status Pusat sekarang (di luar komponen), mis. untuk konfirmasi menutup aplikasi. Selalu membaca ulang. */
export async function kasirTersambungSekarang(): Promise<number> {
  const s = await muatStatusPusat();
  return s?.mode === "pusat" ? (s.kasirTersambung ?? 0) : 0;
}

/**
 * Mulai memantau: status saat dibuka, event `status-pusat` dari komputer kasir, dan jumlah komputer kasir (di Pusat)
 * yang dibaca berkala. Jam Pusat dicek tiap kali status berubah dan tiap menit.
 */
export function mulaiPantauPusat(): () => void {
  void muatStatusPusat();
  void muatJamPusat();
  let batal = false;
  let lepas: (() => void) | null = null;
  void kasir.pantau((k: SambunganKasir) => {
    if (keadaan.komputer) ubah({ komputer: { ...keadaan.komputer, kasir: k } });
    void muatJamPusat();
  }).then((f) => { if (batal) f(); else lepas = f; }).catch(() => undefined);
  const t = window.setInterval(() => {
    if (keadaan.komputer?.mode === "pusat") void muatStatusPusat();
  }, 5000);
  const tj = window.setInterval(() => { void muatJamPusat(); }, 60000);
  return () => { batal = true; lepas?.(); window.clearInterval(t); window.clearInterval(tj); };
}

/** Bandingkan nomor versi "1.4.0" dengan "1.3.0": positif bila a lebih baru. */
export function bandingVersi(a: string, b: string): number {
  const x = a.split(".").map((n) => parseInt(n, 10) || 0), y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
}
