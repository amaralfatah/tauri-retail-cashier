import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { api, Row } from "../api";
import { rp, tglID, today } from "../format";
import { GridCol, ModalFrame, VbGrid } from "../vb/VbGrid";

/**
 * FrmCariTransJual / FrmCariTransBeli: daftar transaksi untuk dipilih (asal retur, cetak ulang, surat jalan, SPK).
 * Tanggal awal dan akhir hari ini, daftar dimuat ulang tiap ketikan, panah bawah dari kotak cari pindah ke daftar.
 */
export function CariTransaksi(props: { kode: "TJ" | "TB"; onPick: (notrans: string) => void; onClose: () => void }) {
  const jual = props.kode === "TJ";
  const [cari, setCari] = useState("");
  const [tgl1, setTgl1] = useState(today());
  const [tgl2, setTgl2] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [muat, setMuat] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      api.listTransaksi(props.kode, tgl1, tgl2, cari)
        .then((r) => {
          const list = Array.isArray(r) ? r : [];
          if (!batal) { setRows(list); setSel((cur) => (list.some((x) => x.notrans === cur) ? cur : list[0]?.notrans ?? null)); }
        })
        .catch(() => !batal && setRows([]));
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [props.kode, tgl1, tgl2, cari, muat]);

  const ambil = (r?: Row) => {
    const x = r ?? rows.find((y) => y.notrans === sel);
    if (x) props.onPick(x.notrans);
  };

  const cols: GridCol<Row>[] = [
    { title: "No. Transaksi", width: 150, render: (r) => r.notrans },
    { title: "Tanggal", width: 100, render: (r) => tglID(r.tgltrans), sortValue: (r) => String(r.tgltrans ?? "") },
    { title: jual ? "Pelanggan" : "Supplier", width: 220, render: (r) => r.kontak },
    { title: "Sales", width: 130, render: (r) => r.sales },
    { title: "Total", width: 120, align: "right", render: (r) => rp(r.totaltrans), sortValue: (r) => Number(r.totaltrans) || 0 },
  ];

  return (
    <ModalFrame title={jual ? "Cari Transaksi Penjualan" : "Cari Transaksi Pembelian"} width={760} height={500} onClose={props.onClose}>
      <div ref={root} data-form={jual ? "FrmCariTransJual" : "FrmCariTransBeli"} className="flex size-full min-h-0 flex-col justify-between gap-2.5 p-3 font-sans text-xs text-foreground">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-44 flex-1 flex-col gap-1" data-vb="tData">
            <Label className="text-xs font-medium text-foreground">Cari</Label>
            <Input
              autoFocus
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={jual ? "Nomor transaksi atau nama pelanggan..." : "Nomor transaksi atau nama supplier..."}
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setMuat((n) => n + 1); }
                else if (e.key === "ArrowDown" && rows.length) {
                  e.preventDefault();
                  root.current?.querySelector<HTMLElement>('[data-slot="vbg"], .vbg')?.focus();
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-1" data-vb="dtTgl1">
            <Label className="text-xs font-medium text-foreground">Dari</Label>
            <Input type="date" value={tgl1} onChange={(e) => e.target.value && setTgl1(e.target.value)} className="h-8 w-36 text-xs tabular-nums" />
          </div>
          <div className="flex flex-col gap-1" data-vb="dtTgl2">
            <Label className="text-xs font-medium text-foreground">Sampai</Label>
            <Input type="date" value={tgl2} onChange={(e) => e.target.value && setTgl2(e.target.value)} className="h-8 w-36 text-xs tabular-nums" />
          </div>
          <Button type="button" variant="outline" size="default" data-vb="cOK" className="h-8 px-3 text-xs font-medium" onClick={() => setMuat((n) => n + 1)}>
            Cari
          </Button>
        </div>

        <div className="relative min-h-0 flex-1" data-vb="lsData">
          <VbGrid cols={cols} rows={rows} rowKey={(r) => String(r.notrans)} selected={sel} onSelect={setSel} onOpen={ambil} />
          {rows.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-[30px] bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
              {jual ? "Transaksi tidak ditemukan. Ubah tanggal atau coba kata lain." : "Pembelian tidak ditemukan. Ubah tanggal atau coba kata lain."}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <span className="text-xs text-muted-foreground">{rows.length} transaksi ditemukan</span>
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
      </div>
    </ModalFrame>
  );
}
