import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { rp } from "../format";
import type { Unit } from "../format";
import { GridCol, ModalFrame, VbGrid } from "../vb/VbGrid";

/** Jendela Cari Satuan (FrmCariSatuan): daftar satuan satu barang. Ambil, klik dua kali, atau Enter memilih. */
export function CariSatuan(props: { units: Unit[]; aktif: number; jual: boolean; onPick: (index: number) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string | null>(String(props.aktif));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[data-slot="vbg"], .vbg')?.focus(); }, []);
  const rows = props.units.map((u, i) => ({ ...u, i: String(i) }));
  type R = (typeof rows)[number];
  const harga = (r: R) => (props.jual ? r.hargaJual : r.hargaBeli);
  const cols: GridCol<R>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: "Satuan", width: 100, render: (r) => r.satuan },
    { title: "Konversi", width: 85, align: "right", render: (r) => r.konversi },
    { title: "Hrg. Satuan", width: 115, align: "right", render: (r) => rp(r.konversi > 0 ? harga(r) / r.konversi : harga(r)) },
    { title: "Hrg. Multi Satuan", width: 135, align: "right", render: (r) => rp(harga(r)) },
  ];
  const ambil = (r?: R) => {
    const x = r ?? rows.find((y) => y.i === sel);
    if (x) props.onPick(Number(x.i));
  };
  return (
    <ModalFrame title="Pilih Satuan Barang" width={540} height={320} onClose={props.onClose}>
      <div ref={root} className="flex size-full min-h-0 flex-col justify-between gap-2.5 p-3 font-sans text-xs text-foreground" data-form="FrmCariSatuan">
        <div className="min-h-0 flex-1" data-vb="lsData">
          <VbGrid cols={cols} rows={rows} rowKey={(r) => r.i} selected={sel} onSelect={setSel} onOpen={ambil} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-2.5">
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
    </ModalFrame>
  );
}
