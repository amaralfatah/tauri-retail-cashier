import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, Row } from "../api";
import { rp, tglID, today } from "../format";
import { ModalFrame } from "../vb/VbGrid";

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
  const [sel, setSel] = useState(0);
  const [muat, setMuat] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      api.listTransaksi(props.kode, tgl1, tgl2, cari)
        .then((r) => {
          const list = Array.isArray(r) ? r : [];
          if (!batal) { setRows(list); setSel(0); }
        })
        .catch(() => !batal && setRows([]));
    }, 250);
    return () => { batal = true; clearTimeout(t); };
  }, [props.kode, tgl1, tgl2, cari, muat]);

  const ambil = () => rows[sel] && props.onPick(rows[sel].notrans);
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); ambil(); }
  };

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
                  root.current?.querySelector<HTMLElement>('[data-slot="cari-data"], .cari-data')?.focus();
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

        <div
          data-slot="cari-data"
          data-vb="lsData"
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="cari-data tp-scroll-always min-h-0 flex-1 rounded-md border border-foreground/20 bg-card font-sans text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&>[data-slot=table-container]]:overflow-visible"
        >
          <Table className="table-fixed border-collapse">
            <colgroup><col className="w-[22%]" /><col className="w-[14%]" /><col className="w-[28%]" /><col className="w-[18%]" /><col className="w-[18%]" /></colgroup>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted hover:bg-muted">
                <TableHead className="sticky top-0 z-20 h-7 border-r border-border bg-muted px-2 text-left text-xs font-semibold text-foreground">No. Transaksi</TableHead>
                <TableHead className="sticky top-0 z-20 h-7 border-r border-border bg-muted px-2 text-left text-xs font-semibold text-foreground">Tanggal</TableHead>
                <TableHead className="sticky top-0 z-20 h-7 border-r border-border bg-muted px-2 text-left text-xs font-semibold text-foreground">{jual ? "Pelanggan" : "Supplier"}</TableHead>
                <TableHead className="sticky top-0 z-20 h-7 border-r border-border bg-muted px-2 text-left text-xs font-semibold text-foreground">Sales</TableHead>
                <TableHead className="sticky top-0 z-20 h-7 bg-muted px-2 text-right text-xs font-semibold text-foreground">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const cur = i === sel;
                return (
                  <TableRow
                    key={r.notrans}
                    data-state={cur ? "selected" : undefined}
                    onMouseDown={() => setSel(i)}
                    onDoubleClick={() => props.onPick(r.notrans)}
                    className={cn(
                      "cursor-default border-b border-border",
                      cur ? "bg-primary text-primary-foreground hover:bg-primary" : "hover:bg-muted",
                    )}
                  >
                    <TableCell className={cn("h-7 truncate border-r px-2 py-0 tabular-nums", cur ? "border-transparent" : "border-border")}>{r.notrans}</TableCell>
                    <TableCell className={cn("h-7 truncate border-r px-2 py-0 tabular-nums", cur ? "border-transparent" : "border-border")}>{tglID(r.tgltrans)}</TableCell>
                    <TableCell className={cn("h-7 truncate border-r px-2 py-0", cur ? "border-transparent" : "border-border")}>{r.kontak}</TableCell>
                    <TableCell className={cn("h-7 truncate border-r px-2 py-0", cur ? "border-transparent" : "border-border")}>{r.sales}</TableCell>
                    <TableCell className="h-7 truncate px-2 py-0 text-right tabular-nums">{rp(r.totaltrans)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
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
            <Button type="button" variant="default" size="default" data-vb="cAmbil" className="h-8 gap-1.5 px-3.5 text-xs font-semibold" onClick={ambil}>
              <span>Ambil</span>
              <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
