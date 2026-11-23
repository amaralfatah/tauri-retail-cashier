import { useEffect, useRef, useState } from "react";
import { api, errText, Row } from "../api";
import { kasirApi } from "../api/kasir";
import { rp } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { Input } from "@/components/ui/input";
import { getLocal } from "../pages/localSettings";
import { Alert } from "./Modal";

/**
 * Jendela Cari Barang (FrmCariBarang). Daftar muncul sambil mengetik (jeda 250 ms); Enter atau tombol Cari mencari seketika.
 * Ambil, klik dua kali, dan Enter di daftar memilih barang; Tutup atau Esc menutup.
 */
export function CariBarang(props: { initial?: string; onPick: (b: Row) => void; onClose: () => void; showBeli?: boolean; kasir?: boolean;
  /** Mode stok minimum: hanya barang dengan `stokakhir<=stokmin`. */
  stokMin?: boolean }) {
  // Pengaturan per komputer AutoLoadData (dari VB): hidup = daftar dimuat dan dicari sambil mengetik;
  // mati = baru dicari saat Enter atau tombol Cari (dipakai di komputer lambat atau katalog besar).
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
        .then((r) => { if (!batal) { setList(r); setSel(r[0]?.kodebarang ?? null); setErr(""); setSelesai(true); } })
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

  // Alt+O menekan Cari (dulu OK), Alt+D ke kotak cari (tanda & pada caption aslinya).
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
    { title: "No", width: 40, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 120, render: (r) => r.kodebarang },
    { title: "Nama", width: 330, render: (r) => r.namabarang },
    { title: "Harga", width: 100, align: "right", render: (r) => rp(r.hrgjual) },
    { title: "Stok", width: 80, align: "right", render: (r) => (r.jenis === "Jasa" ? "" : qty2(r.stokakhir)) },
    { title: "Rak", width: 75, render: (r) => r.rak ?? "" },
    { title: "Status", width: 55, render: (r) => (Number(r.aktif ?? 1) === 0 ? "Tdk.Aktif" : "Aktif") },
  ];

  const bind: Record<string, Bind> = {
    LabelData: { text: "Cari" },
    tData: () => (
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={auto ? "Ketik nama, kode, atau barcode" : "Ketik nama, kode, atau barcode, lalu Enter"}
        className="h-full w-full rounded-sm bg-background px-1.5 py-0 leading-none uppercase [font-size:inherit] placeholder:normal-case md:[font-size:inherit]" />
    ),
    cOK: { text: "Cari", onClick: cariSekarang },
    lsData: () => (
      <div className="relative size-full">
        <VbGrid cols={cols} rows={list} rowKey={(r) => r.kodebarang} selected={sel} onSelect={setSel} onOpen={ambil} />
        {selesai && list.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-[30px] bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
            Barang tidak ditemukan. Coba kata lain.
          </div>
        )}
      </div>
    ),
    cAmbil: { text: "Ambil [Enter]", onClick: () => ambil(), variant: "default" },
    cClose: { text: "Tutup [Esc]", onClick: props.onClose },
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.closest('[data-vb="tData"]')) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cariSekarang(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); root.current?.querySelector<HTMLElement>('[data-slot="vbg"], .vbg')?.focus(); }
    }
  };

  return (
    <div ref={root} onKeyDownCapture={onKeyDown}>
      <VbModal form="FrmCariBarang" bind={bind} onClose={props.onClose}>
        {err && <div className="mt-2"><Alert>{err}</Alert></div>}
        {msg.node}
      </VbModal>
    </div>
  );
}

const qty2 = (n: unknown) => (Number(n) || 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
