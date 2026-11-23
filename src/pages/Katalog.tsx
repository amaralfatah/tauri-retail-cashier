import { useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { qty, rp } from "../format";
import { GridCol, useMsgBox, VbGrid } from "../vb/VbGrid";
import { kotakFoto, useFotoBarang } from "./fotoBarang";

const COLS: GridCol<Row>[] = [
  { title: "No", width: 45, align: "right", render: (_r, i) => i + 1 },
  { title: "Kode", width: 105, render: (r) => r.kodebarang },
  { title: "Nama Barang", width: 290, render: (r) => r.namabarang },
  { title: "Stok", width: 80, align: "right", render: (r) => qty(r.stokakhir) },
  { title: "Satuan", width: 70, render: (r) => r.kodesatuan },
  { title: "Harga Jual", width: 100, align: "right", render: (r) => rp(r.hrgjual) },
];

/** Katalog Barang (FrmKatalogBrg): daftar barang untuk dilihat saja, dengan rincian barang yang dipilih. */
export function Katalog() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [cari, setCari] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const seq = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const muat = useCallback((q: string) => {
    const n = ++seq.current;
    inventoriApi.katalog(q)
      .then((r) => {
        const list = Array.isArray(r) ? r : [];
        if (n === seq.current) {
          setRows(list);
          setSel((s) => (list.some((x) => x.kodebarang === s) ? s : list[0]?.kodebarang ?? null));
        }
      })
      .catch((e) => msg.alert(errText(e)));
  }, [msg]);
  useEffect(() => { muat(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Cari sambil mengetik: tunggu sebentar setelah ketikan terakhir. Enter dan tombol Cari tetap mencari seketika.
  const pertama = useRef(true);
  useEffect(() => {
    if (pertama.current) { pertama.current = false; return; }
    const id = window.setTimeout(() => muat(cari), 250);
    return () => window.clearTimeout(id);
  }, [cari]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !msg.node) go("home"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, msg.node]);

  const cur = rows.find((r) => r.kodebarang === sel);
  const foto = useFotoBarang(cur?.kodebarang);
  const renderFoto = kotakFoto(foto.src);

  return (
    <div
      className="vb-modern flex h-full min-h-0 flex-col gap-2.5 bg-background p-3 font-sans text-xs text-foreground"
      ref={wrapRef}
      data-form="FrmKatalogBrg"
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
        <Label className="shrink-0 text-xs font-semibold text-foreground">Cari Barang</Label>
        <div className="flex-1" data-vb="tCari">
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Ketik kode, barcode, atau nama barang…"
            className="h-8 border-foreground/25 bg-background text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); muat(cari); }
              else if (e.key === "ArrowDown") { e.preventDefault(); wrapRef.current?.querySelector<HTMLElement>(".vbg")?.focus(); }
            }}
          />
        </div>
        <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs font-semibold" data-vb="cCari" onClick={() => muat(cari)}>
          <SearchIcon className="size-3.5" />
          <span>Cari</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1" data-vb="lsData">
        <VbGrid cols={COLS} rows={rows} rowKey={(r) => r.kodebarang} selected={sel} onSelect={setSel} />
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-card p-3 shadow-2xs sm:grid-cols-[1fr_140px]">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Kode Barang</Label>
            <div className="mt-0.5 rounded border border-border bg-muted/50 px-2 py-1 font-semibold text-foreground tabular-nums">{cur?.kodebarang || "-"}</div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Barcode</Label>
            <div className="mt-0.5 rounded border border-border bg-muted/50 px-2 py-1 font-semibold text-foreground tabular-nums">{cur?.barcode || "-"}</div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Jenis / Satuan / Rak</Label>
            <div className="mt-0.5 truncate rounded border border-border bg-muted/50 px-2 py-1 font-medium text-foreground">
              {[cur?.jenis, cur?.kodesatuan, cur?.rak && `Rak ${cur.rak}`].filter(Boolean).join(" · ") || "-"}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <Label className="text-[11px] font-semibold text-foreground">Nama Barang</Label>
            <div className="mt-0.5 truncate rounded border border-border bg-muted/50 px-2 py-1.5 text-sm font-bold text-foreground">{cur?.namabarang || "-"}</div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Kelompok & Kategori</Label>
            <div className="mt-0.5 truncate rounded border border-border bg-muted/50 px-2 py-1 text-foreground">
              {[cur?.namakelompok, cur?.namakategori].filter(Boolean).join(" / ") || "-"}
            </div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Harga Jual</Label>
            <div className="mt-0.5 rounded bg-display px-2.5 py-1 text-right text-sm font-extrabold text-display-foreground tabular-nums">
              {cur ? `Rp ${rp(cur.hrgjual)}` : "-"}
            </div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold text-foreground">Stok Akhir</Label>
            <div className="mt-0.5 rounded border border-border bg-muted px-2.5 py-1 text-right text-sm font-extrabold text-foreground tabular-nums">
              {cur ? `${qty(cur.stokakhir)} ${cur.kodesatuan ?? ""}` : "-"}
            </div>
          </div>
        </div>
        <div className="flex flex-col justify-between gap-2">
          <div className="h-28 w-full overflow-hidden rounded border border-border bg-muted/30" data-vb="picFoto">
            {typeof renderFoto === "function" ? renderFoto({ left: 0, top: 0, width: 140, height: 112 }, { type: "PictureBox", name: "picFoto", props: {}, children: [] }) : null}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5 font-semibold" data-vb="cTutup" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
        </div>
      </div>
      {msg.node}
    </div>
  );
}
