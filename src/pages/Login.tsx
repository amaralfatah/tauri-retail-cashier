import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { api, errText, User } from "../api";
import { Alert } from "../components/Modal";
import { LupaPasswordDialog } from "../components/LupaPasswordDialog";
import { formCaption } from "../vb/VbForm";

/** Pindah fokus ke kontrol bernama `name` di dalam wadah. */
function focusCtl(root: HTMLElement | null, name: string) {
  (root?.querySelector(`[data-vb="${name}"] input, [data-vb="${name}"] button`) as HTMLElement | null)?.focus();
}

function Dialog(props: { title: string; width: number; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      style={{ width: props.width }}
      className="vb-modern flex max-w-[95vw] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl"
    >
      <div className="flex h-9 flex-none items-center gap-2 border-b bg-muted/40 pr-1.5 pl-3 select-none">
        <span className="flex-1 truncate text-sm font-medium">{props.title}</span>
        {props.onClose && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      {props.children}
    </div>
  );
}

export function Login(props: { namaUsaha?: string; onLogin: (u: User) => void }) {
  const [iduser, setIduser] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lupa, setLupa] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!lupa) focusCtl(root.current, "tNamaUser"); }, [lupa]);

  const masuk = async () => {
    if (busy) return;
    if (!iduser.trim()) { setErr("Nama user belum diisi."); focusCtl(root.current, "tNamaUser"); return; }
    setBusy(true);
    setErr("");
    try {
      props.onLogin(await api.login(iduser, password));
    } catch (e) {
      setErr(errText(e));
      setPassword("");
      focusCtl(root.current, "tSandi");
    } finally {
      setBusy(false);
    }
  };

  const batal = async () => {
    try { await getCurrentWindow().close(); } catch { window.close(); }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); void batal(); return; }
    if (e.key !== "Enter") return;
    const name = (e.target as HTMLElement).closest("[data-vb]")?.getAttribute("data-vb");
    if (name === "tNamaUser") { e.preventDefault(); focusCtl(root.current, "tSandi"); }
    else if (name === "tSandi") { e.preventDefault(); void masuk(); }
  };

  if (lupa) return <LupaPasswordDialog onTutup={() => setLupa(false)} onSelesai={props.onLogin} />;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2.5 bg-muted/60" ref={root} onKeyDown={onKey}>
      <Dialog title={formCaption("FrmZLogin")} width={400} onClose={batal}>
        <div className="flex flex-col gap-4 p-5 font-sans text-xs text-foreground" data-form="FrmZLogin">
          <div className="border-b border-border pb-3">
            <div className="text-base font-bold text-foreground" data-vb="lblNama">{props.namaUsaha || "KasirJet"}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Masukkan Nama User dan Kata Sandi untuk melanjutkan</div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5" data-vb="tNamaUser">
              <Label className="text-xs font-medium text-foreground">Nama User</Label>
              <Input
                value={iduser}
                disabled={busy}
                onChange={(e) => setIduser(e.target.value)}
                placeholder="Nama user"
                className="h-8 border-foreground/25 bg-background text-xs"
              />
            </div>
            <div className="flex flex-col gap-1.5" data-vb="tSandi">
              <Label className="text-xs font-medium text-foreground">Kata Sandi</Label>
              <Input
                type="password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata sandi"
                className="h-8 border-foreground/25 bg-background text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <div data-vb="cBatal">
              <Button type="button" variant="outline" size="default" className="h-8 min-w-20 text-xs font-medium" onClick={batal}>
                <span>Batal</span>
                <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
              </Button>
            </div>
            <div data-vb="cLogin">
              <Button type="button" variant="default" size="default" disabled={busy} className="h-8 min-w-24 text-xs font-semibold" onClick={masuk}>
                <span>Login</span>
                <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
              </Button>
            </div>
          </div>
          <div className="-mt-1 flex justify-center">
            <Button type="button" variant="link" size="sm" disabled={busy} className="h-6 text-xs" onClick={() => setLupa(true)}>
              Lupa kata sandi?
            </Button>
          </div>
        </div>
      </Dialog>
      {err && <div className="w-[400px] max-w-[95vw]"><Alert>{err}</Alert></div>}
    </div>
  );
}

/** Dialog ganti kata sandi. */
export function GantiPassword(props: { wajib?: boolean; onDone: () => void; onCancel?: () => void }) {
  const [old, setOld] = useState(props.wajib ? "admin" : "");
  const [nw, setNw] = useState("");
  const [ulang, setUlang] = useState("");
  const [err, setErr] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { focusCtl(root.current, props.wajib ? "baru" : "lama"); }, [props.wajib]);

  const simpan = async () => {
    if (!nw) return setErr("Kata sandi baru belum diisi.");
    if (nw !== ulang) return setErr("Kata sandi baru dan ulangannya belum sama.");
    try {
      await api.changePassword(old, nw);
      props.onDone();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const rows: [string, string, string, (v: string) => void][] = [];
  if (!props.wajib) rows.push(["lama", "Kata Sandi Lama", old, setOld]);
  rows.push(["baru", "Kata Sandi Baru", nw, setNw], ["ulang", "Ulangi Kata Sandi", ulang, setUlang]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2.5 bg-muted/60" ref={root}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); void simpan(); }
        else if (e.key === "Escape" && props.onCancel) { e.preventDefault(); props.onCancel(); }
      }}>
      <Dialog title={props.wajib ? "Buat Kata Sandi Baru" : "Ganti Kata Sandi"} width={400} onClose={props.onCancel}>
        <div className="flex flex-col gap-3.5 p-5 font-sans text-xs text-foreground">
          {props.wajib && (
            <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Akun Anda masih memakai kata sandi sementara. Buat kata sandi baru dulu sebelum melanjutkan.
            </div>
          )}
          {rows.map(([n, cap, val, set]) => (
            <div key={n} className="flex flex-col gap-1.5" data-vb={n}>
              <Label className="text-xs font-medium text-foreground">{cap}</Label>
              <Input type="password" value={val} onChange={(e) => set(e.target.value)} autoComplete="off" className="h-8 border-foreground/25 bg-background text-xs" />
            </div>
          ))}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            {props.onCancel && (
              <Button type="button" variant="outline" size="default" className="h-8 min-w-20 text-xs font-medium" onClick={props.onCancel}>
                <span>Batal</span>
                <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
              </Button>
            )}
            <Button type="button" size="default" className="h-8 min-w-24 text-xs font-semibold" onClick={simpan}>
              <span>Simpan</span>
              <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            </Button>
          </div>
        </div>
      </Dialog>
      {err && <div className="w-[400px] max-w-[95vw]"><Alert>{err}</Alert></div>}
    </div>
  );
}
