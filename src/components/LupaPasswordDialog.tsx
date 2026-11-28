import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { api, errText, User } from "../api";
import { useStatusPusat } from "../lib/statusPusat";
import { Alert } from "./Modal";

interface AkunManager { iduser: string; nama: string }

/**
 * Lupa kata sandi Manager tanpa internet: aplikasi menampilkan kode permintaan, pemilik toko mengirimnya ke pengembang
 * lewat WA, lalu mengetik kode reset yang dibalas. Kalau cocok, pemilik membuat kata sandi baru dan langsung masuk.
 */
export function LupaPasswordDialog(props: { onSelesai: (u: User) => void; onTutup: () => void }) {
  const { komputer } = useStatusPusat();
  const diKasir = komputer?.mode === "kasir";
  const [daftar, setDaftar] = useState<AkunManager[] | null>(null);
  const [iduser, setIduser] = useState("");
  const [kode, setKode] = useState("");
  const [kodeReset, setKodeReset] = useState("");
  const [baru, setBaru] = useState("");
  const [ulang, setUlang] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [tersalin, setTersalin] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Daftar Manager dimuat sekali. Kalau hanya satu, langsung terpilih.
  useEffect(() => {
    if (diKasir || !komputer) return;
    let batal = false;
    api.resetDaftarManager().then((d) => {
      if (batal) return;
      setDaftar(d);
      if (d.length === 1) setIduser(d[0].iduser);
    }).catch((e) => { if (!batal) { setDaftar([]); setErr(errText(e)); } });
    return () => { batal = true; };
  }, [diKasir, komputer]);

  // Kode permintaan dibuat (atau diambil lagi bila masih berlaku) setiap akun dipilih.
  useEffect(() => {
    setKode("");
    if (!iduser) return;
    let batal = false;
    api.resetMintaKode(iduser).then((k) => { if (!batal) { setKode(k); setErr(""); } }).catch((e) => { if (!batal) setErr(errText(e)); });
    return () => { batal = true; };
  }, [iduser]);

  useEffect(() => {
    if (kode) root.current?.querySelector<HTMLInputElement>('[data-vb="kodeReset"] input')?.focus();
  }, [kode]);

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(kode);
      setTersalin(true);
      window.setTimeout(() => setTersalin(false), 2000);
    } catch {
      toast.error("Kode belum bisa disalin. Catat kodenya dari layar.");
    }
  };

  const simpan = async () => {
    if (busy) return;
    if (!kodeReset.trim()) return setErr("Kode reset belum diisi.");
    if (!baru) return setErr("Kata sandi baru belum diisi.");
    if (baru !== ulang) return setErr("Kata sandi baru dan ulangannya belum sama.");
    setBusy(true);
    setErr("");
    try {
      const u = await api.resetPeriksa(iduser, kodeReset, baru);
      toast.success("Kata sandi sudah diganti. Selamat datang kembali.");
      props.onSelesai(u);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  let isi;
  if (diKasir) {
    isi = <p className="text-sm text-foreground">Silakan lakukan dari komputer Pusat.</p>;
  } else if (daftar === null) {
    isi = <p className="text-sm text-muted-foreground">Sebentar, KasirJet sedang menyiapkan.</p>;
  } else if (daftar.length === 0) {
    isi = (
      <p className="text-sm text-foreground">
        Belum ada akun Manager yang aktif di komputer ini, jadi kata sandi belum bisa direset di sini. Hubungi pengembang KasirJet untuk bantuan.
      </p>
    );
  } else {
    isi = (
      <>
        {daftar.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-foreground">Akun Manager yang lupa kata sandi</Label>
            <NativeSelect className="w-full" value={iduser} onChange={(e) => setIduser(e.target.value)} disabled={busy}>
              <option value="">Pilih akun...</option>
              {daftar.map((a) => <option key={a.iduser} value={a.iduser}>{a.nama === a.iduser ? a.iduser : `${a.nama} (${a.iduser})`}</option>)}
            </NativeSelect>
          </div>
        )}
        {daftar.length === 1 && (
          <div className="text-sm text-foreground">
            Akun: <span className="font-semibold">{daftar[0].nama === daftar[0].iduser ? daftar[0].iduser : `${daftar[0].nama} (${daftar[0].iduser})`}</span>
          </div>
        )}
        {kode && (
          <>
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-3xl font-bold tracking-widest text-foreground tabular-nums" data-vb="kodePermintaan">{kode}</span>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={salin}>
                  {tersalin ? <CheckIcon /> : <CopyIcon />}
                  <span>{tersalin ? "Tersalin" : "Salin"}</span>
                </Button>
              </div>
              <p className="text-xs text-foreground">
                Kirim kode ini ke pengembang KasirJet lewat WA. Setelah Anda menerima kode reset, ketik di bawah ini.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5" data-vb="kodeReset">
                <Label className="text-xs font-medium text-foreground">Kode reset dari pengembang</Label>
                <Input
                  value={kodeReset}
                  disabled={busy}
                  onChange={(e) => setKodeReset(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 border-foreground/25 bg-background font-mono text-sm tracking-wider tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1.5" data-vb="baru">
                <Label className="text-xs font-medium text-foreground">Kata Sandi Baru</Label>
                <Input type="password" value={baru} disabled={busy} onChange={(e) => setBaru(e.target.value)} autoComplete="new-password" className="h-8 border-foreground/25 bg-background text-xs" />
              </div>
              <div className="flex flex-col gap-1.5" data-vb="ulang">
                <Label className="text-xs font-medium text-foreground">Ulangi Kata Sandi</Label>
                <Input type="password" value={ulang} disabled={busy} onChange={(e) => setUlang(e.target.value)} autoComplete="new-password" className="h-8 border-foreground/25 bg-background text-xs" />
              </div>
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2.5 bg-muted/60"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); props.onTutup(); }
        else if (e.key === "Enter" && kode && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); void simpan(); }
      }}
    >
      <div className="vb-modern flex w-[440px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="flex h-9 flex-none items-center gap-2 border-b bg-muted/40 pr-1.5 pl-3 select-none">
          <span className="flex-1 truncate text-sm font-medium">Lupa Kata Sandi</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onTutup}><XIcon /></Button>
        </div>
        <div className="flex flex-col gap-3.5 p-5 font-sans text-xs text-foreground">
          {isi}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" className="h-8 min-w-20 text-xs font-medium" onClick={props.onTutup}>
              <span>Tutup</span>
              <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            {kode && !diKasir && (
              <Button type="button" className="h-8 min-w-28 text-xs font-semibold" disabled={busy} onClick={simpan}>
                <span>Ganti dan Masuk</span>
                <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
              </Button>
            )}
          </div>
        </div>
      </div>
      {err && <div className="w-[440px] max-w-[95vw]"><Alert>{err}</Alert></div>}
    </div>
  );
}
