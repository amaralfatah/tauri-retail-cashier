import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { api, errText, Row } from "../api";
import { kasirApi } from "../api/kasir";
import { rp } from "../format";
import { GridCol, ModalFrame, useMsgBox, VbGrid } from "../vb/VbGrid";
import { getLocal } from "../pages/localSettings";
import { Alert } from "./Modal";

/**
 * Jendela Cari Barang (FrmCariBarang). Daftar muncul sambil mengetik (jeda 250 ms); Enter atau tombol Cari mencari seketika.
 * Ambil, klik dua kali, dan Enter di daftar memilih barang; Tutup atau Esc menutup.
 */
export function CariBarang(props: { initial?: string; onPick: (b: Row) => void; onClose: () => void; showBeli?: boolean; kasir?: boolean;
  /** Mode stok minimum: hanya barang dengan `stokakhir<=stokmin`. */
  stokMin?: boolean }) {
  const auto = getLocal("autoLoad") === "1";
  const msg = useMsgBox();
  const [q, setQ] = useState(props.initial ?? "");
  const [kata, setKata] = useState<string | null>(auto || props.initial ? (props.initial ?? "") : null);
  const [list, setList] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [selesai, setSelesai] = useState(false);
  const [cari, setCari] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const segera = useRef(false);
  useEffect(() => { if (auto) setKata(q); }, [q, auto]);

  useEffect(() => {
    if (kata === null) return;
    setSelesai(false);
    let batal = false;
    const tunda = segera.current ? 0 : 250;
    segera.current = false;
    const t = setTimeout(() => {
      (props.kasir ? kasirApi.cariBarang(kata, 500) : api.barangSearch(kata, 500, props.stokMin))
        .then((r) => {
          const rows = Array.isArray(r) ? r : [];
          if (!batal) { setList(rows); setSel(rows[0]?.kodebarang ?? null); setErr(""); setSelesai(true); }
        })
        .catch((e) => !batal && setErr(errText(e)));
    }, tunda);
    return () => { batal = true; clearTimeout(t); };
  }, [kata, cari, props.kasir, props.stokMin]);
  const cariSekarang = () => { segera.current = true; setKata(q); setCari((n) => n + 1); };

  useEffect(() => {
    const el = root.current?.querySelector<HTMLInputElement>('[data-vb="tData"] input');
    el?.focus();
    el?.select();
  }, []);

  // Alt+O menekan Cari (dulu OK), Alt+D ke kotak cari.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.code === "KeyO") { e.preventDefault(); cariRef.current(); }
      else if (e.code === "KeyD") {
        e.preventDefault();
        const el = root.current?.querySelector<HTMLInputElement>('[data-vb="tData"] input');
        el?.focus(); el?.select();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const cariRef = useRef(cariSekarang);
  cariRef.current = cariSekarang;

  const ambil = (r?: Row) => {
    const x = r ?? list.find((y) => y.kodebarang === sel);
    if (!x) return;
    if (Number(x.aktif ?? 1) === 0) {
      msg.confirm("Barang ini berstatus tidak aktif dan biasanya tidak dijual. Tetap pilih barang ini?", () => props.onPick(x), "Barang tidak aktif");
      return;
    }
    props.onPick(x);
  };

  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 115, render: (r) => r.kodebarang },
    { title: "Nama Barang", width: 310, render: (r) => r.namabarang },
    { title: props.showBeli ? "Hrg. Beli" : "Hrg. Jual", width: 100, align: "right", render: (r) => rp(props.showBeli ? r.hrgbeli : r.hrgjual) },
    { title: "Stok", width: 85, align: "right", render: (r) => (r.jenis === "Jasa" ? "" : qty2(r.stokakhir)) },
    { title: "Rak", width: 75, render: (r) => r.rak ?? "" },
    { title: "Status", width: 70, render: (r) => (Number(r.aktif ?? 1) === 0 ? "Tdk.Aktif" : "Aktif") },
  ];

  return (
    <ModalFrame title="Cari Data Barang" width={820} height={520} onClose={props.onClose}>
      <div ref={root} data-form="FrmCariBarang" className="flex size-full min-h-0 flex-col justify-between gap-2.5 p-3 font-sans text-xs text-foreground">
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs font-medium text-foreground">Cari</Label>
          <div className="flex-1" data-vb="tData">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={auto ? "Ketik nama, kode, atau barcode..." : "Ketik nama, kode, atau barcode, lalu Enter"}
              className="h-8 text-xs uppercase placeholder:normal-case"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cariSekarang(); }
                else if (e.key === "ArrowDown") { e.preventDefault(); root.current?.querySelector<HTMLElement>('[data-slot="vbg"], .vbg')?.focus(); }
              }}
            />
          </div>
          <Button type="button" variant="outline" size="default" data-vb="cOK" className="h-8 px-3 text-xs font-medium" onClick={cariSekarang}>
            Cari
          </Button>
        </div>

        {err && <Alert>{err}</Alert>}

        <div className="relative min-h-0 flex-1" data-vb="lsData">
          <VbGrid cols={cols} rows={list} rowKey={(r) => r.kodebarang} selected={sel} onSelect={setSel} onOpen={ambil} />
          {selesai && list.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[30px] bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
              Barang tidak ditemukan. Coba kata lain.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="text-xs text-muted-foreground">{list.length} barang ditemukan · Panah ↓ ke daftar</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="default" data-vb="cClose" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={props.onClose}>
              <span>Tutup</span>
              <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            <Button type="button" variant="default" size="default" data-vb="cAmbil" className="h-8 gap-1.5 px-3.5 text-xs font-semibold" onClick={() => ambil()}>
              <span>Ambil</span>
              <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            </Button>
          </div>
        </div>
        {msg.node}
      </div>
    </ModalFrame>
  );
}

const qty2 = (n: unknown) => (Number(n) || 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
