import { ReactNode, useEffect, useRef, useState } from "react";
import { api, errText, MasterTable, Row } from "../api";
import { rp } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, VbGrid, VbModal } from "../vb/VbGrid";
import { KEYS } from "./masterLib";

export const s = (v: unknown) => String(v ?? "");
export const txt = (v: unknown, set?: (x: string) => void, disabled?: boolean): Bind => ({ value: s(v), onChange: set, disabled });
export const opsi = (list: string[], kosong?: string): ReactNode => (
  <>
    {kosong !== undefined && <option value="">{kosong}</option>}
    {list.map((o) => <option key={o} value={o}>{o}</option>)}
  </>
);

const FORM_CARI: Record<string, string> = { mdpelanggan: "FrmCariPelanggan", mdpemasok: "FrmCariPemasok", mdkaryawan: "FrmCariKaryawan" };

/**
 * Jendela Cari Pelanggan / Supplier / Karyawan (tombol "..."). Seperti aslinya: semua data tampil (juga yang tidak aktif),
 * pencarian hanya mencocokkan kode dan nama, dan Panah Bawah di kotak cari pindah ke daftar.
 * `jthTempo` menampilkan tombol Jatuh Tempo (khusus Cari Pelanggan; aslinya hanya bila pemanggil menyalakannya).
 */
export function CariMaster(props: { table: Extract<MasterTable, "mdpelanggan" | "mdpemasok" | "mdkaryawan">; onPick: (r: Row) => void; onClose: () => void; jthTempo?: boolean }) {
  const { key, name } = KEYS[props.table];
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [jth, setJth] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const ambil = jth ? api.pelangganJatuhTempo(q) : api.masterList(props.table, { search: q, limit: 300, sort: key, hanyaKodeNama: true }).then((r) => r.rows);
      ambil.then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(errText(e)));
    }, 150);
    return () => clearTimeout(t);
  }, [q, props.table, key, jth]);
  const cols: GridCol<Row>[] = [
    { title: "No.", width: 40, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 110, render: (r) => r[key] },
    { title: "Nama", width: 240, render: (r) => r[name] },
    { title: "Alamat", width: 200, render: (r) => r.alamat },
    ...(props.table === "mdpelanggan" ? [
      { title: "Level", width: 60, render: (r: Row) => r.level },
      { title: "Limit", width: 90, align: "right" as const, render: (r: Row) => rp(r.limitkredit) },
      { title: "Poin", width: 60, align: "right" as const, render: (r: Row) => rp(r.poin) },
    ] : []),
  ];
  const ambil = (r?: Row) => { const x = r ?? rows.find((y) => y[key] === sel); if (x) props.onPick(x); };
  const bind: Record<string, Bind> = {
    tData: { value: q, onChange: setQ },
    lsData: () => <VbGrid cols={cols} rows={rows} rowKey={(r) => r[key]} selected={sel} onSelect={setSel} onOpen={ambil} />,
    cAmbil: { onClick: () => ambil() },
    cJthTempo: { onClick: () => setJth(true) },
    cClose: { onClick: props.onClose },
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "ArrowDown" && t instanceof HTMLInputElement && t.closest('[data-vb="tData"]') && rows.length) {
      e.preventDefault();
      root.current?.querySelector<HTMLElement>(".vbg")?.focus();
    }
  };
  const hide = ["cOK", ...(props.jthTempo && props.table === "mdpelanggan" ? [] : ["cJthTempo"])];
  return (
    <div ref={root} onKeyDownCapture={onKeyDown}>
      <VbModal form={FORM_CARI[props.table]} bind={bind} hide={hide} onClose={props.onClose}>{err && <div className="vbm-msg">{err}</div>}</VbModal>
    </div>
  );
}

/** Daftar dengan kotak centang (ListBox gaya checkbox). */
export function Checklist(props: { items: { kunci: string; nama: string }[]; picked: Set<string>; onToggle: (k: string) => void; radio?: boolean }) {
  return (
    <div className="alat-list">
      {props.items.map((i) => (
        <label key={i.kunci} className={props.radio && props.picked.has(i.kunci) ? "on" : ""}>
          <input type={props.radio ? "radio" : "checkbox"} checked={props.picked.has(i.kunci)} onChange={() => props.onToggle(i.kunci)} />
          <span>{i.nama}</span>
        </label>
      ))}
    </div>
  );
}
