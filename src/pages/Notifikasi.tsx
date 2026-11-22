import { useCallback, useEffect, useRef, useState } from "react";
import { dashApi } from "../api/dashboard";
import { today } from "../format";
import { formCaption } from "../vb/VbForm";
import notif from "../vb/icons/notif.png";
import "./notifikasi.css";

/** Lama jendela tampil (frmNotification asli muncul dari bawah layar, lalu turun lagi). */
const TAMPIL_MS = 8000;

/**
 * Jendela pemberitahuan kecil di kanan bawah (frmNotification). Dicek satu kali saat jendela utama terbuka
 * setelah masuk, dan satu kali lagi tiap tombol Notification di Dashboard ditekan. Kalau tidak ada piutang jatuh tempo, tidak ada yang tampil (seperti aslinya). Tidak ada pengecekan berkala.
 * Isinya: piutang yang sudah jatuh tempo. Klik jendelanya untuk membuka Pelunasan Piutang.
 */
export function Notifikasi(props: { aktif: boolean; onBuka: () => void }) {
  const [jml, setJml] = useState(0);
  const [naik, setNaik] = useState(false);
  const [ada, setAda] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const cek = useCallback(async () => {
    try {
      const r = await dashApi.notifikasi(today());
      const n = Number(r.piutang_jatuh_tempo) || 0;
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
    <div className={`notif no-print ${naik ? "naik" : ""}`} role="status" onTransitionEnd={() => !naik && setAda(false)}
      onClick={() => { setNaik(false); if (jml > 0) props.onBuka(); }} title={formCaption("frmNotification")}>
      <img src={notif} alt="" width={32} height={32} />
      <div className="notif-teks">
        <div className="notif-judul">Notifikasi</div>
        <div className="notif-isi">
          {`Ditemukan piutang jatuh tempo sebanyak ${jml} transaksi, klik disini untuk melakukan proses pembayaran piutang.`}
        </div>
      </div>
    </div>
  );
}
