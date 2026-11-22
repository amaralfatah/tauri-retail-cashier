import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { qty, rp } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid } from "../vb/VbGrid";
import { kotakFoto, useFotoBarang } from "./fotoBarang";

const COLS: GridCol<Row>[] = [
  { title: "No", width: 45, align: "right", render: (_r, i) => i + 1 },
  { title: "Kode", width: 100, render: (r) => r.kodebarang },
  { title: "Nama", width: 290, render: (r) => r.namabarang },
  { title: "Stok", width: 70, align: "right", render: (r) => qty(r.stokakhir) },
  { title: "Satuan", width: 65, render: (r) => r.kodesatuan },
  { title: "Harga", width: 85, align: "right", render: (r) => rp(r.hrgjual) },
];

const ANCHOR = { lsData: { left: true, right: true }, picFoto: { right: true }, Picture1: { left: true, right: true }, Picture2: { left: true, right: true, bottom: true } };

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
      .then((r) => { if (n === seq.current) { setRows(r); setSel((s) => (r.some((x) => x.kodebarang === s) ? s : r[0]?.kodebarang ?? null)); } })
      .catch((e) => msg.alert(errText(e)));
  }, [msg]);
  useEffect(() => { muat(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !msg.node) go("home"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, msg.node]);

  const cur = rows.find((r) => r.kodebarang === sel);
  const foto = useFotoBarang(cur?.kodebarang);
  const one = (v: unknown): Bind => ({ value: String(v ?? ""), children: <option value={String(v ?? "")}>{String(v ?? "")}</option>, disabled: true });
  const bind = useMemo<Record<string, Bind>>(() => ({
    tCari: { value: cari, onChange: setCari },
    cCari: { onClick: () => muat(cari) },
    lsData: () => <VbGrid cols={COLS} rows={rows} rowKey={(r) => r.kodebarang} selected={sel} onSelect={setSel} />,
    picFoto: kotakFoto(foto.src),
    cJenis: one(cur?.jenis),
    cKelompokNama: one(cur?.namakelompok),
    cKelompokKode: one(cur?.kodekelompok),
    cKategoriNama: one(cur?.namakategori),
    cKategoriKode: one(cur?.kodekategori),
    cPemasokNama: one(cur?.namapemasok),
    cPemasokKode: one(cur?.kodepemasok),
    cSatuan: one(cur?.kodesatuan),
    cRak: one(cur?.rak),
    tKode: { value: String(cur?.kodebarang ?? "") },
    tBarcode: { value: String(cur?.barcode ?? "") },
    tNama: { value: String(cur?.namabarang ?? "") },
    tHrgJual: { value: cur ? rp(cur.hrgjual) : "" },
    tStokAkhir: { value: cur ? qty(cur.stokakhir) : "" },
    cTutup: { onClick: () => go("home") },
  }), [cari, rows, sel, cur, muat, go, foto.src]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="vbm-fill" ref={wrapRef} onKeyDown={(e) => {
      if (!(e.target as HTMLElement).closest('[data-vb="tCari"]')) return;
      if (e.key === "Enter") { e.preventDefault(); muat(cari); }
      else if (e.key === "ArrowDown") { e.preventDefault(); wrapRef.current?.querySelector<HTMLElement>(".vbg")?.focus(); }
    }}>
      <VbForm form="FrmKatalogBrg" bind={bind} fill anchor={ANCHOR} />
      {msg.node}
    </div>
  );
}
