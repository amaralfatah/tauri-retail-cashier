import { useEffect, useRef, useState } from "react";
import { rp } from "../format";
import type { Unit } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, VbGrid, VbModal } from "../vb/VbGrid";

/** Jendela Cari Satuan (FrmCariSatuan): daftar satuan satu barang. Ambil, klik dua kali, atau Enter memilih. */
export function CariSatuan(props: { units: Unit[]; aktif: number; jual: boolean; onPick: (index: number) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(String(props.aktif));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>(".vbg")?.focus(); }, []);
  const rows = props.units.map((u, i) => ({ ...u, i: String(i) }));
  type R = (typeof rows)[number];
  // Kolom asli: No, Satuan, Konversi, Hrg.Satuan (per satuan dasar), Hrg.Multi Satuan (harga satu satuan ini).
  const harga = (r: R) => (props.jual ? r.hargaJual : r.hargaBeli);
  const cols: GridCol<R>[] = [
    { title: "No", width: 40, align: "right", render: (_r, i) => i + 1 },
    { title: "Satuan", width: 100, render: (r) => r.satuan },
    { title: "Konversi", width: 80, align: "right", render: (r) => r.konversi },
    { title: "Hrg.Satuan", width: 110, align: "right", render: (r) => rp(r.konversi > 0 ? harga(r) / r.konversi : harga(r)) },
    { title: "Hrg.Multi Satuan", width: 130, align: "right", render: (r) => rp(harga(r)) },
  ];
  const ambil = (r?: R) => {
    const x = r ?? rows.find((y) => y.i === sel);
    if (x) props.onPick(Number(x.i));
  };
  const bind: Record<string, Bind> = {
    lsData: () => <VbGrid cols={cols} rows={rows} rowKey={(r) => r.i} selected={sel} onSelect={setSel} onOpen={ambil} />,
    cAmbil: { onClick: () => ambil() },
    cClose: { onClick: props.onClose },
  };
  return <div ref={root} style={{ display: "contents" }}><VbModal form="FrmCariSatuan" bind={bind} onClose={props.onClose} /></div>;
}
