import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { errText } from "../api";
import { kasirApi } from "../api/kasir";
import { ModalFrame } from "../vb/VbGrid";
import { Alert } from "./Modal";

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

  return (
    <ModalFrame title="Verifikasi Admin" width={400} onClose={props.onBatal}>
      <div
        ref={box}
        data-form="FrmZOtentikasi"
        className="flex flex-col gap-3.5 p-4 font-sans text-xs text-foreground"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
          e.preventDefault();
          const vb = e.target.closest("[data-vb]")?.getAttribute("data-vb");
          if (vb === "tNamaUser") box.current?.querySelector<HTMLInputElement>('[data-vb="tSandi"] input')?.focus();
          else void login();
        }}
      >
        {props.alasan && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {props.alasan}
          </div>
        )}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1" data-vb="tNamaUser">
            <Label className="text-xs font-medium text-foreground">Nama User</Label>
            <Input value={nama} disabled={busy} onChange={(e) => setNama(e.target.value)} placeholder="Nama user supervisor / admin" className="h-8 text-xs" />
          </div>
          <div className="flex flex-col gap-1" data-vb="tSandi">
            <Label className="text-xs font-medium text-foreground">Kata Sandi</Label>
            <Input type="password" value={sandi} disabled={busy} onChange={(e) => setSandi(e.target.value)} placeholder="Kata sandi" className="h-8 text-xs" />
          </div>
        </div>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={props.onBatal}>
            <span>Batal</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cLogin" disabled={busy} className="h-8 gap-1.5 px-3.5 text-xs font-semibold" onClick={() => void login()}>
            <span>Login</span>
            <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}
