import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { qty, today } from "../format";
import { Geom, VbForm } from "../vb/VbForm";
import { BELUM_ADA, useMsgBox } from "../vb/VbGrid";
import { NumInput } from "./Transaksi";
import { FilterBarang } from "./inventoriLib";
import "./transaksi.css";

/** Satu baris tabel. Barang yang sama boleh muncul lebih dari sekali, jadi baris dikenali lewat `uid`. */
interface Item { uid: number; b: Row; awal: number }

let uidSeq = 0;
const NOT_FOUND = "Data tidak ditemukan, atau barang tidak aktif.";

const ROW_H = 23;
const HEAD_H = 40;
/** Lebar kolom (No, Kode, Nama Barang, Satuan, Stok Awal, Stok Masuk, Stok Keluar, Stok Opname, Stok Akhir) dalam persen. */
const COLS = [4, 12, 30, 7, 11, 9, 9, 9, 9];

const FULL = { left: true, right: true, top: true, bottom: true };
const ANCHOR = { dtDetil: FULL };
/** Di aslinya pelanggan dan sales dipakai form transaksi; stok awal tidak memakainya. */
const HIDE = ["tTotal", "tKasirKode", "Picture1", "cCariPelanggan", "tPelangganKode", "tPelangganNama", "Label6", "tSalesKode",
  "cCariSales", "tSalesNama", "Label4", "lblInfo"];

export function StokAwal() {
  const { user, go } = useApp();
  const msg = useMsgBox();
  const [tgl, setTgl] = useState(today());
  const [notrans, setNotrans] = useState("");
  const [catatan, setCatatan] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cari, setCari] = useState(false);
  const [filter, setFilter] = useState(false);
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.previewNotrans("SA", tgl).then(setNotrans).catch(() => setNotrans(""));
  }, [tgl, items.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tambahkan barang ke tabel dengan Stok Awal dari data barang. Jasa dan barang yang sudah ada tetap boleh, seperti aslinya. */
  const add = (b: Row) => {
    const uid = ++uidSeq;
    setItems((xs) => [...xs, { uid, b, awal: Number(b.stokawal) || 0 }]);
    setSelected(uid);
  };

  /** Kode atau barcode yang diisi di kolom kode: hanya barang aktif yang diterima. */
  const tambahKode = async (kode: string) => {
    kode = kode.trim();
    if (!kode) return;
    const b = await api.barangFind(kode).catch(() => null);
    if (b) add(b);
    else msg.alert(NOT_FOUND, "Informasi");
  };

  const onScan = async () => {
    const kode = scan;
    setScan("");
    await tambahKode(kode);
  };

  const kosongkan = useCallback(() => { setItems([]); setSelected(null); setCatatan(""); }, []);

  const simpan = useCallback(async () => {
    if (items.length === 0) return msg.alert("Belum ada barang yang diisi. Silakan tambahkan barang dulu.");
    try {
      await inventoriApi.saveStokAwal(tgl, catatan, items.map((i) => ({ kodebarang: i.b.kodebarang, stokawal: i.awal })));
      kosongkan();
      msg.alert("Data sudah disimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [items, tgl, catatan, msg, kosongkan]);

  /** Batal: langsung mengosongkan form, tanpa bertanya (clearForm di aslinya). */
  const batal = kosongkan;

  const cariKasir = () => msg.alert(BELUM_ADA);

  const ada = !!msg.node;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cari || filter || ada) return;
      if (e.key === "F4") { e.preventDefault(); void simpan(); }
      else if (e.key === "F1") { e.preventDefault(); batal(); }
      else if (e.key === "Escape") go("home");
      else if (e.altKey && e.code === "Digit2") { e.preventDefault(); cariKasir(); }
      else if (e.altKey && e.code === "KeyT") { e.preventDefault(); gridRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cari, filter, ada, simpan, batal, go]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = (g: Geom) => {
    const total = Math.max(items.length + 1, Math.floor((g.height - 2 - HEAD_H) / ROW_H));
    const idx = items.findIndex((i) => i.uid === selected);
    const onKeyDown = (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "ArrowDown" && idx + 1 < items.length) { e.preventDefault(); setSelected(items[idx + 1].uid); }
      else if (e.key === "ArrowUp" && idx > 0) { e.preventDefault(); setSelected(items[idx - 1].uid); }
      else if (e.key === "Delete" && idx >= 0) {
        e.preventDefault();
        setItems((xs) => xs.filter((_, k) => k !== idx));
        setSelected(items[idx + 1]?.uid ?? items[idx - 1]?.uid ?? null);
      } else if (e.key === "Enter" && idx >= 0) {
        e.preventDefault();
        gridRef.current?.querySelector<HTMLInputElement>("input[data-awal]")?.focus();
      }
    };
    const rows: ReactNode[] = [];
    for (let i = 0; i < total; i++) {
      const it = items[i];
      if (!it) {
        rows.push(
          <tr key={`e${i}`}>
            <td className="no">{i + 1}</td>
            <td className="kd">{i === items.length && (
              <input ref={scanRef} value={scan} autoComplete="off" autoFocus onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void onScan(); }
                  else if (e.key === "F10") { e.preventDefault(); setCari(true); }
                }} />
            )}</td>
            <td /><td /><td /><td /><td /><td /><td />
          </tr>,
        );
        continue;
      }
      const kode = it.b.kodebarang;
      const cur = selected === it.uid;
      rows.push(
        <tr key={it.uid} className={cur ? "cur" : ""} onMouseDown={() => !cur && setSelected(it.uid)}>
          <td className="no">{i + 1}</td>
          <td>{it.b.barcode || kode}</td>
          <td className="nm">{it.b.namabarang}</td>
          <td>{it.b.kodesatuan}</td>
          <td className="r">{cur ? (
            <NumInput className="r" value={it.awal} onChange={(v) => setItems((xs) => xs.map((x) => (x === it ? { ...x, awal: v } : x)))} />
          ) : qty(it.awal)}</td>
          <td className="r">{qty(it.b.stokmasuk)}</td>
          <td className="r">{qty(it.b.stokkeluar)}</td>
          <td className="r">{qty(it.b.stokopname)}</td>
          <td className="r">{qty(it.b.stokakhir)}</td>
        </tr>,
      );
    }
    return (
      <div className="tj-grid" tabIndex={0} ref={gridRef} onKeyDown={onKeyDown}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.dataset.awal) { e.preventDefault(); scanRef.current?.focus(); }
        }}>
        <table>
          <colgroup>{COLS.map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
          <thead>
            <tr><th className="r">No</th><th>Kode / Barcode</th><th>Nama Barang</th><th>Satuan</th><th className="r">Stok Awal</th><th className="r">Stok Masuk</th><th className="r">Stok Keluar</th><th className="r">Stok Opname</th><th className="r">Stok Akhir</th></tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  // Kotak stok awal di baris terpilih ditandai supaya Enter bisa memfokuskannya.
  useEffect(() => {
    gridRef.current?.querySelectorAll<HTMLInputElement>("td.r input").forEach((el) => el.setAttribute("data-awal", "1"));
  });

  const bind = useMemo(() => ({
    tNoTrans: { value: notrans },
    dtTglTrans: { value: tgl, onChange: (v: string) => v && setTgl(v) },
    tKasirNama: { value: user.namakaryawan },
    cCariKasir: { onClick: cariKasir },
    tCatatan: { value: catatan, onChange: setCatatan },
    lblJmlItem: { text: `Jml. Jenis : ${items.length}` },
    lblTotal: { text: "" },
    dtDetil: grid,
    cSimpan: { onClick: () => void simpan() },
    cFilter: { onClick: () => setFilter(true) },
    cBatal: { onClick: batal },
    cTutup: { onClick: () => go("home") },
  }), [notrans, tgl, user, catatan, items, selected, scan, simpan, batal]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tj-page">
      <VbForm form="FrmTransStokAwal" bind={bind} hide={HIDE} fill anchor={ANCHOR} />
      {msg.node}
      {cari && (
        <CariBarang initial={scan} showBeli onClose={() => { setCari(false); scanRef.current?.focus(); }}
          onPick={(b) => { setCari(false); setScan(""); void tambahKode(b.kodebarang).then(() => setTimeout(() => scanRef.current?.focus(), 0)); }} />
      )}
      {filter && <FilterBarang onClose={() => setFilter(false)} onAdd={(rows) => {
        const baru = rows.filter((b) => !items.some((i) => i.b.kodebarang === b.kodebarang));
        setItems((xs) => [...xs, ...baru.map((b) => ({ uid: ++uidSeq, b, awal: Number(b.stokawal) || 0 }))]);
        setFilter(false);
        msg.alert(baru.length ? `${baru.length} barang sudah ditambahkan ke daftar.` : "Tidak ada barang baru yang bisa ditambahkan.");
      }} />}
    </div>
  );
}
