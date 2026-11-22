import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, Row } from "../api";
import { inventoriApi, PromoJenis } from "../api/inventori";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { rp, today } from "../format";
import { Geom, VbForm } from "../vb/VbForm";
import { useMsgBox } from "../vb/VbGrid";
import { tglId2Iso, tglIso2Id } from "./inventoriLib";
import { NumInput } from "./Transaksi";
import "./transaksi.css";

interface R {
  uid: number;
  bid: number | null;
  kodebarang: string; namabarang: string; hrgnormal: number;
  diskon: number; hrgdiskon: number;
  minbeli: number; kodebonus: string; namabonus: string; jmlbonus: number;
  minbelanja: number;
  tglawal: string; tglakhir: string;
  dirty: boolean;
}

type Kode = "kodebarang" | "kodebonus";

const FORM: Record<PromoJenis, string> = { diskon: "FrmDataBarangDiskon", bonus: "FrmDataBarangBonus", pdp: "FrmDataBarangPDP" };
const NOTE_F10 = "Tekan tombol F10 pada keyboard atau klik ganda untuk mencari data barang pada kolom kode barang";
const NOTE: Record<PromoJenis, string> = {
  diskon: "Keterangan : Gunakan format tanggal DD/MM/YYYY. Isi diskon (%) atau harga diskon, yang satunya akan dihitung sendiri.",
  bonus: "Keterangan : Gunakan format tanggal DD/MM/YYYY",
  pdp: "Keterangan : Gunakan format tanggal DD/MM/YYYY. Diskon berlaku kalau total belanja mencapai minimal transaksi.",
};

const ROW_H = 23;
const HEAD_H = 40;
const FULL = { left: true, right: true, top: true, bottom: true };
const ANCHOR = { tdBonus: FULL, Picture1: { left: true, right: true, bottom: true }, lblKet: { left: true, right: true } };

let uidSeq = 0;
const blank = (): R => ({
  uid: ++uidSeq, bid: null, kodebarang: "", namabarang: "", hrgnormal: 0, diskon: 0, hrgdiskon: 0,
  minbeli: 1, kodebonus: "", namabonus: "", jmlbonus: 1, minbelanja: 0, tglawal: "", tglakhir: "", dirty: false,
});

const fromRow = (x: Row): R => ({
  ...blank(), bid: x.bid, kodebarang: x.kodebarang ?? "", namabarang: x.namabarang ?? "", hrgnormal: Number(x.hrgnormal) || 0,
  diskon: Number(x.diskon) || 0, hrgdiskon: Number(x.hrgdiskon) || 0,
  minbeli: Number(x.minbeli) || 0, kodebonus: x.kodebonus ?? "", namabonus: x.namabonus ?? "", jmlbonus: Number(x.jmlbonus) || 0,
  minbelanja: Number(x.minbelanja) || 0, tglawal: tglIso2Id(x.tglawal), tglakhir: tglIso2Id(x.tglakhir),
});

const hitungHarga = (jual: number, persen: number) => Math.round(jual * (1 - persen / 100) * 100) / 100;
const hitungPersen = (jual: number, harga: number) => (jual > 0 ? Math.round((1 - harga / jual) * 10000) / 100 : 0);

/** Status menurut tanggal berakhir saja: sudah lewat hari ini berarti "Tdk. Aktif", selain itu "Aktif". */
function status(r: R, hari: string): string {
  const b = tglId2Iso(r.tglakhir);
  if (!b) return "";
  return b < hari ? "Tdk. Aktif" : "Aktif";
}

/** Data Barang Diskon, Data Barang Bonus, dan Data Barang Diskon PDP: tabel isian yang disimpan sekaligus. */
export function Promo({ jenis }: { jenis: PromoJenis }) {
  const { go, user } = useApp();
  const msg = useMsgBox();
  const [rows, setRows] = useState<R[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [cari, setCari] = useState<{ uid: number; field: Kode } | null>(null);
  const [tgl1, setTgl1] = useState(today());
  const [tgl2, setTgl2] = useState(today());
  const [minTrans, setMinTrans] = useState("0");
  const gridRef = useRef<HTMLDivElement>(null);
  const bisaUbah = user.level !== "Kasir";
  const hari = today();

  const muat = useCallback(async () => {
    try {
      // Hanya diskon PDP yang disaring menurut tanggal berakhir; mengganti tanggal memuat ulang daftar.
      const r = (await (jenis === "pdp" ? inventoriApi.promoList(jenis, tgl1, tgl2) : inventoriApi.promoList(jenis))).map(fromRow);
      setRows([...r, blank()]);
      setSel(null);
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [jenis, tgl1, tgl2, msg]);
  useEffect(() => { void muat(); }, [jenis, jenis === "pdp" ? tgl1 : "", jenis === "pdp" ? tgl2 : ""]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ubah satu baris; baris kosong terakhir yang mulai diisi diikuti baris kosong baru. */
  const patch = (uid: number, p: Partial<R>) => setRows((xs) => {
    const out = xs.map((x) => (x.uid === uid ? { ...x, ...p, dirty: true } : x));
    return out[out.length - 1].kodebarang ? [...out, blank()] : out;
  });

  const cariKode = async (uid: number, field: Kode, kode: string) => {
    kode = kode.trim();
    if (!kode) return;
    const b = await api.barangFind(kode).catch(() => null);
    if (!b) {
      msg.alert(`Barang ${kode} tidak ditemukan. Tekan F10 untuk mencari barang.`);
      patch(uid, field === "kodebarang" ? { kodebarang: "", namabarang: "", hrgnormal: 0 } : { kodebonus: "", namabonus: "" });
      return;
    }
    pilih(uid, field, b);
  };
  const pilih = (uid: number, field: Kode, b: Row) => {
    if (field === "kodebonus") return patch(uid, { kodebonus: b.kodebarang, namabonus: b.namabarang });
    setRows((xs) => xs.map((x) => (x.uid === uid ? {
      ...x, kodebarang: b.kodebarang, namabarang: b.namabarang, hrgnormal: Number(b.hrgjual) || 0, dirty: true,
      hrgdiskon: x.diskon > 0 ? hitungHarga(Number(b.hrgjual) || 0, x.diskon) : x.hrgdiskon,
    } : x)).concat(xs[xs.length - 1].uid === uid ? [blank()] : []));
  };

  const simpan = useCallback(async () => {
    const isi = rows.filter((r) => r.dirty && r.kodebarang.trim());
    if (!isi.length) return msg.alert("Tidak ada perubahan yang perlu disimpan.");
    const data = [];
    for (const r of isi) {
      const baris = `Baris ${rows.indexOf(r) + 1}: `;
      const a = tglId2Iso(r.tglawal), b = tglId2Iso(r.tglakhir);
      if (!a) return msg.alert(`${baris}tanggal mulai belum diisi atau formatnya salah. Tulis dengan format DD/MM/YYYY.`);
      if (!b) return msg.alert(`${baris}tanggal berakhir belum diisi atau formatnya salah. Tulis dengan format DD/MM/YYYY.`);
      data.push({
        bid: r.bid, kodebarang: r.kodebarang, minbeli: r.minbeli, kodebonus: r.kodebonus, jmlbonus: r.jmlbonus,
        minbelanja: r.minbelanja, diskon: r.diskon, hrgdiskon: r.hrgdiskon, tglawal: a, tglakhir: b,
      });
    }
    try {
      const r = await inventoriApi.promoSave(jenis, data);
      await muat();
      msg.alert(`${r.jumlah} data sudah tersimpan.`);
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [rows, jenis, muat, msg]);

  const refresh = useCallback(() => {
    if (rows.some((r) => r.dirty && r.kodebarang)) msg.confirm("Ada data yang belum disimpan. Muat ulang dan buang perubahan itu?", () => void muat());
    else void muat();
  }, [rows, muat, msg]);

  const hapus = useCallback(() => {
    const r = rows.find((x) => x.uid === sel);
    if (!r || !r.kodebarang) return msg.alert("Pilih dulu baris yang akan dihapus.");
    msg.confirm(`Hapus data ${r.kodebarang} - ${r.namabarang}? Data yang dihapus tidak bisa dikembalikan.`, async () => {
      try {
        if (r.bid != null) await inventoriApi.promoDelete(jenis, r.bid);
        setRows((xs) => xs.filter((x) => x.uid !== r.uid));
        setSel(null);
      } catch (e) {
        msg.alert(errText(e));
      }
    });
  }, [rows, sel, jenis, msg]);

  /** Set semua: hanya mengisi kolom Minimal Transaksi di semua baris (kosong berarti 0). */
  const setSemua = () => {
    const min = Number(minTrans.replace(/\./g, "").replace(",", ".")) || 0;
    setRows((xs) => xs.map((x) => (x.kodebarang ? { ...x, minbelanja: min, dirty: true } : x)));
  };

  const ada = !!msg.node || !!cari;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ada) return;
      if (e.key === "F4") { e.preventDefault(); if (bisaUbah) void simpan(); }
      else if (e.key === "F5") { e.preventDefault(); refresh(); }
      else if (e.key === "F6") { e.preventDefault(); if (bisaUbah) hapus(); }
      else if (e.key === "Escape") go("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ada, simpan, refresh, hapus, go, bisaUbah]);

  /* ---- Tabel ---- */
  const txt = (r: R, key: "tglawal" | "tglakhir", ph = "") => (
    <input value={r[key]} placeholder={ph} autoComplete="off" onChange={(e) => patch(r.uid, { [key]: e.target.value })}
      onBlur={() => { const iso = tglId2Iso(r[key]); if (iso) patch(r.uid, { [key]: tglIso2Id(iso) } as Partial<R>); }} />
  );
  const kode = (r: R, field: Kode) => (
    <input value={r[field]} autoComplete="off" onChange={(e) => patch(r.uid, { [field]: e.target.value } as Partial<R>)}
      onKeyDown={(e) => {
        if (e.key === "F10") { e.preventDefault(); setCari({ uid: r.uid, field }); }
        else if (e.key === "Enter" && r[field].trim() && !(field === "kodebarang" ? r.namabarang : r.namabonus)) { e.preventDefault(); void cariKode(r.uid, field, r[field]); }
      }}
      onBlur={() => { if (r[field].trim() && !(field === "kodebarang" ? r.namabarang : r.namabonus)) void cariKode(r.uid, field, r[field]); }}
      onDoubleClick={() => setCari({ uid: r.uid, field })} />
  );
  const num = (r: R, key: "minbeli" | "jmlbonus" | "minbelanja") => (
    <NumInput className="r" value={r[key]} onChange={(v) => patch(r.uid, { [key]: v } as Partial<R>)} />
  );
  const persen = (r: R) => (
    <NumInput className="r" value={r.diskon} onChange={(v) => patch(r.uid, { diskon: v, hrgdiskon: r.hrgnormal > 0 ? hitungHarga(r.hrgnormal, v) : 0 })} />
  );
  const harga = (r: R) => (
    <NumInput className="r" value={r.hrgdiskon} onChange={(v) => patch(r.uid, { hrgdiskon: v, diskon: hitungPersen(r.hrgnormal, v) })} />
  );

  type Col = { t: string; w: number; r?: boolean; cell: (x: R) => ReactNode };
  const cols: Col[] = jenis === "diskon" ? [
    { t: "Kode Barang", w: 14, cell: (x) => kode(x, "kodebarang") },
    { t: "Nama Barang", w: 30, cell: (x) => x.namabarang },
    { t: "Hrg. Normal", w: 11, r: true, cell: (x) => (x.kodebarang ? rp(x.hrgnormal) : "") },
    { t: "Diskon (%)", w: 9, r: true, cell: persen },
    { t: "Hrg. Diskon", w: 11, r: true, cell: harga },
    { t: "Tgl. Mulai", w: 10, cell: (x) => txt(x, "tglawal", "DD/MM/YYYY") },
    { t: "Tgl. Berakhir", w: 10, cell: (x) => txt(x, "tglakhir", "DD/MM/YYYY") },
    { t: "Status", w: 8, cell: (x) => (x.kodebarang ? status(x, hari) : "") },
  ] : jenis === "bonus" ? [
    { t: "Kode Barang", w: 12, cell: (x) => kode(x, "kodebarang") },
    { t: "Nama Barang", w: 22, cell: (x) => x.namabarang },
    { t: "Min. Beli", w: 8, r: true, cell: (x) => num(x, "minbeli") },
    { t: "Kode Bonus", w: 12, cell: (x) => kode(x, "kodebonus") },
    { t: "Nama Barang Bonus", w: 22, cell: (x) => x.namabonus },
    { t: "Jml. Bonus", w: 8, r: true, cell: (x) => num(x, "jmlbonus") },
    { t: "Tgl. Mulai", w: 9, cell: (x) => txt(x, "tglawal", "DD/MM/YYYY") },
    { t: "Tgl. Berakhir", w: 9, cell: (x) => txt(x, "tglakhir", "DD/MM/YYYY") },
    { t: "Status", w: 8, cell: (x) => (x.kodebarang ? status(x, hari) : "") },
  ] : [
    { t: "Min. Transaksi", w: 11, r: true, cell: (x) => num(x, "minbelanja") },
    { t: "Kode Barang", w: 12, cell: (x) => kode(x, "kodebarang") },
    { t: "Nama Barang", w: 24, cell: (x) => x.namabarang },
    { t: "Hrg. Normal", w: 10, r: true, cell: (x) => (x.kodebarang ? rp(x.hrgnormal) : "") },
    { t: "Diskon (%)", w: 8, r: true, cell: persen },
    { t: "Hrg. Diskon", w: 10, r: true, cell: harga },
    { t: "Tgl. Mulai", w: 9, cell: (x) => txt(x, "tglawal", "DD/MM/YYYY") },
    { t: "Tgl. Berakhir", w: 9, cell: (x) => txt(x, "tglakhir", "DD/MM/YYYY") },
    { t: "Status", w: 7, cell: (x) => (x.kodebarang ? status(x, hari) : "") },
  ];

  const grid = (g: Geom) => {
    const total = Math.max(rows.length, Math.floor((g.height - 2 - HEAD_H) / ROW_H));
    const trs: ReactNode[] = [];
    for (let i = 0; i < total; i++) {
      const x = rows[i];
      if (!x) { trs.push(<tr key={`e${i}`}><td className="no">{i + 1}</td>{cols.map((_, k) => <td key={k} />)}</tr>); continue; }
      trs.push(
        <tr key={x.uid} className={sel === x.uid ? "cur" : ""} onMouseDown={() => setSel(x.uid)} onFocus={() => setSel(x.uid)}>
          <td className="no">{i + 1}</td>
          {cols.map((c, k) => <td key={k} className={c.r ? "r" : c.t.startsWith("Nama") ? "nm" : ""}>{c.cell(x)}</td>)}
        </tr>,
      );
    }
    return (
      <div className="tj-grid" ref={gridRef}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
          const all = [...(gridRef.current?.querySelectorAll<HTMLInputElement>("tbody input") ?? [])];
          const at = all.indexOf(e.target);
          if (at >= 0 && all[at + 1]) { e.preventDefault(); all[at + 1].focus(); all[at + 1].select(); }
        }}>
        <table>
          <colgroup><col style={{ width: "4%" }} />{cols.map((c, i) => <col key={i} style={{ width: `${c.w * 0.96}%` }} />)}</colgroup>
          <thead><tr><th className="r">No</th>{cols.map((c, i) => <th key={i} className={c.r ? "r" : ""}>{c.t}</th>)}</tr></thead>
          <tbody>{trs}</tbody>
        </table>
      </div>
    );
  };

  const bind = useMemo(() => ({
    tdBonus: grid,
    lblKet: { text: <>{NOTE[jenis]}<br />{NOTE_F10}</> },
    cSimpan: { onClick: () => (bisaUbah ? void simpan() : msg.alert("Akun kasir tidak bisa mengubah data promo.")) },
    cRefresh: { onClick: refresh },
    cHapus: { onClick: () => (bisaUbah ? hapus() : msg.alert("Akun kasir tidak bisa menghapus data promo.")) },
    cTutup: { onClick: () => go("home") },
    dtTgl1: { value: tgl1, onChange: (v: string) => setTgl1(v) },
    dtTgl2: { value: tgl2, onChange: (v: string) => setTgl2(v) },
    tMinTrans: { value: minTrans, onChange: setMinTrans },
    cSetSemua: { onClick: setSemua },
  }), [rows, sel, jenis, tgl1, tgl2, minTrans, bisaUbah, simpan, refresh, hapus]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tj-page" style={{ position: "relative" }}>
      <VbForm form={FORM[jenis]} bind={bind} fill anchor={ANCHOR} />
      {jenis === "diskon" && (
        <button type="button" className="vb-btn" style={{ position: "absolute", right: 16, bottom: 8, width: 130, height: 27 }}
          onClick={() => go("promopdp")}>Diskon PDP</button>
      )}
      {msg.node}
      {cari && <CariBarang onClose={() => setCari(null)} onPick={(b) => { pilih(cari.uid, cari.field, b); setCari(null); }} />}
    </div>
  );
}
