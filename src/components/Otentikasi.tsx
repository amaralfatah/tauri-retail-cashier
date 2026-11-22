import { useEffect, useRef, useState } from "react";
import { errText } from "../api";
import { kasirApi } from "../api/kasir";
import { VbWindow, formCaption, formSize } from "../vb/VbForm";
import { Alert } from "./Modal";

const FORM = "FrmZOtentikasi";

/**
 * Verifikasi Admin (FrmZOtentikasi): supervisor atau pemilik toko memasukkan nama user dan kata sandi
 * untuk mengizinkan hal yang dibatasi bagi Kasir. `onOk` menerima tanda izin sekali pakai dari server.
 */
export function Otentikasi(props: { alasan?: string; onOk: (tanda: string) => void; onBatal: () => void }) {
  const [nama, setNama] = useState("");
  const [sandi, setSandi] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { box.current?.querySelector<HTMLInputElement>('[data-vb="tNamaUser"] input')?.focus(); }, []);

  const login = async () => {
    if (busy) return;
    if (!nama.trim() || !sandi) return setErr("Isi nama user dan kata sandi supervisor dulu.");
    setBusy(true);
    setErr("");
    try {
      props.onOk(await kasirApi.verifikasiAdmin(nama.trim(), sandi));
    } catch (e) {
      setErr(errText(e));
      setSandi("");
      box.current?.querySelector<HTMLInputElement>('[data-vb="tSandi"] input')?.focus();
    } finally {
      setBusy(false);
    }
  };

  // Esc membatalkan; ditangkap lebih dulu supaya tidak ikut menutup dialog di belakangnya.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onBatal(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const { width, height } = formSize(FORM);
  return (
    <div className="modal-backdrop no-print" style={{ zIndex: 60 }}>
      <div ref={box} style={{ width: width + 2 }}
        onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); void login(); } }}>
        <VbWindow form={FORM} title={formCaption(FORM)} onClose={props.onBatal} bind={{
          tNamaUser: { value: nama, onChange: setNama },
          tSandi: { value: sandi, onChange: setSandi },
          cLogin: { onClick: () => void login(), disabled: busy },
          cBatal: { onClick: props.onBatal },
        }} />
        <div style={{ background: "#f0f0f0", border: "1px solid #7a7a7a", borderTop: 0, padding: "6px 10px", font: "12px Tahoma, sans-serif", minHeight: 0, maxHeight: height }}>
          {props.alasan && !err && <div>{props.alasan}</div>}
          <Alert>{err}</Alert>
        </div>
      </div>
    </div>
  );
}
