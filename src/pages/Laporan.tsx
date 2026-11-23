import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { api, errText, Row } from "../api";
import { useApp } from "../appContext";
import { Alert, Modal } from "../components/Modal";
import { berkasApi } from "../api/berkas";
import { useMsgBox } from "../vb/VbGrid";
import { cetakLaporan } from "../components/Struk";
import { today, tglID } from "../format";
import { FilterWindow, matchFilter } from "./MasterFilter";
import { loadAll } from "./masterLib";
import { KASIR_BOLEH, LAPORAN, TAB_LAMA, lewatBatas, selisihBatas } from "./laporan/defs";
import { FormatEkspor, MENU_EKSPOR, OpsiText, OpsiTextDialog, simpanEkspor } from "./laporan/Ekspor";
import { LapFilterDialog, LapFilterVal } from "./laporan/Filter";
import { build, gridLaporan, Kertas, kopTeks, StokCtx } from "./laporan/Preview";
import "./laporan/laporan.css";

/** Nilai `initial` adalah namamenu asli (mis. mnLapPenjualanHarian); tab lama dipetakan ke menu yang setara. */
export type Tab = string;

const adaLaporan = (k: string) => k.startsWith("stok");

export function Laporan(props: { initial?: Tab }) {
  const { user, setting, go } = useApp();
  const menu = props.initial && LAPORAN[props.initial] ? props.initial : TAB_LAMA[props.initial ?? ""] ?? props.initial ?? "";
  const def = LAPORAN[menu];
  const bolehKasir = !def || user.level !== "Kasir" || KASIR_BOLEH.has(def.kind);
  const stok = !!def && adaLaporan(def.kind);
  const tanpaFilter = def?.kind === "lr_komparatif"; // Laba Rugi Komparatif langsung tampil, tanpa filter
  const msg = useMsgBox();
  const [menuEkspor, setMenuEkspor] = useState(false);
  const [dlgText, setDlgText] = useState<string | null>(null);

  const [filter, setFilter] = useState<LapFilterVal>({ dari: today(), sampai: today() });
  const [tampil, setTampil] = useState(false);
  const [ubahFilter, setUbahFilter] = useState(false); // dialog filter dibuka lagi dari laporan yang sedang tampil
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [barang, setBarang] = useState<Row[]>([]);
  const [ctx, setCtx] = useState<StokCtx>({ kelompok: new Map(), kategori: new Map() });

  // Daftar barang dipakai oleh dialog Filter Barang dan laporan stok.
  useEffect(() => {
    if (!stok) return;
    (async () => {
      setBarang(await loadAll("mdbarang", {}));
      const [kel, kat] = await Promise.all([loadAll("mdkelompok", {}), loadAll("mdkategori", {})]);
      setCtx({
        kelompok: new Map(kel.map((r) => [String(r.kodekelompok), String(r.namakelompok)])),
        kategori: new Map(kat.map((r) => [String(r.kodekategori), String(r.namakategori)])),
      });
    })().catch((e) => setErr(errText(e)));
  }, [stok]);

  const terapkan = async (f: LapFilterVal) => {
    if (!def) return;
    setUbahFilter(false);
    setErr("");
    setFilter(f);
    setRows(null);
    setTampil(true);
    try {
      if (stok) {
        const semua = await loadAll("mdbarang", {}); // Refresh membaca data terbaru
        let r = semua.filter((x) => matchFilter("mdbarang", f, x));
        // Stok maksimum dan minimum: syarat dan urutan asli (selisih stok terhadap batas), tanpa saringan lain.
        r = r.filter((x) => lewatBatas(def.kind, x));
        const urut = (a: Row, b: Row) => String(a.namabarang).localeCompare(String(b.namabarang));
        if (def.kind === "stok_max") r.sort((a, b) => selisihBatas(def.kind, b) - selisihBatas(def.kind, a));
        else if (def.kind === "stok_min") r.sort((a, b) => selisihBatas(def.kind, a) - selisihBatas(def.kind, b));
        else r.sort((a, b) => String(a.kodekelompok ?? "").localeCompare(String(b.kodekelompok ?? "")) || String(a.kodekategori ?? "").localeCompare(String(b.kodekategori ?? "")) || urut(a, b));
        setRows(r);
      } else {
        const r = await api.laporanData(def.jenis!, f);
        setRows(Array.isArray(r) ? r : []);
      }
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  };

  useEffect(() => { if (tanpaFilter && bolehKasir) void terapkan(filter); /* sekali saat dibuka */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc menutup laporan yang sedang tampil. Dialog yang terbuka menangkap Esc lebih dulu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !tampil) return;
      e.preventDefault();
      if (menuEkspor) setMenuEkspor(false);
      else go("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!def || !bolehKasir) {
    return (
      <Modal title="Informasi" onClose={() => go("home")} footer={<Button autoFocus onClick={() => go("home")}>OK</Button>}>
        <p>{def ? "Laporan ini hanya bisa dibuka oleh pengguna selain kasir." : "Laporan ini belum tersedia di versi ini."}</p>
      </Modal>
    );
  }

  const labelTgl = def.form === "FrmFilterKas" ? "Tgl. Transaksi" : ["piutang", "hutang", "pelunasan_piutang", "pelunasan_hutang"].includes(def.kind) ? "Tgl. Jatuh Tempo" : "Tanggal";
  const periode = stok || tanpaFilter ? `Per tanggal : ${tglID(today())}` : `${labelTgl} : ${tglID(filter.dari)} s.d ${tglID(filter.sampai)}`;
  const built = useMemo(() => (rows ? build(def.kind, rows, ctx) : null), [def.kind, rows, ctx]);

  /** Ekspor ke Text, Excel, RTF, PDF, atau HTML (menu Ekspor di jendela laporan). */
  const ekspor = async (format: FormatEkspor) => {
    setMenuEkspor(false);
    if (!built || !rows) return;
    try {
      if (format === "pdf") {
        // Belum ada pembuat PDF di aplikasi; dialog cetak sistem punya pilihan simpan sebagai PDF.
        msg.alert("Di dialog cetak, pilih \"Simpan sebagai PDF\" untuk menyimpan laporan ini sebagai file PDF.");
        await cetakLaporan();
        return;
      }
      if (format === "text") { setDlgText(await berkasApi.eksporNama(def.title, "txt")); return; }
      const f = await simpanEkspor(format, def.title, kopTeks(setting, def.title, periode), gridLaporan(built));
      msg.alert(`File tersimpan di ${f}.`);
    } catch (e) { msg.alert(errText(e)); }
  };
  const simpanText = async (path: string, o: OpsiText) => {
    if (!built) return;
    try {
      const f = await simpanEkspor("text", def.title, kopTeks(setting, def.title, periode), gridLaporan(built), path, o);
      setDlgText(null);
      msg.alert(`File tersimpan di ${f}.`);
    } catch (e) { msg.alert(errText(e)); }
  };

  return (
    <>
      {msg.node}
      {dlgText !== null && <OpsiTextDialog nama={dlgText} onClose={() => setDlgText(null)} onSimpan={simpanText} />}
      {tampil && (
        <div className="lap-wrap flex h-full flex-col bg-muted/60">
          <div className="lap-toolbar no-print flex items-center gap-1.5 border-b border-border bg-muted px-3 py-1.5">
            <Button type="button" variant="default" size="sm" onClick={() => { setMenuEkspor(false); cetakLaporan().catch((e) => setErr(errText(e))); }} disabled={rows === null}>Cetak</Button>
            <Button type="button" variant="outline" size="sm" className="bg-background" onClick={() => { setMenuEkspor(false); void terapkan(filter); }} disabled={rows === null}>Refresh</Button>
            <span className="lap-ekspor relative">
              <Button type="button" variant="outline" size="sm" className="bg-background" onClick={() => setMenuEkspor((x) => !x)} disabled={rows === null}>
                <span>Ekspor</span>
                <ChevronDownIcon className="size-3.5" />
              </Button>
              {menuEkspor && (
                <ul className="lap-menu absolute top-8 left-0 z-20 m-0 min-w-44 list-none rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg">
                  {MENU_EKSPOR.map(([k, t]) => (
                    <li key={k}>
                      <button
                        type="button"
                        data-slot="menu-item"
                        className="block w-full rounded-sm px-2.5 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
                        onClick={() => void ekspor(k)}
                      >
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
            {!tanpaFilter && (
              <Button type="button" variant="outline" size="sm" className="bg-background" onClick={() => { setMenuEkspor(false); setUbahFilter(true); }}>Ubah Filter</Button>
            )}
            <Button type="button" variant="outline" size="sm" className="bg-background" onClick={() => go("home")}>
              <span>Tutup</span>
              <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            <span className="lap-info ml-auto pr-1 text-xs text-muted-foreground">{rows === null ? "Memuat laporan..." : ""}</span>
          </div>
          <div className="lap-scroll flex-1 overflow-auto p-4" onMouseDown={() => setMenuEkspor(false)}>
            {err && <Alert>{err}</Alert>}
            {rows !== null && built && <Kertas kind={def.kind} title={def.title} periode={periode} setting={setting} built={built} kosong={rows.length === 0} onUbahFilter={tanpaFilter ? undefined : () => setUbahFilter(true)} />}
          </div>
        </div>
      )}
      {(!tampil || ubahFilter) && stok && (
        <FilterWindow table="mdbarang" rows={barang} value={filter} onApply={terapkan} onClose={() => (tampil ? setUbahFilter(false) : go("home"))} />
      )}
      {(!tampil || ubahFilter) && !stok && !tanpaFilter && (
        <LapFilterDialog form={def.form} value={filter} onApply={terapkan} onClose={() => (tampil ? setUbahFilter(false) : go("home"))} />
      )}
    </>
  );
}
