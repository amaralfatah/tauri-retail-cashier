import type { Row } from "./api";

const rpFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

export const rp = (n: unknown) => rpFmt.format(Math.round(Number(n) || 0));
export const qty = (n: unknown) => qtyFmt.format(Number(n) || 0);
export const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export function today(): string {
  const d = new Date();
  return localDate(d);
}

export function localDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function firstOfMonth(iso = today()): string {
  return iso.slice(0, 8) + "01";
}

export const tglID = (iso: unknown) => {
  const s = String(iso ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s;
};

// ---- Multi satuan & harga (meniru kolom SATUAN1..5, HRGMULTISATUAN, HRGLEVEL, HRGTINGKAT) ----

export interface Unit {
  satuan: string;
  konversi: number;
  hargaJual: number;
  hargaBeli: number;
}

export function unitsOf(b: Row): Unit[] {
  const base: Unit = { satuan: b.kodesatuan || "PCS", konversi: 1, hargaJual: Number(b.hrgjual) || 0, hargaBeli: Number(b.hrgbeli) || 0 };
  const list = [base];
  for (let n = 1; n <= 5; n++) {
    const sat = (b[`satuan${n}`] || "").trim();
    const k = Number(b[`konversi${n}`]) || 0;
    if (!sat || k <= 0) continue;
    const multi = Number(b[`hrgmultisatuan${n}`]) || 0;
    const per = Number(b[`hrgsatuan${n}`]) || 0;
    list.push({
      satuan: sat,
      konversi: k,
      hargaJual: multi > 0 ? multi : per > 0 ? per * k : base.hargaJual * k,
      hargaBeli: base.hargaBeli * k,
    });
  }
  return list;
}

/** Harga jual per satuan dengan aturan harga level pelanggan dan harga grosir (tingkat). */
export function hargaJual(b: Row, unit: Unit, jml: number, levelPelanggan: string, aktifLevel: boolean): number {
  if (unit.konversi !== 1) return unit.hargaJual;
  let harga = Number(b.hrgjual) || 0;
  const m = /(\d)/.exec(levelPelanggan || "");
  if (aktifLevel && m) {
    const lv = Number(b[`hrglevel${m[1]}`]) || 0;
    if (lv > 0) harga = lv;
  }
  let minTerpenuhi = 0;
  for (let n = 1; n <= 5; n++) {
    const min = Number(b[`minhrg${n}`]) || 0;
    const h = Number(b[`hrgtingkat${n}`]) || 0;
    if (min > 0 && h > 0 && jml >= min && min >= minTerpenuhi) {
      minTerpenuhi = min;
      harga = h;
    }
  }
  return harga;
}
