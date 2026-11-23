import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilterIcon, PrinterIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { EntryGrid, type EntryGridCol, GridKodeInput } from "../components/EntryGrid";
import { Modal } from "../components/Modal";
import { qty, rp, today } from "../format";
import { useMsgBox } from "../vb/VbGrid";
import { code128Bars } from "./barcode128";
import { FilterBarang } from "./inventoriLib";
import { NumInput } from "./Transaksi";
import "./label.css";

export type LabelMode = "barcode" | "pricetag";

interface Item { kode: string; barcode: string; nama: string; hrgjual: number; hrgpromo: number; ketpromo: string; jml: number }

/** Kolom tabel cetak label (lebar dalam persen). */
const COLS: EntryGridCol[] = [
  { label: "No", width: 5, align: "right" },
  { label: "Kode", width: 14, align: "left" },
  { label: "Barcode", width: 16, align: "left" },
  { label: "Nama Barang", width: 33, align: "left" },
  { label: "Hrg. Jual", width: 16, align: "right" },
  { label: "Jml. Cetak", width: 16, align: "right" },
];

const KODE_BARANG = "Kode Barang";
const BARCODE = "Barcode";

/** Barcode Code 128 sebagai SVG. */
export function Barcode({ value }: { value: string }) {
  const { bars, width } = useMemo(() => code128Bars(value), [value]);
  const quiet = 10;
  return (
    <svg className="bc" viewBox={`0 0 ${width + quiet * 2} 10`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={value}>
      {bars.map(([x, w], i) => <rect key={i} x={x + quiet} y={0} width={w} height={10} fill="#000" />)}
    </svg>
  );
}

function Sheet({ mode, items }: { mode: LabelMode; items: Item[] }) {
  return (
    <div className={`lbl-sheet ${mode}`}>
      {items.map((it, i) => mode === "barcode" ? (
        <div className="lbl" key={i}>
          <div className="nm">{it.nama}</div>
          <Barcode value={it.barcode} />
          <div className="kd">{it.barcode}</div>
          <div className="hg">Rp {rp(it.hrgjual)}</div>
        </div>
      ) : (
        <div className="lbl" key={i}>
          <div className="nm">{it.nama}</div>
          <div className="kd">{it.kode}</div>
          <div>
            {it.hrgpromo > 0 && <div className="coret">Rp {rp(it.hrgjual)}</div>}
            <div className="hg">Rp {rp(it.hrgpromo > 0 ? it.hrgpromo : it.hrgjual)}</div>
          </div>
          <div className="promo">{it.ketpromo}</div>
        </div>
      ))}
    </div>
  );
}

/** Cetak Barcode (FrmCetakBarcode) dan Cetak Price Tag (form yang sama, lewat menu lain). */
export function CetakLabel({ mode }: { mode: LabelMode }) {
  const { go } = useApp();
  const msg = useMsgBox();
  const tag = mode === "pricetag";
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [kodeJenis, setKodeJenis] = useState(KODE_BARANG);
  const [cari, setCari] = useState(false);
  const [filter, setFilter] = useState(false);
  const [scan, setScan] = useState("");
  const [preview, setPreview] = useState<Item[] | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  /** Tambahkan barang beserta harga promonya hari ini. Mengembalikan jumlah barang yang benar-benar masuk. */
  const add = useCallback(async (list: Row[], diam = false): Promise<number> => {
    const baru = list.filter((b, i) => list.findIndex((x) => x.kodebarang === b.kodebarang) === i && !items.some((i2) => i2.kode === b.kodebarang));
    if (!baru.length) {
      if (!diam) msg.alert(list.length === 1 ? `${list[0].namabarang} sudah ada di daftar.` : "Tidak ada barang baru yang bisa ditambahkan.");
      return 0;
    }
    let promo: Row[] = [];
    try {
      promo = await inventoriApi.barangLabel(baru.map((b) => b.kodebarang), today());
    } catch (e) {
      msg.alert(errText(e));
    }
    const byKode = new Map(promo.map((p) => [p.kodebarang, p]));
    setItems((xs) => [...xs, ...baru.map<Item>((b) => {
      const p = byKode.get(b.kodebarang);
      return {
        kode: b.kodebarang, barcode: b.barcode || "", nama: b.namabarang, hrgjual: Number(b.hrgjual) || 0,
        hrgpromo: Number(p?.hrgpromo) || 0, ketpromo: p?.ketpromo ?? "", jml: 1,
      };
    })]);
    setSelected(baru[baru.length - 1].kodebarang);
    return baru.length;
  }, [items, msg]);

  const onScan = async () => {
    const kode = scan.trim();
    if (!kode) return;
    const b = await inventoriApi.labelFind(kode).catch(() => null);
    if (b) await add([b]);
    else setCari(true);
    setScan("");
  };

  const cetak = async () => {
    const aktif = items.filter((i) => i.jml > 0);
    if (!aktif.length) return msg.alert("Belum ada barang yang akan dicetak. Silakan tambahkan barang dan isi jumlah cetaknya.");
    try {
      // Harga dan promo diambil lagi supaya yang tercetak adalah yang berlaku hari ini.
      const fresh = new Map((await inventoriApi.barangLabel(aktif.map((i) => i.kode), today())).map((r) => [r.kodebarang, r]));
      const out: Item[] = [];
      for (const it of aktif) {
        const f = fresh.get(it.kode);
        const dasar: Item = f
          ? { ...it, hrgjual: Number(f.hrgjual) || 0, hrgpromo: Number(f.hrgpromo) || 0, ketpromo: f.ketpromo ?? "", barcode: f.barcode || "" }
          : it;
        const code = tag || kodeJenis === KODE_BARANG ? dasar.kode : dasar.barcode || dasar.kode;
        for (let n = 0; n < Math.round(it.jml); n++) out.push({ ...dasar, barcode: code });
      }
      setPreview(out);
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const cetakSekarang = async () => {
    document.body.dataset.print = "label";
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      await api.cetak();
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const ada = !!msg.node || cari || filter || !!preview;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ada) return;
      if (e.key === "F10") { e.preventDefault(); setCari(true); }
      else if (e.key === "Escape") go("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ada, go]);

  const renderGrid = () => {
    const total = Math.max(items.length + 1, 16);
    const idx = items.findIndex((i) => i.kode === selected);
    const onKeyDown = (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "ArrowDown" && idx + 1 < items.length) { e.preventDefault(); setSelected(items[idx + 1].kode); }
      else if (e.key === "ArrowUp" && idx > 0) { e.preventDefault(); setSelected(items[idx - 1].kode); }
      else if (e.key === "Delete" && idx >= 0) {
        e.preventDefault();
        setItems((xs) => xs.filter((_, k) => k !== idx));
        setSelected(items[idx + 1]?.kode ?? items[idx - 1]?.kode ?? null);
      } else if (e.key === "Enter" && idx >= 0) {
        e.preventDefault();
        gridRef.current?.querySelector<HTMLInputElement>("input[data-jml]")?.focus();
      }
    };
    const rows: ReactNode[] = [];
    for (let i = 0; i < total; i++) {
      const it = items[i];
      if (!it) {
        rows.push(
          <tr key={`e${i}`}>
            <td className="no">{i + 1}</td>
            <td className="kd">{i === items.length && (
              <GridKodeInput
                inputRef={scanRef}
                value={scan}
                autoFocus
                onChange={(e) => setScan(e.target.value)}
                onSearch={() => setCari(true)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onScan(); } }}
              />
            )}</td>
            <td /><td /><td /><td />
          </tr>,
        );
        continue;
      }
      const cur = selected === it.kode;
      rows.push(
        <tr key={it.kode} className={cur ? "cur" : ""} onMouseDown={() => !cur && setSelected(it.kode)}>
          <td className="no">{i + 1}</td>
          <td>{it.kode}</td>
          <td>{it.barcode}</td>
          <td className="nm">{it.nama}</td>
          <td className="r">{rp(it.hrgjual)}</td>
          <td className="r">{cur ? (
            <NumInput className="r" value={it.jml} onChange={(v) => setItems((xs) => xs.map((x) => (x === it ? { ...x, jml: v } : x)))} />
          ) : qty(it.jml)}</td>
        </tr>,
      );
    }
    return (
      <EntryGrid
        cols={COLS}
        gridRef={gridRef}
        onKeyDown={onKeyDown}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.dataset.jml) { e.preventDefault(); scanRef.current?.focus(); }
        }}
      >
        {rows}
      </EntryGrid>
    );
  };

  // Kotak jumlah cetak di baris terpilih ditandai supaya Enter bisa memfokuskannya.
  useEffect(() => {
    gridRef.current?.querySelectorAll<HTMLInputElement>("td.r input").forEach((el) => el.setAttribute("data-jml", "1"));
  });

  const totalLabel = items.reduce((s, i) => s + Math.max(0, Math.round(i.jml)), 0);

  return (
    <div className="flex size-full flex-col overflow-hidden bg-background font-sans text-xs text-foreground" data-form="FrmCetakBarcode">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-display px-3.5 py-2 text-display-foreground">
        <div className="flex items-center gap-4">
          <div className="flex flex-col" data-vb="lblJudul">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Layar</span>
            <span className="text-xl leading-none font-bold tracking-tight uppercase">{tag ? "Cetak Price Tag" : "Cetak Barcode"}</span>
          </div>
          <div className="h-7 w-px bg-display-foreground/15" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Jenis Barang</span>
            <span className="text-xl leading-none font-bold tabular-nums">{items.length}</span>
          </div>
          <div className="h-7 w-px bg-display-foreground/15" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Total Label</span>
            <span className="text-xl leading-none font-bold tabular-nums">{totalLabel}</span>
          </div>
        </div>
        <div className="text-xs font-medium text-display-foreground/80">
          Scan barcode atau ketik kode di tabel. F10 untuk mencari barang.
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/20 p-2.5" data-vb="tdBarang">
        {renderGrid()}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {!tag && (
            <div className="flex items-center gap-2" data-vb="cKode">
              <Label className="text-xs font-semibold text-foreground">Sumber Barcode</Label>
              <NativeSelect value={kodeJenis} onChange={(e) => setKodeJenis(e.target.value)} className="w-36">
                <NativeSelectOption value={KODE_BARANG}>{KODE_BARANG}</NativeSelectOption>
                <NativeSelectOption value={BARCODE}>{BARCODE}</NativeSelectOption>
              </NativeSelect>
            </div>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-foreground/20 bg-background font-semibold text-foreground shadow-2xs" onClick={() => setCari(true)}>
            <SearchIcon className="size-3.5" />
            <span>Cari Barang</span>
            <Kbd className="border border-border bg-muted text-foreground">F10</Kbd>
          </Button>
          <Button type="button" variant="outline" size="sm" data-vb="cFilter" className="h-8 gap-1.5 border-foreground/20 bg-background font-semibold text-foreground shadow-2xs" onClick={() => setFilter(true)}>
            <FilterIcon className="size-3.5" />
            <span>Filter Barang</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" data-vb="cTutup" className="h-8 gap-1.5 border-foreground/20 bg-background px-3 font-semibold text-foreground shadow-2xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="sm" data-vb="cCetak" className="h-8 gap-1.5 px-4 font-bold shadow-xs" onClick={() => void cetak()}>
            <PrinterIcon className="size-3.5" />
            <span>Cetak</span>
          </Button>
        </div>
      </div>

      {msg.node}
      {cari && (
        <CariBarang initial={scan} onClose={() => { setCari(false); scanRef.current?.focus(); }}
          onPick={(b) => { void add([b]); setCari(false); setScan(""); setTimeout(() => scanRef.current?.focus(), 0); }} />
      )}
      {filter && <FilterBarang onClose={() => setFilter(false)} onAdd={async (rows) => {
        setFilter(false);
        const n = await add(rows, true);
        msg.alert(n ? `${n} barang sudah ditambahkan ke daftar.` : "Tidak ada barang baru yang bisa ditambahkan.");
      }} />}
      {preview && (
        <Modal title={tag ? "Cetak Price Tag" : "Cetak Barcode"} wide onClose={() => setPreview(null)}
          footer={<><Button variant="outline" onClick={() => setPreview(null)}>Tutup</Button><Button autoFocus onClick={() => void cetakSekarang()}>Cetak</Button></>}>
          <p>{preview.length} label siap dicetak. Cek tampilannya di bawah, lalu klik Cetak.</p>
          <div className="lbl-preview rounded-md border border-border bg-muted/70"><Sheet mode={mode} items={preview} /></div>
        </Modal>
      )}
      {preview && createPortal(
        <div className="lbl-print">
          <style>{tag ? "@page { size: A4; margin: 8mm; }" : "@page { size: 101mm auto; margin: 0; }"}</style>
          <Sheet mode={mode} items={preview} />
        </div>,
        document.body,
      )}
    </div>
  );
}
