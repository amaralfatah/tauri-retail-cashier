import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errText, User } from "../api";
import { Alert } from "../components/Modal";
import { VbForm, formCaption, formSize } from "../vb/VbForm";
import "./Login.css";

/** Pindah fokus ke kontrol VB bernama `name` di dalam wadah. */
function focusCtl(root: HTMLElement | null, name: string) {
  (root?.querySelector(`[data-vb="${name}"] input, [data-vb="${name}"] button`) as HTMLElement | null)?.focus();
}

function Dialog(props: { title: string; width: number; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="vbl-dialog" style={{ width: props.width + 6 }}>
      <div className="vb-window-title">
        <span className="vb-window-caption">{props.title}</span>
        {props.onClose && <button type="button" className="vb-window-x" aria-label="Tutup" onClick={props.onClose}>×</button>}
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
  const root = useRef<HTMLDivElement>(null);
  const { width } = formSize("FrmZLogin");

  useEffect(() => { focusCtl(root.current, "tNamaUser"); }, []);

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

  return (
    <div className="vbl-screen" ref={root} onKeyDown={onKey}>
      <Dialog title={formCaption("FrmZLogin")} width={width} onClose={batal}>
        <VbForm
          form="FrmZLogin"
          bind={{
            tNamaUser: { value: iduser, onChange: setIduser, disabled: busy },
            tSandi: { value: password, onChange: setPassword, disabled: busy },
            lblNama: { text: props.namaUsaha || "Toko Pro" },
            cLogin: { onClick: masuk, disabled: busy },
            cBatal: { onClick: batal },
          }}
        />
      </Dialog>
      {err && <div className="vbl-err"><Alert>{err}</Alert></div>}
    </div>
  );
}

/** Dialog ganti kata sandi bergaya VB klasik (aslinya tidak ada form khusus, jadi memakai kontrol standar yang sama). */
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
  const top0 = props.wajib ? 56 : 20;
  const h = top0 + rows.length * 28 + 70;

  const body = (
    <div className="vbl-screen" ref={root}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void simpan(); } }}>
      <Dialog title={props.wajib ? "Buat Kata Sandi Baru" : "Ganti Kata Sandi"} width={380} onClose={props.onCancel}>
        <div className="vb-form vbl-gp" style={{ width: 380, height: h }}>
          {props.wajib && (
            <div className="vb-c vb-t-Label vbl-gp-note" style={{ left: 16, top: 12, width: 348, height: 36 }}>
              <div className="vb-label">Akun Anda masih memakai kata sandi sementara. Buat kata sandi baru dulu sebelum melanjutkan.</div>
            </div>
          )}
          {rows.map(([n, cap, val, set], i) => (
            <div key={n}>
              <div className="vb-c vb-t-Label" style={{ left: 16, top: top0 + i * 28 + 3, width: 130, height: 18 }}>
                <div className="vb-label">{cap}</div>
              </div>
              <div className="vb-c vb-t-TextBox" data-vb={n} style={{ left: 150, top: top0 + i * 28, width: 214, height: 21 }}>
                <input type="password" className="vb-txt" value={val} onChange={(e) => set(e.target.value)} autoComplete="off" />
              </div>
            </div>
          ))}
          <div className="vb-c vb-t-CommandButton" style={{ left: props.onCancel ? 150 : 244, top: h - 44, width: 77, height: 25 }}>
            <button type="button" className="vb-btn" onClick={simpan}>Simpan</button>
          </div>
          {props.onCancel && (
            <div className="vb-c vb-t-CommandButton" style={{ left: 287, top: h - 44, width: 77, height: 25 }}>
              <button type="button" className="vb-btn" onClick={props.onCancel}>Batal</button>
            </div>
          )}
        </div>
      </Dialog>
      {err && <div className="vbl-err"><Alert>{err}</Alert></div>}
    </div>
  );
  return body;
}
