import { useEffect } from "react";
import {
  BanIcon, ClockAlertIcon, ServerIcon, TriangleAlertIcon, UnplugIcon, WifiIcon, WifiOffIcon, WrenchIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { JamPusat, StatusKomputer } from "@/api/pusat";
import { bacaVersi, bukaPembaruan, cekPembaruan, usePembaruan } from "../lib/pembaruan";
import { bandingVersi, useStatusPusat } from "../lib/statusPusat";

export type Nada = "success" | "warning" | "destructive";
export interface Ringkasan { ikon: LucideIcon; nada: Nada; teks: string; singkat: string; kedip?: boolean }

export const WARNA_NADA: Record<Nada, { teks: string; titik: string }> = {
  success: { teks: "text-success", titik: "bg-success" },
  warning: { teks: "text-warning", titik: "bg-warning" },
  destructive: { teks: "text-destructive", titik: "bg-destructive" },
};

/** Ringkasan status untuk ikon di bilah atas, status bar, dan layar Komputer Pusat (rancangan 7.2). `null` di mode Tunggal. */
export function ringkasStatus(k: StatusKomputer | null): Ringkasan | null {
  if (!k || k.mode === "tunggal") return null;
  if (k.mode === "pusat") {
    if (k.galat) return { ikon: TriangleAlertIcon, nada: "warning", teks: k.galat, singkat: "Pusat" };
    if (k.izinFirewall === "belum" || k.izinFirewall === "berbeda") {
      return { ikon: TriangleAlertIcon, nada: "warning", singkat: "Pusat", teks: "Pusat · komputer kasir belum bisa tersambung, izin Windows belum ada" };
    }
    const n = k.kasirTersambung ?? 0;
    return { ikon: ServerIcon, nada: "success", singkat: "Pusat",
      teks: n > 0 ? `Pusat · ${n} komputer kasir tersambung` : "Pusat · belum ada komputer kasir yang tersambung" };
  }
  const nama = k.kasir.namaPusat || k.kasir.pusat || "Pusat";
  switch (k.kasir.status) {
    case "tersambung": return { ikon: WifiIcon, nada: "success", teks: `Tersambung ke ${nama}`, singkat: "Tersambung" };
    case "menyambung": return { ikon: WifiIcon, nada: "warning", kedip: true, teks: `Menyambung lagi ke ${nama}…`, singkat: "Menyambung" };
    case "terputus": return { ikon: WifiOffIcon, nada: "destructive", teks: "Pusat tidak terjangkau", singkat: "Terputus" };
    case "versi-beda": return { ikon: TriangleAlertIcon, nada: "warning", teks: "Versi Toko Pro berbeda dengan Pusat", singkat: "Versi beda" };
    case "perawatan": return { ikon: WrenchIcon, nada: "warning", teks: "Pusat sedang memulihkan data", singkat: "Perawatan" };
    case "ditolak": return { ikon: BanIcon, nada: "destructive", teks: "Diputus dari Pusat", singkat: "Diputus" };
    default: return { ikon: UnplugIcon, nada: "warning", teks: `Belum tersambung ke ${nama}`, singkat: "Belum tersambung" };
  }
}

/** Peringatan bila jam komputer ini berbeda dengan Pusat (rancangan 7.2). `null` bila jam cocok atau bukan komputer kasir. */
export function teksJamBeda(j: JamPusat | null): string | null {
  if (!j?.berbeda || !j.dariPusat) return null;
  const menit = Math.max(1, Math.round(Math.abs(j.selisihDetik) / 60));
  return `Jam di komputer ini berbeda ${menit} menit dengan Pusat`;
}

/** Ikon status di bilah atas. Tidak tampil di mode Tunggal. Klik membuka layar Komputer Pusat. */
export function IkonStatusPusat(props: { onBuka: () => void }) {
  const { komputer, jam } = useStatusPusat();
  const r = ringkasStatus(komputer);
  const jamBeda = teksJamBeda(jam);
  if (!r) return null;
  const Ikon = r.ikon;
  return (
    <>
      {jamBeda && (
        <Button type="button" variant="ghost" size="icon-sm" data-slot="ikon-jam-beda" aria-label={jamBeda} title={jamBeda}
          className="h-8 text-warning hover:bg-foreground/6 hover:text-warning" onMouseDown={(e) => e.preventDefault()} onClick={props.onBuka}>
          <ClockAlertIcon />
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" data-slot="ikon-status-pusat" aria-label={r.teks} title={r.teks}
        className="relative h-8 gap-1.5 px-2 text-[13px] font-medium text-foreground/80 hover:bg-foreground/6 hover:text-foreground"
        onMouseDown={(e) => e.preventDefault()} onClick={props.onBuka}>
        <Ikon className={cn("size-4", WARNA_NADA[r.nada].teks)} />
        <span className="hidden @min-[1300px]/nav:inline">{r.singkat}</span>
        <span aria-hidden className={cn("absolute top-1 right-1 size-2 rounded-full ring-2 ring-muted", WARNA_NADA[r.nada].titik, r.kedip && "animate-pulse")} />
      </Button>
    </>
  );
}

/** Garis peringatan di atas layar kerja: versi berbeda (dengan arah ke pembaruan) dan jam berbeda. Tidak ada di mode Tunggal. */
export function PeringatanPusat(props: { onBuka: () => void }) {
  const { komputer, jam } = useStatusPusat();
  const { versi } = usePembaruan();
  useEffect(() => { if (komputer?.mode === "kasir") void bacaVersi(); }, [komputer?.mode]);
  if (komputer?.mode !== "kasir") return null;
  const baris: { kunci: string; ikon: LucideIcon; teks: string; aksi?: React.ReactNode }[] = [];
  if (komputer.kasir.status === "versi-beda") {
    const pusatBaru = !!versi && !!komputer.kasir.versiPusat && bandingVersi(komputer.kasir.versiPusat, versi) > 0;
    baris.push({
      kunci: "versi", ikon: TriangleAlertIcon,
      teks: komputer.kasir.pesan || "Versi Toko Pro di komputer ini berbeda dengan Pusat.",
      aksi: pusatBaru ? (
        <Button type="button" size="sm" className="h-7 px-3 text-xs font-semibold" onClick={() => { void cekPembaruan().then(() => bukaPembaruan()); }}>
          Perbarui Sekarang
        </Button>
      ) : undefined,
    });
  }
  const jamBeda = teksJamBeda(jam);
  if (jamBeda) {
    baris.push({
      kunci: "jam", ikon: ClockAlertIcon,
      teks: `${jamBeda}. Transaksi tetap memakai jam Pusat, tetapi sebaiknya benarkan jam Windows di komputer ini.`,
    });
  }
  if (!baris.length) return null;
  return (
    <div className="no-print flex flex-none flex-col" role="region" aria-label="Peringatan sambungan ke Pusat">
      {baris.map((b) => (
        <div key={b.kunci} className="flex items-center gap-2.5 border-b border-warning/40 bg-warning/15 px-3 py-1.5 text-xs text-foreground">
          <b.ikon aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="flex-1">{b.teks}</span>
          {b.aksi}
          <Button type="button" variant="outline" size="sm" className="h-7 px-3 text-xs font-medium" onClick={props.onBuka}>Lihat</Button>
        </div>
      ))}
    </div>
  );
}
