import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api, MasterTable, Row } from "../api";
import { Bind, useVbForm, VbAnchor, VbCtrl, VbFormDef, VbPos } from "../vb/VbForm";

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
    api.masterList(table, { limit: 5000, sort: KEYS[table].key }).then((r) => setRows(Array.isArray(r?.rows) ? r.rows : [])).catch(() => undefined);
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
export const statusText = (r: Row) => (Number(r.aktif ?? 1) === 0 ? "Nonaktif" : "Aktif");

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

const q2Fmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
/** Jumlah stok: bilangan bulat apa adanya (30), desimal hanya bila memang pecahan (2,5). */
export const q2 = (n: unknown) => q2Fmt.format(Number(n) || 0);

/** Muat seluruh isi tabel (beberapa halaman kalau lebih dari 5.000 baris). */
export async function loadAll(table: MasterTable, opts: { kelompok?: string; kategori?: string; sort?: string }): Promise<Row[]> {
  const out: Row[] = [];
  for (;;) {
    const r = await api.masterList(table, { ...opts, limit: 5000, offset: out.length });
    const list = Array.isArray(r?.rows) ? r.rows : [];
    out.push(...list);
    if (!list.length || out.length >= (r?.total ?? 0)) return out;
  }
}

/** Gaya tombol Hapus di form VB: tombol outline berteks merah (letaknya tetap, hanya warnanya). */
export const HAPUS_MERAH = "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive";
/** Tombol tutup: tulisan "Tutup" dengan chip Esc. */
export const TUTUP = "Tutup [Esc]";

/**
 * Rapikan label form VB tanpa menggeser kontrol: label dibuat selebar jarak ke kotak isian di kanannya,
 * rata kanan (menempel ke kotaknya dengan jarak 6px), satu baris, huruf 11px, dan dipusatkan vertikal ke kotak.
 * `teks` mengganti tulisan label (nama kontrol → teks); `wajib` memberi tanda * merah pada label yang disebut.
 */
export function labelRapi(def: VbFormDef | undefined, teks: Record<string, string> = {}, wajib: string[] = []): Record<string, Bind> {
  const out: Record<string, Bind> = {};
  if (!def) return out;
  const semua: VbCtrl[] = [];
  const jalan = (c: VbCtrl) => { for (const k of c.children) { semua.push(k); jalan(k); } };
  jalan(def);
  const px = (c: VbCtrl) => { const [l, t, w, h] = c.props.POS as number[]; return { l: l / 15, t: t / 15, w: w / 15, h: h / 15 }; };
  const kotak = semua.filter((c) => (c.type === "TextBox" || c.type === "ComboBox") && c.props.POS).map(px);
  for (const lb of semua) {
    if (lb.type !== "Label" || !lb.props.POS) continue;
    const a = px(lb);
    const cy = a.t + a.h / 2;
    const sebaris = kotak.filter((k) => cy >= k.t - 2 && cy <= k.t + k.h + 2 && k.l >= a.l + 8 && k.l - a.l <= 150);
    if (!sebaris.length) continue;
    const k = sebaris.reduce((x, y) => (y.l < x.l ? y : x));
    const dy = Math.round((k.t + k.h / 2 - cy) * 2) / 2;
    const isi = teks[lb.name];
    const bintang = wajib.includes(lb.name);
    out[lb.name] = {
      ...(isi !== undefined || bintang
        ? { text: <>{isi ?? String(lb.props.Caption ?? "").replace(/&(.)/g, "$1")}{bintang && <span className="text-destructive" aria-label="wajib diisi">*</span>}</> }
        : {}),
      // Hanya label ~AutoSize yang boleh melebar (kotak pembungkusnya tidak memotong); yang lain cukup dipusatkan.
      className: lb.props["~AutoSize"] ? "flex items-center justify-end gap-0.5 text-[11px] whitespace-nowrap" : "flex items-center gap-0.5 text-[11px]",
      style: { ...(lb.props["~AutoSize"] ? { width: Math.max(8, k.l - 6 - a.l) } : {}), position: "relative", top: dy },
    };
  }
  return out;
}

/** Versi hook dari `labelRapi` untuk komponen halaman. */
export function useLabelRapi(form: string, teks: Record<string, string> = {}, wajib: string[] = []) {
  const def = useVbForm(form);
  return useMemo(() => labelRapi(def, teks, wajib), [def, JSON.stringify(teks), wajib.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Daftar yang kosong: satu kalimat di tengah, di bawah kepala tabel, tanpa menutupi tabelnya. */
export function GridKosong(props: { kosong: boolean; teks: string; children: ReactNode }) {
  return (
    <div className="relative size-full">
      {props.children}
      {props.kosong && (
        <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4 text-center text-sm text-muted-foreground">{props.teks}</div>
      )}
    </div>
  );
}
