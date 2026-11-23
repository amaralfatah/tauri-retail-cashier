import { useCallback, useEffect, useRef, useState } from "react";
import { dashApi } from "../api/dashboard";
import { today } from "../format";
import { formCaption } from "../vb/VbForm";
import { TriangleAlertIcon, XIcon } from "lucide-react";

/** Lama jendela tampil (frmNotification asli muncul dari bawah layar, lalu turun lagi). */
const TAMPIL_MS = 8000;

/**
 * Jendela pemberitahuan kecil di kanan bawah (frmNotification). Dicek satu kali saat jendela utama terbuka
 * setelah masuk, dan satu kali lagi tiap tombol Notification di Dashboard ditekan. Kalau tidak ada piutang jatuh tempo, tidak ada yang tampil (seperti aslinya). Tidak ada pengecekan berkala.
 * Isinya: piutang yang sudah jatuh tempo. Klik jendelanya untuk membuka Pelunasan Piutang.
 */
/** `diKasir`: popup dinaikkan supaya tidak menutupi tombol Bayar di bilah bawah layar kasir. */
export function Notifikasi(props: { aktif: boolean; onBuka: () => void; diKasir?: boolean }) {
  const [jml, setJml] = useState(0);
  const [naik, setNaik] = useState(false);
  const [ada, setAda] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const cek = useCallback(async () => {
    try {
      const r = await dashApi.notifikasi(today());
      const n = Number(r?.piutang_jatuh_tempo) || 0;
      setJml(n);
      if (n > 0) {
        setAda(true);
        requestAnimationFrame(() => setNaik(true));
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setNaik(false), TAMPIL_MS);
      }
    } catch { /* tanpa pemberitahuan kalau data belum bisa dibaca */ }
  }, []);

  useEffect(() => {
    if (!props.aktif) { setNaik(false); setAda(false); return; }
    const awal = window.setTimeout(() => void cek(), 1500);
    const manual = () => void cek();
    window.addEventListener("tokopro:notifikasi", manual);
    return () => {
      window.clearTimeout(awal); window.clearTimeout(timer.current);
      window.removeEventListener("tokopro:notifikasi", manual);
    };
  }, [props.aktif, cek]);

  if (!props.aktif || !ada) return null;
  return (
    <div
      className={`no-print fixed right-3 ${props.diKasir ? "bottom-24" : "bottom-12"} z-50 flex w-80 cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3 font-sans text-xs text-card-foreground shadow-xl transition-transform duration-500 ease-out hover:border-primary/40 hover:bg-muted/60 ${naik ? "translate-y-0" : "translate-y-[calc(100%+40px)]"}`}
      role="status"
      onTransitionEnd={() => !naik && setAda(false)}
      onClick={() => { setNaik(false); if (jml > 0) props.onBuka(); }}
      title={formCaption("frmNotification")}
    >
      <TriangleAlertIcon aria-hidden className="size-7 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground">Notifikasi</div>
        <div className="mt-0.5 text-primary">
          {`Ada ${jml} piutang yang jatuh tempo. Klik di sini untuk melunasinya.`}
        </div>
      </div>
      <button
        type="button"
        data-slot="notif-tutup"
        aria-label="Tutup pemberitahuan"
        className="-mt-1 -mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); setNaik(false); }}
      >
        <XIcon aria-hidden className="size-4" />
      </button>
    </div>
  );
}
