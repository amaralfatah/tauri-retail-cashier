import { useEffect, useState } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, Row } from "../api";
import { rp, tglID, today } from "../format";
import { Geom } from "../vb/VbForm";
import { VbModal } from "../vb/VbGrid";

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

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      api.listTransaksi(props.kode, tgl1, tgl2, cari)
        .then((r) => { if (!batal) { setRows(r); setSel(0); } })
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

  const bind = {
    LabelData: { text: "Cari" },
    tData: () => (
      <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={jual ? "Ketik nomor transaksi atau nama pelanggan" : "Ketik nomor transaksi atau nama supplier"}
        className="h-full w-full rounded-sm bg-background px-1.5 py-0 leading-none [font-size:inherit] md:[font-size:inherit]" />
    ),
    dtTgl1: { value: tgl1, onChange: (v: string) => v && setTgl1(v) },
    dtTgl2: { value: tgl2, onChange: (v: string) => v && setTgl2(v) },
    cOK: { text: "Cari", onClick: () => setMuat((n) => n + 1) },
    cAmbil: { text: "Ambil [Enter]", onClick: ambil, variant: "default" as const },
    cClose: { text: "Tutup [Esc]", onClick: props.onClose },
    lsData: (_g: Geom) => (
      <div
        data-slot="cari-data"
        tabIndex={0}
        onKeyDown={onListKeyDown}
        className="cari-data tp-scroll-always size-full rounded-md border border-border bg-card font-sans text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&>[data-slot=table-container]]:overflow-visible"
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
                  <TableCell className={cn("h-6.5 truncate border-r px-2 py-0 tabular-nums", cur ? "border-transparent" : "border-border")}>{r.notrans}</TableCell>
                  <TableCell className={cn("h-6.5 truncate border-r px-2 py-0 tabular-nums", cur ? "border-transparent" : "border-border")}>{tglID(r.tgltrans)}</TableCell>
                  <TableCell className={cn("h-6.5 truncate border-r px-2 py-0", cur ? "border-transparent" : "border-border")}>{r.kontak}</TableCell>
                  <TableCell className={cn("h-6.5 truncate border-r px-2 py-0", cur ? "border-transparent" : "border-border")}>{r.sales}</TableCell>
                  <TableCell className="h-6.5 truncate px-2 py-0 text-right tabular-nums">{rp(r.totaltrans)}</TableCell>
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
    ),
  };
  // Enter di kotak cari memuat ulang; panah bawah dari kotak cari pindah ke daftar bila ada isinya.
  return (
    <div className="contents" onKeyDownCapture={(e) => {
      if (!(e.target instanceof HTMLInputElement)) return;
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setMuat((n) => n + 1); }
      else if (e.key === "ArrowDown" && e.target.closest('[data-vb="tData"]') && rows.length) {
        e.preventDefault();
        document.querySelector<HTMLElement>('[data-slot="cari-data"], .cari-data')?.focus();
      }
    }}>
      <VbModal form={jual ? "FrmCariTransJual" : "FrmCariTransBeli"} bind={bind} onClose={props.onClose} />
    </div>
  );
}
