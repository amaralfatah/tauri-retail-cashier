import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { Channel, perintahTauri } from "@/lib/panggil";

/**
 * Pembaruan aplikasi (plugin updater Tauri). Status dipegang di satu tempat supaya ikon di header,
 * pemberitahuan di Beranda, halaman Panduan, dan dialognya selalu sama.
 */
export interface VersiBaru { versi: string; sekarang: string; catatan: string }
export type HasilCek = "ada" | "terbaru" | "gagal";
export type Kemajuan = { unduh: number; total: number | null };

interface Status {
  baru: VersiBaru | null;
  /** Versi aplikasi yang sedang berjalan ("" sampai terbaca). */
  versi: string;
  dialog: boolean;
  mengecek: boolean;
  /** Versi yang pemberitahuan Berandanya sudah ditutup di komputer ini (selama aplikasi terbuka). */
  noticeDitutup: string;
  /** Komputer ini komputer Kasir: pembaruannya selalu ke versi Pusat, dan boleh dipasang semua akun (rancangan 6.4). */
  kasir: boolean;
}

let status: Status = { baru: null, versi: "", dialog: false, mengecek: false, noticeDitutup: "", kasir: false };
const pendengar = new Set<() => void>();
const ubah = (p: Partial<Status>) => { status = { ...status, ...p }; pendengar.forEach((f) => f()); };
export const usePembaruan = () => useSyncExternalStore((f) => { pendengar.add(f); return () => { pendengar.delete(f); }; }, () => status);

export const diJendelaTauri = () => "__TAURI_INTERNALS__" in window && !("__TOKOPRO_MOCK__" in window);
/** Di browser biasa saat pengembangan, `?simulasiUpdate=1` memunculkan versi baru palsu untuk melihat tampilannya. */
const simulasi = () => {
  if (!import.meta.env.DEV || diJendelaTauri()) return false;
  const q = new URLSearchParams(window.location.search);
  // `?simulasiPusat=versi-beda` juga memunculkan versi baru palsu, supaya jalur "Perbarui Sekarang" di komputer kasir bisa dilihat.
  return q.has("simulasiUpdate") || q.get("simulasiPusat") === "versi-beda";
};

let tertunda: Pick<Update, "downloadAndInstall"> | null = null;

export async function bacaVersi(): Promise<string> {
  try {
    const v = await getVersion();
    if (v) ubah({ versi: v });
    return v;
  } catch { return ""; }
}

async function modeKasir(): Promise<boolean> {
  try {
    const s = await perintahTauri<{ mode?: string } | null>("pusat_status");
    return s?.mode === "kasir";
  } catch { return false; }
}

/** Tanda markdown dibuang: catatan rilis ditampilkan sebagai teks biasa. */
export function catatanBersih(body: string | undefined): string {
  if (!body) return "";
  const bagian = body.match(/^#{1,4}\s*Yang baru\s*\n([\s\S]*?)(?=\n#{1,4}\s|$)/im);
  return (bagian ? bagian[1] : body)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}

/** Memeriksa versi baru. Tidak pernah melempar error: kegagalan (mis. tidak ada internet) hanya dicatat di console. */
export async function cekPembaruan(): Promise<HasilCek> {
  if (status.mengecek) return status.baru ? "ada" : "terbaru";
  ubah({ mengecek: true });
  try {
    const sekarang = (await bacaVersi()) || status.versi;
    if (simulasi()) {
      await new Promise((r) => setTimeout(r, 400));
      tertunda = {
        async downloadAndInstall(onEvent) {
          const total = 24_000_000;
          onEvent?.({ event: "Started", data: { contentLength: total } });
          for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 120)); onEvent?.({ event: "Progress", data: { chunkLength: total / 30 } }); }
          onEvent?.({ event: "Finished" });
          if (new URLSearchParams(window.location.search).get("simulasiUpdate") === "gagal") throw new Error("simulasi gagal");
        },
      };
      ubah({ baru: { versi: "9.9.9", sekarang: sekarang || "0.1.0", catatan: "• Tampilan kasir lebih cepat.\n• Laporan penjualan bisa dicetak per hari.\n• Perbaikan kecil lainnya." } });
      return "ada";
    }
    if (!diJendelaTauri()) return "terbaru";
    if (await modeKasir()) {
      // Komputer Kasir hanya boleh naik ke versi Pusat, jadi pengecekannya lewat Rust (alamat rilis sesuai versi Pusat).
      ubah({ kasir: true });
      const info = await perintahTauri<{ version: string; currentVersion: string; body?: string } | null>("pembaruan_pusat_cek");
      if (!info) { tertunda = null; ubah({ baru: null }); return "terbaru"; }
      tertunda = {
        async downloadAndInstall(onEvent) {
          const saluran = new Channel<Parameters<NonNullable<typeof onEvent>>[0]>();
          if (onEvent) saluran.onmessage = onEvent;
          await perintahTauri("pembaruan_pusat_pasang", { kemajuan: saluran });
        },
      };
      ubah({ baru: { versi: info.version, sekarang: info.currentVersion || sekarang, catatan: catatanBersih(info.body) } });
      return "ada";
    }
    ubah({ kasir: false });
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    if (!u) { tertunda = null; ubah({ baru: null }); return "terbaru"; }
    tertunda = u;
    ubah({ baru: { versi: u.version, sekarang: u.currentVersion || sekarang, catatan: catatanBersih(u.body) } });
    return "ada";
  } catch (e) {
    console.warn("[pembaruan] gagal memeriksa versi baru:", e);
    return "gagal";
  } finally {
    ubah({ mengecek: false });
  }
}

/** Pemeriksaan pertama: diam-diam beberapa detik setelah aplikasi terbuka. Hanya di aplikasi terpasang (bukan `tauri dev`). */
export function mulaiCekOtomatis(): () => void {
  if (!simulasi() && (import.meta.env.DEV || !diJendelaTauri())) return () => undefined;
  const t = window.setTimeout(() => { void cekPembaruan(); }, 8000);
  return () => window.clearTimeout(t);
}

export const bukaPembaruan = () => ubah({ dialog: true });
export const tutupPembaruan = () => ubah({ dialog: false });
export const tutupNotice = () => { if (status.baru) ubah({ noticeDitutup: status.baru.versi }); };

/** Unduh, pasang, lalu buka ulang aplikasi. Melempar error kalau unduhan atau pemasangan gagal. */
export async function pasangPembaruan(onKemajuan: (k: Kemajuan) => void): Promise<void> {
  if (!tertunda) throw new Error("tidak ada pembaruan");
  let unduh = 0;
  let total: number | null = null;
  await tertunda.downloadAndInstall((e) => {
    if (e.event === "Started") { total = e.data.contentLength ?? null; onKemajuan({ unduh: 0, total }); }
    else if (e.event === "Progress") { unduh += e.data.chunkLength; onKemajuan({ unduh, total }); }
  });
  if (simulasi()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
