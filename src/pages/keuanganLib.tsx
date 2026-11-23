import { ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Alert } from "../components/Modal";
import { api, errText, MasterTable, Row } from "../api";
import { rp } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, ModalFrame, VbGrid } from "../vb/VbGrid";
import { KEYS } from "./masterLib";

export const s = (v: unknown) => String(v ?? "");
export const txt = (v: unknown, set?: (x: string) => void, disabled?: boolean): Bind => ({ value: s(v), onChange: set, disabled });
export const opsi = (list: string[], kosong?: string): ReactNode => (
  <>
    {kosong !== undefined && <option value="">{kosong}</option>}
    {list.map((o) => <option key={o} value={o}>{o}</option>)}
  </>
);

const TITLE_CARI: Record<string, string> = {
  mdpelanggan: "Cari Pelanggan",
  mdpemasok: "Cari Supplier",
  mdkaryawan: "Cari Karyawan",
};

/**
 * Jendela Cari Pelanggan / Supplier / Karyawan (tombol "..."). Seperti aslinya: semua data tampil (juga yang tidak aktif),
 * pencarian hanya mencocokkan kode dan nama, dan Panah Bawah di kotak cari pindah ke daftar.
 * `jthTempo` menampilkan tombol Jatuh Tempo (khusus Cari Pelanggan; aslinya hanya bila pemanggil menyalakannya).
 */
export function CariMaster(props: { table: Extract<MasterTable, "mdpelanggan" | "mdpemasok" | "mdkaryawan">; onPick: (r: Row) => void; onClose: () => void; jthTempo?: boolean;
  /** Buka langsung di daftar pelanggan yang piutangnya jatuh tempo (dari pemberitahuan). */
  awalJthTempo?: boolean }) {
  const { key, name } = KEYS[props.table];
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [jth, setJth] = useState(!!props.awalJthTempo);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const ambil = jth ? api.pelangganJatuhTempo(q) : api.masterList(props.table, { search: q, limit: 300, sort: key, hanyaKodeNama: true }).then((r) => r.rows);
      ambil.then((r) => { setRows(r); setSel((prev) => (prev && r.some((x) => x[key] === prev) ? prev : r[0]?.[key] ?? null)); setErr(""); }).catch((e) => setErr(errText(e)));
    }, 150);
    return () => clearTimeout(t);
  }, [q, props.table, key, jth]);
  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 110, render: (r) => r[key] },
    { title: "Nama", width: 220, render: (r) => r[name] },
    { title: "Alamat", width: 200, render: (r) => r.alamat },
    ...(props.table === "mdpelanggan" ? [
      { title: "Level", width: 60, render: (r: Row) => r.level },
      { title: "Limit", width: 95, align: "right" as const, render: (r: Row) => rp(r.limitkredit) },
      { title: "Poin", width: 65, align: "right" as const, render: (r: Row) => rp(r.poin) },
    ] : []),
  ];
  const ambil = (r?: Row) => { const x = r ?? rows.find((y) => y[key] === sel); if (x) props.onPick(x); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "ArrowDown" && t instanceof HTMLInputElement && t.closest('[data-vb="tData"]') && rows.length) {
      e.preventDefault();
      root.current?.querySelector<HTMLElement>(".vbg")?.focus();
    } else if (e.key === "Enter" && t instanceof HTMLInputElement && t.closest('[data-vb="tData"]') && sel) {
      e.preventDefault();
      ambil();
    }
  };
  return (
    <div ref={root} onKeyDownCapture={onKeyDown}>
      <ModalFrame
        title={jth ? "Pelanggan Piutang Jatuh Tempo" : TITLE_CARI[props.table]}
        width={760}
        height={480}
        onClose={props.onClose}
        footer={
          <>
            {props.jthTempo && props.table === "mdpelanggan" && (
              <Button
                type="button"
                variant={jth ? "secondary" : "outline"}
                className="mr-auto h-8 text-xs"
                data-vb="cJthTempo"
                onClick={() => setJth((v) => !v)}
              >
                {jth ? "Semua Pelanggan" : "Jatuh Tempo"}
              </Button>
            )}
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cClose" onClick={props.onClose}>
              Tutup <Kbd>Esc</Kbd>
            </Button>
            <Button type="button" className="h-8 text-xs" data-vb="cAmbil" disabled={!sel} onClick={() => ambil()}>
              Ambil <Kbd className="bg-primary-foreground/15 text-primary-foreground">Enter</Kbd>
            </Button>
          </>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="cari-master-q" className="shrink-0 text-xs text-muted-foreground">Cari Kode / Nama</Label>
            <Input
              id="cari-master-q"
              autoFocus
              data-vb="tData"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ketik kode atau nama..."
              className="h-8 flex-1 text-xs"
            />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{rows.length} data</span>
          </div>
          {err && <Alert>{err}</Alert>}
          <div className="min-h-0 flex-1" data-vb="lsData">
            <VbGrid cols={cols} rows={rows} rowKey={(r) => r[key]} selected={sel} onSelect={setSel} onOpen={ambil} />
          </div>
        </div>
      </ModalFrame>
    </div>
  );
}

/** Daftar dengan kotak centang (ListBox gaya checkbox). */
export function Checklist(props: { items: { kunci: string; nama: string }[]; picked: Set<string>; onToggle: (k: string) => void; radio?: boolean }) {
  return (
    <div className="tp-scroll-always flex size-full flex-col gap-0.5 rounded-md border border-border bg-card p-1 font-sans text-xs text-foreground">
      {props.items.map((i) => {
        const checked = props.picked.has(i.kunci);
        return (
          <Label
            key={i.kunci}
            className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 font-normal transition-colors ${props.radio && checked ? "bg-accent font-medium text-foreground" : "hover:bg-muted"}`}
          >
            {props.radio ? (
              <input
                data-slot="vb-check-input"
                type="radio"
                className="size-3.5 shrink-0 accent-primary"
                checked={checked}
                onChange={() => props.onToggle(i.kunci)}
              />
            ) : (
              <Checkbox checked={checked} onCheckedChange={() => props.onToggle(i.kunci)} />
            )}
            <span className="truncate">{i.nama}</span>
          </Label>
        );
      })}
    </div>
  );
}
