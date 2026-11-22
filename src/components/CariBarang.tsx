import { useEffect, useRef, useState } from "react";
import { api, errText, Row } from "../api";
import { kasirApi } from "../api/kasir";
import { rp } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { getLocal } from "../pages/localSettings";

/**
 * Jendela Cari Barang (FrmCariBarang). Mengetik atau menekan OK mencari kode atau nama barang;
 * Ambil, klik dua kali, dan Enter di daftar memilih barang; Tutup atau Esc menutup.
 */
export function CariBarang(props: { initial?: string; onPick: (b: Row) => void; onClose: () => void; showBeli?: boolean; kasir?: boolean;
  /** Mode stok minimum: hanya barang dengan `stokakhir<=stokmin`. */
  stokMin?: boolean }) {
  // Pengaturan per komputer AutoLoadData (global 0x8c5190 di EXE): hidup = daftar dimuat dan dicari otomatis setiap ketikan;
  // mati = baru dicari saat OK atau Enter.
  const auto = getLocal("autoLoad") === "1";
  const msg = useMsgBox();
  const [q, setQ] = useState(props.initial ?? "");
  const [kata, setKata] = useState<string | null>(auto || props.initial ? (props.initial ?? "") : null);
  const [list, setList] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [cari, setCari] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { if (auto) setKata(q); }, [q, auto]);

  useEffect(() => {
    if (kata === null) return;
    let batal = false;
    const t = setTimeout(() => {
      (props.kasir ? kasirApi.cariBarang(kata, 500) : api.barangSearch(kata, 500, props.stokMin))
        .then((r) => { if (!batal) { setList(r); setSel(r[0]?.kodebarang ?? null); setErr(""); } })
        .catch((e) => !batal && setErr(errText(e)));
    }, 150);
    return () => { batal = true; clearTimeout(t); };
  }, [kata, cari, props.kasir, props.stokMin]);
  const cariSekarang = () => { setKata(q); setCari((n) => n + 1); };

  useEffect(() => {
    const el = root.current?.querySelector<HTMLInputElement>('[data-vb="tData"] input');
    el?.focus();
    el?.select();
  }, []);

  // Alt+O menekan OK, Alt+D ke kotak Data (tanda & pada caption aslinya).
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
      msg.confirm("Status barang tidak aktif tidak dapat digunakan dalam transaksi.\nApakah akan dipilih barang tidak aktif?", () => props.onPick(x), "Konfirmasi");
      return;
    }
    props.onPick(x);
  };

  const cols: GridCol<Row>[] = [
    { title: "No", width: 40, render: (_r, i) => i + 1 },
    { title: "Kode", width: 120, render: (r) => r.kodebarang },
    { title: "Nama", width: 330, render: (r) => r.namabarang },
    { title: "Harga", width: 100, align: "right", render: (r) => rp(r.hrgjual) },
    { title: "Stok", width: 80, align: "right", render: (r) => (r.jenis === "Jasa" ? "" : qty2(r.stokakhir)) },
    { title: "Rak", width: 75, render: (r) => r.rak ?? "" },
    { title: "Status", width: 55, render: (r) => (Number(r.aktif ?? 1) === 0 ? "Tdk.Aktif" : "Aktif") },
  ];

  const bind: Record<string, Bind> = {
    tData: {
      value: q, onChange: setQ,
      style: { textTransform: "uppercase" },
    },
    cOK: { onClick: cariSekarang },
    lsData: () => <VbGrid cols={cols} rows={list} rowKey={(r) => r.kodebarang} selected={sel} onSelect={setSel} onOpen={ambil} />,
    cAmbil: { onClick: () => ambil() },
    cClose: { onClick: props.onClose },
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.closest('[data-vb="tData"]')) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cariSekarang(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); root.current?.querySelector<HTMLElement>(".vbg")?.focus(); }
    }
  };

  return (
    <div ref={root} onKeyDownCapture={onKeyDown}>
      <VbModal form="FrmCariBarang" bind={bind} onClose={props.onClose}>{err && <div className="vbm-msg">{err}</div>}{msg.node}</VbModal>
    </div>
  );
}

const qty2 = (n: unknown) => (Number(n) || 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
