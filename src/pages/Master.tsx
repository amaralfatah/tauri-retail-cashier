import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, MasterTable, Row } from "../api";
import { useApp } from "../appContext";
import { rp } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { BELUM_ADA, GridCol, ToolItem, useMsgBox, VbGrid, VbToolbar } from "../vb/VbGrid";
import { BarangEdit, PartyEdit, SimpleMaster } from "./MasterEdit";
import { FilterVal, FilterWindow, matchFilter } from "./MasterFilter";
import { useDaftarFile } from "./daftarFile";
import { ImportFoto } from "./fotoBarang";
import { PoinMember } from "./Poin";
import { formCaption } from "../vb/VbForm";
import { getLocal } from "./localSettings";
import { KEYS, loadAll, q2, statusText, useList, useListLayout } from "./masterLib";

type Col = GridCol<Row>;
const no: Col = { title: "No.", width: 40, align: "right", render: (_, i) => i + 1 };
const t = (title: string, width: number, key: string): Col => ({ title, width, render: (r) => r[key] });
const money = (title: string, width: number, key: string): Col => ({ title, width, align: "right", render: (r) => rp(r[key]) });
const stok = (title: string, key: string): Col => ({ title, width: 70, align: "right", render: (r) => q2(r[key]) });
const status: Col = { title: "Status", width: 70, render: statusText };

interface MdCfg { form: string; title: string; cols: Col[]; extra?: string }
const CFG: Record<string, MdCfg> = {
  mdbarang: {
    form: "FrmMDBarang", title: "barang",
    cols: [no, t("Jenis", 55, "jenis"), t("Kode Brg.", 90, "kodebarang"), t("Barcode", 100, "barcode"), t("Nama Brg", 210, "namabarang"), t("Satuan", 60, "kodesatuan"),
      money("Hrg. Beli", 75, "hrgbeli"), money("Hrg. Jual", 75, "hrgjual"), stok("Stok Awal", "stokawal"), stok("Stok Masuk", "stokmasuk"), stok("Stok Keluar", "stokkeluar"),
      stok("Stok Opname", "stokopname"), stok("Stok Akhir", "stokakhir"), status],
  },
  mdpelanggan: {
    form: "FrmMDPelanggan", title: "pelanggan",
    cols: [no, t("Kode", 90, "kodepelanggan"), t("Nama", 200, "namapelanggan"), t("Alamat", 220, "alamat"), t("Kota", 100, "kota"), t("Provinsi", 100, "provinsi"),
      t("Telp1", 100, "tlp1"), t("Telp2", 100, "tlp2"), t("Email", 140, "email"), { title: "Masa Aktif", width: 85, render: (r) => String(r.masaaktif ?? "").slice(0, 10) },
      t("Level", 70, "level"), status],
  },
  mdpemasok: {
    form: "FrmMDPemasok", title: "supplier",
    cols: [no, t("Kode", 90, "kodepemasok"), t("Nama", 200, "namapemasok"), t("Kontak", 140, "namakontak"), t("Alamat", 220, "alamat"), t("Kota", 100, "kota"),
      t("Provinsi", 100, "provinsi"), t("Telp1", 100, "tlp1"), t("Telp2", 100, "tlp2"), t("Fax", 90, "fax"), t("Email", 140, "email"), status],
  },
  mdkaryawan: {
    form: "FrmMDKaryawan", title: "karyawan",
    cols: [no, t("Kode", 90, "kodekaryawan"), t("Nama", 200, "namakaryawan"), t("Alamat", 220, "alamat"), t("Kota", 100, "kota"), t("Provinsi", 100, "provinsi"),
      t("Telp1", 100, "tlp1"), t("Telp2", 100, "tlp2"), t("Email", 140, "email"), t("Jabatan", 120, "jabatan"), status],
  },
};

/** Pilihan urut Data Barang (cmbUrut aslinya); tanpa pilihan: jenis, kode, nama. */
const URUT: [string, string][] = [["Jenis", "jenis"], ["Kode Barang", "kodebarang"], ["Nama Barang", "namabarang"], ["Stok Akhir", "stokakhir"]];
const URUT_AWAL = "jenis,kodebarang,namabarang";

export function Master(props: { initial?: MasterTable }) {
  const { user } = useApp();
  const tab = props.initial ?? "mdbarang";
  if (user.level === "Kasir") return <div className="vbm-area" />;
  if (tab === "mdkelompok" || tab === "mdkategori" || tab === "mdsatuan") return <SimpleMaster table={tab} />;
  return <MdList table={tab} />;
}

function MdList({ table }: { table: MasterTable }) {
  const cfg = CFG[table];
  const { go } = useApp();
  const lay = useListLayout(cfg.form);
  const msg = useMsgBox();
  const { key, name } = KEYS[table];

  const [all, setAll] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [kel, setKel] = useState("");
  const [kat, setKat] = useState("");
  const [urut, setUrut] = useState("");
  const [filter, setFilter] = useState<FilterVal>({});
  const [showFilter, setShowFilter] = useState(false);
  const [edit, setEdit] = useState<{ row: Row; isNew: boolean } | null>(null);
  const [poinKode, setPoinKode] = useState<string | null>(null);
  const [importFoto, setImportFoto] = useState(false);
  const kelompok = useList(table === "mdbarang" ? "mdkelompok" : null).rows;
  const kategori = useList(table === "mdbarang" ? "mdkategori" : null).rows;

  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    const sort = urut ? URUT.find((u) => u[0] === urut)![1] : table === "mdbarang" ? URUT_AWAL : `${key},${name}`;
    loadAll(table, table === "mdbarang" ? { kelompok: kel, kategori: kat, sort } : { sort })
      .then((r) => { if (n === seq.current) setAll(r); })
      .catch((e) => msg.alert(errText(e)));
  }, [table, kel, kat, urut, key, name]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pengaturan per komputer "Tampilkan Semua Data ketika membuka Master Data": kalau mati, daftar kosong sampai Refresh/filter.
  const pertama = useRef(table === "mdbarang" && getLocal("autoLoad") !== "1");
  useEffect(() => {
    if (pertama.current) { pertama.current = false; return; }
    load();
  }, [load]);

  const rows = useMemo(() => all.filter((r) => matchFilter(table, filter, r)), [all, filter, table]);
  const current = rows.find((r) => r[key] === sel);

  const openEdit = (r?: Row) => {
    // Tanpa baris terpilih Edit diam saja, seperti aslinya.
    if (!r) return;
    setEdit({ row: r, isNew: false });
  };
  const hapus = () => {
    if (!current) return;
    msg.confirm("Apakah data terpilih akan dihapus?", async () => {
      try {
        await api.masterDelete(table, current[key]);
        setSel(null);
        load();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Konfirmasi");
  };
  const cekPoin = () => {
    if (!current) return msg.alert("Pilih dulu pelanggan yang akan dicek poinnya.");
    setPoinKode(current[key]);
  };
  const file = useDaftarFile(formCaption(cfg.form), cfg.cols, rows, msg, cfg.title[0].toUpperCase() + cfg.title.slice(1));
  const belum = () => msg.alert(BELUM_ADA);

  const handlers: Record<string, () => void> = {
    "Baru": () => setEdit({ row: table === "mdbarang" ? { jenis: "Barang", aktif: 1 } : { aktif: 1 }, isNew: true }),
    "Edit": () => openEdit(current),
    "Hapus": hapus,
    "Filter": () => setShowFilter(true),
    "Refresh": () => load(),
    "Export": () => void file.ekspor(), "Cetak": () => void file.cetak(),
    "Import Foto": () => setImportFoto(true),
    "Cek Poin": cekPoin,
    "Tutup": () => go("home"),
  };
  const sepBefore = new Set(["Filter", "Export", "Tutup"]);

  // Pilihan kelompok tidak mempersempit daftar kategori (di EXE asli tidak ada kode yang melakukannya).
  const katList = kategori;
  const pickKel = (v: string) => setKel(v);

  const bind: Record<string, Bind> = {
    tbMenu: (_g, ctrl) => (
      <VbToolbar items={(ctrl.texts ?? []).map<ToolItem>((c) => ({ caption: c, onClick: handlers[c] ?? belum, sepBefore: sepBefore.has(c) }))} />
    ),
    lsData: () => <VbGrid cols={cfg.cols} rows={rows} rowKey={(r) => r[key]} selected={sel} onSelect={setSel} onOpen={openEdit} />,
    lblTotal: { text: `Jumlah Data : ${rp(rows.length)}` },
    cKelompokNama: { value: kel, onChange: pickKel, children: <><option value="">{"{Semua Kelompok}"}</option>{kelompok.map((k) => <option key={k.kodekelompok} value={k.kodekelompok}>{k.namakelompok}</option>)}</> },
    cKelompokKode: { value: kel, onChange: pickKel, children: <><option value="" />{kelompok.map((k) => <option key={k.kodekelompok} value={k.kodekelompok}>{k.kodekelompok}</option>)}</> },
    cKategoriNama: { value: kat, onChange: setKat, children: <><option value="">{"{Semua Kategori}"}</option>{katList.map((k) => <option key={k.kodekategori} value={k.kodekategori}>{k.namakategori}</option>)}</> },
    cKategoriKode: { value: kat, onChange: setKat, children: <><option value="" />{katList.map((k) => <option key={k.kodekategori} value={k.kodekategori}>{k.kodekategori}</option>)}</> },
    cmbUrut: { value: urut, onChange: setUrut, children: <><option value="" />{URUT.map((u) => <option key={u[0]} value={u[0]}>{u[0]}</option>)}</> },
  };

  return (
    <div className="vbm-fill">
      <VbForm form={cfg.form} bind={bind} hide={["cKelompokKode", "cKategoriKode"]} fill anchor={lay.anchor} pos={lay.pos} />
      {msg.node}
      {file.node}
      {poinKode && <PoinMember kode={poinKode} onClose={() => { setPoinKode(null); load(); }} />}
      {importFoto && <ImportFoto barang={current} onClose={() => setImportFoto(false)} />}
      {showFilter && (
        <FilterWindow table={table} rows={all} value={filter} onClose={() => setShowFilter(false)}
          onApply={(f) => { setFilter(f); setShowFilter(false); load(); }} />
      )}
      {edit && table === "mdbarang" && (
        <BarangEdit row={edit.row} isNew={edit.isNew} onClose={() => setEdit(null)} onChanged={(k) => { setSel(k); load(); }} />
      )}
      {edit && table !== "mdbarang" && (
        <PartyEdit table={table} row={edit.row} isNew={edit.isNew} rows={all} onClose={() => setEdit(null)} onChanged={(k) => { setSel(k); load(); }} />
      )}
    </div>
  );
}
