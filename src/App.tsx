import { useCallback, useEffect, useRef, useState } from "react";
import { AppCtx } from "./appContext";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, MasterTable, Row, User } from "./api";
import "./App.css";
import { Login, GantiPassword } from "./pages/Login";
import { Home } from "./pages/Home";
import { TransaksiForm } from "./pages/Transaksi";
import { Opname } from "./pages/Opname";
import { StokAwal } from "./pages/StokAwal";
import { CetakLabel } from "./pages/CetakLabel";
import { Katalog } from "./pages/Katalog";
import { Promo } from "./pages/Promo";
import { Master } from "./pages/Master";
import { SimpleMaster } from "./pages/MasterEdit";
import { Laporan, Tab } from "./pages/Laporan";
import { Pengaturan } from "./pages/Pengaturan";
import { Pengguna } from "./pages/Pengguna";
import { Retur } from "./pages/Retur";
import { Pelunasan } from "./pages/Pelunasan";
import { Keuangan } from "./pages/Keuangan";
import { Database } from "./pages/Database";
import { Alat } from "./pages/Alat";
import { Poin } from "./pages/Poin";
import { JenisNonTunai } from "./pages/JenisNonTunai";
import { Panduan } from "./pages/Panduan";
import { Notifikasi } from "./pages/Notifikasi";
import { Splash } from "./pages/Splash";
import { getLocal } from "./pages/localSettings";
import { Modal } from "./components/Modal";
import { formSize } from "./vb/VbForm";
import { ModalFrame } from "./vb/VbGrid";
import {
  allowedFor, DEFAULT_CAPTION, DIALOG_FORM, isDialog, MENU, MenuNode, Page, TARGETS, TOOLBAR, ToolBtn,
} from "./vb/shell";
import "./vb/vb.css";
import { cadanganSaatKeluar } from "./api/cadangan";

const SESSION_KEY = "tokopro.sesi";
const SPLASH_KEY = "tokopro.splash";
// Build pengembangan memakai localStorage: `tauri dev` membuka jendela baru setiap kali kode Rust
// berubah, dan sessionStorage ikut hilang. Build rilis tetap sessionStorage (sesi hilang saat ditutup).
const sesiStore = (): Storage => (import.meta.env.DEV ? localStorage : sessionStorage);
const SPLASH_MS = 2600;

/**
 * Pekerjaan yang dijalankan sebelum program ditutup (mis. cadangan data otomatis).
 * Tambahkan langkahnya di sini; Keluar menunggu semuanya selesai.
 */
const sebelumKeluar: Array<() => Promise<unknown>> = [cadanganSaatKeluar];

const icons = import.meta.glob("./vb/icons/*.png", { eager: true, import: "default" }) as Record<string, string>;
const iconUrl = (n: string) => icons[`./vb/icons/${n}.png`];

interface Child { page: Page; caption: string; tab?: MasterTable | Tab; seq: number }
/** Dialog modal (form VB BorderStyle 1) yang terbuka di atas halaman aktif. Yang terakhir ada di paling atas. */
interface Dlg { page: Page; caption: string; seq: number }

/** Isi dialog: komponen yang sama dengan halamannya, dibingkai pada ukuran asli form VB. */
function DialogBody({ page }: { page: Page }) {
  switch (page) {
    case "piutang": return <Pelunasan jenis="Piutang" />;
    case "hutang": return <Pelunasan jenis="Hutang" />;
    case "barcode": return <CetakLabel mode="barcode" />;
    case "pricetag": return <CetakLabel mode="pricetag" />;
    case "katalog": return <Katalog />;
    case "pengaturan": return <Pengaturan />;
    case "database": return <Database />;
    case "alat": return <Alat />;
    case "poin": return <Poin />;
    case "nontunai": return <JenisNonTunai />;
    case "satuan": return <SimpleMaster table="mdsatuan" />;
    case "kelompok": return <SimpleMaster table="mdkelompok" />;
    case "kategori": return <SimpleMaster table="mdkategori" />;
    default: return null;
  }
}

function PopupItems(props: { nodes: MenuNode[]; kasir: boolean; ditolak: ReadonlySet<string>; onPick: (n: MenuNode) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="mdi-popup">
      {props.nodes.filter((n) => allowedFor(props.kasir, n, props.ditolak)).map((n) => (
        <li key={n.id} onMouseEnter={() => setOpen(n.children.length ? n.id : null)}>
          <button type="button"
            onMouseDown={(e) => { if (e.button === 0 && !n.children.length) { e.preventDefault(); props.onPick(n); } }}
            onClick={(e) => { if (e.detail === 0 && !n.children.length) props.onPick(n); }}>
            <span>{n.caption}</span>
            {n.children.length > 0 && <span className="arrow">▸</span>}
          </button>
          {open === n.id && <PopupItems nodes={n.children} kasir={props.kasir} ditolak={props.ditolak} onPick={props.onPick} />}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [setting, setSetting] = useState<Row>({});
  const [ditolak, setDitolak] = useState<ReadonlySet<string>>(new Set());
  const [child, setChild] = useState<Child>({ page: "home", caption: DEFAULT_CAPTION.home, seq: 0 });
  const [dbPath, setDbPath] = useState("");
  const [popup, setPopup] = useState<{ key: string; left: number; top: number } | null>(null);
  const toolbarRef = useRef<HTMLElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("");
  const [konfirmKeluar, setKonfirmKeluar] = useState(false);
  const seq = useRef(0);
  const [dialogs, setDialogs] = useState<Dlg[]>([]);
  const dialogsRef = useRef<Dlg[]>([]);
  dialogsRef.current = dialogs;
  const [ready, setReady] = useState(false);
  // Layar pembuka hanya saat program baru dibuka, tidak saat halaman dimuat ulang.
  const [splash, setSplash] = useState(() => {
    try { return !sessionStorage.getItem(SPLASH_KEY); } catch { return true; }
  });
  useEffect(() => {
    if (!splash) return;
    try { sessionStorage.setItem(SPLASH_KEY, "1"); } catch { /* penyimpanan tidak tersedia */ }
    const t = window.setTimeout(() => setSplash(false), SPLASH_MS);
    return () => window.clearTimeout(t);
  }, [splash]);

  // Hot reload: ambil sesi yang masih ada di backend, atau (build pengembangan) pulihkan setelah backend dimulai ulang.
  useEffect(() => {
    let saved: { iduser?: string; child?: Child } = {};
    try { saved = JSON.parse(sesiStore().getItem(SESSION_KEY) ?? "{}"); } catch { /* kosong */ }
    (async () => {
      let u = await api.currentUser().catch(() => null);
      if (!u && saved.iduser) u = await api.restoreSession(saved.iduser).catch(() => null);
      // Pengaturan Aktifkan Login mati: langsung masuk sebagai Administrator, tanpa layar masuk.
      if (!u) u = await api.loginBawaan().catch(() => null);
      if (u) { setUser(u); if (saved.child && !isDialog(saved.child.page)) { seq.current = saved.child.seq; setChild(saved.child); } }
    })().finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      if (user && !user.must_change) sesiStore().setItem(SESSION_KEY, JSON.stringify({ iduser: user.iduser, child }));
      else sesiStore().removeItem(SESSION_KEY);
    } catch { /* penyimpanan tidak tersedia */ }
  }, [ready, user, child]);

  // Hak akses per menu dimuat setiap kali pengguna yang masuk berganti.
  const iduser = user?.iduser;
  useEffect(() => {
    setDialogs([]);
    if (!iduser) { setDitolak(new Set()); return; }
    api.myMenus().then((l) => setDitolak(new Set(l))).catch(() => setDitolak(new Set()));
  }, [iduser]);

  const reloadSetting = useCallback(async () => setSetting((await api.getSettings()) ?? {}), []);
  useEffect(() => { reloadSetting().catch(() => undefined); api.dbPath().then(setDbPath).catch(() => undefined); }, [reloadSetting]);

  const open = useCallback((page: Page, caption?: string, tab?: MasterTable | Tab) => {
    seq.current += 1;
    setChild({ page, caption: caption ?? DEFAULT_CAPTION[page], tab, seq: seq.current });
  }, []);

  const openDialog = useCallback((page: Page, caption?: string) => {
    seq.current += 1;
    const dlg = { page, caption: caption ?? DEFAULT_CAPTION[page], seq: seq.current };
    setDialogs((d) => [...d, dlg]);
  }, []);
  const closeDialog = useCallback((s: number) => setDialogs((d) => d.filter((x) => x.seq !== s)), []);
  // Dipakai halaman dan dialog: "home" menutup dialog teratas, dialog lain menumpuk, halaman biasa menggantikan halaman aktif.
  const go = (p: Page) => {
    const d = dialogsRef.current;
    if (p === "home" && d.length) return closeDialog(d[d.length - 1].seq);
    if (isDialog(p)) return openDialog(p);
    setDialogs([]);
    open(p);
  };

  const windowTitle = `Software Toko Pro Unlimited (${setting.namausaha || "Toko"}) - [${child.caption}]`;
  useEffect(() => {
    document.title = user ? windowTitle : "Software Toko Pro Unlimited";
    try { getCurrentWindow().setTitle(document.title).catch(() => undefined); } catch { /* bukan di jendela Tauri */ }
  }, [windowTitle, user]);

  useEffect(() => {
    if (!popup) return;
    const close = () => setPopup(null);
    // Klik di dalam menu atau di tombol bilah alat ditangani sendiri; klik di tempat lain menutup menu.
    const outside = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (popupRef.current?.contains(t) || toolbarRef.current?.contains(t))) return;
      close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("keydown", key); };
  }, [popup]);

  if (splash) return <Splash namaUsaha={setting.namausaha} />;
  if (!ready) return null;
  if (!user) {
    return <Login namaUsaha={setting.namausaha} onLogin={(u) => { setUser(u); open("home"); }} />;
  }
  if (user.must_change) return <GantiPassword wajib onDone={() => setUser({ ...user, must_change: false })} />;

  const isKasir = user.level === "Kasir";
  const logout = async () => { await api.logout(); setUser(null); setDialogs([]); open("home"); };
  const keluar = async () => {
    for (const langkah of sebelumKeluar) await langkah().catch(() => undefined);
    try { await getCurrentWindow().close(); } catch { window.close(); }
  };

  const pick = (n: MenuNode) => {
    setPopup(null);
    const t = TARGETS[n.nama];
    if (ditolak.has(n.nama)) { setInfo("Anda tidak punya hak akses ke menu ini."); return; }
    if (!t) { setInfo(n.nama.startsWith("mnLap") ? "Laporan ini belum tersedia di versi ini." : "Menu ini belum tersedia di versi ini."); return; }
    if (isDialog(t.page)) { openDialog(t.page, n.caption); return; }
    open(t.page, n.caption, t.page === "laporan" && n.nama.startsWith("mnLap") ? n.nama : t.tab);
  };

  const press = (b: ToolBtn, el: HTMLElement) => {
    if (b.key === "home") return open("home");
    if (b.key === "logoff") return void logout();
    if (b.key === "keluar") return setKonfirmKeluar(true);
    const node = MENU.find((m) => m.nama === b.menu);
    if (!node) return;
    if (!node.children.length) return pick(node);
    const r = el.getBoundingClientRect();
    setPopup(popup?.key === b.key ? null : { key: b.key, left: r.left, top: r.bottom });
  };

  const buttons = TOOLBAR.filter((b) => {
    if (!b.menu) return true;
    const node = MENU.find((m) => m.nama === b.menu);
    return node ? allowedFor(isKasir, node, ditolak) : !isKasir;
  });
  const popNode = popup ? MENU.find((m) => m.nama === TOOLBAR.find((b) => b.key === popup.key)?.menu) : undefined;

  const page = child.page;
  return (
    <AppCtx.Provider value={{ user, setting, reloadSetting, go }}>
      <div className="mdi-app">
        <nav className="mdi-toolbar no-print" aria-label="Menu utama" ref={toolbarRef}>
          {buttons.map((b) => (
            <span key={b.key} className="mdi-tb-item">
              {b.sepBefore && <span className="mdi-sep" />}
              <button type="button" className={`mdi-tb ${popup?.key === b.key ? "down" : ""}`}
                onClick={(e) => press(b, e.currentTarget)}>
                <img src={iconUrl(b.icon)} alt="" draggable={false} />
                <span>{b.key === "home" && getLocal("home") === "Dashboard" ? "Dashboard" : b.caption}</span>
              </button>
            </span>
          ))}
          <span className="spacer" />
          <button type="button" className="mdi-x" aria-label="Tutup jendela" title="Tutup jendela" onClick={() => open("home")} disabled={page === "home"}>×</button>
        </nav>
        {popup && popNode && (
          <div className="mdi-popup-wrap no-print" style={{ left: popup.left, top: popup.top }} ref={popupRef}>
            <PopupItems nodes={popNode.children} kasir={isKasir} ditolak={ditolak} onPick={pick} />
          </div>
        )}
        <main className="mdi-workspace">
          <section className="mdi-child">
            <div className="mdi-child-body">
              {page === "home" && <Home />}
              {page === "panduan" && <Panduan />}
              {page === "jual" && <TransaksiForm key="jual" mode="jual" />}
              {page === "beli" && <TransaksiForm key="beli" mode="beli" />}
              {page === "orderjual" && <TransaksiForm key="orderjual" mode="jual" order />}
              {page === "orderbeli" && <TransaksiForm key="orderbeli" mode="beli" order />}
              {page === "opname" && <Opname />}
              {page === "stokawal" && <StokAwal />}
              {page === "promodiskon" && <Promo key="diskon" jenis="diskon" />}
              {page === "promobonus" && <Promo key="bonus" jenis="bonus" />}
              {page === "promopdp" && <Promo key="pdp" jenis="pdp" />}
              {page === "master" && <Master key={child.seq} initial={child.tab as MasterTable | undefined} />}
              {page === "laporan" && <Laporan key={child.seq} initial={child.tab as Tab | undefined} />}
              {page === "pengguna" && <Pengguna />}
              {page === "keuangan" && <Keuangan />}
              {page === "returjual" && <Retur key="rj" mode="jual" />}
              {page === "returbeli" && <Retur key="rb" mode="beli" />}
              {page === "returbelibrg" && <Retur key="rbb" mode="brg" />}
            </div>
          </section>
        </main>
        <footer className="mdi-status no-print">
          <span className="p1">User : {user.iduser}</span>
          <span className="p2">Status : {user.level}</span>
          <span className="p3">Lokasi Data : {dbPath}</span>
        </footer>
      </div>
      {dialogs.map((d) => {
        const { width, height } = formSize(DIALOG_FORM[d.page] ?? "");
        return (
          <ModalFrame key={d.seq} title={d.caption} width={width + 2} height={height + 22} onClose={() => closeDialog(d.seq)}>
            <DialogBody page={d.page} />
          </ModalFrame>
        );
      })}
      <Notifikasi aktif onBuka={() => openDialog("piutang")} />
      {info && (
        <Modal title="Informasi" onClose={() => setInfo("")} footer={<button className="btn primary" onClick={() => setInfo("")}>OK</button>}>
          <p>{info}</p>
        </Modal>
      )}
      {konfirmKeluar && (
        <Modal title="Keluar" onClose={() => setKonfirmKeluar(false)}
          footer={<><button className="btn" onClick={() => setKonfirmKeluar(false)}>Tidak</button><button className="btn primary" onClick={keluar}>Ya, keluar</button></>}>
          <p>Anda yakin ingin keluar dari program?</p>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}
