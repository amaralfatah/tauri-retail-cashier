import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, Row, TransInput } from "../api";
import { ntApi } from "../api/keuangan";
import { kasirApi, perluVerifikasi, pesanKonfirmasi } from "../api/kasir";
import { orderApi } from "../api/order";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { CariSatuan } from "../components/CariSatuan";
import { CariTransaksi } from "../components/CariTransaksi";
import { Alert, Modal } from "../components/Modal";
import { Otentikasi } from "../components/Otentikasi";
import { cetakStruk, Struk } from "../components/Struk";
import { StrukPenjualan } from "../components/StrukPenjualan";
import { addDays, hargaJual, num, qty, rp, tglID, today, Unit, unitsOf } from "../format";
import { Geom, VbCtrl, VbForm, VbPos, VbWindow, formCaption, formSize, twips, useVbForm, vbColor } from "../vb/VbForm";
import { useMsgBox, VbModal } from "../vb/VbGrid";
import { BarangEdit } from "./MasterEdit";
import { PoinMember } from "./Poin";
import { CariMaster } from "./keuanganLib";
import { getLocal } from "./localSettings";
import { getModeScan } from "./modeScan";
import "./transaksi.css";

type Mode = "jual" | "beli";
type Kol = "kode" | "satuan" | "jml" | "hrg" | "nama" | "hjual" | "margin";
const qty2 = (n: unknown) => (Number(n) || 0).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Line {
  key: number;
  b: Row;
  units: Unit[];
  ui: number;
  jml: number;
  harga: number;
  manual: boolean;
  /** Nama barang yang diubah di baris (hanya untuk barang dengan BISAEDITNAMA = 1). */
  nama?: string;
  /** Pembelian: harga jual per satuan transaksi yang diisi di kolom Hrg. Jual (kosong = harga jual master). */
  hrgjual?: number;
}

const namaBaris = (l: Line) => l.nama ?? l.b.namabarang;
/** Harga jual yang dipakai kolom Hrg. Jual pembelian: yang diisi, atau harga jual master per satuan transaksi. */
const hrgJualBaris = (l: Line) => l.hrgjual ?? Math.round((Number(l.b.hrgjual) || 0) * l.units[l.ui].konversi);

/** Baris yang ditampilkan: harga sudah memakai promo, `pdp` = potongan PDP untuk seluruh baris. */
type ShownLine = Line & { pdp: number };

interface PromoHitung {
  baris: { harga: number; disknilai: number }[];
  bonus: { kodebarang: string; namabarang: string; kodesatuan: string; jml: number }[];
}

const promoKeranjang = (tgl: string, items: Row[]) => invoke<PromoHitung>("promo_keranjang", { tgl, items });

let lineKey = 1;

const fmt2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function findCtrl(n: VbCtrl | undefined, name: string): VbCtrl | undefined {
  if (!n) return undefined;
  if (n.name === name) return n;
  for (const k of n.children) {
    const r = findCtrl(k, name);
    if (r) return r;
  }
  return undefined;
}

const fontCss = (f?: { name: string; size: number; weight?: number }): CSSProperties =>
  f ? { fontFamily: `"${f.name}", Tahoma, sans-serif`, fontSize: `${((f.size * 96) / 72).toFixed(1)}px`, fontWeight: (f.weight ?? 0) >= 600 ? 700 : 400 } : {};

const FULL = { left: true, right: true, top: true, bottom: true };
/** Jangkar saat jendela dimaksimalkan (setara Form_Resize di aslinya). */
const ANCHOR = {
  lblTotal: { right: true },
  lblInfo: { left: true, right: true },
  dtDetil: FULL,
  dtDetilBonus: { right: true, top: true, bottom: true },
  lblBonus: { right: true },
};
/** Tanpa kotak scan, tabel dan panel bonus naik tepat di bawah garis hitam. */
const POS_TANPA_SCAN = {
  dtDetil: { top: 2505, height: 6255 - 2505 },
  lblBonus: { top: 2505 },
  dtDetilBonus: { top: 2835, height: 6195 - 2835 },
};

const POS_JUDUL_BONUS: VbPos = { left: 10770, width: 3405 };

/** Layar order: tabel diperpanjang sampai baris DP / Uang Muka (Picture2) di atas tombol bawah. */
const POS_ORDER_JUAL = { dtDetil: { top: 2700, height: 5850 - 2700 } };
const POS_ORDER_BELI = { dtDetil: { top: 2790, height: 6345 - 2790 } };

/** Kotak isian angka: teks mentah saat difokus, berformat saat tidak. */
function VNum(props: { value: number; onChange?: (v: number) => void; f: string; right?: boolean; readOnly?: boolean; dec2?: boolean; inputRef?: React.Ref<HTMLInputElement>; className?: string }) {
  const [text, setText] = useState(String(props.value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(props.value)); }, [props.value, focus]);
  // Nilai diubah dari luar saat Anda mengetik (misalnya jumlah dikembalikan ke stok): tampilkan nilai barunya.
  useEffect(() => { if (focus && (Number(text.replace(",", ".")) || 0) !== props.value) setText(String(props.value)); }, [props.value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input ref={props.inputRef} data-f={props.f} className={props.className} inputMode="decimal" readOnly={props.readOnly || !props.onChange}
      style={props.right ? { textAlign: "right" } : undefined}
      value={focus ? text : new Intl.NumberFormat("id-ID", { minimumFractionDigits: props.dec2 ? 2 : 0, maximumFractionDigits: 2 }).format(props.value)}
      onFocus={(e) => { setFocus(true); setText(String(props.value)); const el = e.target; setTimeout(() => el.select(), 0); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => { setText(e.target.value); props.onChange?.(Number(e.target.value.replace(",", ".")) || 0); }} />
  );
}

/* ------------------------------------------------------------------ */
/* Tabel detail (pengganti xTableEdit)                                 */
/* ------------------------------------------------------------------ */

const ROW_H = 23;
const HEAD_H = 40;
/** Lebar kolom (No, Kode, Nama, Satuan, Jml, Harga, Subtotal) dalam persen, mengikuti aslinya. */
const COLS = [3.7, 12.4, 43.5, 6.3, 6.3, 13.4, 14.4];
/** Pembelian: tambah kolom Hrg. Jual dan Margin (sebelum Subtotal). */
const COLS_BELI = [3.5, 11, 29, 6, 6, 12, 12, 9, 11.5];

function Lens({ onClick, title }: { onClick?: () => void; title: string }) {
  return (
    <button type="button" className="kd-cari" tabIndex={-1} aria-label={title} title={title}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 10l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function DetailGrid(props: {
  g: Geom; jual: boolean; lines: ShownLine[]; selected: number | null;
  onSelect: (k: number | null) => void;
  onUpdate: (key: number, patch: Partial<Line>) => void;
  onDelete: (key: number) => void;
  onEnterScan: () => void;
  onCariKode: (key: number) => void;
  onCariSatuan: (key: number) => void;
  stokKurang: (l: Line) => boolean;
  /** Kolom harga hanya bisa dibaca (Kasir, pengaturan "Izinkan user bisa edit harga jual" mati). */
  hargaTerkunci?: boolean;
  /** Naik tiap kali kursor harus pindah ke kolom jumlah baris terpilih. */
  fokusJml?: number;
  entry?: { value: string; onChange: (v: string) => void; onEnter: () => void; onCari?: () => void; inputRef: React.Ref<HTMLInputElement> };
  gridRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { lines, selected, g } = props;
  const wantFocus = useRef(false);
  const [entryFocus, setEntryFocus] = useState(false);
  const [col, setCol] = useState<Kol>("jml");
  const total = Math.max(lines.length + (props.entry ? 1 : 0), Math.floor((g.height - 2 - HEAD_H) / ROW_H));

  useEffect(() => {
    if (!props.fokusJml) return;
    setCol("jml");
    const t = setTimeout(() => props.gridRef.current?.querySelector<HTMLInputElement>("input[data-act]")?.focus(), 30);
    return () => clearTimeout(t);
  }, [props.fokusJml, props.gridRef]);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    props.gridRef.current?.querySelector<HTMLInputElement>("input[data-act]")?.focus();
  }, [selected, col, props.gridRef]);

  const urutan: Kol[] = props.hargaTerkunci ? ["kode", "satuan", "jml"] : props.jual ? ["kode", "satuan", "jml", "hrg"] : ["kode", "satuan", "jml", "hrg", "hjual", "margin"];
  const pindah = (c: Kol) => { wantFocus.current = true; setCol(c); };

  const idx = lines.findIndex((l) => l.key === selected);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const inInput = e.target !== e.currentTarget;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.target instanceof HTMLSelectElement) return;
      const n = idx + (e.key === "ArrowDown" ? 1 : -1);
      if (n >= 0 && n < lines.length) {
        e.preventDefault();
        wantFocus.current = inInput;
        props.onSelect(lines[n].key);
      }
    } else if (e.key === "Delete" && !inInput && selected != null) {
      e.preventDefault();
      props.onDelete(selected);
    } else if (e.key === "Enter" && !inInput && selected != null) {
      e.preventDefault();
      pindah("jml");
    } else if (e.key === "Tab" && inInput && (e.target as HTMLElement).dataset.act !== undefined && selected != null && !entryFocus) {
      const i = urutan.indexOf(col) + (e.shiftKey ? -1 : 1);
      e.preventDefault();
      if (i >= 0 && i < urutan.length) pindah(urutan[i]);
      else if (i >= urutan.length) props.onEnterScan();
    }
  };

  const rows: ReactNode[] = [];
  for (let i = 0; i < total; i++) {
    const l = lines[i];
    if (!l) {
      const isEntry = props.entry && i === lines.length;
      rows.push(
        <tr key={`e${i}`}>
          <td className="no">{i + 1}</td>
          <td className="kd">{isEntry && (
            <div className="kd-edit">
              <input ref={props.entry!.inputRef} value={props.entry!.value} autoComplete="off"
                onFocus={() => setEntryFocus(true)} onBlur={() => setEntryFocus(false)}
                onChange={(e) => props.entry!.onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); props.entry!.onEnter(); } }} />
              {(selected == null || entryFocus) && <Lens title="Cari barang [F10]" onClick={props.entry!.onCari} />}
            </div>
          )}</td>
          {Array.from({ length: props.jual ? 5 : 7 }, (_, k) => <td key={k} />)}
        </tr>,
      );
      continue;
    }
    const cur = selected === l.key && !entryFocus;
    const klik = (c: Kol) => () => { if (!(cur && col === c)) { wantFocus.current = true; setCol(c); } if (selected !== l.key) props.onSelect(l.key); };
    const kodeTampil = l.b.kodebarang;
    rows.push(
      <tr key={l.key}>
        <td className="no">{i + 1}</td>
        <td className={cur && col === "kode" ? "kd" : undefined} onMouseDown={klik("kode")}>{cur && col === "kode" ? (
          <div className="kd-edit">
            <input readOnly data-act="kode" value={kodeTampil} />
            <Lens title="Cari barang [F10]" onClick={() => props.onCariKode(l.key)} />
          </div>
        ) : kodeTampil}</td>
        <td className="nm" onMouseDown={props.jual && Number(l.b.bisaeditnama) === 1 ? klik("nama") : undefined}>{cur && col === "nama" && props.jual && Number(l.b.bisaeditnama) === 1 ? (
          <input data-act="nama" value={namaBaris(l)} onChange={(e) => props.onUpdate(l.key, { nama: e.target.value })} style={{ width: "100%" }} />
        ) : namaBaris(l)}</td>
        <td className={cur && col === "satuan" ? "kd" : undefined} onMouseDown={klik("satuan")}>
          {cur && col === "satuan" ? (
            <div className="kd-edit">
              <input readOnly data-act="satuan" value={l.units[l.ui].satuan} />
              <Lens title="Cari satuan" onClick={() => props.onCariSatuan(l.key)} />
            </div>
          ) : l.units[l.ui].satuan}
        </td>
        <td className="r" onMouseDown={klik("jml")}>{cur && col === "jml" ? (
          <VNum f="jml" right dec2 value={l.jml} onChange={(v) => props.onUpdate(l.key, { jml: v })}
            inputRef={(el) => { if (el) el.setAttribute("data-act", "jml"); }} />
        ) : qty2(l.jml)}
        </td>
        <td className="r" onMouseDown={klik("hrg")}>{cur && col === "hrg" ? (
          <VNum f="hrg" right value={l.harga} readOnly={props.hargaTerkunci} onChange={(v) => props.onUpdate(l.key, { harga: v, manual: true })}
            inputRef={(el) => { if (el) el.setAttribute("data-act", "hrg"); }} />
        ) : rp(l.harga)}</td>
        {!props.jual && (
          <td className="r" onMouseDown={klik("hjual")}>{cur && col === "hjual" ? (
            <VNum f="hjual" right value={hrgJualBaris(l)} onChange={(v) => props.onUpdate(l.key, { hrgjual: v })}
              inputRef={(el) => { if (el) el.setAttribute("data-act", "hjual"); }} />
          ) : rp(hrgJualBaris(l))}</td>
        )}
        {!props.jual && (
          <td className="r" onMouseDown={klik("margin")}>{cur && col === "margin" ? (
            <VNum f="margin" right value={hrgJualBaris(l) - l.harga} onChange={(v) => props.onUpdate(l.key, { hrgjual: l.harga + v })}
              inputRef={(el) => { if (el) el.setAttribute("data-act", "margin"); }} />
          ) : rp(hrgJualBaris(l) - l.harga)}</td>
        )}
        <td className="r">{rp(l.jml * l.harga - l.pdp)}</td>
      </tr>,
    );
  }

  return (
    <div className="tj-grid" tabIndex={0} ref={props.gridRef} onKeyDown={onKeyDown}
      onKeyDownCapture={(e) => {
        const act = e.target instanceof HTMLInputElement ? e.target.dataset.act : undefined;
        if (e.key !== "Enter" || !act) return;
        e.preventDefault();
        if (act === "kode" && selected != null) props.onCariKode(selected);
        else if (act === "satuan" && selected != null) props.onCariSatuan(selected);
        else if (act === "nama") pindah("jml");
        else if (act === "jml" && !props.hargaTerkunci) pindah("hrg");
        else if (act === "hrg" && !props.jual) pindah("hjual");
        else if (act === "hjual") pindah("margin");
        else props.onEnterScan();
      }}>
      <table>
        <colgroup>{(props.jual ? COLS : COLS_BELI).map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
        <thead>
          <tr>
            <th>No</th><th>Kode / Barcode</th><th>Nama Barang</th><th>Satuan</th><th>Jml</th>
            <th>{props.jual ? "Hrg. Jual" : "Hrg. Beli"}</th>{!props.jual && <th>Hrg. Jual</th>}{!props.jual && <th>Margin</th>}<th>Subtotal</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function BonusGrid({ g, bonus }: { g: Geom; bonus: PromoHitung["bonus"] }) {
  const n = Math.max(bonus.length, Math.floor((g.height - 2 - 24) / 23));
  return (
    <div className="tj-bonus">
      <table>
        <colgroup><col style={{ width: 30 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 44 }} /></colgroup>
        <thead><tr><th>No</th><th>Kode</th><th>Nama</th><th>Jml</th></tr></thead>
        <tbody>{Array.from({ length: n }, (_, i) => {
          const b = bonus[i];
          return <tr key={i}><td>{i + 1}</td><td>{b?.kodebarang}</td><td className="nm" title={b?.namabarang}>{b?.namabarang}</td><td className="r">{b ? qty(b.jml) : ""}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pilih pelanggan / pemasok / sales                                   */
/* ------------------------------------------------------------------ */

function PilihModal(props: { title: string; rows: { kode: string; nama: string }[]; kosong: string; onPick: (kode: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = props.rows.filter((r) => r.nama.toLowerCase().includes(q.toLowerCase()) || r.kode.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik nama untuk mencari" style={{ width: "100%" }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); props.onPick(list[0]?.kode ?? ""); } }} />
      <div className="tp-pilih">
        <button className="btn" onClick={() => props.onPick("")}>{props.kosong}</button>
        {list.slice(0, 200).map((r) => <button key={r.kode} className="btn" onClick={() => props.onPick(r.kode)}>{r.nama}</button>)}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Cari order / data pending (FrmCariOrderJual, FrmCariOrderBeli,      */
/* FrmCariPendingJual)                                                 */
/* ------------------------------------------------------------------ */

type CariJenis = "orderjual" | "orderbeli" | "pending";
const CARI_FORM: Record<CariJenis, string> = { orderjual: "FrmCariOrderJual", orderbeli: "FrmCariOrderBeli", pending: "FrmCariPendingJual" };

function CariDataDialog(props: { jenis: CariJenis; onAmbil: (nomor: string) => void; onClose: () => void }) {
  const formName = CARI_FORM[props.jenis];
  const [q, setQ] = useState("");
  const [dari, setDari] = useState(today());
  const [sampai, setSampai] = useState(today());
  const [list, setList] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const { user } = useApp();
  const [hapus, setHapus] = useState(false);
  const [mintaIzin, setMintaIzin] = useState(false);
  /** Tanda izin dari Verifikasi Admin; dipakai saat penghapusan setelah pertanyaan dijawab Ya. */
  const [izin, setIzin] = useState<string | undefined>(undefined);
  const [muat, setMuat] = useState(0);
  const nomorKey = props.jenis === "pending" ? "nopending" : "notrans";
  const kontakLabel = props.jenis === "orderjual" || props.jenis === "pending" ? "Pelanggan" : "Pemasok";

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      const ambil = props.jenis === "pending"
        ? orderApi.listPending(dari, sampai, q)
        : orderApi.listOrder(props.jenis === "orderjual", dari, sampai, q);
      ambil.then((r) => { if (!batal) { setList(r); setSel((s) => (r.some((x) => x[nomorKey] === s) ? s : r[0]?.[nomorKey] ?? null)); } })
        .catch((e) => !batal && setErr(errText(e)));
    }, 150);
    return () => { batal = true; clearTimeout(t); };
  }, [props.jenis, q, dari, sampai, muat, nomorKey]);

  const ambil = () => { if (sel) props.onAmbil(sel); else setErr("Pilih dulu data yang akan diambil."); };
  // Seperti aslinya: Kasir dan Lainnya login lewat Verifikasi Admin dulu, baru ditanya "akan dihapus?".
  const mulaiHapus = () => {
    if (!sel) return;
    setIzin(undefined);
    if (perluVerifikasi(user.level)) setMintaIzin(true);
    else setHapus(true);
  };
  const hapusData = async (tanda?: string) => {
    if (!sel) return;
    try {
      if (props.jenis === "pending") await orderApi.deletePending(sel, tanda);
      else await orderApi.deleteOrder(sel, tanda);
      setHapus(false);
      setMuat((n) => n + 1);
    } catch (e) {
      setHapus(false);
      setErr(errText(e));
    }
  };

  const move = (d: number) => {
    const i = list.findIndex((x) => x[nomorKey] === sel);
    const n = list[Math.max(0, Math.min(list.length - 1, i + d))];
    if (n) setSel(n[nomorKey]);
  };

  const bind: Record<string, any> = {
    tData: { value: q, onChange: setQ, style: { fontSize: 13 } },
    dtTgl1: { value: dari, onChange: (v: string) => v && setDari(v) },
    dtTgl2: { value: sampai, onChange: (v: string) => v && setSampai(v) },
    cOK: { onClick: () => setMuat((n) => n + 1) },
    cAmbil: { onClick: ambil, disabled: !sel },
    cHapus: { onClick: mulaiHapus, disabled: !sel },
    cClose: { onClick: props.onClose },
    lsData: (g: Geom) => (
      <div className="tj-grid cari-data" tabIndex={0} style={{ width: g.width, height: g.height }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter") { e.preventDefault(); ambil(); }
        }}>
        <table>
          <thead>
            <tr><th>{props.jenis === "pending" ? "No. Pending" : "No. Order"}</th><th>Tanggal</th><th>{kontakLabel}</th><th>Kasir</th><th className="r">Jumlah</th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r[nomorKey]} className={r[nomorKey] === sel ? "cur" : ""} onMouseDown={() => setSel(r[nomorKey])} onDoubleClick={ambil}>
                <td>{r[nomorKey]}</td>
                <td>{tglID(props.jenis === "pending" ? r.tgltrans : r.tglorder)}</td>
                <td>{r.kontak}</td>
                <td>{r.kasir}</td>
                <td className="r">{rp(r.jmltrans)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="kosong">{props.jenis === "pending" ? "Belum ada transaksi yang di-pending." : "Belum ada order yang menunggu diambil."}</td></tr>}
          </tbody>
        </table>
      </div>
    ),
  };

  const apa = props.jenis === "pending" ? "data pending" : "order";
  return (
    <div style={{ display: "contents" }}
      onKeyDownCapture={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setMuat((n) => n + 1); }
        else if (e.key === "ArrowDown" && e.target.closest('[data-vb="tData"]') && list.length) { e.preventDefault(); document.querySelector<HTMLElement>(".cari-data")?.focus(); }
      }}>
      <VbModal form={formName} title={formCaption(formName)} bind={bind} onClose={() => { if (!err && !hapus && !mintaIzin) props.onClose(); }}>
        {err && (
          <div style={{ position: "absolute" }}>
            <Modal title={formCaption(formName)} onClose={() => setErr("")} footer={<button className="btn primary" autoFocus onClick={() => setErr("")}>OK</button>}>
              <Alert>{err}</Alert>
            </Modal>
          </div>
        )}
        {hapus && (
          <div style={{ position: "absolute" }}>
            <Modal title={formCaption(formName)} onClose={() => setHapus(false)}
              footer={<><button className="btn" onClick={() => setHapus(false)}>Tidak</button><button className="btn primary" autoFocus onClick={() => void hapusData(izin)}>Ya</button></>}>
              <p>Apakah data order yg dipilih akan dihapus?</p>
            </Modal>
          </div>
        )}
        {mintaIzin && (
          <Otentikasi alasan={`Untuk menghapus ${apa}, masukkan nama user dan kata sandi supervisor atau pemilik toko.`}
            onBatal={() => setMintaIzin(false)}
            onOk={(t) => { setMintaIzin(false); setIzin(t); setHapus(true); }} />
        )}
      </VbModal>
    </div>
  );
}

/** Tombol Stok Min: daftar barang yang stoknya sudah di bawah atau sama dengan stok minimal; pengguna memilih satu per satu. */
function StokMinDialog(props: { onPick: (b: Row) => void; onClose: () => void }) {
  const [daftar, setDaftar] = useState<Row[] | null>(null);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const semua: Row[] = [];
      for (let off = 0; ; off += 1000) {
        const r = await api.masterList("mdbarang", { limit: 1000, offset: off, onlyActive: true });
        semua.push(...r.rows);
        if (semua.length >= r.total || r.rows.length === 0) break;
      }
      setDaftar(semua.filter((b) => b.jenis === "Barang" && Number(b.stokmin) > 0 && Number(b.stokakhir) <= Number(b.stokmin)));
    })().catch((e) => setErr(errText(e)));
  }, []);
  return (
    <Modal title="Stok Minimum" onClose={props.onClose} wide footer={<button className="btn primary" autoFocus onClick={props.onClose}>Tutup</button>}>
      <Alert>{err}</Alert>
      <p>Klik barang yang akan dipesan. Jumlahnya bisa Anda ubah di tabel.</p>
      <div className="tj-grid cari-data" style={{ height: 300 }}>
        <table>
          <thead><tr><th>Kode</th><th>Nama Barang</th><th className="r">Stok</th><th className="r">Stok Min</th><th /></tr></thead>
          <tbody>
            {(daftar ?? []).map((b) => (
              <tr key={b.kodebarang} onClick={() => { props.onPick(b); setDipilih((x) => new Set(x).add(b.kodebarang)); }}>
                <td>{b.kodebarang}</td><td className="nm">{b.namabarang}</td><td className="r">{qty(b.stokakhir)}</td><td className="r">{qty(b.stokmin)}</td>
                <td>{dipilih.has(b.kodebarang) ? "✓" : ""}</td>
              </tr>
            ))}
            {daftar && daftar.length === 0 && <tr><td colSpan={5} className="kosong">Tidak ada barang yang stoknya sudah di bawah stok minimal.</td></tr>}
            {!daftar && !err && <tr><td colSpan={5} className="kosong">Mohon tunggu sebentar.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Halaman transaksi                                                   */
/* ------------------------------------------------------------------ */

export function TransaksiForm({ mode, order = false }: { mode: Mode; order?: boolean }) {
  const { user, setting, go } = useApp();
  const jual = mode === "jual";
  const formName = order ? (jual ? "FrmTransJualOrder" : "FrmTransBeliOrder") : jual ? "FrmTransJual" : "FrmTransBeli";
  const kodeTrans = order ? (jual ? "SO" : "PO") : jual ? "TJ" : "TB";
  const [tgl, setTgl] = useState(today());
  const [notrans, setNotrans] = useState("");
  const [kontak, setKontak] = useState("");
  const [sales, setSales] = useState("");
  const [catatan, setCatatan] = useState("");
  const [kontakList, setKontakList] = useState<Row[]>([]);
  const [salesList, setSalesList] = useState<Row[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const tanya = useMsgBox();
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "cari" | "bayar" | "kontak" | "sales" | "ambilorder" | "satuan" | "koreksi" | "pending" | "poin" | "editbarang" | "kasir" | "pilihtrans" | "pilihorder" | "stokmin">(null);
  const [kasir, setKasir] = useState({ kode: user.kodekaryawan, nama: user.namakaryawan });
  /** Dokumen yang akan dicetak dari transaksi atau order yang dipilih di daftar. */
  const [pilihUntuk, setPilihUntuk] = useState<"ulang" | "sj" | "spk">("ulang");
  // Order yang sedang diambil, pending yang sedang dipulihkan, order yang sedang dikoreksi.
  const [noOrder, setNoOrder] = useState("");
  const [noPending, setNoPending] = useState("");
  const [noKoreksi, setNoKoreksi] = useState("");
  const [dp, setDp] = useState(0);
  const [cariAwal, setCariAwal] = useState("");
  const [gantiKey, setGantiKey] = useState<number | null>(null);
  const [satuanKey, setSatuanKey] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [modeScan] = useState(getModeScan);
  const kotakScan = jual && modeScan && !order;
  const [ulang, setUlang] = useState<{ header: Row; detail: Row[] } | null>(null);
  const [ulangOrder, setUlangOrder] = useState<{ header: Row; detail: Row[] } | null>(null);
  const [promo, setPromo] = useState<PromoHitung | null>(null);
  const [dok, setDok] = useState<{ jenis: "sj" | "spk"; header: Row; detail: Row[] } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [fokusJml, setFokusJml] = useState(0);

  const aktifLevel = Number(setting.aktiflevel) === 1;
  const level = useMemo(() => kontakList.find((k) => k.kodepelanggan === kontak)?.level ?? "", [kontak, kontakList]);
  const kontakNama = useMemo(() => {
    const k = kontakList.find((x) => (jual ? x.kodepelanggan : x.kodepemasok) === kontak);
    return k ? (jual ? k.namapelanggan : k.namapemasok) : "Tunai";
  }, [kontak, kontakList, jual]);
  const salesNama = salesList.find((k) => k.kodekaryawan === sales)?.namakaryawan ?? "";

  const refreshNo = useCallback(() => {
    api.previewNotrans(kodeTrans, tgl).then(setNotrans).catch(() => setNotrans(""));
  }, [kodeTrans, tgl]);
  useEffect(refreshNo, [refreshNo]);

  useEffect(() => {
    api.masterList(jual ? "mdpelanggan" : "mdpemasok", { limit: 5000, onlyActive: true }).then((r) => setKontakList(r.rows)).catch(() => undefined);
    api.masterList("mdkaryawan", { limit: 1000, onlyActive: true }).then((r) => setSalesList(r.rows)).catch(() => undefined);
    scanRef.current?.focus();
  }, [jual]);

  const priceOf = useCallback(
    (l: Line) => (l.manual ? l.harga : jual ? hargaJual(l.b, l.units[l.ui], l.jml, level, aktifLevel) : l.units[l.ui].hargaBeli),
    [jual, level, aktifLevel],
  );

  // Harga dihitung ulang saat pelanggan (level) berubah.
  useEffect(() => { setLines((ls) => ls.map((l) => ({ ...l, harga: priceOf(l) }))); }, [priceOf]);

  // Promo (harga diskon, bonus, PDP) dihitung backend, aturannya sama dengan saat simpan.
  const promoAktif = jual && !order && Number(setting.aktifpromo) === 1;
  const isKasir = user.level === "Kasir";
  // Kasir tanpa izin harga: kolom Hrg. Jual hanya bisa dibaca.
  const hargaTerkunci = jual && !order && isKasir && Number(setting.izinharga) !== 1;
  const kursorKeJml = jual && !order && getLocal("kursor") === "1";
  // Pengaturan izinstokmin mati (semua level): jumlah tidak boleh melebihi stok.
  const batasiStok = jual && !order && Number(setting.izinstokmin) !== 1;
  /** Jumlah terbanyak (dalam satuan transaksi) yang masih ada stoknya; null kalau tanpa batas. */
  const stokMaks = (b: Row, u: Unit): number | null =>
    batasiStok && b.jenis === "Barang" ? Math.max(0, Math.floor((Number(b.stokakhir) / u.konversi) * 100 + 1e-9) / 100) : null;
  /** Setelah barang masuk: kursor ke kolom jumlah (pengaturan "Arahkan kursor ke kolom jumlah") atau kembali ke kotak scan. */
  const setelahTambah = () => {
    if (kursorKeJml) setFokusJml((n) => n + 1);
    else setTimeout(() => scanRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (!promoAktif || lines.length === 0) { setPromo(null); return; }
    let batal = false;
    const t = setTimeout(() => {
      promoKeranjang(tgl, lines.map((l) => ({
        kodebarang: l.b.kodebarang, namabarang: l.b.namabarang, kodesatuan: l.b.kodesatuan || l.units[0].satuan,
        satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga,
      }))).then((r) => { if (!batal) setPromo(r); }).catch(() => { if (!batal) setPromo(null); });
    }, 120);
    return () => { batal = true; clearTimeout(t); };
  }, [promoAktif, lines, tgl]);

  const shown: ShownLine[] = useMemo(() => {
    const p = promo && promo.baris.length === lines.length ? promo : null;
    return lines.map((l, i) => ({ ...l, harga: p ? Math.min(l.harga, p.baris[i].harga) : l.harga, pdp: p ? p.baris[i].disknilai : 0 }));
  }, [lines, promo]);
  const bonus = promoAktif && promo && promo.baris.length === lines.length ? promo.bonus : [];

  const addBarang = (b: Row, jml = 1) => {
    const ada = lines.find((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
    const maks = stokMaks(b, ada ? ada.units[0] : unitsOf(b)[0]);
    const sudah = ada?.jml ?? 0;
    if (maks !== null && sudah + jml > maks + 1e-9) {
      jml = Math.max(0, maks - sudah);
      if (jml <= 0 && !ada) return setMsg("Stok tidak mencukupi");
      setMsg("Stok tidak mencukupi");
    } else setMsg(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
      if (i >= 0) {
        const copy = [...ls];
        const l = { ...copy[i], jml: maks !== null ? sudah + jml : copy[i].jml + jml };
        copy[i] = { ...l, harga: priceOf(l) };
        setSelected(copy[i].key);
        return copy;
      }
      const l: Line = { key: lineKey++, b, units: unitsOf(b), ui: 0, jml, harga: 0, manual: false };
      l.harga = priceOf(l);
      setSelected(l.key);
      return [...ls, l];
    });
  };

  const onScan = async () => {
    const code = scan.trim();
    if (!code) return setModal("cari");
    // Format "3*kode" untuk langsung mengisi jumlah, seperti kebiasaan kasir.
    const m = /^(\d+(?:[.,]\d+)?)\*(.+)$/.exec(code);
    const jml = m ? num(m[1]) : 1;
    const kode = m ? m[2] : code;
    try {
      const b = await (jual && !order ? kasirApi.findBarang(kode) : api.barangFind(kode));
      if (b) {
        addBarang(b, jml);
        setScan("");
        setelahTambah();
      } else if (!jual) {
        // Pembelian dan order: pesan seperti aslinya, bukan dialog cari.
        setMsg("Data tidak ditemukan, atau barang tidak aktif.");
        setScan("");
      } else {
        setCariAwal(kode);
        setModal("cari");
        setScan("");
      }
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const update = (key: number, patch: Partial<Line>) => {
    // Jumlah melebihi stok: kembalikan ke stok yang ada.
    const cur = lines.find((l) => l.key === key);
    if (cur && ("jml" in patch || "ui" in patch)) {
      const n = { ...cur, ...patch };
      const maks = stokMaks(n.b, n.units[n.ui]);
      if (maks !== null && n.jml > maks + 1e-9) {
        patch = { ...patch, jml: maks };
        setMsg("Stok tidak mencukupi");
      }
    }
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const n = { ...l, ...patch };
      if ("ui" in patch && !("hrgjual" in patch)) n.hrgjual = undefined;
      return "harga" in patch || "hrgjual" in patch || "nama" in patch ? n : { ...n, harga: priceOf(n) };
    }));
  };

  const hapusBaris = (key: number) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const rest = ls.filter((l) => l.key !== key);
      setSelected(rest.length ? rest[Math.min(i, rest.length - 1)].key : null);
      return rest;
    });
  };

  const total = shown.reduce((s, l) => s + l.jml * l.harga - l.pdp, 0);
  const totalItem = lines.reduce((s, l) => s + l.jml, 0);

  const reset = () => {
    setTgl(today());
    setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan });
    setLines([]);
    setKontak("");
    setSales("");
    setCatatan("");
    setNoOrder("");
    setNoPending("");
    setNoKoreksi("");
    setDp(0);
    setMsg(null);
    setSelected(null);
    setPromo(null);
    refreshNo();
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  /** Batal [F6]: seperti aslinya (cBatal_Click) langsung mengosongkan form tanpa bertanya, lalu kursor ke Pelanggan. */
  const batal = () => {
    reset();
    setTimeout(() => fokusCtl(jual ? "tPelangganNama" : "tPemasokNama"), 0);
  };

  const bayar = () => {
    if (lines.length === 0) return setMsg("Belum ada barang. Scan barcode atau tekan F10 untuk mencari barang.");
    if (lines.some((l) => l.jml <= 0)) return setMsg("Ada barang dengan jumlah 0. Perbaiki dulu jumlahnya.");
    if (order) return void simpanOrder();
    setModal("bayar");
  };

  const itemsInput = () => lines.map((l) => ({
    kodebarang: l.b.kodebarang, namabarang: namaBaris(l), kodesatuan: l.b.kodesatuan || l.units[0].satuan,
    satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga,
  }));

  /** Simpan order (SO/PO). Stok tidak berubah. */
  const simpanOrder = async () => {
    try {
      const r = await orderApi.saveOrder({
        jual, tgl, kodepelanggan: jual ? kontak : undefined, kodepemasok: jual ? undefined : kontak, kodesales: sales, catatan,
        dp: jual ? dp : 0, items: itemsInput(), notrans: noKoreksi || undefined, kodekasir: kasir.kode,
      });
      const o = await orderApi.getOrder(r.notrans);
      reset();
      tanya.confirm(`Data sudah disimpan (${r.notrans}). Apakah akan cetak nota order?`, () => setUlangOrder(o));
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Isi layar dari baris order atau pending. Harga yang tersimpan dipakai apa adanya. */
  const muatBaris = async (detail: Row[]) => {
    const baru: Line[] = [];
    const hilang: string[] = [];
    for (const d of detail) {
      const b = await api.barangFind(d.kodebarang);
      if (!b) { hilang.push(d.namabarang || d.kodebarang); continue; }
      const units = unitsOf(b);
      let ui = units.findIndex((u) => u.satuan === d.satuanjual);
      let jml = Number(d.jmljual) || 0;
      let harga = Number(d.hrgterjual) || 0;
      if (ui < 0) { // satuan sudah tidak ada di master: pakai satuan dasar
        const k = Number(d.konversi) > 0 ? Number(d.konversi) : 1;
        ui = 0; jml *= k; harga /= k;
      }
      baru.push({ key: lineKey++, b, units, ui, jml, harga, manual: true });
    }
    setLines(baru);
    setSelected(baru[0]?.key ?? null);
    if (hilang.length) setMsg(`Barang ini sudah tidak ada di data barang, jadi tidak ikut diambil: ${hilang.join(", ")}.`);
  };

  const kontakDari = (h: Row, kode: string) => (h[kode] && h[kode] !== "Tunai" ? String(h[kode]) : "");

  // window.confirm tidak muncul di WebView Tauri, jadi pakai kotak pesan aplikasi.
  const konfirmGanti = () => new Promise<boolean>((ok) => {
    if (lines.length === 0) ok(true);
    else tanya.confirm("Barang yang ada di layar akan diganti. Lanjutkan?", () => ok(true));
  });

  /** Ambil Order [F3] (kasir/pembelian) dan Koreksi Order (layar order). */
  const ambilOrder = async (nomor: string, koreksi: boolean) => {
    if (!(await konfirmGanti())) return;
    try {
      const o = await orderApi.getOrder(nomor);
      const h = o.header;
      if (Number(h.status) === 1) return setMsg("Order ini sudah diambil. Silakan pilih order lain.");
      setModal(null);
      setKontak(kontakDari(h, jual ? "kodepelanggan" : "kodepemasok"));
      setSales(h.kodesales ?? "");
      setCatatan(h.catatan ?? "");
      setDp(jual ? Number(h.jmlbayar) || 0 : 0);
      if (koreksi) { setNoKoreksi(nomor); setTgl(String(h.tglorder || today())); setNoOrder(""); }
      else { setNoOrder(nomor); setNoKoreksi(""); }
      await muatBaris(o.detail);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Tombol Pending: tunda penjualan yang belum selesai. */
  const simpanPending = async () => {
    if (lines.length === 0) return setMsg("Data transaksi masih kosong.");
    try {
      await orderApi.savePending({
        nopending: noPending || undefined, tgl, kodepelanggan: kontak, kodesales: sales, catatan,
        items: itemsInput(), kodekasir: kasir.kode,
      });
      reset();
      setMsg("Pending transaksi sudah tersimpan");
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const ambilPending = async (nomor: string) => {
    if (!(await konfirmGanti())) return;
    try {
      const p = await orderApi.getPending(nomor);
      const h = p.header;
      setModal(null);
      setNoPending(nomor);
      setNoOrder("");
      setDp(0);
      setKontak(kontakDari(h, "kodepelanggan"));
      setSales(h.kodesales ?? "");
      setCatatan(h.catatan ?? "");
      await muatBaris(p.detail);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Cetak ulang nota order: pilih order dari daftar (FrmCariOrderJual / FrmCariOrderBeli). */
  const cetakOrderPilih = async (nomor: string) => {
    try {
      setModal(null);
      setUlangOrder(await orderApi.getOrder(nomor));
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    if (!ulangOrder) return;
    cetakStruk().catch((e) => setMsg(errText(e))).finally(() => setUlangOrder(null));
  }, [ulangOrder]);

  const cekPoin = () => {
    if (!kontak) return setMsg("Pilih dulu pelanggannya (tombol ? di samping kolom Pelanggan). Poin hanya dimiliki pelanggan terdaftar.");
    setModal("poin");
  };

  /** Surat Jalan dan SPK Gudang: dicetak dari transaksi penjualan yang dipilih di daftar (FrmCariTransJual). */
  const cetakDokumen = async (jenis: "sj" | "spk", no: string) => {
    try {
      setModal(null);
      const t = await api.getTransaksi(no);
      const detail = await Promise.all(t.detail.map(async (d) => {
        const b = await api.barangFind(d.kodebarang).catch(() => null);
        return { ...d, barcode: b?.barcode ?? "", rak: b?.rak ?? "" };
      }));
      setDok({ jenis, header: t.header, detail });
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const bukaPilih = (untuk: "ulang" | "sj" | "spk") => { setPilihUntuk(untuk); setModal("pilihtrans"); };
  useEffect(() => {
    if (!dok) return;
    cetakDokumen_(setMsg).finally(() => setDok(null));
  }, [dok]);

  /** Isi pesanan dengan barang yang dipilih dari daftar Stok Min: jumlah = kekurangan sampai stok maksimal. */
  const tambahStokMin = (b: Row) => {
    const min = Number(b.stokmin), max = Number(b.stokmax), akhir = Number(b.stokakhir);
    const jml = Math.round((max > min ? max - akhir : min - akhir) * 100) / 100;
    if (jml <= 0) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], jml: Math.max(c[i].jml, jml) }; return c; }
      const l: Line = { key: lineKey++, b, units: unitsOf(b), ui: 0, jml, harga: 0, manual: false };
      l.harga = priceOf(l);
      return [...ls, l];
    });
  };
  const stokMin = () => setModal("stokmin");

  const editBarang = () => {
    if (selected == null) return setMsg("Pilih dulu barang di tabel yang akan diubah datanya.");
    setModal("editbarang");
  };
  /** Setelah data barang diubah: ambil ulang barangnya dan hitung ulang harga barisnya. */
  const barangBerubah = async (key: string | null) => {
    const lama = lines.find((l) => l.key === selected);
    if (!lama) return;
    try {
      const b = await api.barangFind(key || lama.b.kodebarang);
      if (!b) return setMsg("Barang ini sudah tidak ditemukan di data barang.");
      const units = unitsOf(b);
      const sat = lama.units[lama.ui].satuan;
      const ui = Math.max(0, units.findIndex((u) => u.satuan === sat));
      setLines((ls) => ls.map((l) => {
        if (l.key !== lama.key) return l;
        const n = { ...l, b, units, ui, manual: false };
        return { ...n, harga: priceOf(n) };
      }));
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const cariBarang = () => { setCariAwal(scan); setModal("cari"); };

  /** Cetak Ulang: pilih transaksi dari daftar lalu cetak. */
  const cetakUlang = async (no: string) => {
    try {
      setModal(null);
      setUlang(await api.getTransaksi(no));
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    if (!ulang) return;
    cetakStruk().catch((e) => setMsg(errText(e))).finally(() => setUlang(null));
  }, [ulang]);

  const fokusCtl = (name: string) => document.querySelector<HTMLElement>(`[data-vb="${name}"] input, [data-vb="${name}"] textarea`)?.focus();
  const tutupLayar = () => {
    if (lines.length > 0 && !order) tanya.confirm("Masih ada transaksi yang aktif, apakah akan di batalkan?", () => go("home"));
    else go("home");
  };
  const kasirBisaDiganti = user.level.toUpperCase() !== "KASIR";

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (modal || msg || tanya.node) return;
      if (ev.key === "Escape") { ev.preventDefault(); tutupLayar(); return; }
      if (ev.altKey) {
        const m: Record<string, () => void> = {
          KeyT: () => (kotakScan ? gridRef.current?.focus() : scanRef.current?.focus()),
          Digit1: () => document.querySelector<HTMLElement>('[data-vb="dtTglTrans"] input')?.focus(),
          Digit2: () => { if (kasirBisaDiganti) setModal("kasir"); },
          Digit3: () => setModal("kontak"),
          Digit4: () => setModal("sales"),
          Digit5: () => fokusCtl("tCatatan"),
        };
        if (m[ev.code]) { ev.preventDefault(); m[ev.code](); }
        return;
      }
      const cariBarangF10 = () => { setCariAwal(""); setModal("cari"); };
      const f: Record<string, () => void> = order
        ? { F1: batal, F4: bayar, F10: cariBarangF10, ...(jual ? {} : { F6: stokMin }) }
        : jual
          ? { F1: () => { setScan(""); scanRef.current?.focus(); }, F3: () => setModal("ambilorder"), F4: bayar, F6: batal, F10: cariBarangF10 }
          : { F1: batal, F3: () => setModal("ambilorder"), F4: bayar, F6: stokMin, F10: cariBarangF10 };
      if (f[ev.key]) { ev.preventDefault(); f[ev.key](); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stokKurang = (l: Line) => jual && !order && l.b.jenis === "Barang" && l.jml * l.units[l.ui].konversi > Number(l.b.stokakhir);

  const hint = "1. Tombol [F10] untuk mencari daftar barang pada tabel\n2. Tombol [Alt] + [Angka] untuk mencari daftar sesuai kolom yang disediakan (Tanggal, Kasir, " + (jual ? "Pelanggan" : "Pemasok") + ", Sales)";

  const grid = (g: Geom) => (
    <DetailGrid g={g} jual={jual} lines={shown} selected={selected} onSelect={setSelected} onUpdate={update} onDelete={hapusBaris}
      onEnterScan={() => scanRef.current?.focus()} onCariKode={(k) => { setGantiKey(k); setCariAwal(""); setModal("cari"); }}
      onCariSatuan={(k) => { setSatuanKey(k); setModal("satuan"); }} stokKurang={stokKurang} gridRef={gridRef}
      hargaTerkunci={hargaTerkunci} fokusJml={fokusJml}
      entry={kotakScan ? undefined : { value: scan, onChange: setScan, onEnter: onScan, onCari: cariBarang, inputRef: scanRef }} />
  );

  const kontakKey = jual ? "tPelangganNama" : "tPemasokNama";
  const bind: Record<string, any> = {
    tNoTrans: { value: noKoreksi || notrans },
    dtTglTrans: { value: tgl, onChange: (v: string) => v && setTgl(v) },
    tKasirNama: { value: kasir.nama },
    [kontakKey]: { value: kontakNama },
    tSalesNama: { value: salesNama },
    tCatatan: { value: catatan, onChange: setCatatan },
    cCariKasir: { onClick: () => setModal("kasir"), disabled: !kasirBisaDiganti },
    [jual ? "cCariPelanggan" : "cCariPemasok"]: { onClick: () => setModal("kontak") },
    cCariSales: { onClick: () => setModal("sales") },
    lblInfo: { text: hint },
    lblJmlItem: { text: `Jml. Jenis : ${lines.length}\nJml. Item : ${fmt2.format(totalItem)}` },
    lblTotal: { text: `${rp(total)},-` },
    dtDetil: (g: Geom) => grid(g),
    dtDetilBonus: (g: Geom) => <BonusGrid g={g} bonus={bonus} />,
    cAmbilOrder: { onClick: () => setModal("ambilorder") },
    cSimpan: { onClick: bayar },
    cBatal: { onClick: batal },
    cTutup: { onClick: () => go("home") },
    cDataPending: { onClick: () => setModal("pending") },
    cPending: { onClick: simpanPending },
    cEdit: { onClick: () => setModal("koreksi") },
    cCekPoin: { onClick: cekPoin },
    cSuratJalan: { onClick: () => bukaPilih("sj") },
    cSPK: { onClick: () => bukaPilih("spk") },
    cCetakUlang: { onClick: () => (order ? setModal("pilihorder") : bukaPilih("ulang")) },
    cStokMin: { onClick: stokMin },
    cEditBarang: { onClick: editBarang },
    tScanBarcode: (g: Geom) => (
      <input ref={scanRef} className="vb-txt" style={{ width: g.width, height: g.height }} value={scan} autoComplete="off"
        onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onScan()} />
    ),
    cCariBarcode: { onClick: cariBarang },
  };
  const picScanHide = kotakScan ? [] : ["picScan"];
  const poinAktif = Number(setting.aktifpoin) === 1 && Number(setting.aktiftranspoin) === 1;
  // Layar order: baris "DP / Uang Muka" (Picture2) digambar sendiri di bawah tabel, lihat .tj-dp.
  const hide = order
    ? ["Picture2", "tTotal", "tKasirKode", "tSalesKode", "tPelangganKode", "tPemasokKode", "Picture1", "lblID", "LblID"]
    : jual
    ? [...picScanHide, "dtDetil2", "tTotal", "tTotalBeli", "tPelangganKode", "tSalesKode", "tKasirKode", "tPelangganLevel", "tDP", "tPoin", "tNoOrder", "dtTglOrder", "Picture1", ...(poinAktif ? [] : ["cCekPoin"])]
    : ["dtDetil2", "tTotal", "tTotalBeli", "tPemasokKode", "tSalesKode", "tKasirKode", "tNoOrder", "Picture1"];

  const basePos: Record<string, VbPos> = order ? (jual ? POS_ORDER_JUAL : POS_ORDER_BELI) : jual && !kotakScan ? POS_TANPA_SCAN : {};
  // Judul "Barang Bonus" selebar tabel bonus di bawahnya.
  const posForm: Record<string, VbPos> = { ...basePos, lblBonus: { ...basePos.lblBonus, ...POS_JUDUL_BONUS } };

  // Enter di kolom kepala pindah ke kolom berikutnya: Tanggal, Kasir, Pelanggan/Pemasok, Sales, Catatan, lalu kotak scan.
  const rantai = ["dtTglTrans", "tKasirNama", kontakKey, "tSalesNama", "tCatatan"];
  const enterKepala = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || modal || msg || tanya.node) return;
    const nama = (e.target as HTMLElement).closest<HTMLElement>("[data-vb]")?.dataset.vb ?? "";
    const i = rantai.indexOf(nama);
    if (i < 0 || !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    if (i < rantai.length - 1) fokusCtl(rantai[i + 1]);
    else scanRef.current?.focus();
  };

  return (
    <div className="tj-page" onKeyDown={enterKepala}>
      {tanya.node}
      <VbForm form={formName} bind={bind} hide={hide} fill anchor={ANCHOR}
        pos={posForm} />
      {order && jual && <DpBar value={dp} onChange={setDp} />}

      {modal === "cari" && (
        <CariBarang initial={cariAwal} showBeli={!jual} kasir={jual && !order} onClose={() => { setModal(null); setGantiKey(null); scanRef.current?.focus(); }}
          onPick={(b) => {
            if (gantiKey != null) {
              update(gantiKey, { b, units: unitsOf(b), ui: 0, manual: false });
              setGantiKey(null); setModal(null); setelahTambah();
            } else { addBarang(b); setModal(null); setelahTambah(); }
          }} />
      )}
      {modal === "satuan" && lines.find((l) => l.key === satuanKey) && (() => {
        const l = lines.find((x) => x.key === satuanKey)!;
        return <CariSatuan units={l.units} aktif={l.ui} jual={jual}
          onClose={() => { setModal(null); setSatuanKey(null); scanRef.current?.focus(); }}
          onPick={(i) => { update(l.key, { ui: i, manual: false }); setModal(null); setSatuanKey(null); setelahTambah(); }} />;
      })()}
      {modal === "kontak" && (
        <PilihModal title={jual ? "Pilih Pelanggan" : "Pilih Pemasok"} kosong="Tunai"
          rows={kontakList.map((k) => ({ kode: jual ? k.kodepelanggan : k.kodepemasok, nama: jual ? `${k.namapelanggan}${k.level ? ` · ${k.level}` : ""}` : k.namapemasok }))}
          onClose={() => setModal(null)} onPick={(k) => { setKontak(k); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "sales" && (
        <PilihModal title="Pilih Sales" kosong="Tanpa sales"
          rows={salesList.map((k) => ({ kode: k.kodekaryawan, nama: k.namakaryawan }))}
          onClose={() => setModal(null)} onPick={(k) => { setSales(k); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "bayar" && (
        <BayarDialog mode={mode} tgl={tgl} kontak={kontak} sales={sales} kasir={kasir.kode} catatan={catatan} lines={shown} noorder={noOrder} dpAwal={dp}
          onClose={() => setModal(null)}
          onTanpaPemasok={(pesan) => { setModal(null); setMsg(pesan); setTimeout(() => fokusCtl("tPemasokNama"), 0); }}
          onSaved={(_no, cetak) => {
            if (cetak) setUlang(cetak);
            if (noPending) orderApi.pendingSelesai(noPending).catch(() => undefined);
            setModal(null);
            reset();
          }} />
      )}
      {modal === "ambilorder" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void ambilOrder(n, false)} />}
      {modal === "koreksi" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void ambilOrder(n, true)} />}
      {modal === "kasir" && (
        <CariMaster table="mdkaryawan" onClose={() => setModal(null)}
          onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "pilihtrans" && (
        <CariTransaksi kode={jual ? "TJ" : "TB"} onClose={() => setModal(null)}
          onPick={(no) => (pilihUntuk === "ulang" ? void cetakUlang(no) : void cetakDokumen(pilihUntuk, no))} />
      )}
      {modal === "pilihorder" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void cetakOrderPilih(n)} />}
      {modal === "stokmin" && <StokMinDialog onPick={tambahStokMin} onClose={() => setModal(null)} />}
      {modal === "pending" && <CariDataDialog jenis="pending" onClose={() => setModal(null)} onAmbil={(n) => void ambilPending(n)} />}
      {msg && (
        <Modal title={formCaption(formName)} onClose={() => setMsg(null)}
          footer={<button className="btn primary" autoFocus onClick={() => setMsg(null)}>OK</button>}>
          <Alert kind="info">{msg}</Alert>
        </Modal>
      )}
      {modal === "poin" && <PoinMember kode={kontak} onClose={() => { setModal(null); scanRef.current?.focus(); }} />}
      {modal === "editbarang" && (() => {
        const l = lines.find((x) => x.key === selected);
        return l ? <BarangEdit row={l.b} isNew={false} onClose={() => setModal(null)} onChanged={(k) => void barangBerubah(k)} /> : null;
      })()}
      {dok && <DokumenGudang dok={dok} setting={setting} />}
      {ulang && <Struk trans={ulang} setting={setting} />}
      {ulangOrder && <StrukOrder order={ulangOrder} setting={setting} />}
    </div>
  );
}

/** Baris "DP / Uang Muka" di atas tombol bawah pada layar Order Penjualan (Picture2 di aslinya). */
function DpBar(props: { value: number; onChange: (v: number) => void }) {
  const def = useVbForm("FrmTransJualOrder");
  const box = findCtrl(def, "Picture2");
  const tdp = findCtrl(def, "tDP");
  const lbl = findCtrl(def, "Label8");
  if (!box?.props.POS || !tdp?.props.POS || !lbl?.props.POS) return null;
  const [, , , bh] = box.props.POS as number[];
  const bottom = twips((findCtrl(def, "picBottom")?.props.POS as number[] | undefined)?.[3] ?? 555);
  const [ll, lt, lw, lh] = lbl.props.POS as number[];
  const [tl, tt, tw, th] = tdp.props.POS as number[];
  return (
    <div className="tj-dp" style={{ bottom, height: twips(bh), ...fontCss(lbl.props.Font) }}>
      <span style={{ left: twips(ll), top: twips(lt), width: twips(lw), height: twips(lh) }}>{vbText(lbl.props.Caption)}</span>
      <div style={{ left: twips(tl), top: twips(tt), width: twips(tw), height: twips(th) }}>
        <VNum f="tDP" right value={props.value} onChange={props.onChange} />
      </div>
    </div>
  );
}

const vbText = (s?: string) => (s ?? "").replace(/&(.)/g, "$1");

/** Cetak ulang order di kertas struk. */
function StrukOrder({ order, setting }: { order: { header: Row; detail: Row[] }; setting: Row }) {
  const h = order.header;
  const jual = h.kode === "SO";
  return createPortal(
    <div className="struk">
      <div className="center bold">{setting.namausaha}</div>
      {setting.alamat && <div className="center">{setting.alamat}{setting.kota ? `, ${setting.kota}` : ""}</div>}
      <div className="center bold">{jual ? "ORDER PENJUALAN" : "ORDER PEMBELIAN"}</div>
      <hr />
      <div className="row"><span>{h.notrans}</span><span>{tglID(h.tglorder)}</span></div>
      <div className="row"><span>{jual ? "Pelanggan" : "Pemasok"}</span><span>{jual ? h.namapelanggan : h.namapemasok}</span></div>
      <div className="row"><span>Petugas</span><span>{h.namakasir}</span></div>
      <hr />
      {order.detail.map((d) => (
        <div key={d.nourut}>
          <div>{d.namabarang}</div>
          <div className="row"><span>{qty(d.jmljual)} {d.satuanjual} x {rp(d.hrgterjual)}</span><span>{rp(Number(d.jmljual) * Number(d.hrgterjual) - Number(d.disknilai || 0))}</span></div>
        </div>
      ))}
      <hr />
      <div className="row bold"><span>TOTAL</span><span>{rp(h.jmltrans)}</span></div>
      {jual && Number(h.jmlbayar) > 0 && <div className="row"><span>Uang muka</span><span>{rp(h.jmlbayar)}</span></div>}
      {h.catatan && <div>{h.catatan}</div>}
    </div>,
    document.body,
  );
}

/** Buka dialog cetak untuk dokumen gudang (kertas A4, bukan struk). */
async function cetakDokumen_(setMsg: (m: string) => void) {
  try {
    document.body.dataset.print = "dokumen";
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await api.cetak();
  } catch (e) {
    setMsg(errText(e));
  }
}

/** Surat Jalan (RptSuratJalan) dan Faktur SPK (RptSPK): daftar barang tanpa harga. SPK menambah kolom Rak/Etalase. */
function DokumenGudang({ dok, setting }: { dok: { jenis: "sj" | "spk"; header: Row; detail: Row[] }; setting: Row }) {
  const h = dok.header;
  const spk = dok.jenis === "spk";
  const jenisBarang = new Set(dok.detail.map((d) => d.kodebarang)).size;
  const totalItem = dok.detail.reduce((s, d) => s + (Number(d.jmljual) || 0), 0);
  return createPortal(
    <div className="tj-dok">
      <div className="dk-kop">
        <div className="dk-judul">{spk ? "Faktur SPK" : "Surat Jalan"}</div>
        <div><strong>{setting.namausaha}</strong></div>
        {setting.alamat && <div>{setting.alamat}{setting.kota ? `, ${setting.kota}` : ""}</div>}
      </div>
      <table className="dk-info">
        <tbody>
          <tr><td>{spk ? "No. Transaksi" : "Nomor"}</td><td>: {h.notrans}</td><td>Tanggal</td><td>: {tglID(h.tgltrans)}</td></tr>
          <tr><td>Pelanggan</td><td>: {h.namapelanggan}</td><td>Karyawan</td><td>: {h.namakasir}</td></tr>
          {!spk && <tr><td>Cara bayar</td><td>: {h.carabayar}</td><td>Jth Tempo</td><td>: {h.tgljthtempo ? tglID(h.tgljthtempo) : ""}</td></tr>}
          {!spk && <tr><td>Catatan</td><td colSpan={3}>: {h.catatan}</td></tr>}
        </tbody>
      </table>
      <table className="dk-detail">
        <thead>
          <tr><th>No.</th><th>Kode</th><th>Nama</th><th>Jumlah</th><th>Satuan</th>{spk && <th>Rak/Etalase</th>}</tr>
        </thead>
        <tbody>
          {dok.detail.map((d, i) => (
            <tr key={d.nourut}>
              <td className="r">{i + 1}</td><td>{d.barcode || d.kodebarang}</td><td>{d.namabarang}</td>
              <td className="r">{qty(d.jmljual)}</td><td>{d.satuanjual}</td>{spk && <td>{d.rak}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dk-foot">
        <div>Jml. Item : {qty(totalItem)}<br />Jml. Jenis : {jenisBarang}</div>
        <div>Petugas<br /><br /><br />( {spk ? "" : h.namakasir} )</div>
        <div>Penerima<br /><br /><br />( {h.namapelanggan !== "Tunai" ? h.namapelanggan : "                    "} )</div>
      </div>
    </div>,
    document.body,
  );
}

export function NumInput(props: { value: number; onChange: (v: number) => void; className?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(String(props.value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(props.value)); }, [props.value, focus]);
  return (
    <input className={`num ${props.className ?? ""}`} inputMode="decimal" autoFocus={props.autoFocus}
      value={focus ? text : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(props.value)}
      onFocus={(e) => { setFocus(true); setText(String(props.value)); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => { setText(e.target.value); props.onChange(Number(e.target.value.replace(",", ".")) || 0); }} />
  );
}

/* ------------------------------------------------------------------ */
/* Pembayaran (FrmTransJualBayar / FrmTransBeliBayar)                  */
/* ------------------------------------------------------------------ */

function BayarDialog(props: { mode: Mode; tgl: string; kontak: string; sales: string; kasir: string; catatan: string; lines: ShownLine[]; noorder?: string; dpAwal?: number; onClose: () => void; onTanpaPemasok: (pesan: string) => void; onSaved: (notrans?: string, cetak?: { header: Row; detail: Row[] }) => void }) {
  const { setting, user } = useApp();
  const jual = props.mode === "jual";
  const formName = jual ? "FrmTransJualBayar" : "FrmTransBeliBayar";
  const def = useVbForm(formName);
  const subtotal = props.lines.reduce((s, l) => s + l.jml * l.harga - l.pdp, 0);
  const [diskonPersen, setDiskonPersen] = useState(0);
  const [diskonNilai, setDiskonNilai] = useState(0);
  const [biaya, setBiaya] = useState(0);
  const [dp, setDp] = useState(props.dpAwal ?? 0);
  const [bayar, setBayarNilai] = useState(0);
  // Non tunai punya nominal sendiri, jadi bisa dicampur dengan tunai dan uang muka (tBayarNonTunai).
  const [bayarNt, setBayarNt] = useState(0);
  const [bayarManual, setBayarManual] = useState(false);
  const setBayar = (v: number) => { setBayarManual(true); setBayarNilai(v); };
  // Pertanyaan Ya/Tidak: jumlah bayar kurang dari total (jadi piutang), atau batas kredit pelanggan terlampaui.
  const [tanya, setTanya] = useState<{ pesan: string; piutang: boolean; kredit: boolean } | null>(null);
  const [tanyaCetak, setTanyaCetak] = useState<{ header: Row; detail: Row[]; notrans: string } | null>(null);
  const [jenisList, setJenisList] = useState<Row[]>([]);
  const [itemNt, setItemNt] = useState<Row[]>([]);
  const [jenis, setJenis] = useState("");
  const [kartu, setKartu] = useState("");
  const [noref, setNoref] = useState("");
  // Jatuh tempo = hari ini + pengaturan Tempo Piutang (FrmTransJualBayar.Form_Load).
  const [tempo, setTempo] = useState(addDays(today(), Number(setting.tempopiutang) || 0));
  const [preview, setPreview] = useState(true);
  const defaultJmlByr = jual && getLocal("defaultJmlByr") === "1";
  const diskonTerkunci = jual && user.level === "Kasir" && Number(setting.izindiskon) !== 1;
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<{ notrans: string; kembali?: number; cara: string; poin?: number; trans?: { header: Row; detail: Row[] } } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Jenis dan item non tunai diambil dari data Jenis Non Tunai (MDJENISNONTUNAI / MDJENISNONTUNAIITEM).
  useEffect(() => { if (jual) ntApi.list().then((r) => { setJenisList(r.jenis); setItemNt(r.item); }).catch(() => undefined); }, [jual]);

  const diskon = diskonNilai > 0 ? diskonNilai : Math.round(subtotal * diskonPersen) / 100;
  // Aplikasi lama tidak punya PPN di layar bayar: total = jumlah - diskon + biaya.
  const total = Math.round((subtotal - diskon + biaya) * 100) / 100;

  // Jumlah bayar dibiarkan kosong seperti aslinya. Penjualan terisi total hanya kalau pengaturan lokal
  // "Default jml bayar sama dgn total" aktif dan Anda belum mengetik sendiri; uang muka (DP) dan non tunai dikurangkan.
  useEffect(() => {
    if (jual && defaultJmlByr && !bayarManual) setBayarNilai(Math.max(0, Math.round((total - dp - bayarNt) * 100) / 100));
  }, [jual, total, defaultJmlByr, bayarManual, dp, bayarNt]);

  // Jumlah yang sudah diterima = uang muka + tunai + non tunai. Kurang dari total ditanyakan dulu, lalu jadi piutang (hutang di pembelian).
  const diterima = jual ? bayar + dp + bayarNt : bayar;
  const sisa = total - diterima;
  const jenisNama = [...new Set(jenisList.map((j) => j.namajenis))];
  const itemList = itemNt.filter((j) => j.namajenis === jenis && j.namaitem);

  const field = (name: string) => boxRef.current?.querySelector<HTMLElement>(`[data-f="${name}"], [data-vb="${name}"] input, [data-vb="${name}"] select`);

  // `dariTanya`: dipanggil dari tombol Ya pada pertanyaan; closure `tanya` masih berisi nilai lama saat itu.
  const simpanBusy = useRef(false);
  const simpan = async (o: { piutang?: boolean; lanjutkredit?: boolean; dariTanya?: boolean } = {}) => {
    if (simpanBusy.current || busy || hasil || tanyaCetak || (tanya && !o.dariTanya)) return;
    setErr("");
    if (jual && bayarNt > 0 && !jenis) return setErr("Pilih dulu jenis pembayaran non tunai.");
    let caraKirim: TransInput["carabayar"] = "Tunai";
    if (diterima + 0.005 < total) {
      if (!o.piutang) {
        return setTanya({
          pesan: jual
            ? "Jumlah bayar kurang dari total transaksi, apakah akan dilanjutkan sebagai piutang transaksi?"
            : "Jumlah bayar kurang dari total transaksi, apakah akan dilanjutkan sebagai hutang transaksi?",
          piutang: true, kredit: false,
        });
      }
      caraKirim = "Kredit";
    }
    if (caraKirim === "Kredit" && !props.kontak) {
      if (jual) {
        return setErr("Transaksi piutang tidak bisa dilakukan untuk pelanggan 'Tunai'. Pilih nama pelanggan yang terdaftar untuk melanjutkan proses transaksi piutang.");
      }
      // Seperti aslinya: dialog bayar ditutup, kursor ke kolom pemasok di layar pembelian.
      props.onTanpaPemasok("Transaksi hutang tidak bisa dilakukan ke Pemasok 'Tunai'.\nPilih nama Pemasok yang terdaftar untuk melanjutkan proses transaksi piutang");
      return;
    }
    simpanBusy.current = true;
    setBusy(true);
    const input: TransInput = {
      tgl: props.tgl,
      kodepelanggan: jual ? props.kontak : undefined,
      kodepemasok: jual ? undefined : props.kontak,
      kodesales: props.sales,
      kodekasir: props.kasir,
      catatan: props.catatan,
      hargajual: jual ? undefined : props.lines.map((l) => ({ kodebarang: l.b.kodebarang, hrgjual: hrgJualBaris(l) / l.units[l.ui].konversi })),
      items: props.lines.map((l) => ({
        kodebarang: l.b.kodebarang, namabarang: namaBaris(l), kodesatuan: l.b.kodesatuan || l.units[0].satuan,
        satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga, disknilai: l.pdp,
      })),
      diskonpersen: diskonNilai > 0 ? 0 : diskonPersen,
      diskonnilai: diskon,
      biaya,
      carabayar: caraKirim,
      jmlbayar: jual ? bayar + dp : diterima,
      bayarnontunai: jual ? bayarNt : 0,
      jenisnontunai: jual && bayarNt > 0 ? jenis : "",
      kartu,
      norefkartu: noref,
      jthtempo: tempo,
      lanjutkredit: o.lanjutkredit,
    };
    try {
      if (jual) {
        const r = props.noorder ? await orderApi.savePenjualanOrder(input, props.noorder) : await kasirApi.savePenjualan(input);
        const trans = await api.getTransaksi(r.notrans);
        const poin = Number((r as { poin?: number }).poin) || 0;
        if (preview) setHasil({ notrans: r.notrans, kembali: r.kembali, cara: caraKirim, poin, trans });
        else if (getLocal("konfirmasiCetak") === "1") setTanyaCetak({ ...trans, notrans: r.notrans });
        else props.onSaved(r.notrans, trans);
      } else {
        const r = props.noorder ? await orderApi.savePembelianOrder(input, props.noorder) : await kasirApi.savePembelian(input);
        const trans = await api.getTransaksi(r.notrans);
        // "Data sudah disimpan. Apakah akan cetak nota pembelian?"
        setTanyaCetak({ ...trans, notrans: r.notrans });
      }
    } catch (e) {
      const pertanyaan = pesanKonfirmasi(errText(e));
      if (pertanyaan) setTanya({ pesan: pertanyaan, piutang: !!o.piutang, kredit: true });
      else setErr(errText(e));
    } finally {
      simpanBusy.current = false;
      setBusy(false);
    }
  };

  // Alt+huruf sesuai tanda & pada caption; Esc menutup.
  useEffect(() => {
    if (hasil || err || tanya || tanyaCetak) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onClose(); return; }
      if (!ev.altKey) return;
      const k: Record<string, () => void> = {
        KeyS: () => void simpan(),
        KeyT: props.onClose,
        KeyB: () => field("tJmlBayar")?.focus(),
        KeyP: () => setPreview((p) => !p),
      };
      if (k[ev.code]) { ev.preventDefault(); ev.stopPropagation(); k[ev.code](); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => { setTimeout(() => field("tJmlBayar")?.focus(), 0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter pindah ke kolom berikutnya; di kolom terakhir menyimpan.
  const urutan = jual
    ? ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tDP", "tJmlBayar", "cmbJenis", "cmbItem", "tNoRefNonTunai", "dtJthTempo"]
    : ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tJmlBayar", "dtJthTempo"];
  const onEnter = (ev: React.KeyboardEvent) => {
    if (ev.key !== "Enter" || ev.target instanceof HTMLButtonElement) return;
    ev.preventDefault();
    const el = ev.target as HTMLElement;
    const cur = urutan.findIndex((n) => field(n) === el);
    const akhir = ["tJmlBayar", "tNoRefNonTunai", "dtJthTempo"];
    if (cur < 0 || akhir.includes(urutan[cur])) return void simpan();
    field(urutan[cur + 1])?.focus();
  };

  // Kotak isian VB: tiap isian digambar di atas kotak "Text" di belakangnya.
  const colorOf = (n: string) => vbColor(findCtrl(def, n)?.props["~ForeColor"]);
  const face = (back: string, real: string, el: (st: CSSProperties) => ReactNode) => (g: Geom) => {
    const b = findCtrl(def, back);
    const r = findCtrl(def, real);
    if (!b?.props.POS || !r?.props.POS) return null;
    const [bl, bt] = b.props.POS as number[];
    const [rl, rt, rw, rh] = r.props.POS as number[];
    return (
      <div className="tp-face" style={{ width: g.width, height: g.height, background: vbColor(b.props["~BackColor"]) ?? "#fff" }}>
        <div className="tp-in" style={{ left: twips(rl - bl), top: twips(rt - bt), width: twips(rw), height: twips(rh), color: colorOf(real), ...fontCss(r.props.Font) }}>
          {el({ background: vbColor(r.props["~BackColor"]) ?? "transparent" })}
        </div>
      </div>
    );
  };
  const num2 = (back: string, real: string, f: string, value: number, onChange?: (v: number) => void, kunci?: boolean) =>
    face(back, real, () => <VNum f={f} right value={value} onChange={onChange} readOnly={!!kunci} />);

  const plain = (name: string, value: string): any => ({ value, style: { color: colorOf(name) } });

  const bind: Record<string, any> = {
    tJmlTrans: plain("tJmlTrans", rp(subtotal)),
    tTotalTrans: plain("tTotalTrans", rp(total)),
    Label6: { text: sisa < 0 ? "Kembalian" : "Kekurangan/Sisa" },
    dtJthTempo: { value: tempo, onChange: (v: string) => v && setTempo(v) },
    cSimpan: { onClick: () => void simpan(), disabled: busy },
    cTutup: { onClick: props.onClose },
    chkPreview: { value: preview ? "1" : "0", onChange: (v: string) => setPreview(v === "1") },
    Text1: num2("Text1", "tDiskonPersen", "tDiskonPersen", diskonNilai > 0 ? Math.round((diskon / (subtotal || 1)) * 10000) / 100 : diskonPersen, (v) => { setDiskonPersen(v); setDiskonNilai(0); }, diskonTerkunci),
    Text6: num2("Text6", "tDiskonNilai", "tDiskonNilai", diskon, (v) => { setDiskonNilai(v); setDiskonPersen(0); }, diskonTerkunci),
    Text5: num2("Text5", "tBiaya", "tBiaya", biaya, setBiaya),
    Text3: num2("Text3", "tJmlBayar", "tJmlBayar", bayar, setBayar),
    Text2: num2("Text2", "tSisa", "tSisa", Math.abs(sisa)),
  };
  if (jual) {
    Object.assign(bind, {
      Text7: num2("Text7", "tDP", "tDP", dp, setDp),
      Text8: num2("Text8", "tBayarNonTunai", "tBayarNonTunai", bayarNt, setBayarNt),
      Text10: face("Text10", "tNoRefNonTunai", () => (
        <input data-f="tNoRefNonTunai" value={noref} onChange={(e) => setNoref(e.target.value)} />
      )),
      cmbJenis: {
        value: jenis, onChange: (v: string) => {
          setJenis(v); setKartu("");
          // Pilih jenis tanpa mengetik nominal: sisa yang belum dibayar dianggap non tunai.
          if (v && bayarNt === 0) setBayarNt(Math.max(0, Math.round((total - dp - bayar) * 100) / 100));
          if (!v) setBayarNt(0);
        },
        children: [<option key="" value="" />, ...jenisNama.map((j) => <option key={j} value={j}>{j}</option>)],
      },
      cmbItem: {
        value: kartu, onChange: setKartu,
        children: [<option key="" value="" />, ...itemList.map((j) => <option key={j.namaitem} value={j.namaitem}>{j.namaitem}</option>)],
      },
    });
  } else {
    bind.Text4 = num2("Text4", "tTotalTrans", "tTotalTrans", total);
    bind.Text7 = num2("Text7", "tJmlTrans", "tJmlTrans", subtotal);
  }
  const hide = jual
    ? ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tDP", "tJmlBayar", "tSisa", "tBayarNonTunai", "tNoRefNonTunai", "cmbJenisKode", "tTotalTrans", "tJmlTrans"]
    : ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tJmlBayar", "tSisa", "tTotalTrans", "tJmlTrans"];
  // tJmlTrans dan tTotalTrans pada form penjualan berdiri sendiri (tanpa kotak Text di belakangnya).
  const hideFinal = jual ? hide.filter((n) => n !== "tTotalTrans" && n !== "tJmlTrans") : hide;

  if (hasil && jual && hasil.trans) {
    // Jendela "Struk Penjualan": Cetak mencetak lalu selesai, Batal selesai tanpa mencetak.
    return <StrukPenjualan trans={hasil.trans} setting={setting} onSelesai={() => props.onSaved(hasil.notrans)} />;
  }

  if (hasil) {
    return (
      <Modal title="Transaksi tersimpan" onClose={() => props.onSaved(hasil.notrans)}
        footer={<>
          {hasil.trans && <button className="btn" onClick={() => cetakStruk().catch((e) => setErr(errText(e)))}>Cetak Struk</button>}
          <button className="btn primary" autoFocus onClick={() => props.onSaved(hasil.notrans)}>Transaksi Baru [Enter]</button>
        </>}>
        <div>
          <p>Nomor transaksi <strong className="mono">{hasil.notrans}</strong> sudah tersimpan.</p>
          {jual && hasil.cara === "Tunai" && <div className="kembali">Kembalian <strong>Rp {rp(hasil.kembali)}</strong></div>}
          {jual && !!hasil.poin && <p>Poin Anda bertambah {qty(hasil.poin)} dari transaksi ini.</p>}
          <Alert>{err}</Alert>
        </div>
        <Struk trans={hasil.trans ?? null} setting={setting} />
      </Modal>
    );
  }

  const { width, height } = formSize(formName);
  return (
    <>
    <div className="modal-backdrop no-print">
      <div ref={boxRef} onKeyDown={onEnter} style={{ width: width + 2, height: `min(${height + 22}px, 96vh)`, maxWidth: "96vw", display: "flex", flexDirection: "column" }}>
        <VbWindow form={formName} title={formCaption(formName)} bind={bind} hide={hideFinal} onClose={props.onClose} />
        {err && <div style={{ position: "absolute" }}><Modal title="Pembayaran" onClose={() => setErr("")}
          footer={<button className="btn primary" autoFocus onClick={() => setErr("")}>OK</button>}><Alert>{err}</Alert></Modal></div>}
      </div>
    </div>
    {tanya && (
      <Modal title={formCaption(formName)} onClose={() => setTanya(null)}
        footer={<>
          <button className="btn" onClick={() => setTanya(null)}>Tidak</button>
          <button className="btn primary" autoFocus onClick={() => { const t = tanya; setTanya(null); void simpan({ piutang: t.piutang, lanjutkredit: t.kredit, dariTanya: true }); }}>Ya</button>
        </>}>
        <p style={{ whiteSpace: "pre-line" }}>{tanya.pesan}</p>
      </Modal>
    )}
    {tanyaCetak && (
      <Modal title={formCaption(formName)} onClose={() => props.onSaved(tanyaCetak.notrans)}
        footer={<>
          <button className="btn" onClick={() => props.onSaved(tanyaCetak.notrans)}>Tidak</button>
          <button className="btn primary" autoFocus onClick={() => props.onSaved(tanyaCetak.notrans, tanyaCetak)}>Cetak</button>
        </>}>
        <p>Data sudah disimpan ({tanyaCetak.notrans}). {jual ? "Cetak struknya?" : "Apakah akan cetak nota pembelian?"}</p>
      </Modal>
    )}
    </>
  );
}
