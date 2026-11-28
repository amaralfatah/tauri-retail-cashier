import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useApp } from "../appContext";
import { pasangPembaruan, tutupPembaruan, usePembaruan, type Kemajuan } from "../lib/pembaruan";
import { ModalFrame } from "../vb/VbGrid";

const mb = (n: number) => `${(n / 1048576).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
const JUDUL = "Versi Baru KasirJet";

/** Dialog pembaruan: menjelaskan, mengunduh dengan kemajuan, lalu memasang dan membuka ulang aplikasi. Dipasang sekali di App. */
export function PembaruanDialog() {
  const { baru, dialog, kasir } = usePembaruan();
  const { user } = useApp();
  const [fase, setFase] = useState<"tanya" | "unduh" | "gagal">("tanya");
  const [k, setK] = useState<Kemajuan>({ unduh: 0, total: null });
  const sedang = useRef(false);
  if (!dialog || !baru) return null;

  const manager = user.level === "Manager" || kasir; // Komputer Kasir hanya bisa naik ke versi Pusat, jadi semua akun boleh.
  const tutup = () => { setFase("tanya"); tutupPembaruan(); };
  const mulai = async () => {
    if (sedang.current) return;
    sedang.current = true;
    setK({ unduh: 0, total: null });
    setFase("unduh");
    try {
      await pasangPembaruan(setK);
      tutup(); // Sampai sini hanya di simulasi: aplikasi asli sudah dibuka ulang oleh pasangPembaruan.
    } catch (e) {
      console.warn("[pembaruan] gagal memasang:", e);
      setFase("gagal");
    } finally {
      sedang.current = false;
    }
  };

  if (fase === "unduh") {
    const selesai = k.total !== null && k.unduh >= k.total;
    const persen = k.total ? Math.min(100, Math.round((k.unduh / k.total) * 100)) : 0;
    return (
      <ModalFrame title={JUDUL} width={460}>
        <div className="flex flex-col gap-3 p-4 text-sm" aria-live="polite">
          <p className="font-semibold">{selesai ? "Memasang versi baru…" : "Mengunduh versi baru…"}</p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={persen} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${selesai ? 100 : persen}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {k.total ? `${mb(k.unduh)} dari ${mb(k.total)}` : k.unduh > 0 ? mb(k.unduh) : "Mohon tunggu"}
          </p>
          <p className="text-xs text-muted-foreground">Jangan matikan komputer. Aplikasi akan tertutup lalu terbuka lagi sendiri.</p>
        </div>
      </ModalFrame>
    );
  }

  const nanti = (
    <Button type="button" variant="outline" size="default" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={tutup}>
      {manager ? "Nanti" : "Tutup"} <Kbd>Esc</Kbd>
    </Button>
  );

  return (
    <ModalFrame title={JUDUL} width={500} onClose={tutup}
      footer={manager ? (
        <>
          {nanti}
          <Button type="button" variant="default" size="default" autoFocus className="h-8 px-4 text-xs font-semibold" onClick={() => void mulai()}>
            {fase === "gagal" ? "Coba Lagi" : "Perbarui Sekarang"}
          </Button>
        </>
      ) : nanti}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="font-semibold">Versi {baru.versi} sudah tersedia.</p>
        <p className="text-xs text-muted-foreground tabular-nums">Dari versi {baru.sekarang} ke versi {baru.versi}.</p>

        {fase === "gagal" && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-xs font-medium text-destructive">
            Versi baru belum berhasil diunduh. Periksa koneksi internet Anda, lalu coba lagi.
          </p>
        )}

        {baru.catatan && (
          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold">Yang baru</div>
            <div className="max-h-40 overflow-auto rounded-md border border-border bg-card px-3 py-2 text-xs leading-relaxed whitespace-pre-line">{baru.catatan}</div>
          </div>
        )}

        {manager ? (
          <div className="flex flex-col gap-1 rounded-md bg-muted p-3 text-xs">
            <p>Aplikasi akan tertutup sebentar, lalu terbuka lagi sendiri.</p>
            {kasir
              ? <p>Versi ini disamakan dengan komputer Pusat. Data toko tetap aman di sana.</p>
              : <p>Data toko Anda aman. Program menyimpan salinannya otomatis sebelum memperbarui.</p>}
            <p className="font-semibold">Selesaikan dulu transaksi yang sedang berjalan.</p>
          </div>
        ) : (
          <p className="rounded-md bg-muted p-3 text-xs font-medium">Minta akun Manager untuk memperbarui aplikasi.</p>
        )}
      </div>
    </ModalFrame>
  );
}
