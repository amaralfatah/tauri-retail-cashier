import { useCallback, useEffect, useState } from "react";
import { api, MasterTable, Row } from "../api";
import { useVbForm, VbAnchor, VbFormDef, VbPos } from "../vb/VbForm";

/** Kolom kunci dan kolom nama tiap tabel master. */
export const KEYS: Record<string, { key: string; name: string }> = {
  mdbarang: { key: "kodebarang", name: "namabarang" },
  mdkelompok: { key: "kodekelompok", name: "namakelompok" },
  mdkategori: { key: "kodekategori", name: "namakategori" },
  mdsatuan: { key: "kodesatuan", name: "namasatuan" },
  mdpelanggan: { key: "kodepelanggan", name: "namapelanggan" },
  mdpemasok: { key: "kodepemasok", name: "namapemasok" },
  mdkaryawan: { key: "kodekaryawan", name: "namakaryawan" },
};

/** Daftar isi sebuah tabel master (untuk isian combo). `reload` memuat ulang. */
export function useList(table: MasterTable | null) {
  const [rows, setRows] = useState<Row[]>([]);
  const reload = useCallback(() => {
    if (!table) return;
    api.masterList(table, { limit: 5000, sort: KEYS[table].key }).then((r) => setRows(r.rows)).catch(() => undefined);
  }, [table]);
  useEffect(reload, [reload]);
  return { rows, reload };
}

/** Kode berikutnya, mengikuti pola kode yang paling banyak dipakai (awalan huruf + angka). */
export function nextKode(codes: string[]): string {
  const groups = new Map<string, { n: number; max: number }>();
  for (const c of codes) {
    const m = /^(\D*)(\d+)$/.exec(String(c));
    if (!m) continue;
    const k = `${m[1]}|${m[2].length}`;
    const g = groups.get(k) ?? { n: 0, max: 0 };
    g.n += 1;
    g.max = Math.max(g.max, Number(m[2]));
    groups.set(k, g);
  }
  let best: [string, { n: number; max: number }] | null = null;
  for (const e of groups) if (!best || e[1].n > best[1].n) best = e;
  if (!best) return "1";
  const [prefix, len] = best[0].split("|");
  return prefix + String(best[1].max + 1).padStart(Number(len), "0");
}

export const distinct = (rows: Row[], col: string) =>
  [...new Set(rows.map((r) => String(r[col] ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Aktif/nonaktif sebagai teks status di daftar. */
export const statusText = (r: Row) => (Number(r.aktif ?? 1) === 0 ? "Tdk.Aktif" : "Aktif");

/**
 * Kode otomatis seperti AutoKode di EXE asli: awalan tetap + angka selebar `lebar`,
 * diambil dari kode terbesar (urut menurun) ditambah 1; kalau belum ada: awalan + 1 ("E001", "01").
 */
export function kodeUrut(codes: unknown[], awalan: string, lebar: number): string {
  const ada = codes.map((c) => String(c ?? "")).filter((c) => c.startsWith(awalan)).sort();
  if (!ada.length) return awalan + "1".padStart(lebar, "0");
  const angka = parseInt(ada[ada.length - 1].slice(-lebar), 10) || 0;
  return awalan + String(angka + 1).padStart(lebar, "0");
}

/* ---- Jendela daftar yang memenuhi ruang kerja ---- */
const layouts = new Map<string, { anchor: Record<string, VbAnchor>; pos: Record<string, VbPos> }>();

/**
 * Jendela daftar aslinya dimaksimalkan: bilah atas dan bawah selebar jendela, dan ListView memenuhi sisanya.
 * Dipakai bersama VbForm `fill`; definisi form tidak diubah.
 */
export function listLayout(def: VbFormDef | undefined) {
  const hit = def && layouts.get(def.name);
  if (hit) return hit;
  const out = { anchor: { lsData: { left: true, right: true, top: true, bottom: true } } as Record<string, VbAnchor>, pos: {} as Record<string, VbPos> };
  if (def) {
    const [, , W, H] = def.props.ClientRect as number[];
    let top = 0;
    for (const c of def.children) if (c.props.Align === 1 && c.name !== "picTop1") top = Math.max(top, c.props.POS[1] + c.props.POS[3]);
    const bh = def.children.find((c) => c.name === "picBottom")?.props.POS[3] ?? 0;
    out.pos.lsData = { left: 60, top: top + 60, width: W - 120, height: H - bh - top - 120 };
    layouts.set(def.name, out);
  }
  return out;
}

/** Properti VbForm untuk daftar master yang memenuhi jendela. */
export function useListLayout(form: string) {
  return listLayout(useVbForm(form));
}

const q2Fmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Jumlah stok dengan dua desimal, mis. 1,00 */
export const q2 = (n: unknown) => q2Fmt.format(Number(n) || 0);

/** Muat seluruh isi tabel (beberapa halaman kalau lebih dari 5.000 baris). */
export async function loadAll(table: MasterTable, opts: { kelompok?: string; kategori?: string; sort?: string }): Promise<Row[]> {
  const out: Row[] = [];
  for (;;) {
    const r = await api.masterList(table, { ...opts, limit: 5000, offset: out.length });
    out.push(...r.rows);
    if (!r.rows.length || out.length >= r.total) return out;
  }
}
