import { CSSProperties, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Row } from "../../api";
import { qty, rp, tglID, today } from "../../format";
import { Kind, kertasLaporan } from "./defs";

type Al = "l" | "r" | "c";
interface C { __c: 1; v: ReactNode; span?: number; a?: Al }
type Cell = ReactNode | C;
interface Def { cls: string; cells: Cell[] }
interface Col { w: number; a?: Al }
export interface Built { cols: Col[]; rows: Def[]; wide?: boolean }

const c = (v: ReactNode, span?: number, a?: Al): C => ({ __c: 1, v, span, a });
const isC = (x: Cell): x is C => typeof x === "object" && x !== null && (x as C).__c === 1;
const n = (x: unknown) => Number(x) || 0;
const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);

const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const bulanTahun = (iso: string) => `${BULAN[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`;

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); }
  return [...m.entries()];
}

/** Baris dengan label di kiri dan angka di kolom-kolom terakhir. */
const tail = (ncol: number, label: string, vals: ReactNode[], cls = "sub"): Def => ({
  cls, cells: [c(label, ncol - vals.length, "r"), ...vals],
});

function infoRow(left: string, lv: ReactNode, right: string, rv: ReactNode, ncol: number, split: number): Def {
  return { cls: "info", cells: [c(<>{left} : {lv}</>, split), c(right ? <>{right} : {rv}</> : "", ncol - split)] };
}

/* ---- Penjualan / pembelian / laba rugi per nota ---- */
function perNota(rows: Row[], mode: "jual" | "beli" | "lr"): Built {
  const jual = mode !== "beli";
  const lr = mode === "lr";
  const cols: Col[] = lr
    ? [{ w: 5, a: "r" }, { w: 12 }, { w: 31 }, { w: 9, a: "r" }, { w: 9 }, { w: 11, a: "r" }, { w: 11, a: "r" }, { w: 12, a: "r" }]
    : [{ w: 5, a: "r" }, { w: 12 }, { w: 31 }, { w: 9, a: "r" }, { w: 9 }, { w: 16, a: "r" }, { w: 18, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  let grand = 0;
  for (const [no, ls] of groupBy(rows, (r) => String(r.notrans))) {
    const h = ls[0];
    const split = lr ? 5 : 4;
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push(infoRow(lr && h.kode === "RJ" ? "No. Retur" : "No. Transaksi", no, "Kasir", h.namakasir as string, N, split));
    out.push(infoRow("Tanggal", tglID(h.tgltrans), jual ? "Pelanggan" : "Supplier", (jual ? h.namapelanggan : h.namapemasok) as string, N, split));
    out.push(infoRow(jual ? "Sales" : "Catatan", jual ? (h.namasales as string) : (h.catatan as string), jual ? "Catatan" : "", jual ? (h.catatan as string) : "", N, split));
    out.push({ cls: "head", cells: lr
      ? ["No", "Kode", "Nama Barang", "Jml", "Satuan", "Hrg.Beli", "Hrg.Jual", "Laba/Rugi"]
      : ["No", "Kode", "Nama Barang", "Jml", "Satuan", "Harga", "Subtotal"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: lr
      ? [i + 1, r.kodebarang as string, r.namabarang as string, qty(r.jmljual), r.satuanjual as string, rp(r.hrgbelij), rp(r.hrgterjual), rp(r.keuntungansubtotal)]
      : [i + 1, r.kodebarang as string, r.namabarang as string, qty(r.jmljual), r.satuanjual as string, rp(r.hrgterjual), rp(r.subtotal)] }));
    const total = sum(ls, (r) => n(r.subtotal));
    if (lr) {
      // Seperti aslinya: laba = jumlah laba tiap baris; retur bernilai negatif dan diskon nota tidak dikurangkan.
      const laba = sum(ls, (r) => n(r.keuntungansubtotal));
      grand += laba;
      out.push(tail(N, "Laba/Rugi per Transaksi :", [rp(laba)]));
    } else {
      grand += n(h.totaltrans);
      out.push(tail(N, "Total :", [rp(total)]));
      out.push(tail(N, "Diskon :", [rp(h.diskonnilai)], "sub2"));
      out.push(tail(N, "Biaya :", [rp(h.biaya)], "sub2"));
      out.push(tail(N, "Total Transaksi :", [rp(h.totaltrans)], "sub2"));
      out.push(tail(N, jual ? "Bayar Tunai :" : "Jml. Bayar :", [rp(h.jmlbayar)], "sub2"));
      if (n(h.bayarlain1) > 0) {
        out.push(tail(N, "Non Tunai :", [rp(h.bayarlain1)], "sub2"));
        out.push({ cls: "info", cells: [c(`Pembayaran Non Tunai : Jenis : ${h.ketbayarlain1 ?? ""}  Kartu : ${h.kartu ?? ""}  Noref : ${h.norefkartu ?? ""}`, N)] });
      }
      out.push(tail(N, "Sisa/Kekurangan :", [rp(h.sisa)], "sub2"));
    }
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, lr ? "Total Laba/Rugi :" : jual ? "Total Penjualan :" : "Total Pembelian :", [rp(grand)], "tot"));
  return { cols, rows: out };
}

/* ---- Harian / per supplier ---- */
function harian(rows: Row[], jual: boolean): Built {
  const cols: Col[] = jual
    ? [{ w: 5, a: "r" }, { w: 19 }, { w: 30 }, { w: 15 }, { w: 14 }, { w: 17, a: "r" }]
    : [{ w: 5, a: "r" }, { w: 22 }, { w: 33 }, { w: 22 }, { w: 18, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [tgl, ls] of groupBy(rows, (r) => String(r.tgltrans))) {
    out.push({ cls: "grp", cells: [c(`Tanggal : ${tglID(tgl)}`, N)] });
    out.push({ cls: "head", cells: jual ? ["No", "No. Transaksi", "Pelanggan", "Sales", "Kasir", "Jml. Transaksi"] : ["No", "No. Transaksi", "Supplier", "Kasir", "Jml. Transaksi"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: jual
      ? [i + 1, r.notrans as string, r.namapelanggan as string, r.namasales as string, r.namakasir as string, rp(r.totaltrans)]
      : [i + 1, r.notrans as string, r.namapemasok as string, r.namakasir as string, rp(r.totaltrans)] }));
    out.push(tail(N, "Total per Hari :", [rp(sum(ls, (r) => n(r.totaltrans)))]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, "Total Transaksi :", [rp(sum(rows, (r) => n(r.totaltrans)))], "tot"));
  return { cols, rows: out };
}

function perSupplier(rows: Row[]): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 25 }, { w: 20 }, { w: 30 }, { w: 20, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [nama, ls] of groupBy(rows, (r) => String(r.namapemasok))) {
    out.push({ cls: "grp", cells: [c(`Supplier : ${nama}`, N)] });
    out.push({ cls: "head", cells: ["No", "No. Transaksi", "Tanggal", "Kasir", "Jml. Transaksi"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.notrans as string, tglID(r.tgltrans), r.namakasir as string, rp(r.totaltrans)] }));
    out.push(tail(N, "Total per Supplier :", [rp(sum(ls, (r) => n(r.totaltrans)))]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, "Total Transaksi :", [rp(sum(rows, (r) => n(r.totaltrans)))], "tot"));
  return { cols, rows: out };
}

/* ---- Bulanan (jumlah per tanggal) dan laba rugi harian/bulanan ---- */
function bulanan(rows: Row[], field: string, lr: "harian" | "bulanan" | null, totalLabel: string, subLabel: string): Built {
  const cols: Col[] = [{ w: 6, a: "r" }, { w: 44 }, { w: 50, a: "r" }];
  const N = 3;
  const out: Def[] = [];
  const bulanan = lr === "bulanan";
  const grpKey = (r: Row) => String(r.tgltrans).slice(0, bulanan ? 4 : 7);
  for (const [g, ls] of groupBy(rows, grpKey)) {
    out.push({ cls: "grp", cells: [c(bulanan ? `Tahun : ${g}` : `${lr ? "Bulan" : "Bulan"} : ${bulanTahun(g + "-01")}`, N)] });
    out.push({ cls: "head", cells: ["No", "Tanggal", lr ? "Laba/Rugi" : "Jml. Transaksi"] });
    const per = groupBy(ls, (r) => String(r.tgltrans).slice(0, bulanan ? 7 : 10));
    per.forEach(([k, xs], i) => out.push({ cls: "row", cells: [i + 1, bulanan ? bulanTahun(k) : tglID(k), rp(sum(xs, (r) => n(r[field])))] }));
    out.push(tail(N, `${subLabel} :`, [rp(sum(ls, (r) => n(r[field])))]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, `${totalLabel} :`, [rp(sum(rows, (r) => n(r[field])))], "tot"));
  return { cols, rows: out };
}

/* ---- Per barang ---- */
function perBarang(rows: Row[]): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 16 }, { w: 10 }, { w: 11, a: "r" }, { w: 6 }, { w: 12, a: "r" }, { w: 14, a: "r" }, { w: 16 }, { w: 10 }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [kode, ls] of groupBy(rows, (r) => String(r.kodebarang))) {
    out.push({ cls: "grp", cells: [c(`Kode Barang : ${kode}    Barcode : ${ls[0].barcode ?? ""}    Nama Barang : ${ls[0].namabarang ?? ""}`, N)] });
    out.push({ cls: "head", cells: ["No", "No. Transaksi", "Tgl", "Jml", "", "Harga", "Subtotal", "Pelanggan", "Sales"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.notrans as string, tglID(r.tgltrans), qty(r.jmljual), r.satuanjual as string, rp(r.hrgterjual), rp(r.subtotal), r.namapelanggan as string, r.namasales as string] }));
    out.push(tail(N - 2, "Total per Barang :", [rp(sum(ls, (r) => n(r.subtotal))), ""]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N - 2, "Total Penjualan :", [rp(sum(rows, (r) => n(r.subtotal))), ""], "tot"));
  return { cols, rows: out };
}

/* ---- Piutang / hutang ---- */
function utang(rows: Row[], piutang: boolean): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 22 }, { w: 15 }, { w: 19, a: "r" }, { w: 19, a: "r" }, { w: 20, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [nama, ls] of groupBy(rows, (r) => String(r.nama))) {
    out.push({ cls: "grp", cells: [c(`${piutang ? "Pelanggan" : "Supplier"} : ${nama}`, N)] });
    out.push({ cls: "head", cells: ["No", "No. Transaksi", "Jatuh Tempo", piutang ? "Jml. Piutang" : "Jml. Hutang", "Jml. Terbayar", "Kekurangan"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.noreftrans as string, tglID(r.jthtempo), rp(r.jmlpiutang), rp(r.jmlterbayar), rp(r.kekurangan)] }));
    out.push({ cls: "sub", cells: [c(`Total per ${piutang ? "Pelanggan" : "Supplier"} :`, 3, "r"), rp(sum(ls, (r) => n(r.jmlpiutang))), rp(sum(ls, (r) => n(r.jmlterbayar))), rp(sum(ls, (r) => n(r.kekurangan)))] });
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push({ cls: "tot", cells: [c(`Total ${piutang ? "Piutang" : "Hutang"} :`, 3, "r"), rp(sum(rows, (r) => n(r.jmlpiutang))), rp(sum(rows, (r) => n(r.jmlterbayar))), rp(sum(rows, (r) => n(r.kekurangan)))] });
  return { cols, rows: out };
}

/* ---- Kas ---- */
function kas(rows: Row[]): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 14 }, { w: 10 }, { w: 15 }, { w: 22 }, { w: 11, a: "r" }, { w: 11, a: "r" }, { w: 12, a: "r" }];
  const N = cols.length;
  const out: Def[] = [{ cls: "head", cells: ["No", "No. Kas", "Tgl.", "No. Ref", "Keterangan", "Keluar", "Masuk", "Saldo Akhir"] }];
  rows.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.nokas as string, tglID(r.tglkas), (r.noreftrans as string) ?? "", (r.keterangan as string) ?? "", rp(r.keluar), rp(r.masuk), rp(r.saldo)] }));
  const masuk = sum(rows, (r) => n(r.masuk));
  const keluar = sum(rows, (r) => n(r.keluar));
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, "Total Keluar :", [rp(keluar)], "sub"));
  out.push(tail(N, "Total Masuk :", [rp(masuk)], "sub2"));
  out.push(tail(N, "Kas Per Periode :", [rp(masuk - keluar)], "tot"));
  return { cols, rows: out };
}

/* ---- Stok ---- */
export interface StokCtx { kelompok: Map<string, string>; kategori: Map<string, string> }

function stok(rows: Row[], ctx: StokCtx, detil: boolean): Built {
  const cols: Col[] = detil
    ? [{ w: 3, a: "r" }, { w: 7 }, { w: 16 }, { w: 9 }, { w: 5 }, { w: 5, a: "r" }, { w: 5, a: "r" }, { w: 5, a: "r" }, { w: 5, a: "r" }, { w: 6, a: "r" }, { w: 7, a: "r" }, { w: 7, a: "r" }, { w: 4, a: "r" }, { w: 6, a: "r" }, { w: 8, a: "r" }, { w: 8, a: "r" }]
    : [{ w: 5, a: "r" }, { w: 15 }, { w: 31 }, { w: 9 }, { w: 8, a: "r" }, { w: 8, a: "r" }, { w: 8, a: "r" }, { w: 8, a: "r" }, { w: 8, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  const nilaiBeli = (r: Row) => n(r.stokakhir) * n(r.hrgbeli);
  const nilaiJual = (r: Row) => n(r.stokakhir) * n(r.hrgjual);
  const totals = (ls: Row[]) => [qty(sum(ls, (r) => n(r.stokakhir))), rp(sum(ls, nilaiBeli)), rp(sum(ls, nilaiJual))];
  for (const [kel, lk] of groupBy(rows, (r) => String(r.kodekelompok ?? ""))) {
    out.push({ cls: "grp", cells: [c(`Kelompok : ${ctx.kelompok.get(kel) ?? ""}${kel ? ` (${kel})` : ""}`, N)] });
    for (const [kat, ls] of groupBy(lk, (r) => String(r.kodekategori ?? ""))) {
      out.push({ cls: "grp", cells: [c(`Kategori : ${ctx.kategori.get(kat) ?? ""}${kat ? ` (${kat})` : ""}`, N)] });
      out.push({ cls: "head", cells: detil
        ? ["No", "Kode", "Nama Barang", "Barcode", "Satuan", "Awal", "Masuk", "Keluar", "Opname", "Akhir", "Hrg. Beli", "Hrg. Jual", "Margin", "Margin Nilai", "Nilai Beli", "Nilai Jual"]
        : ["No", "Kode", "Nama Barang", "Satuan", "Awal", "Masuk", "Keluar", "Opname", "Akhir"] });
      ls.forEach((r, i) => {
        const hb = n(r.hrgbeli), hj = n(r.hrgjual);
        out.push({ cls: "row", cells: detil
          ? [i + 1, r.kodebarang as string, r.namabarang as string, (r.barcode as string) ?? "", r.kodesatuan as string, qty(r.stokawal), qty(r.stokmasuk), qty(r.stokkeluar), qty(r.stokopname), qty(r.stokakhir),
            rp(hb), rp(hj), r.marginpersen != null ? qty(r.marginpersen) : hb ? qty(((hj - hb) / hb) * 100) : "0", rp(r.marginnilai ?? hj - hb), rp(nilaiBeli(r)), rp(nilaiJual(r))]
          : [i + 1, r.kodebarang as string, r.namabarang as string, r.kodesatuan as string, qty(r.stokawal), qty(r.stokmasuk), qty(r.stokkeluar), qty(r.stokopname), qty(r.stokakhir)] });
      });
      if (detil) out.push({ cls: "sub", cells: [c("Total per Kategori :", 9, "r"), ...totals(ls).slice(0, 1), c("", 4), ...totals(ls).slice(1)] });
    }
    if (detil) out.push({ cls: "sub2", cells: [c("Total per Kelompok :", 9, "r"), ...totals(lk).slice(0, 1), c("", 4), ...totals(lk).slice(1)] });
  }
  if (detil) {
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push({ cls: "tot", cells: [c("Grand Total :", 9, "r"), ...totals(rows).slice(0, 1), c("", 4), ...totals(rows).slice(1)] });
  }
  return { cols, rows: out, wide: detil };
}

function batasStok(rows: Row[], max: boolean): Built {
  const cols: Col[] = [{ w: 6, a: "r" }, { w: 18 }, { w: 40 }, { w: 12, a: "r" }, { w: 10 }, { w: 14, a: "r" }];
  const out: Def[] = [{ cls: "head", cells: ["No", "Kode", "Nama Barang", "Jml. Stok", "Satuan", max ? "Maksimum" : "Minimal"] }];
  rows.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.kodebarang as string, r.namabarang as string, qty(r.stokakhir), r.kodesatuan as string, qty(max ? r.stokmax : r.stokmin)] }));
  return { cols, rows: out };
}

/* ---- Order dan retur (per nota, tanpa rincian pembayaran) ---- */
function orderRetur(rows: Row[], kind: "order_jual" | "order_beli" | "retur_jual" | "retur_beli"): Built {
  const jual = kind === "order_jual" || kind === "retur_jual";
  const order = kind.startsWith("order");
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 12 }, { w: 31 }, { w: 9, a: "r" }, { w: 9 }, { w: 16, a: "r" }, { w: 18, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [no, ls] of groupBy(rows, (r) => String(r.notrans))) {
    const h = ls[0];
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push(infoRow("No. Transaksi", no, "Kasir", h.namakasir as string, N, 4));
    out.push(infoRow("Tanggal", tglID(h.tgllap), jual ? "Pelanggan" : "Supplier", (jual ? h.namapelanggan : h.namapemasok) as string, N, 4));
    out.push(infoRow(jual && order ? "Sales" : "Catatan", jual && order ? (h.namasales as string) : (h.catatan as string), order ? "Status" : "", order ? (n(h.status) === 1 ? "Sudah diambil" : "Belum diambil") : "", N, 4));
    if (jual && order) out.push(infoRow("Catatan", h.catatan as string, "", "", N, 4));
    out.push({ cls: "head", cells: ["No", "Kode", "Nama Barang", "Jml", "Satuan", "Harga", "Subtotal"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.kodebarang as string, r.namabarang as string, qty(r.jmljual), r.satuanjual as string, rp(r.hrgterjual), rp(r.subtotal)] }));
    out.push(tail(N, "Total :", [rp(sum(ls, (r) => n(r.subtotal)))]));
    if (jual && order) out.push(tail(N, "Uang Muka :", [rp(h.jmlbayar)], "sub2"));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, order ? "Total Order :" : "Total Retur :", [rp(sum(rows, (r) => n(r.subtotal)))], "tot"));
  return { cols, rows: out };
}

/* ---- Penjualan per sales ---- */
function perSales(rows: Row[]): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 19 }, { w: 30 }, { w: 15 }, { w: 14 }, { w: 17, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [nama, ls] of groupBy(rows, (r) => String(r.namasales ?? ""))) {
    out.push({ cls: "grp", cells: [c(`Sales : ${nama}`, N)] });
    out.push({ cls: "head", cells: ["No", "No. Transaksi", "Pelanggan", "Tanggal", "Kasir", "Jml. Transaksi"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.notrans as string, r.namapelanggan as string, tglID(r.tgltrans), r.namakasir as string, rp(r.totaltrans)] }));
    out.push(tail(N, "Total per Sales :", [rp(sum(ls, (r) => n(r.totaltrans)))]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, "Total Transaksi :", [rp(sum(rows, (r) => n(r.totaltrans)))], "tot"));
  return { cols, rows: out };
}

/* ---- Pelunasan piutang / hutang ---- */
function pelunasan(rows: Row[], piutang: boolean): Built {
  const cols: Col[] = [{ w: 6, a: "r" }, { w: 22 }, { w: 40 }, { w: 32, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [no, ls] of groupBy(rows, (r) => String(r.nopiutang))) {
    const h = ls[0];
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push({ cls: "info", cells: [c(<>No. Transaksi : {h.noreftrans as string}</>, 2), c(<>{piutang ? "Pelanggan" : "Supplier"} : {(piutang ? h.namapelanggan : h.namapemasok) as string}</>, 2)] });
    out.push({ cls: "info", cells: [c(<>{piutang ? "Jml. Piutang" : "Jml. Hutang"} : {rp(h.jmlpiutang)}</>, 2), c(<>Jml. Terbayar : {rp(h.jmlterbayar)}   Kekurangan : {rp(h.kekurangan)}</>, 2)] });
    out.push({ cls: "head", cells: ["No", "Tgl. Bayar", "Nama Petugas", "Jml. Bayar"] });
    ls.filter((r) => r.tglbayar).forEach((r, i) => out.push({ cls: "row", cells: [i + 1, tglID(r.tglbayar), r.namakaryawan as string, rp(r.jmlbayar)] }));
    out.push(tail(N, `Total ${no} :`, [rp(sum(ls, (r) => n(r.jmlbayar)))]));
  }
  out.push({ cls: "spasi", cells: [c("", N)] });
  out.push(tail(N, "Total Pembayaran :", [rp(sum(rows, (r) => n(r.jmlbayar)))], "tot"));
  return { cols, rows: out };
}

/* ---- Barang terlaris dan omset tertinggi ---- */
function peringkat(rows: Row[], omset: boolean): Built {
  const cols: Col[] = [{ w: 6, a: "r" }, { w: 20 }, { w: 40 }, { w: 22, a: "r" }, { w: 12 }];
  const N = cols.length;
  const out: Def[] = [{ cls: "head", cells: ["No", "Kode", "Nama Barang", omset ? "Total Penjualan" : "Jumlah Terjual", "Satuan"] }];
  rows.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.kodebarang as string, r.namabarang as string, omset ? rp(r.jmlomset) : qty(r.jmltotal), r.kodesatuan as string] }));
  if (omset) {
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push({ cls: "tot", cells: [c("Total :", 3, "r"), rp(sum(rows, (r) => n(r.jmlomset))), ""] });
  }
  return { cols, rows: out };
}

/* ---- Stok opname ---- */
function opname(rows: Row[]): Built {
  const cols: Col[] = [{ w: 5, a: "r" }, { w: 16 }, { w: 39 }, { w: 10 }, { w: 10, a: "r" }, { w: 10, a: "r" }, { w: 10, a: "r" }];
  const N = cols.length;
  const out: Def[] = [];
  for (const [no, ls] of groupBy(rows, (r) => String(r.notrans))) {
    const h = ls[0];
    out.push({ cls: "spasi", cells: [c("", N)] });
    out.push(infoRow("No. Transaksi", no, "Petugas", h.namakasir as string, N, 4));
    out.push(infoRow("Tanggal", tglID(h.tgllap), "Catatan", (h.catatan as string) ?? "", N, 4));
    out.push({ cls: "head", cells: ["No", "Kode", "Nama Barang", "Satuan", "Jml. Opname", "Jml. Asli", "Stok Akhir"] });
    ls.forEach((r, i) => out.push({ cls: "row", cells: [i + 1, r.kodebarang as string, r.namabarang as string, r.kodesatuan as string, qty(r.selisih), qty(r.stokasal), qty(n(r.stokasal) + n(r.selisih))] }));
  }
  return { cols, rows: out };
}

/* ---- Laba Rugi Komparatif (ARLabaRugiKomperatif) ---- */
const rpKurung = (x: number) => (x < 0 ? `(${rp(-x)})` : rp(x));

function komparatif(rows: Row[]): Built {
  const cols: Col[] = [{ w: 46 }, { w: 18, a: "r" }, { w: 18, a: "r" }, { w: 18, a: "r" }];
  const N = cols.length;
  const out: Def[] = [{ cls: "head", cells: ["", "Periode Bulan Lalu", "Mutasi Bulan Ini", "Periode Bulan Ini"] }];
  // Tiap kategori kas menjadi satu angka per kolom: masuk dikurangi keluar.
  const ambil = (kat: string): [number, number, number] => {
    const r = rows.find((x) => String(x.kategori).toLowerCase() === kat);
    return r ? [n(r.lalu_masuk) - n(r.lalu_keluar), n(r.mutasi_masuk) - n(r.mutasi_keluar), n(r.semua_masuk) - n(r.semua_keluar)] : [0, 0, 0];
  };
  const plus = (...xs: [number, number, number][]): [number, number, number] => [0, 1, 2].map((i) => xs.reduce((s, x) => s + x[i], 0)) as [number, number, number];
  const baris = (cls: string, label: string, v?: [number, number, number]) => out.push({ cls, cells: [label, ...(v ? v.map(rpKurung) : ["", "", ""])] });
  const jual = ambil("penjualan barang dagang"), returJual = ambil("retur penjualan");
  const hpp = ambil("harga pokok penjualan"), returBeli = ambil("retur pembelian");
  const biaya = ambil("biaya operasional"), gaji = ambil("biaya gaji, upah, dll"), luar = ambil("pendapatan diluar usaha");
  const bersih = plus(jual, returJual), kotor = plus(bersih, hpp, returBeli), usaha = plus(kotor, biaya, gaji), pajak = plus(usaha, luar);
  baris("grp", "PENDAPATAN");
  baris("row", "PENDAPATAN OPERASIONAL");
  baris("row", "   Penjualan Barang Dagang", jual);
  baris("row", "   Retur Penjualan", returJual);
  baris("sub", "PENDAPATAN BERSIH", bersih);
  baris("grp", "HARGA POKOK PENJUALAN");
  baris("row", "   Harga Pokok Penjualan", hpp);
  baris("row", "   Retur Pembelian", returBeli);
  baris("sub", "LABA KOTOR", kotor);
  baris("grp", "BIAYA UMUM DAN ADMINISTRASI");
  baris("row", "   Biaya Operasional", biaya);
  baris("row", "   Biaya Gaji, Upah dan Lain-Lain", gaji);
  baris("sub", "LABA BERSIH DARI BIAYA OPERASIONAL", usaha);
  baris("grp", "PENDAPATAN NON OPERASIONAL");
  baris("row", "   Pendapatan Diluar Usaha", luar);
  baris("tot", "LABA BERSIH SEBELUM PAJAK", pajak);
  void N;
  return { cols, rows: out };
}

export function build(kind: Kind, rows: Row[], ctx: StokCtx): Built {
  switch (kind) {
    case "jual_detil": return perNota(rows, "jual");
    case "beli_detil": return perNota(rows, "beli");
    case "lr_trans": return perNota(rows, "lr");
    case "jual_harian": return harian(rows, true);
    case "beli_harian": return harian(rows, false);
    case "beli_supplier": return perSupplier(rows);
    case "jual_bulanan": case "beli_bulanan": return bulanan(rows, "totaltrans", null, "Total Transaksi", "Total per Bulan");
    case "lr_harian": return bulanan(rows, "laba", "harian", "Total Laba/Rugi", "Laba/Rugi per Bulan");
    case "lr_bulanan": return bulanan(rows, "laba", "bulanan", "Total Laba/Rugi", "Laba/Rugi per Tahun");
    case "jual_barang": return perBarang(rows);
    case "piutang": return utang(rows, true);
    case "hutang": return utang(rows, false);
    case "kas": return kas(rows);
    case "lr_komparatif": return komparatif(rows);
    case "stok": return stok(rows, ctx, false);
    case "stok_detil": return stok(rows, ctx, true);
    case "stok_max": return batasStok(rows, true);
    case "stok_min": return batasStok(rows, false);
    case "order_jual": case "order_beli": case "retur_jual": case "retur_beli": return orderRetur(rows, kind);
    case "jual_sales": return perSales(rows);
    case "pelunasan_piutang": return pelunasan(rows, true);
    case "pelunasan_hutang": return pelunasan(rows, false);
    case "terlaris": return peringkat(rows, false);
    case "omset": return peringkat(rows, true);
    case "opname": return opname(rows);
  }
}

/** Baris yang tidak boleh jadi baris terakhir di sebuah halaman (harus ikut baris sesudahnya). */
const IKUT_BERIKUT = new Set(["info", "head", "grp", "spasi"]);
const PX_MM = 96 / 25.4;
/** Ruang untuk nomor halaman di bawah isi. */
const TINGGI_FOOTER = 22;

interface Halaman { baris: number[]; ulang?: number }

/** Baris judul kolom terakhir sebelum baris `awal` dalam kelompok yang sama; diulang di awal halaman lanjutan. */
function judulKolom(rows: Def[], awal: number): number | undefined {
  // Hanya lanjutan tabel yang memakai judul kolom lama; blok baru (info, spasi, judul sendiri) tidak.
  if (!["row", "sub", "sub2"].includes(rows[awal]?.cls)) return undefined;
  for (let i = awal - 1; i >= 0; i--) {
    const k = rows[i].cls;
    if (k === "head") return i;
    if (k === "info" || k === "tot") return undefined;
  }
  return undefined;
}

/** Bagi baris ke halaman menurut tinggi tiap baris (px) dan ruang yang tersedia. */
export function bagiHalaman(rows: Def[], tinggi: number[], ruang: number): Halaman[] {
  if (rows.length === 0) return [{ baris: [] }];
  const hasil: Halaman[] = [];
  let cur: number[] = [];
  let ulang: number | undefined;
  let pakai = 0;
  const mulai = (awal: number[], pertama: number) => {
    cur = awal;
    ulang = judulKolom(rows, pertama);
    pakai = (ulang !== undefined ? tinggi[ulang] : 0) + awal.reduce((s, i) => s + tinggi[i], 0);
  };
  for (let i = 0; i < rows.length; i++) {
    if (cur.length && pakai + tinggi[i] > ruang) {
      let potong = cur.length;
      while (potong > 1 && IKUT_BERIKUT.has(rows[cur[potong - 1]].cls)) potong--;
      hasil.push({ baris: cur.slice(0, potong), ulang });
      const sisa = cur.slice(potong);
      mulai(sisa, sisa.length ? sisa[0] : i);
    }
    if (cur.length === 0) mulai([], i);
    cur.push(i);
    pakai += tinggi[i];
  }
  if (cur.length) hasil.push({ baris: cur, ulang });
  return hasil;
}

function Tabel(props: { built: Built; baris: number[]; ulang?: number }) {
  const { built } = props;
  const urut = props.ulang !== undefined ? [props.ulang, ...props.baris] : props.baris;
  return (
    <table className="lap-t">
      <colgroup>{built.cols.map((k, i) => <col key={i} style={{ width: `${k.w}%` }} />)}</colgroup>
      <tbody>
        {urut.map((idx, n) => {
          const r = built.rows[idx];
          let at = 0;
          return (
            <tr key={`${idx}-${n}`} className={r.cls}>
              {r.cells.map((cell, j) => {
                const span = isC(cell) ? cell.span ?? 1 : 1;
                const al = isC(cell) ? cell.a : built.cols[at]?.a;
                const v = isC(cell) ? cell.v : cell;
                at += span;
                return <td key={j} colSpan={span} className={al === "r" ? "r" : al === "c" ? "c" : ""}>{v}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Kertas laporan: kop toko, judul, periode, isi, dan nomor halaman. Isi dibagi ke halaman seukuran kertas
 * (A4, tegak atau mendatar sesuai laporan). Kop dan judul kolom diulang di tiap halaman.
 */
export function Kertas(props: { kind: Kind; title: string; periode: string; setting: Row; built: Built; kosong: boolean; onUbahFilter?: () => void }) {
  const { setting: s, built, kind } = props;
  const k = kertasLaporan(kind);
  const lebarIsi = k.lebar - 2 * k.margin;
  const tinggiIsi = (k.tinggi - 2 * k.margin) * PX_MM;
  // Kop seperti aslinya (FUN_0069f0d0): "alamat, kota - provinsi", "Tlp/Fax : ... , Kode Pos ...", "Website : ... Email ...".
  const baris2 = [s.tlp || s.fax ? `Tlp/Fax : ${s.tlp ?? ""} / ${s.fax ?? ""}` : "", s.kodepos ? `Kode Pos ${s.kodepos}` : ""].filter(Boolean).join(", ");
  const baris3 = [s.website ? `Website : ${s.website}` : "", s.email ? `Email ${s.email}` : ""].filter(Boolean).join("  ");
  const alamat = [[[s.alamat, s.kota].filter(Boolean).join(", "), s.provinsi].filter(Boolean).join(" - "), baris2, baris3].filter(Boolean).join("\n");
  const ukur = useRef<HTMLDivElement>(null);
  const [halaman, setHalaman] = useState<Halaman[]>([{ baris: built.rows.map((_, i) => i) }]);

  // Ukur tinggi tiap baris pada lebar yang sama dengan kertas, lalu bagi ke halaman.
  useLayoutEffect(() => {
    const el = ukur.current;
    if (!el || props.kosong) { setHalaman([{ baris: [] }]); return; }
    const kop = el.querySelector<HTMLElement>(".lap-kop");
    const trs = Array.from(el.querySelectorAll<HTMLElement>("tr"));
    const tinggi = trs.map((t) => t.getBoundingClientRect().height);
    const ruang = tinggiIsi - TINGGI_FOOTER - (kop ? kop.getBoundingClientRect().height : 0) - 12;
    const baru = bagiHalaman(built.rows, tinggi, Math.max(60, ruang));
    setHalaman((lama) => (JSON.stringify(lama) === JSON.stringify(baru) ? lama : baru));
  }, [built, props.kosong, props.title, props.periode, s, tinggiIsi]);

  const kop = (
    <div className="lap-kop">
      <div className="lap-cetak">Tgl. Cetak : {tglID(today())}</div>
      <div className="lap-nama">{s.namausaha}</div>
      <div className="lap-alamat">{alamat}</div>
      <div className="lap-judul">{props.title}</div>
      <div className="lap-periode">{props.periode}</div>
    </div>
  );
  const gaya = { "--lap-w": `${lebarIsi}mm`, "--lap-h": `${tinggiIsi / PX_MM}mm`, "--lap-m": `${k.margin}mm` } as CSSProperties;
  return (
    <div className="lap-kertas" style={gaya}>
      <style>{`@media print { @page { size: ${k.ukuran} ${k.arah}; margin: ${k.margin}mm; } }`}</style>
      {!props.kosong && (
        <div className="lap-page lap-ukur" ref={ukur} aria-hidden="true">
          {kop}
          <Tabel built={built} baris={built.rows.map((_, i) => i)} />
        </div>
      )}
      {halaman.map((h, n) => (
        <div key={n} className="lap-page">
          {kop}
          {props.kosong
            ? (
              <div className="lap-kosong">
                <p>Tidak ada data untuk pilihan ini. Coba ubah tanggal atau filter.</p>
                {props.onUbahFilter && <Button type="button" variant="outline" size="sm" className="no-print mt-3 bg-background" onClick={props.onUbahFilter}>Ubah Filter</Button>}
              </div>
            )
            : <Tabel built={built} baris={h.baris} ulang={h.ulang} />}
          <div className="lap-hal">Halaman : {n + 1}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- Bahan ekspor (Text, Excel, HTML, RTF) ---- */
const teksDari = (x: ReactNode): string => {
  if (x === null || x === undefined || typeof x === "boolean") return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (Array.isArray(x)) return x.map(teksDari).join("");
  const anak = (x as { props?: { children?: ReactNode } }).props?.children;
  return anak === undefined ? "" : teksDari(anak);
};

/** Baris kop laporan sebagai teks: nama usaha, alamat, judul, periode. */
export function kopTeks(s: Row, title: string, periode: string): string[] {
  const l2 = [s.tlp || s.fax ? `Tlp/Fax : ${s.tlp ?? ""} / ${s.fax ?? ""}` : "", s.kodepos ? `Kode Pos ${s.kodepos}` : ""].filter(Boolean).join(", ");
  const l3 = [s.website ? `Website : ${s.website}` : "", s.email ? `Email ${s.email}` : ""].filter(Boolean).join("  ");
  const l1 = [[s.alamat, s.kota].filter(Boolean).join(", "), s.provinsi].filter(Boolean).join(" - ");
  return [String(s.namausaha ?? ""), l1, l2, l3, title, periode, `Tgl. Cetak : ${tglID(today())}`].filter(Boolean);
}

/** Isi laporan sebagai tabel teks: tiap sel dilebarkan sesuai jumlah kolom yang dicakup. */
export function gridLaporan(built: Built): string[][] {
  return built.rows.map((r) => r.cells.flatMap((cell) => {
    const span = isC(cell) ? cell.span ?? 1 : 1;
    return [teksDari(isC(cell) ? cell.v : cell), ...Array(Math.max(0, span - 1)).fill("")];
  }));
}
