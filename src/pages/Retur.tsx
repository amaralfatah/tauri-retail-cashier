import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, errText, Row } from "../api";
import { returApi, ReturSumber } from "../api/retur";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { CariTransaksi } from "../components/CariTransaksi";
import { cetakStruk } from "../components/Struk";
import { Modal } from "../components/Modal";
import { qty, rp, tglID, today } from "../format";
import { Geom, VbForm } from "../vb/VbForm";
import { useMsgBox } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";
import { NumInput } from "./Transaksi";
import "./transaksi.css";

/** jual = Retur Penjualan, beli = Retur Pembelian per Transaksi, brg = Retur Pembelian per Barang. */
export type ReturMode = "jual" | "beli" | "brg";

const FORM: Record<ReturMode, string> = { jual: "FrmTransJualRetur", beli: "FrmTransBeliRetur", brg: "FrmTransBeliReturBrg" };
const KODE: Record<ReturMode, string> = { jual: "RJ", beli: "RB", brg: "RB" };
const ROW_H = 23;
const HEAD_H = 40;
const FULL = { left: true, right: true, top: true, bottom: true };
const ANCHOR = { dtDetil: FULL, lblTotal: { right: true } };
const HIDE = ["tTotal", "tTotalBeli", "tNoOrder", "tKasirKode", "Picture1", "tPelangganKode", "tPemasokKode", "tSalesKode"];

interface Baris { b: Row; jml: number; harga: number }

export function Retur({ mode }: { mode: ReturMode }) {
  const { user, go, setting } = useApp();
  const msg = useMsgBox();
  const [tgl, setTgl] = useState(today());
  const [kasir, setKasir] = useState({ kode: user.kodekaryawan, nama: user.namakaryawan });
  // Pelanggan / pemasok / sales yang dipilih manual lewat tombol [?] (transaksi asal menggantikannya).
  const [manual, setManual] = useState<{ kontak?: Row; sales?: Row }>({});
  const [cariLain, setCariLain] = useState<null | "kasir" | "pelanggan" | "sales">(null);
  const [bukti, setBukti] = useState<{ header: Row; detail: Row[] } | null>(null);
  const [notrans, setNotrans] = useState("");
  const [catatan, setCatatan] = useState("");
  const [sumber, setSumber] = useState<ReturSumber | null>(null);
  const [jmlRetur, setJmlRetur] = useState<Record<number, number>>({});
  const [barisan, setBarisan] = useState<Baris[]>([]);
  const [pemasok, setPemasok] = useState<Row | null>(null);
  const [cariTrans, setCariTrans] = useState(false);
  const [cariBarang, setCariBarang] = useState(false);
  const [cariPemasok, setCariPemasok] = useState(false);
  const [scan, setScan] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const brg = mode === "brg";

  const kosong = !sumber && barisan.length === 0;
  useEffect(() => { api.previewNotrans(KODE[mode], tgl).then(setNotrans).catch(() => setNotrans("")); }, [tgl, mode, kosong]);

  const reset = () => {
    setSumber(null); setJmlRetur({}); setBarisan([]); setPemasok(null); setCatatan(""); setSelected(null);
    setTgl(today()); setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan }); setManual({});
  };

  const ambil = async (no: string) => {
    try {
      const s = await returApi.sumber(no, mode === "jual" ? "TJ" : "TB");
      setSumber(s);
      setJmlRetur({});
      setCariTrans(false);
      if (!s.detail.some((d) => Number(d.sisa) > 0)) msg.alert("Semua barang di transaksi ini sudah diretur.");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const tambah = (b: Row) => {
    if (barisan.some((x) => x.b.kodebarang === b.kodebarang)) { msg.alert(`${b.namabarang} sudah ada di daftar.`); return; }
    setBarisan((xs) => [...xs, { b, jml: 1, harga: Number(b.hrgbeli) || 0 }]);
    setSelected(b.kodebarang);
  };
  const onScan = async () => {
    const kode = scan.trim();
    if (!kode) return;
    // Retur per barang boleh memilih barang nonaktif; tidak ketemu: pesan "Data tidak ditemukan."
    const hasil = await api.masterList("mdbarang", { search: kode, limit: 20 }).catch(() => ({ rows: [] as Row[] }));
    const up = kode.toUpperCase();
    const b = hasil.rows.find((x) => [x.kodebarang, x.barcode, x.barcode2].some((v) => String(v ?? "").toUpperCase() === up));
    if (b) tambah(b); else msg.alert("Data tidak ditemukan.");
    setScan("");
  };

  const total = brg
    ? barisan.reduce((s, x) => s + x.jml * x.harga, 0)
    : (sumber?.detail ?? []).reduce((s, d) => s + (jmlRetur[Number(d.nourut)] || 0) * (Number(d.hrgterjual) - (mode === "jual" && Number(d.jmljual) > 0 ? Number(d.disknilai) / Number(d.jmljual) : 0)), 0);
  const jenisItem = brg ? barisan.length : Object.values(jmlRetur).filter((v) => v > 0).length;

  const selesai = useCallback((h: { notrans: string; dipotong: number; kas: number }) => {
    const bagian = [`Retur ${h.notrans} tersimpan.`];
    if (h.dipotong > 0) bagian.push(`${mode === "jual" ? "Piutang" : "Hutang"} berkurang Rp ${rp(h.dipotong)}.`);
    if (h.kas > 0) bagian.push(mode === "jual" ? `Uang Rp ${rp(h.kas)} dikembalikan ke pelanggan.` : `Uang Rp ${rp(h.kas)} diterima dari pemasok.`);
    bagian.push("Apakah akan cetak bukti retur?");
    reset();
    msg.confirm(bagian.join(" "), () => { api.getTransaksi(h.notrans).then(setBukti).catch((e) => msg.alert(errText(e))); });
  }, [mode, msg]); // eslint-disable-line react-hooks/exhaustive-deps

  const kirimBusy = useRef(false);
  const kirim = useCallback(async (potong: boolean) => {
    if (kirimBusy.current) return;
    kirimBusy.current = true;
    try {
      let h;
      if (brg) {
        h = await returApi.simpanBeliBarang({
          tgl, kodepemasok: pemasok!.kodepemasok, catatan, kodekasir: kasir.kode,
          items: barisan.map((x) => ({
            kodebarang: x.b.kodebarang, namabarang: x.b.namabarang, kodesatuan: x.b.kodesatuan, satuanjual: x.b.kodesatuan,
            konversi: 1, jmljual: x.jml, harga: x.harga,
          })),
        });
      } else {
        const items = Object.entries(jmlRetur).filter(([, v]) => v > 0).map(([k, v]) => ({ nourut: Number(k), jml: v }));
        const input = { tgl, asal: String(sumber!.header.notrans), catatan, items, kodekasir: kasir.kode };
        h = mode === "jual" ? await returApi.simpanJual({ ...input, potong_piutang: potong }) : await returApi.simpanBeli(input);
      }
      selesai(h);
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      kirimBusy.current = false;
    }
  }, [brg, mode, pemasok, barisan, sumber, jmlRetur, tgl, catatan, kasir, msg, selesai]);

  const simpan = useCallback(async () => {
    if (brg) {
      if (!pemasok) return msg.alert("Silakan pilih pemasok dulu.");
      if (barisan.length === 0) return msg.alert("Belum ada barang yang diretur. Silakan tambahkan barang dulu.");
      return void kirim(false);
    }
    if (!sumber) return msg.alert(`Silakan cari transaksi ${mode === "jual" ? "penjualan" : "pembelian"} dulu.`);
    if (!Object.values(jmlRetur).some((v) => v > 0)) return msg.alert("Belum ada jumlah retur yang diisi.");
    // Retur penjualan: tagihan transaksi asal yang masih terbuka hanya dipotong kalau Anda menjawab Ya.
    if (mode === "jual" && Number(sumber.piutang_terbuka) > 0) {
      msg.confirm("Apakah jml piutang pelanggan akan dikurangi dengan jml retur?", () => void kirim(true), undefined, () => void kirim(false));
      return;
    }
    void kirim(false);
  }, [brg, mode, pemasok, barisan, sumber, jmlRetur, msg, kirim]);

  // Batal [F1]: langsung mengosongkan tanpa bertanya, lalu kursor ke Pelanggan / Pemasok.
  const batal = useCallback(() => {
    reset();
    setTimeout(() => document.querySelector<HTMLElement>(`[data-vb="${mode === "jual" ? "tPelangganNama" : "tPemasokNama"}"] input`)?.focus(), 0);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const kasirBisaDiganti = user.level.toUpperCase() !== "KASIR";

  const ada = !!msg.node;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (cariTrans || cariBarang || cariPemasok || cariLain || ada || bukti) return;
      if (e.altKey) {
        const k = e.code === "Digit2" ? (kasirBisaDiganti ? "kasir" : null) : e.code === "Digit3" ? (brg || mode === "beli" ? "pemasok" : "pelanggan") : e.code === "Digit4" ? "sales" : null;
        if (k === "pemasok") { e.preventDefault(); setCariPemasok(true); }
        else if (k) { e.preventDefault(); setCariLain(k as "kasir" | "pelanggan" | "sales"); }
        else if (e.code === "KeyT") { e.preventDefault(); document.querySelector<HTMLElement>(".tj-grid")?.focus(); }
        return;
      }
      if (e.key === "F4") { e.preventDefault(); void simpan(); }
      else if (e.key === "F1") { e.preventDefault(); batal(); }
      else if (e.key === "F3" && !brg) { e.preventDefault(); setCariTrans(true); }
      else if (e.key === "F10" && brg) { e.preventDefault(); setCariBarang(true); }
      else if (e.key === "Escape") go("home");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cariTrans, cariBarang, cariPemasok, cariLain, bukti, ada, brg, mode, kasirBisaDiganti, simpan, batal, go]);

  const grid = (g: Geom) => {
    const detail = sumber?.detail ?? [];
    const n = brg ? barisan.length : detail.length;
    const lengkap = Math.max(n + 1, Math.floor((g.height - 2 - HEAD_H) / ROW_H));
    const rows: ReactNode[] = [];
    for (let i = 0; i < lengkap; i++) {
      if (brg) {
        const x = barisan[i];
        if (!x) {
          rows.push(
            <tr key={`e${i}`}>
              <td className="no">{i + 1}</td>
              <td className="kd">{i === n && (
                <input ref={scanRef} value={scan} autoComplete="off" autoFocus onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onScan(); } }} />
              )}</td>
              <td /><td /><td /><td /><td />
            </tr>,
          );
          continue;
        }
        const kode = x.b.kodebarang;
        rows.push(
          <tr key={kode} className={selected === kode ? "cur" : ""} onMouseDown={() => setSelected(kode)}>
            <td className="no">{i + 1}</td>
            <td>{x.b.barcode || kode}</td>
            <td className="nm">{x.b.namabarang}</td>
            <td>{x.b.kodesatuan}</td>
            <td className="r"><NumInput className="r" value={x.jml} onChange={(v) => setBarisan((xs) => xs.map((y) => (y === x ? { ...y, jml: v } : y)))} /></td>
            <td className="r"><NumInput className="r" value={x.harga} onChange={(v) => setBarisan((xs) => xs.map((y) => (y === x ? { ...y, harga: v } : y)))} /></td>
            <td className="r">{rp(x.jml * x.harga)}</td>
          </tr>,
        );
      } else {
        const d = detail[i];
        if (!d) { rows.push(<tr key={`e${i}`}><td className="no">{i + 1}</td>{Array.from({ length: mode === "beli" ? 7 : 8 }, (_, k) => <td key={k} />)}</tr>); continue; }
        const no = Number(d.nourut);
        const sisa = Number(d.sisa);
        rows.push(
          <tr key={no} className={mode === "jual" && sisa <= 0 ? "warn" : ""}>
            <td className="no">{i + 1}</td>
            <td>{d.kodebarang}</td>
            <td className="nm">{d.namabarang}</td>
            <td>{d.satuanjual}</td>
            <td className="r">{qty(d.jmljual)}</td>
            {mode === "jual" && <td className="r">{qty(d.jmlretur)}</td>}
            <td className="r">{mode === "beli" || sisa > 0 ? (
              <NumInput className="r" value={jmlRetur[no] ?? 0} onChange={(v) => setJmlRetur((m) => ({ ...m, [no]: v }))} />
            ) : "-"}</td>
            <td className="r">{rp(d.hrgterjual)}</td>
            <td className="r">{rp((jmlRetur[no] || 0) * Number(d.hrgterjual))}</td>
          </tr>,
        );
      }
    }
    // Retur pembelian per transaksi: No, Kode / Barcode, Nama Barang, Satuan, Jumlah, Jml. Retur, Hrg. Beli, Subtotal (FrmTransBeliRetur).
    const kolom = brg ? [4, 14, 40, 8, 10, 12, 12] : mode === "beli" ? [4, 14, 38, 8, 10, 10, 8, 8] : [4, 12, 32, 7, 9, 10, 10, 8, 8];
    const judul = brg
      ? ["No", "Kode / Barcode", "Nama Barang", "Satuan", "Jml. Retur", "Harga", "Subtotal"]
      : mode === "beli"
        ? ["No", "Kode / Barcode", "Nama Barang", "Satuan", "Jumlah", "Jml. Retur", "Hrg. Beli", "Subtotal"]
        : ["No", "Kode", "Nama Barang", "Satuan", "Jml. Jual", "Sudah Diretur", "Jml. Retur", "Harga", "Subtotal"];
    const kanan = brg ? [4, 5, 6] : mode === "beli" ? [4, 5, 6, 7] : [4, 5, 6, 7, 8];
    return (
      <div className="tj-grid" tabIndex={0} onKeyDown={(e) => {
        if (e.key === "Delete" && brg && e.target === e.currentTarget) {
          setBarisan((xs) => xs.filter((x) => x.b.kodebarang !== selected));
          setSelected(null);
        }
      }}>
        <table>
          <colgroup>{kolom.map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
          <thead><tr>{judul.map((j, i) => <th key={i} className={i === 0 || kanan.includes(i) ? "r" : ""}>{j}</th>)}</tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  const h = sumber?.header;
  const bind = useMemo(() => ({
    tNoTrans: { value: notrans },
    dtTglTrans: { value: tgl, onChange: (v: string) => v && setTgl(v) },
    tKasirNama: { value: kasir.nama },
    cCariKasir: { onClick: () => setCariLain("kasir"), disabled: !kasirBisaDiganti },
    tPelangganNama: { value: h?.namakontak ?? manual.kontak?.namapelanggan ?? "" },
    tPemasokNama: { value: brg ? (pemasok?.namapemasok ?? "") : (h?.namakontak ?? manual.kontak?.namapemasok ?? "") },
    cCariPemasok: { onClick: () => setCariPemasok(true) },
    cCariPelanggan: { onClick: () => setCariLain("pelanggan") },
    cCariSales: { onClick: () => setCariLain("sales") },
    tSalesNama: { value: h?.namasales ?? manual.sales?.namakaryawan ?? "" },
    tCatatan: { value: catatan, onChange: setCatatan },
    Label2: { text: sumber ? `Transaksi asal: ${sumber.header.notrans} (${tglID(sumber.header.tgltrans)}). Tekan [Alt] + T untuk mengarahkan kursor ke tabel` : undefined },
    lblInfo: { text: brg && selected ? `Stok ${qty(barisan.find((x) => x.b.kodebarang === selected)?.b.stokakhir)}` : "" },
    lblJmlItem: { text: `Jml. Jenis : ${jenisItem}` },
    lblTotal: { text: `${rp(total)},-` },
    dtDetil: grid,
    cAmbilOrder: { onClick: () => setCariTrans(true) },
    cSimpan: { onClick: () => void simpan() },
    cBatal: { onClick: batal },
    cTutup: { onClick: () => go("home") },
  }), [notrans, tgl, user, kasir, manual, kasirBisaDiganti, h, brg, pemasok, catatan, sumber, selected, barisan, jmlRetur, scan, jenisItem, total, simpan, batal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter pindah antar kolom kepala: Tanggal, Kasir, Pelanggan/Pemasok, Sales, Catatan, lalu tabel.
  const kontakKey = mode === "jual" ? "tPelangganNama" : "tPemasokNama";
  const rantai = ["dtTglTrans", "tKasirNama", kontakKey, "tSalesNama", "tCatatan"];
  const enterKepala = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || ada || cariTrans || cariBarang || cariPemasok || cariLain) return;
    const nama = (e.target as HTMLElement).closest<HTMLElement>("[data-vb]")?.dataset.vb ?? "";
    const i = rantai.indexOf(nama);
    if (i < 0 || !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    if (i < rantai.length - 1) document.querySelector<HTMLElement>(`[data-vb="${rantai[i + 1]}"] input, [data-vb="${rantai[i + 1]}"] textarea`)?.focus();
    else document.querySelector<HTMLElement>(".tj-grid input, .tj-grid")?.focus();
  };

  return (
    <div className="tj-page" onKeyDown={enterKepala}>
      <VbForm form={FORM[mode]} bind={bind} hide={HIDE} fill anchor={ANCHOR} />
      {msg.node}
      {cariTrans && <CariTransaksi kode={mode === "jual" ? "TJ" : "TB"} onClose={() => setCariTrans(false)} onPick={(no) => void ambil(no)} />}
      {cariLain === "kasir" && <CariMaster table="mdkaryawan" onClose={() => setCariLain(null)} onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setCariLain(null); }} />}
      {cariLain === "pelanggan" && <CariMaster table="mdpelanggan" onClose={() => setCariLain(null)} onPick={(r) => { setManual((m) => ({ ...m, kontak: r })); setCariLain(null); }} />}
      {cariLain === "sales" && <CariMaster table="mdkaryawan" onClose={() => setCariLain(null)} onPick={(r) => { setManual((m) => ({ ...m, sales: r })); setCariLain(null); }} />}
      {bukti && <BuktiRetur data={bukti} setting={setting} onSelesai={() => setBukti(null)} />}
      {cariBarang && (
        <CariBarang initial={scan} showBeli onClose={() => { setCariBarang(false); scanRef.current?.focus(); }}
          onPick={(b) => { tambah(b); setCariBarang(false); setTimeout(() => scanRef.current?.focus(), 0); }} />
      )}
      {cariPemasok && <PilihPemasok onClose={() => setCariPemasok(false)} onPick={(p) => { if (brg) setPemasok(p); else setManual((m) => ({ ...m, kontak: p })); setCariPemasok(false); }} />}
    </div>
  );
}

function PilihPemasok(props: { onPick: (p: Row) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const t = setTimeout(() => api.masterList("mdpemasok", { search: q, limit: 100, onlyActive: true, sort: "namapemasok" }).then((r) => setRows(r.rows)).catch(() => setRows([])), 150);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal title="Cari Pemasok" onClose={props.onClose}>
      <input className="input-lg" autoFocus placeholder="Ketik nama atau kode pemasok" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) props.onPick(rows[0]); }} />
      <div className="table-wrap" style={{ height: 300 }}>
        <table className="grid">
          <thead><tr><th>Kode</th><th>Nama Pemasok</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.kodepemasok} onClick={() => props.onPick(r)}><td className="mono">{r.kodepemasok}</td><td>{r.namapemasok}</td></tr>)}
            {rows.length === 0 && <tr><td colSpan={2} className="empty">Pemasok yang Anda cari tidak ditemukan.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Bukti retur untuk dicetak (kertas struk). Mencetak lalu selesai. */
function BuktiRetur({ data, setting, onSelesai }: { data: { header: Row; detail: Row[] }; setting: Row; onSelesai: () => void }) {
  const h = data.header;
  useEffect(() => {
    cetakStruk().catch(() => undefined).finally(onSelesai);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="struk">
      <div className="center bold">{setting.namausaha}</div>
      <div className="center bold">{h.kode === "RJ" ? "BUKTI RETUR PENJUALAN" : "BUKTI RETUR PEMBELIAN"}</div>
      <hr />
      <div className="row"><span>{h.notrans}</span><span>{tglID(h.tgltrans)}</span></div>
      <div className="row"><span>{h.kode === "RJ" ? "Pelanggan" : "Pemasok"}</span><span>{h.kode === "RJ" ? h.namapelanggan : h.namapemasok}</span></div>
      <div className="row"><span>Petugas</span><span>{h.namakasir}</span></div>
      <hr />
      {data.detail.map((d) => (
        <div key={d.nourut}>
          <div>{d.namabarang}</div>
          <div className="row"><span>{qty(d.jmljual)} {d.satuanjual} x {rp(d.hrgterjual)}</span><span>{rp(Number(d.jmljual) * Number(d.hrgterjual))}</span></div>
        </div>
      ))}
      <hr />
      <div className="row bold"><span>TOTAL</span><span>{rp(h.jmltrans)}</span></div>
    </div>,
    document.body,
  );
}
