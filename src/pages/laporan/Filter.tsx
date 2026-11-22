import { useState } from "react";
import { Row } from "../../api";
import { Modal } from "../../components/Modal";
import { Bind } from "../../vb/VbForm";
import { VbModal } from "../../vb/VbGrid";
import { KEYS, useList } from "../masterLib";

export type LapFilterVal = Record<string, string>;
type Who = "pelanggan" | "pemasok" | "kasir" | "sales";
const TABEL: Record<Who, "mdpelanggan" | "mdpemasok" | "mdkaryawan"> = { pelanggan: "mdpelanggan", pemasok: "mdpemasok", kasir: "mdkaryawan", sales: "mdkaryawan" };
const JUDUL: Record<Who, string> = { pelanggan: "Pelanggan", pemasok: "Supplier", kasir: "Kasir", sales: "Sales" };

function Pilih(props: { who: Who; rows: Row[]; onPick: (kode: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { key, name } = KEYS[TABEL[props.who]];
  const list = props.rows.filter((r) => `${r[key]} ${r[name]}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 300);
  return (
    <Modal title={`Pilih ${JUDUL[props.who]}`} onClose={props.onClose} footer={<button className="btn" onClick={props.onClose}>Tutup</button>}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik kode atau nama" style={{ width: "100%", marginBottom: 6 }} />
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        <table className="grid">
          <tbody>
            {list.map((r) => (
              <tr key={r[key]} style={{ cursor: "pointer" }} onClick={() => props.onPick(String(r[key]))}>
                <td>{r[key]}</td><td>{r[name]}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="empty">Tidak ada data yang cocok.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Dialog filter asli (FrmFilterPenjualan, FrmFilterPembelian, FrmFilterKas, dst.). Tampilkan menerapkan isian, Tutup keluar. */
export function LapFilterDialog(props: { form: string; value: LapFilterVal; onApply: (f: LapFilterVal) => void; onClose: () => void }) {
  const [f, setF] = useState<LapFilterVal>(props.value);
  const [pick, setPick] = useState<Who | null>(null);
  const [pesan, setPesan] = useState("");
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const barangBar = props.form === "FrmFilterBarang"; // Terlaris dan Omset: Filter Barang dengan tanggal
  const barang = props.form === "FrmFilterTransaksiBarang" || barangBar;
  const pel = useList("mdpelanggan").rows;
  const pem = useList("mdpemasok").rows;
  const kar = useList("mdkaryawan").rows;
  const kel = useList(barang ? "mdkelompok" : null).rows;
  const kat = useList(barang ? "mdkategori" : null).rows;
  const sat = useList(barangBar ? "mdsatuan" : null).rows;
  const data: Record<Who, Row[]> = { pelanggan: pel, pemasok: pem, kasir: kar, sales: kar };

  const namaDari = (who: Who) => {
    const { key, name } = KEYS[TABEL[who]];
    return String(data[who].find((r) => String(r[key]).toLowerCase() === (f[who] ?? "").toLowerCase())?.[name] ?? "");
  };
  const kode = (who: Who): Bind => ({ value: f[who] ?? "", onChange: (v) => set(who, v.trim()) });
  const nama = (who: Who): Bind => ({ value: namaDari(who) });
  const buka = (who: Who): Bind => ({ onClick: () => setPick(who) });
  const txt = (k: string): Bind => ({ value: f[k] ?? "", onChange: (v) => set(k, v) });
  const pair = (k: string, rows: Row[], key: string, name: string, kodeCtl: boolean, parent?: [string, string]): Bind => {
    const list = parent && f[parent[0]] ? rows.filter((r) => r[parent[1]] === f[parent[0]]) : rows;
    return {
      value: f[k] ?? "", onChange: (v) => { set(k, v); if (k === "kelompok") set("kategori", ""); },
      children: (
        <>
          <option value="">{kodeCtl ? "" : "{Semua}"}</option>
          {list.map((r) => <option key={r[key]} value={r[key]}>{kodeCtl ? r[key] : r[name]}</option>)}
        </>
      ),
    };
  };

  // Seperti aslinya, tanggal awal yang lebih besar dari tanggal akhir tidak diperiksa: hasilnya kosong.
  const tampil = () => props.onApply(f);
  const daftar = (k: string, xs: string[]): Bind => ({
    value: f[k] ?? "", onChange: (v) => set(k, v),
    children: <><option value="">{"{Semua}"}</option>{xs.map((x) => <option key={x} value={x}>{x}</option>)}</>,
  });

  const bind: Record<string, Bind> = {
    dtTgl1: { value: f.dari ?? "", onChange: (v) => set("dari", v) },
    dtTgl2: { value: f.sampai ?? "", onChange: (v) => set("sampai", v) },
    tNotrans: txt("notrans"),
    tPelangganKode: kode("pelanggan"), tPelangganNama: nama("pelanggan"), cOpenPelanggan: buka("pelanggan"),
    tPemasokKode: kode("pemasok"), tPemasokNama: nama("pemasok"), cOpenPemasok: buka("pemasok"), cCariPemasok: buka("pemasok"), Command1: buka("pemasok"),
    tKasirKode: kode("kasir"), tKasirNama: nama("kasir"), cOpenKasir: buka("kasir"),
    tSalesKode: kode("sales"), tSalesNama: nama("sales"), cOpenSales: buka("sales"),
    cmbCaraBayar: {
      value: f.carabayar ?? "", onChange: (v) => set("carabayar", v),
      children: <><option value="">{"{Semua}"}</option><option value="Tunai">Tunai</option><option value="Kredit">Kredit</option><option value="Non Tunai">Non Tunai</option></>,
    },
    tKode: txt("kode"), tBarcode: txt("barcode"), tNama: txt("nama"),
    cKeloimpokNama: pair("kelompok", kel, "kodekelompok", "namakelompok", false),
    cKelompokNama: pair("kelompok", kel, "kodekelompok", "namakelompok", false),
    cKelompokKode: pair("kelompok", kel, "kodekelompok", "namakelompok", true),
    cKategoriNama: pair("kategori", kat, "kodekategori", "namakategori", false, ["kelompok", "kodekelompok"]),
    cKategoriKode: pair("kategori", kat, "kodekategori", "namakategori", true, ["kelompok", "kodekelompok"]),
    cJenis: daftar("jenis", ["Barang", "Jasa"]),
    cmbStatus: { value: f.status ?? "", onChange: (v) => set("status", v), children: <><option value="">Semua</option><option value="Aktif">Aktif</option><option value="Tidak aktif">Tidak aktif</option></> },
    cSatuan: pair("satuan", sat, "kodesatuan", "namasatuan", false),
    cPemasokNama: pair("pemasok", pem, "kodepemasok", "namapemasok", false),
    cPemasokKode: pair("pemasok", pem, "kodepemasok", "namapemasok", true),
    tStok1: { value: f.stok1 ?? "", onChange: (v) => set("stok1", v), num: true },
    tStok2: { value: f.stok2 ?? "", onChange: (v) => set("stok2", v), num: true },
    cTampil: { onClick: tampil },
    cTutup: { onClick: props.onClose },
  };

  return (
    <>
      <VbModal form={props.form} bind={bind} onClose={props.onClose} />
      {pick && <Pilih who={pick} rows={data[pick]} onClose={() => setPick(null)} onPick={(k) => { set(pick, k); setPick(null); }} />}
      {pesan && <Modal title="Informasi" onClose={() => setPesan("")} footer={<button className="btn primary" onClick={() => setPesan("")}>OK</button>}><p>{pesan}</p></Modal>}
    </>
  );
}
