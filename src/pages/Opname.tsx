import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { qty, tglID, today } from "../format";
import { Geom, VbForm } from "../vb/VbForm";
import { useMsgBox } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";
import { FilterBarang } from "./inventoriLib";
import { NumInput } from "./Transaksi";
import "./transaksi.css";

/** Satu baris tabel. Barang yang sama boleh muncul lebih dari sekali, jadi baris dikenali lewat `uid`. */
interface Item { uid: number; b: Row; fisik: number }

/** Isi bukti stok opname yang baru disimpan. */
interface Bukti { notrans: string; tgl: string; catatan: string; kasir: string; baris: { b: Row; fisik: number }[] }

let uidSeq = 0;
const NOT_FOUND = "Data tidak ditemukan, atau barang tidak aktif.";

const ROW_H = 23;
const HEAD_H = 40;
/** Lebar kolom (No, Kode, Nama Barang, Satuan, Stok Buku, Stok Fisik, Selisih Stok) dalam persen. */
const COLS = [4, 14, 38, 8, 12, 12, 12];

const FULL = { left: true, right: true, top: true, bottom: true };
const ANCHOR = { dtDetil: FULL };
/** Di aslinya pelanggan dan sales dipakai form transaksi; opname tidak memakainya. */
const HIDE = ["tTotal", "tKasirKode", "Picture1", "cCariPelanggan", "tPelangganKode", "tPelangganNama", "Label6", "tSalesKode",
  "cCariSales", "tSalesNama", "Label4", "lblInfo"];

export function Opname() {
  const { user, go, setting } = useApp();
  const msg = useMsgBox();
  const [tgl, setTgl] = useState(today());
  const [notrans, setNotrans] = useState("");
  const [catatan, setCatatan] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [bukti, setBukti] = useState<Bukti | null>(null);
  const [cari, setCari] = useState(false);
  const [kasir, setKasir] = useState({ kode: user.kodekaryawan, nama: user.namakaryawan });
  const [cariKasir, setCariKasir] = useState(false);
  const [filter, setFilter] = useState(false);
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.previewNotrans("OP", tgl).then(setNotrans).catch(() => setNotrans(""));
  }, [tgl, items.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tambahkan barang ke tabel dengan Stok Buku = stok akhir. Jasa dan barang yang sudah ada tetap boleh, seperti aslinya. */
  const add = (b: Row) => {
    const uid = ++uidSeq;
    setItems((xs) => [...xs, { uid, b, fisik: Number(b.stokakhir) || 0 }]);
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

  const kosongkan = useCallback(() => { setItems([]); setSelected(null); setCatatan(""); setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan }); }, [user]);

  const cetakBukti = useCallback(async (data: Bukti) => {
    setBukti(data);
    try {
      document.body.dataset.print = "dokumen";
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      await api.cetak();
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      setBukti(null);
    }
  }, [msg]);

  const simpan = useCallback(async () => {
    if (items.length === 0) return msg.alert("Belum ada barang yang dihitung. Silakan tambahkan barang dulu.");
    try {
      const r = await inventoriApi.saveOpname(tgl, catatan, items.map((i) => ({ kodebarang: i.b.kodebarang, stokbuku: Number(i.b.stokakhir) || 0, stokfisik: i.fisik })), kasir.kode);
      const data: Bukti = {
        notrans: r.notrans, tgl, catatan, kasir: kasir.nama,
        baris: items.filter((i) => Math.abs(i.fisik - (Number(i.b.stokakhir) || 0)) >= 0.005).map((i) => ({ b: i.b, fisik: i.fisik })),
      };
      kosongkan();
      msg.confirm("Data sudah disimpan.\nApakah akan cetak bukti stok opname?", () => void cetakBukti(data), "Konfirmasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [items, tgl, catatan, kasir, msg, kosongkan, cetakBukti]);

  /** Batal: langsung mengosongkan form, tanpa bertanya (clearForm di aslinya). */
  const batal = kosongkan;

  const bukaKasir = () => setCariKasir(true);

  const ada = !!msg.node;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cari || cariKasir || filter || ada) return;
      if (e.key === "F4") { e.preventDefault(); void simpan(); }
      else if (e.key === "F1") { e.preventDefault(); batal(); }
      else if (e.key === "Escape") go("home");
      else if (e.altKey && e.code === "Digit2") { e.preventDefault(); bukaKasir(); }
      else if (e.altKey && e.code === "KeyT") { e.preventDefault(); gridRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cari, cariKasir, filter, ada, simpan, batal, go]); // eslint-disable-line react-hooks/exhaustive-deps

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
        gridRef.current?.querySelector<HTMLInputElement>("input[data-fisik]")?.focus();
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
            <td /><td /><td /><td /><td />
          </tr>,
        );
        continue;
      }
      const kode = it.b.kodebarang;
      const cur = selected === it.uid;
      const sel = it.fisik - Number(it.b.stokakhir);
      rows.push(
        <tr key={it.uid} className={cur ? "cur" : ""} onMouseDown={() => !cur && setSelected(it.uid)}>
          <td className="no">{i + 1}</td>
          <td>{it.b.barcode || kode}</td>
          <td className="nm">{it.b.namabarang}</td>
          <td>{it.b.kodesatuan}</td>
          <td className="r">{qty(it.b.stokakhir)}</td>
          <td className="r">{cur ? (
            <NumInput className="r" value={it.fisik} onChange={(v) => setItems((xs) => xs.map((x) => (x === it ? { ...x, fisik: v } : x)))} />
          ) : qty(it.fisik)}</td>
          <td className="r">{sel > 0 ? "+" : ""}{qty(sel)}</td>
        </tr>,
      );
    }
    return (
      <div className="tj-grid" tabIndex={0} ref={gridRef} onKeyDown={onKeyDown}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.dataset.fisik) { e.preventDefault(); scanRef.current?.focus(); }
        }}>
        <table>
          <colgroup>{COLS.map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
          <thead>
            <tr><th className="r">No</th><th>Kode / Barcode</th><th>Nama Barang</th><th>Satuan</th><th className="r">Stok Buku</th><th className="r">Stok Fisik</th><th className="r">Selisih Stok</th></tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  // Kotak jumlah fisik di baris terpilih ditandai supaya Enter bisa memfokuskannya.
  useEffect(() => {
    gridRef.current?.querySelectorAll<HTMLInputElement>("td.r input").forEach((el) => el.setAttribute("data-fisik", "1"));
  });

  const bind = useMemo(() => ({
    tNoTrans: { value: notrans },
    dtTglTrans: { value: tgl, onChange: (v: string) => v && setTgl(v) },
    tKasirNama: { value: kasir.nama },
    cCariKasir: { onClick: bukaKasir },
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
      <VbForm form="FrmTransStokOpname" bind={bind} hide={HIDE} fill anchor={ANCHOR} />
      {msg.node}
      {cariKasir && (
        <CariMaster table="mdkaryawan" onClose={() => setCariKasir(false)}
          onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setCariKasir(false); }} />
      )}
      {cari && (
        <CariBarang initial={scan} showBeli onClose={() => { setCari(false); scanRef.current?.focus(); }}
          onPick={(b) => { setCari(false); setScan(""); void tambahKode(b.kodebarang).then(() => setTimeout(() => scanRef.current?.focus(), 0)); }} />
      )}
      {filter && <FilterBarang onClose={() => setFilter(false)} onAdd={(rows) => {
        const baru = rows.filter((b) => !items.some((i) => i.b.kodebarang === b.kodebarang));
        setItems((xs) => [...xs, ...baru.map((b) => ({ uid: ++uidSeq, b, fisik: Number(b.stokakhir) || 0 }))]);
        setFilter(false);
        msg.alert(baru.length ? `${baru.length} barang sudah ditambahkan ke daftar.` : "Tidak ada barang baru yang bisa ditambahkan.");
      }} />}
      {bukti && <BuktiOpname data={bukti} setting={setting} />}
    </div>
  );
}

/** Bukti stok opname (kertas A4), hanya tampil saat dicetak. Isinya baris yang selisihnya tidak nol, sama dengan yang tersimpan. */
function BuktiOpname({ data, setting }: { data: Bukti; setting: Row }) {
  return createPortal(
    <div className="tj-dok">
      <div className="dk-kop">
        <div className="dk-judul">Bukti Stok Opname</div>
        <div><strong>{setting.namausaha}</strong></div>
        {setting.alamat && <div>{setting.alamat}{setting.kota ? `, ${setting.kota}` : ""}</div>}
      </div>
      <table className="dk-info">
        <tbody>
          <tr><td>No. Transaksi</td><td>: {data.notrans}</td><td>Tanggal</td><td>: {tglID(data.tgl)}</td></tr>
          <tr><td>Petugas</td><td>: {data.kasir}</td><td>Catatan</td><td>: {data.catatan}</td></tr>
        </tbody>
      </table>
      <table className="dk-detail">
        <thead>
          <tr><th className="r">No</th><th>Kode / Barcode</th><th>Nama Barang</th><th>Satuan</th><th className="r">Stok Buku</th><th className="r">Stok Fisik</th><th className="r">Selisih Stok</th></tr>
        </thead>
        <tbody>
          {data.baris.map((x, i) => {
            const sel = x.fisik - (Number(x.b.stokakhir) || 0);
            return (
              <tr key={i}>
                <td className="r">{i + 1}</td><td>{x.b.barcode || x.b.kodebarang}</td><td>{x.b.namabarang}</td><td>{x.b.kodesatuan}</td>
                <td className="r">{qty(x.b.stokakhir)}</td><td className="r">{qty(x.fisik)}</td><td className="r">{sel > 0 ? "+" : ""}{qty(sel)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}
