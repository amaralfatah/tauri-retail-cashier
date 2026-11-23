import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronRight, MoonIcon, SunIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AppCtx, useApp } from "./appContext";
import { KasirAktifCtx } from "./lib/kasirAktif";
import { useTheme } from "./lib/theme";
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
import { formSize, useTinggiJudul } from "./vb/VbForm";
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


interface Child { page: Page; caption: string; tab?: MasterTable | Tab; seq: number }
/** Dialog modal (form VB BorderStyle 1) yang terbuka di atas halaman aktif. Yang terakhir ada di paling atas. */
interface Dlg { page: Page; caption: string; seq: number }

/** Layar kasir yang dibiarkan hidup (disembunyikan) saat Anda membuka layar lain, supaya keranjang tidak hilang. */
type Kasir = "jual" | "beli";
const adaKasir = (p: Page): p is Kasir => p === "jual" || p === "beli";

/**
 * Membungkus layar kasir: menyembunyikannya (tetap terpasang) saat bukan layar aktif, dan menangkap
 * tombol Tutup kasir (go("home")) untuk melepas layar ini supaya dibuka berikutnya mulai bersih.
 */
function KasirHidup(props: { aktif: boolean; onLepas: () => void; onIsi: (n: number) => void; children: React.ReactNode }) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const go = useCallback((p: Page) => { if (p === "home") props.onLepas(); app.go(p); }, [app, props]);
  const laporIsi = props.onIsi;
  // Kembali ke kasir: fokus ke kotak scan lagi, karena fokus lama hilang saat layar disembunyikan.
  const pernahAktif = useRef(props.aktif);
  useEffect(() => {
    if (props.aktif && !pernahAktif.current) {
      const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>("#tp-scan")?.focus(), 50);
      pernahAktif.current = true;
      return () => window.clearTimeout(t);
    }
    pernahAktif.current = props.aktif;
  }, [props.aktif]);
  return (
    <AppCtx.Provider value={{ ...app, go }}>
      <KasirAktifCtx.Provider value={{ aktif: props.aktif, laporIsi }}>
        <div ref={ref} className={cn("size-full", !props.aktif && "hidden")} inert={!props.aktif}>{props.children}</div>
      </KasirAktifCtx.Provider>
    </AppCtx.Provider>
  );
}

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

function PopupItems(props: { nodes: MenuNode[]; kasir: boolean; ditolak: ReadonlySet<string>; onPick: (n: MenuNode) => void; sub?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul data-slot="menu"
      className={cn("m-0 min-w-52 list-none rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg",
        props.sub ? "absolute top-[-5px] left-full ml-1" : "relative")}>
      {props.nodes.filter((n) => allowedFor(props.kasir, n, props.ditolak)).map((n) => (
        <li key={n.id} className="relative" onMouseEnter={() => setOpen(n.children.length ? n.id : null)}>
          <button type="button" data-slot="menu-item"
            className={cn("flex w-full cursor-default items-center justify-between gap-4 rounded-sm px-2 py-1.5 text-left outline-none",
              "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent", open === n.id && "bg-accent text-accent-foreground")}
            onMouseDown={(e) => { if (e.button === 0 && !n.children.length) { e.preventDefault(); props.onPick(n); } }}
            onClick={(e) => { if (e.detail === 0 && !n.children.length) props.onPick(n); }}>
            <span>{n.caption}</span>
            {n.children.length > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
          </button>
          {open === n.id && <PopupItems sub nodes={n.children} kasir={props.kasir} ditolak={props.ditolak} onPick={props.onPick} />}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const { resolvedTheme, setTheme } = useTheme();
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
  const [hidup, setHidup] = useState<Partial<Record<Kasir, true>>>({});
  const isiKasir = useRef<Partial<Record<Kasir, number>>>({});
  const childRef = useRef(child);
  childRef.current = child;
  const [konfirmLogoff, setKonfirmLogoff] = useState(false);
  const [dialogs, setDialogs] = useState<Dlg[]>([]);
  const dialogsRef = useRef<Dlg[]>([]);
  dialogsRef.current = dialogs;
  const [ready, setReady] = useState(false);
  const tinggiJudul = useTinggiJudul();
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
    setHidup({});
    isiKasir.current = {};
    if (!iduser) { setDitolak(new Set()); return; }
    api.myMenus().then((l) => setDitolak(new Set(l))).catch(() => setDitolak(new Set()));
  }, [iduser]);

  const reloadSetting = useCallback(async () => setSetting((await api.getSettings()) ?? {}), []);
  useEffect(() => { reloadSetting().catch(() => undefined); api.dbPath().then(setDbPath).catch(() => undefined); }, [reloadSetting]);

  const open = useCallback((page: Page, caption?: string, tab?: MasterTable | Tab) => {
    const cur = childRef.current.page;
    // Layar kasir ikut dipertahankan saat Anda pindah ke layar lain; yang keranjangnya kosong dilepas.
    setHidup((h) => {
      const n = { ...h };
      if (adaKasir(cur)) n[cur] = true;
      if (adaKasir(page)) n[page] = true;
      for (const k of ["jual", "beli"] as const) if (k !== page && isiKasir.current[k] === 0) delete n[k];
      return n;
    });
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

  // Judul pendek: nama toko lalu layar yang sedang dibuka.
  const windowTitle = `${setting.namausaha || "Toko Pro"} — ${child.caption}`;
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
    // Esc hanya menutup menu: ditangkap lebih dulu supaya layar di bawahnya (mis. kasir) tidak ikut tertutup.
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("keydown", key, true); };
  }, [popup]);

  if (splash) return <Splash namaUsaha={setting.namausaha} />;
  if (!ready) return null;
  if (!user) {
    return <Login namaUsaha={setting.namausaha} onLogin={(u) => { setUser(u); open("home"); }} />;
  }
  if (user.must_change) return <GantiPassword wajib onDone={() => setUser({ ...user, must_change: false })} />;

  const isKasir = user.level === "Kasir";
  const logout = async () => { await api.logout(); setUser(null); setDialogs([]); open("home"); };
  const lepasKasir = (k: Kasir) => { delete isiKasir.current[k]; setHidup((h) => { const n = { ...h }; delete n[k]; return n; }); };
  const ada = (k: Kasir) => !!hidup[k] || page === k;
  const kasirBelumBayar = () => (["jual", "beli"] as const).some((k) => (isiKasir.current[k] ?? 0) > 0);
  const mintaLogoff = () => { if (kasirBelumBayar()) setKonfirmLogoff(true); else void logout(); };
  const mintaKeluar = () => setKonfirmKeluar(true);
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
    if (b.key === "logoff") return mintaLogoff();
    if (b.key === "keluar") return mintaKeluar();
    const node = MENU.find((m) => m.nama === b.menu);
    if (!node) return;
    if (!node.children.length) return pick(node);
    const r = el.getBoundingClientRect();
    const clampedLeft = Math.max(8, Math.min(r.left, window.innerWidth - 230));
    setPopup(popup?.key === b.key ? null : { key: b.key, left: clampedLeft, top: r.bottom });
  };

  const buttons = TOOLBAR.filter((b) => {
    if (!b.menu) return true;
    const node = MENU.find((m) => m.nama === b.menu);
    return node ? allowedFor(isKasir, node, ditolak) : !isKasir;
  });
  const SESSION_KEYS = new Set(["logoff", "keluar"]);
  const mainButtons = buttons.filter((b) => !SESSION_KEYS.has(b.key));
  const sessionButtons = buttons.filter((b) => SESSION_KEYS.has(b.key));
  const popNode = popup ? MENU.find((m) => m.nama === TOOLBAR.find((b) => b.key === popup.key)?.menu) : undefined;

  const page = child.page;
  const activeKey: string =
    page === "home" ? "home"
    : page === "master" || page === "satuan" || page === "kelompok" || page === "kategori" ? "master"
    : page === "jual" || page === "orderjual" || page === "returjual" || page === "piutang" ? "jual"
    : page === "beli" || page === "orderbeli" || page === "returbeli" || page === "returbelibrg" || page === "hutang" ? "beli"
    : page === "opname" || page === "stokawal" || page === "barcode" || page === "pricetag" || page === "katalog" || page === "promodiskon" || page === "promobonus" || page === "promopdp" ? "inv"
    : page === "laporan" ? "lap"
    : page === "keuangan" ? "keu"
    : page === "pengaturan" || page === "pengguna" || page === "database" || page === "alat" || page === "poin" || page === "nontunai" ? "atur"
    : page === "panduan" ? "bantu"
    : "";
  const renderToolBtn = (b: ToolBtn, showSep: boolean) => {
    const active = activeKey === b.key;
    const openMenu = popup?.key === b.key;
    const isKeluar = b.key === "keluar";
    const sesi = b.key === "logoff" || isKeluar;
    // Tombol yang membuka daftar menu diberi tanda panah, supaya beda dengan tombol yang langsung berpindah layar.
    const bukaMenu = !!MENU.find((m) => m.nama === b.menu)?.children.length;
    const Ikon = b.icon;
    return (
      <span key={b.key} className="flex items-center">
        {showSep && <Separator orientation="vertical" className={cn("h-5 bg-border", isKeluar ? "mx-2" : "mx-1")} />}
        <Button
          type="button"
          variant="ghost"
          size="default"
          aria-haspopup={bukaMenu ? "menu" : undefined}
          aria-expanded={bukaMenu ? openMenu : undefined}
          aria-current={active ? "page" : undefined}
          aria-label={sesi ? b.caption : undefined}
          title={sesi ? b.caption : undefined}
          className={cn(
            "group/tb h-8 gap-1.5 border-0 px-2 text-[13px] font-medium text-foreground shadow-none transition-colors @min-[1300px]/nav:px-2.5",
            isKeluar
              ? "hover:bg-destructive/12 hover:text-destructive"
              : "hover:bg-foreground/6 hover:text-foreground",
            openMenu && !active && "bg-foreground/8",
            // Menu aktif: netral seperti aplikasi Apple (kartu putih timbul), bukan blok biru.
            active && "bg-background font-semibold text-foreground shadow-xs ring-1 ring-border hover:bg-background hover:text-foreground",
          )}
          // Klik mouse tidak memindahkan fokus dari kolom scan, supaya scan berikutnya tetap masuk ke kasir.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => press(b, e.currentTarget)}
        >
          <Ikon
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              // Layar sempit (±1093px, Ukuran tampilan 125%): menu modul cukup teks supaya Log Off dan Keluar tetap berlabel dan terlihat.
              b.menu && "hidden @min-[1300px]/nav:block",
              active ? "text-foreground" : "text-foreground/60",
              // Keluar tidak boleh jadi yang paling mencolok: netral, merah hanya saat disorot.
              isKeluar && "text-foreground/70 group-hover/tb:text-destructive",
            )}
          />
          {/* Log Off dan Keluar selalu berlabel: ikon power dan ikon keluar mudah tertukar kalau berdiri sendiri. */}
          <span>{b.key === "home" && getLocal("home") === "Dashboard" ? "Dashboard" : b.caption}</span>
          {bukaMenu && (
            <ChevronDownIcon aria-hidden
              className={cn("-ml-0.5 hidden size-3.5 shrink-0 transition-transform @min-[1300px]/nav:block", "text-foreground/50", openMenu && "rotate-180")} />
          )}
        </Button>
      </span>
    );
  };
  return (
    <AppCtx.Provider value={{ user, setting, reloadSetting, go }}>
      <div className="mdi-app">
        <nav className="mdi-toolbar no-print @container/nav flex h-11 items-center gap-0.5 overflow-x-auto border-b border-border bg-muted px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Menu utama" ref={toolbarRef}>
          {mainButtons.map((b, i) => renderToolBtn(b, i > 0 && !!b.sepBefore))}
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={resolvedTheme === "dark" ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
            title={resolvedTheme === "dark" ? "Mode Terang (ramah mata di ruangan terang)" : "Mode Gelap (redup)"}
            className="h-8 gap-1.5 px-2 text-[13px] font-medium text-foreground/80 hover:bg-foreground/6 hover:text-foreground"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <SunIcon className="size-4 text-warning" /> : <MoonIcon className="size-4" />}
            <span className="hidden @min-[1300px]/nav:inline">{resolvedTheme === "dark" ? "Terang" : "Gelap"}</span>
          </Button>
          {sessionButtons.map((b) => renderToolBtn(b, true))}
          {/* Layar kasir sudah punya tombol Tutup [Esc]; tombol × kedua membuat kasir ragu mana yang menutup aplikasi. */}
          {page !== "home" && page !== "jual" && (
            <span className="flex items-center">
              <Separator orientation="vertical" className="mx-1 h-4 bg-border" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup jendela" title="Tutup jendela (ESC)"
                className="text-foreground/75 hover:bg-foreground/6 hover:text-foreground" onClick={() => open("home")}>
                <XIcon />
              </Button>
            </span>
          )}
        </nav>
        {popup && popNode && (
          <div className="no-print fixed z-40 mt-1" style={{ left: popup.left, top: popup.top }} ref={popupRef}>
            <PopupItems nodes={popNode.children} kasir={isKasir} ditolak={ditolak} onPick={pick} />
          </div>
        )}
        <main className="mdi-workspace min-h-0 overflow-hidden bg-background">
          <section className="flex h-full min-h-0 flex-col">
            <div className="mdi-child-body">
              {page === "home" && <Home key={child.seq} />}
              {page === "panduan" && <Panduan />}
              {(["jual", "beli"] as const).filter(ada).map((k) => (
                <KasirHidup key={k} aktif={page === k} onLepas={() => lepasKasir(k)} onIsi={(n) => { isiKasir.current[k] = n; }}>
                  <TransaksiForm mode={k} />
                </KasirHidup>
              ))}
              {page === "orderjual" && <TransaksiForm key="orderjual" mode="jual" order />}
              {page === "orderbeli" && <TransaksiForm key="orderbeli" mode="beli" order />}
              {page === "opname" && <Opname />}
              {page === "stokawal" && <StokAwal />}
              {page === "barcode" && <CetakLabel key="barcode" mode="barcode" />}
              {page === "pricetag" && <CetakLabel key="pricetag" mode="pricetag" />}
              {page === "katalog" && <Katalog />}
              {page === "promodiskon" && <Promo key="diskon" jenis="diskon" />}
              {page === "promobonus" && <Promo key="bonus" jenis="bonus" />}
              {page === "promopdp" && <Promo key="pdp" jenis="pdp" />}
              {page === "master" && <Master key={child.seq} initial={child.tab as MasterTable | undefined} />}
              {page === "satuan" && <SimpleMaster key="satuan" table="mdsatuan" />}
              {page === "kelompok" && <SimpleMaster key="kelompok" table="mdkelompok" />}
              {page === "kategori" && <SimpleMaster key="kategori" table="mdkategori" />}
              {page === "laporan" && <Laporan key={child.seq} initial={child.tab as Tab | undefined} />}
              {page === "pengaturan" && <Pengaturan />}
              {page === "pengguna" && <Pengguna />}
              {page === "alat" && <Alat />}
              {page === "poin" && <Poin />}
              {page === "keuangan" && <Keuangan />}
              {page === "returjual" && <Retur key="rj" mode="jual" />}
              {page === "returbeli" && <Retur key="rb" mode="beli" />}
              {page === "returbelibrg" && <Retur key="rbb" mode="brg" />}
              {page === "piutang" && <Pelunasan key={`piutang-${child.seq}`} jenis="Piutang" jatuhTempo={child.tab === ("jatuhtempo" as Tab)} />}
              {page === "hutang" && <Pelunasan key="hutang" jenis="Hutang" />}
            </div>
          </section>
        </main>
        <footer className="mdi-status no-print flex h-7 items-center gap-2.5 border-t border-border bg-muted px-3 text-xs text-foreground/80">
          {/* Nama layar yang sedang dibuka (di VB tampil sebagai [Nama Layar] di judul jendela). */}
          <span className="truncate font-semibold text-foreground" aria-live="polite">{child.caption}</span>
          <Separator orientation="vertical" className="h-3.5 bg-border" />
          <span className="flex items-center gap-1 truncate">
            <span className="text-muted-foreground">User:</span>
            <span className="font-semibold text-foreground">{user.iduser}</span>
          </span>
          <Separator orientation="vertical" className="h-3.5 bg-border" />
          <span className="flex items-center gap-1 truncate">
            <span className="text-muted-foreground">Status:</span>
            <span className="font-semibold text-foreground">{user.level}</span>
          </span>
          <Separator orientation="vertical" className="h-3.5 bg-border" />
          <span className="flex-1" />
          <span className="truncate text-foreground/75" title={dbPath ? `Lokasi data: ${dbPath}` : undefined}>Data tersimpan di komputer ini</span>
          <Separator orientation="vertical" className="h-3.5 bg-border" />
          <Jam />
        </footer>
      </div>
      {dialogs.map((d) => {
        const customSize: Partial<Record<Page, { width: number; height: number }>> = {
          database: { width: 540, height: 390 },
          katalog: { width: 760, height: 560 },
          barcode: { width: 760, height: 520 },
          pricetag: { width: 760, height: 520 },
          pengaturan: { width: 680, height: 520 },
          alat: { width: 680, height: 480 },
          piutang: { width: 760, height: 520 },
          hutang: { width: 760, height: 520 },
          poin: { width: 720, height: 520 },
          nontunai: { width: 580, height: 440 },
          satuan: { width: 560, height: 410 },
          kelompok: { width: 560, height: 410 },
          kategori: { width: 560, height: 450 },
        };
        const sz = customSize[d.page];
        const { width, height } = sz ?? formSize(DIALOG_FORM[d.page] ?? "");
        return (
          <ModalFrame key={d.seq} title={d.caption} width={width + (sz ? 0 : 2)} height={height + (sz ? 0 : tinggiJudul)} onClose={() => closeDialog(d.seq)}>
            <DialogBody page={d.page} />
          </ModalFrame>
        );
      })}
      <Notifikasi aktif diKasir={adaKasir(page)} onBuka={() => open("piutang", undefined, "jatuhtempo" as Tab)} />
      {info && (
        <Modal title="Informasi" onClose={() => setInfo("")} footer={<Button autoFocus onClick={() => setInfo("")}>OK</Button>}>
          <p>{info}</p>
        </Modal>
      )}
      {konfirmKeluar && (
        <Modal title="Keluar" onClose={() => setKonfirmKeluar(false)}
          footer={<><Button variant="outline" onClick={() => setKonfirmKeluar(false)}>Tidak</Button><Button autoFocus onClick={keluar}>Ya, keluar</Button></>}>
          <p>{kasirBelumBayar()
            ? "Masih ada transaksi yang belum dibayar di kasir. Tetap keluar dari program?"
            : "Anda yakin ingin keluar dari program?"}</p>
        </Modal>
      )}
      {konfirmLogoff && (
        <Modal title="Log Off" onClose={() => setKonfirmLogoff(false)}
          footer={<><Button variant="outline" onClick={() => setKonfirmLogoff(false)}>Tidak</Button><Button autoFocus onClick={() => { setKonfirmLogoff(false); void logout(); }}>Ya, log off</Button></>}>
          <p>Masih ada transaksi yang belum dibayar di kasir. Tetap log off?</p>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}

/** Tanggal dan jam di status bar, supaya kasir tidak perlu melihat jam komputer. */
function Jam() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  const tgl = now.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const jam = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return <span className="font-semibold text-foreground tabular-nums">{tgl} · {jam}</span>;
}

