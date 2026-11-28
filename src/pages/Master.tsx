import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errText, MasterTable, Row } from "../api";
import { useApp } from "../appContext";
import { rp } from "../format";
import { formCaption } from "../vb/VbForm";
import { BELUM_ADA, GridCol, ToolItem, useMsgBox, useTopEscape, VbGrid, VbToolbar } from "../vb/VbGrid";
import { BarangEdit, PartyEdit, SimpleEdit } from "./MasterEdit";
import { FilterVal, FilterWindow, matchFilter } from "./MasterFilter";
import { useDaftarFile } from "./daftarFile";
import { ImportFoto } from "./fotoBarang";
import { PoinMember } from "./Poin";
import { getLocal } from "./localSettings";
import { GridKosong, KEYS, loadAll, q2, statusText, useList } from "./masterLib";

type Col = GridCol<Row>;
const no: Col = { title: "No", width: 42, align: "right", render: (_, i) => i + 1 };
const t = (title: string, width: number, key: string): Col => ({ title, width, render: (r) => r[key] });
const money = (title: string, width: number, key: string): Col => ({ title, width, align: "right", render: (r) => rp(r[key]) });
const stok = (title: string, key: string): Col => ({ title, width: 92, align: "right", render: (r) => q2(r[key]) });
/** Stok Akhir: sel diberi tanda kalau stok sudah di bawah atau sama dengan stok minimum (stok minimum > 0). */
const stokAkhir: Col = {
  title: "Stok Akhir", width: 92, align: "right",
  render: (r) => {
    const menipis = Number(r.stokmin) > 0 && Number(r.stokakhir) <= Number(r.stokmin);
    return menipis
      ? <span className="rounded-sm bg-destructive/12 px-1.5 font-semibold text-destructive" title={`Stok tinggal ${q2(r.stokakhir)}, batas minimum ${q2(r.stokmin)}`}>{q2(r.stokakhir)}</span>
      : q2(r.stokakhir);
  },
};
const status: Col = { title: "Status", width: 75, render: statusText };

interface MdCfg { form: string; title: string; cols: Col[]; actions: string[]; cari: string[]; placeholder: string; labelCari: string }
const CFG: Record<string, MdCfg> = {
  mdbarang: {
    form: "FrmMDBarang", title: "barang", cari: ["namabarang", "kodebarang", "barcode"], placeholder: "Cari nama, kode, atau barcode…", labelCari: "Cari barang",
    actions: ["Baru", "Edit", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Import Foto", "Tutup"],
    cols: [no, t("Jenis", 60, "jenis"), t("Kode Brg.", 95, "kodebarang"), t("Barcode", 110, "barcode"), t("Nama Barang", 222, "namabarang"), t("Satuan", 65, "kodesatuan"),
      money("Hrg. Beli", 95, "hrgbeli"), money("Hrg. Jual", 95, "hrgjual"), stok("Stok Awal", "stokawal"), stok("Stok Masuk", "stokmasuk"), stok("Stok Keluar", "stokkeluar"),
      { ...stok("Stok Opname", "stokopname"), width: 100 }, stokAkhir, status],
  },
  mdkelompok: {
    form: "FrmDataKelompok", title: "kelompok", cari: ["namakelompok", "kodekelompok"], placeholder: "Cari nama atau kode kelompok…", labelCari: "Cari kelompok",
    actions: ["Baru", "Edit", "Hapus", "Refresh", "Export", "Cetak", "Tutup"],
    cols: [no, t("Kode", 110, "kodekelompok"), t("Nama Kelompok", 360, "namakelompok")],
  },
  mdkategori: {
    form: "FrmDataKategori", title: "kategori", cari: ["namakategori", "kodekategori", "kodekelompok"], placeholder: "Cari nama atau kode kategori…", labelCari: "Cari kategori",
    actions: ["Baru", "Edit", "Hapus", "Refresh", "Export", "Cetak", "Tutup"],
    cols: [no, t("Kode", 95, "kodekategori"), t("Kelompok", 180, "kodekelompok"), t("Nama Kategori", 320, "namakategori")],
  },
  mdsatuan: {
    form: "FrmDataSatuan", title: "satuan", cari: ["namasatuan", "kodesatuan"], placeholder: "Cari nama atau kode satuan…", labelCari: "Cari satuan",
    actions: ["Baru", "Edit", "Hapus", "Refresh", "Export", "Cetak", "Tutup"],
    cols: [no, t("Kode", 110, "kodesatuan"), t("Nama Satuan", 360, "namasatuan")],
  },
  mdpelanggan: {
    form: "FrmMDPelanggan", title: "pelanggan", cari: ["namapelanggan", "kodepelanggan", "tlp1", "tlp2"], placeholder: "Cari nama, kode, atau telepon…", labelCari: "Cari pelanggan",
    actions: ["Baru", "Edit", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Cek Poin", "Tutup"],
    cols: [no, t("Kode", 95, "kodepelanggan"), t("Nama Pelanggan", 210, "namapelanggan"), t("Alamat", 220, "alamat"), t("Kota", 105, "kota"), t("Provinsi", 105, "provinsi"),
      t("Telp 1", 105, "tlp1"), t("Telp 2", 105, "tlp2"), t("Email", 150, "email"), { title: "Masa Aktif", width: 92, render: (r) => String(r.masaaktif ?? "").slice(0, 10) },
      t("Level", 75, "level"), status],
  },
  mdpemasok: {
    form: "FrmMDPemasok", title: "supplier", cari: ["namapemasok", "kodepemasok", "namakontak", "tlp1", "tlp2"], placeholder: "Cari nama, kode, kontak, atau telepon…", labelCari: "Cari supplier",
    actions: ["Baru", "Edit", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Tutup"],
    cols: [no, t("Kode", 95, "kodepemasok"), t("Nama Supplier", 210, "namapemasok"), t("Kontak", 145, "namakontak"), t("Alamat", 220, "alamat"), t("Kota", 105, "kota"),
      t("Provinsi", 105, "provinsi"), t("Telp 1", 105, "tlp1"), t("Telp 2", 105, "tlp2"), t("Fax", 95, "fax"), t("Email", 150, "email"), status],
  },
  mdkaryawan: {
    form: "FrmMDKaryawan", title: "karyawan", cari: ["namakaryawan", "kodekaryawan", "jabatan", "tlp1"], placeholder: "Cari nama, kode, atau jabatan…", labelCari: "Cari karyawan",
    actions: ["Baru", "Edit", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Tutup"],
    cols: [no, t("Kode", 95, "kodekaryawan"), t("Nama Karyawan", 210, "namakaryawan"), t("Alamat", 220, "alamat"), t("Kota", 105, "kota"), t("Provinsi", 105, "provinsi"),
      t("Telp 1", 105, "tlp1"), t("Telp 2", 105, "tlp2"), t("Email", 150, "email"), t("Jabatan", 125, "jabatan"), status],
  },
};

/** Pilihan urut Data Barang (cmbUrut aslinya); tanpa pilihan: jenis, kode, nama. */
const URUT: [string, string][] = [["Jenis", "jenis"], ["Kode Barang", "kodebarang"], ["Nama Barang", "namabarang"], ["Stok Akhir", "stokakhir"]];
const URUT_AWAL = "jenis,kodebarang,namabarang";

type SimpleTable = "mdkelompok" | "mdkategori" | "mdsatuan";
const isSimpleTable = (t: MasterTable): t is SimpleTable =>
  t === "mdkelompok" || t === "mdkategori" || t === "mdsatuan";

export function Master(props: { initial?: MasterTable }) {
  const { user } = useApp();
  const tab = props.initial ?? "mdbarang";
  if (user.level === "Kasir") return <div className="vbm-area" />;
  return <MdList table={tab} />;
}

function MdList({ table }: { table: MasterTable }) {
  const cfg = CFG[table];
  const isSimple = isSimpleTable(table);
  const { go } = useApp();
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
  const kelompok = useList(table === "mdbarang" || table === "mdkategori" ? "mdkelompok" : null).rows;
  const kategori = useList(table === "mdbarang" ? "mdkategori" : null).rows;

  const kelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of kelompok) m.set(String(k.kodekelompok ?? ""), String(k.namakelompok ?? ""));
    return m;
  }, [kelompok]);

  const cols = useMemo<Col[]>(() => {
    if (table !== "mdkategori") return cfg.cols;
    return [
      no,
      t("Kode", 95, "kodekategori"),
      {
        title: "Kelompok",
        width: 190,
        render: (r) => kelMap.get(String(r.kodekelompok ?? "")) || String(r.kodekelompok ?? ""),
      },
      t("Nama Kategori", 320, "namakategori"),
    ];
  }, [table, cfg.cols, kelMap]);

  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    const sort = urut ? URUT.find((u) => u[0] === urut)![1] : table === "mdbarang" ? URUT_AWAL : isSimple ? key : `${key},${name}`;
    loadAll(table, table === "mdbarang" ? { kelompok: kel, kategori: kat, sort } : { sort })
      .then((r) => { if (n === seq.current) setAll(r); })
      .catch((e) => msg.alert(errText(e)));
  }, [table, kel, kat, urut, key, name, isSimple]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pengaturan per komputer "Tampilkan Semua Data ketika membuka Master Data": kalau mati, daftar kosong sampai Refresh/filter.
  const pertama = useRef(table === "mdbarang" && getLocal("autoLoad") !== "1");
  useEffect(() => {
    if (pertama.current) { pertama.current = false; return; }
    load();
  }, [load]);

  // Kotak cari cepat: menyaring daftar yang sudah dimuat sambil mengetik.
  const [cari, setCari] = useState("");
  const [cariTunda, setCariTunda] = useState("");
  const cariRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setCariTunda(cari.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [cari]);

  const modalOpen = !!(edit || showFilter || poinKode || importFoto);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        cariRef.current?.focus();
        cariRef.current?.select();
      } else if (!modalOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEdit({
          row: table === "mdbarang" ? { jenis: "Barang", aktif: 1 } : table === "mdkategori" && kel ? { kodekelompok: kel } : isSimple ? {} : { aktif: 1 },
          isNew: true,
        });
      } else if (!modalOpen && e.key === "F5") {
        e.preventDefault();
        load();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [table, modalOpen, kel, isSimple, load]);

  const rows = useMemo(
    () => all.filter((r) => {
      if (table === "mdkategori" && kel && String(r.kodekelompok ?? "") !== kel) return false;
      if (!matchFilter(table, filter, r)) return false;
      if (!cariTunda) return true;
      if (cfg.cari.some((k) => String(r[k] ?? "").toLowerCase().includes(cariTunda))) return true;
      if (table === "mdkategori" && (kelMap.get(String(r.kodekelompok ?? "")) ?? "").toLowerCase().includes(cariTunda)) return true;
      return false;
    }),
    [all, filter, table, cariTunda, cfg, kel, kelMap],
  );
  const current = rows.find((r) => r[key] === sel);
  // Esc: kalau kotak cari berisi, kosongkan dulu; kalau tidak, tutup layar ini.
  useTopEscape(() => { if (cari) { setCari(""); setCariTunda(""); } else go("home"); });

  const openEdit = (r?: Row) => {
    // Tanpa baris terpilih Edit diam saja, seperti aslinya.
    if (!r) return;
    setEdit({ row: r, isNew: false });
  };
  const hapusRow = (target?: Row) => {
    const row = target ?? current;
    if (!row) return;
    msg.confirm(`Hapus ${cfg.title} ${row[name] || row[key]}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.masterDelete(table, row[key]);
        setSel(null);
        load();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, `Hapus ${cfg.title}`, undefined, true);
  };
  const cekPoin = () => {
    if (!current) return msg.alert("Pilih dulu pelanggan yang akan dicek poinnya.");
    setPoinKode(current[key]);
  };
  const file = useDaftarFile(formCaption(cfg.form), cols, rows, msg, cfg.title[0].toUpperCase() + cfg.title.slice(1));
  const belum = () => msg.alert(BELUM_ADA);

  const openNew = () => setEdit({
    row: table === "mdbarang" ? { jenis: "Barang", aktif: 1 } : table === "mdkategori" && kel ? { kodekelompok: kel } : isSimple ? {} : { aktif: 1 },
    isNew: true,
  });

  const handlers: Record<string, () => void> = {
    "Baru": openNew,
    "Edit": () => openEdit(current),
    "Hapus": () => hapusRow(current),
    "Filter": () => setShowFilter(true),
    "Refresh": () => load(),
    "Export": () => void file.ekspor(), "Cetak": () => void file.cetak(),
    "Import Foto": () => setImportFoto(true),
    "Cek Poin": cekPoin,
    "Tutup": () => go("home"),
  };
  const sepBefore = new Set(cfg.actions.includes("Filter") ? ["Filter", "Export", "Tutup"] : ["Refresh", "Export", "Tutup"]);
  const toolItems: ToolItem[] = cfg.actions.map((c) => ({ caption: c, onClick: handlers[c] ?? belum, sepBefore: sepBefore.has(c) }));

  // Pilihan kelompok tidak mempersempit daftar kategori (di EXE asli tidak ada kode yang melakukannya).
  const katList = kategori;
  const isFiltered = Boolean(cariTunda || (table === "mdkategori" && kel) || Object.values(filter).some(Boolean));
  const kosongTeks = isFiltered
    ? `Tidak ada ${cfg.title} yang cocok. Ubah kata kunci atau filternya.`
    : all.length === 0 && table === "mdbarang" && getLocal("autoLoad") !== "1"
      ? "Klik Refresh untuk menampilkan barang."
      : `Belum ada ${cfg.title}. Klik Baru untuk menambah.`;

  const kotakCari = (
    <div className="ml-auto flex items-center gap-1.5" data-vb="tCari">
      <Input
        ref={cariRef}
        type="search"
        value={cari}
        onChange={(e) => setCari(e.target.value)}
        placeholder={cfg.placeholder}
        aria-label={cfg.labelCari}
        className="h-8 w-56 xl:w-64"
      />
      <Kbd className="border border-border bg-card text-foreground">Ctrl+F</Kbd>
    </div>
  );

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col bg-background font-sans text-foreground" data-form={cfg.form}>
      <div data-vb="tbMenu">
        <VbToolbar items={toolItems} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
        {(table === "mdbarang" || table === "mdkategori") && (
          <div className="flex items-center gap-1.5" data-vb="cKelompokNama">
            <Label className="text-xs font-semibold text-foreground">Kelompok</Label>
            <NativeSelect value={kel} onChange={(e) => setKel(e.target.value)} className="w-40 xl:w-48">
              <NativeSelectOption value="">Semua Kelompok</NativeSelectOption>
              {kelompok.map((k) => <NativeSelectOption key={k.kodekelompok} value={k.kodekelompok}>{k.namakelompok}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        )}
        {table === "mdbarang" && (
          <>
            <div className="flex items-center gap-1.5" data-vb="cKategoriNama">
              <Label className="text-xs font-semibold text-foreground">Kategori</Label>
              <NativeSelect value={kat} onChange={(e) => setKat(e.target.value)} className="w-40 xl:w-48">
                <NativeSelectOption value="">Semua Kategori</NativeSelectOption>
                {katList.map((k) => <NativeSelectOption key={k.kodekategori} value={k.kodekategori}>{k.namakategori}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="flex items-center gap-1.5" data-vb="cmbUrut">
              <Label className="text-xs font-semibold text-foreground">Urutkan</Label>
              <NativeSelect value={urut} onChange={(e) => setUrut(e.target.value)} className="w-36 xl:w-40">
                <NativeSelectOption value="">Urutan standar</NativeSelectOption>
                {URUT.map((u) => <NativeSelectOption key={u[0]} value={u[0]}>{u[0]}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          </>
        )}
        {kotakCari}
      </div>
      <div className="min-h-0 flex-1 p-2.5" data-vb="lsData">
        <GridKosong kosong={rows.length === 0} teks={kosongTeks}>
          <VbGrid
            cols={cols}
            rows={rows}
            rowKey={(r) => r[key]}
            selected={sel}
            onSelect={setSel}
            onOpen={openEdit}
            onDelete={hapusRow}
          />
        </GridKosong>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground" data-vb="lblTotal">
        <span className="tabular-nums">
          Jumlah Data : {rp(rows.length)}
          {isFiltered && rows.length !== all.length && (
            <span className="ml-1 font-normal text-muted-foreground">dari {rp(all.length)}</span>
          )}
        </span>
        {current ? (
          <span className="truncate text-muted-foreground">
            Terpilih: <strong className="text-foreground">{current[key]} — {current[name]}</strong>
          </span>
        ) : (
          <span className="truncate font-normal text-muted-foreground">
            ↑↓←→ Navigasi · Enter/F2 Ubah · Del Hapus · Ctrl+C Salin
          </span>
        )}
      </div>
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
      {edit && isSimple && (
        <SimpleEdit table={table} row={edit.row} isNew={edit.isNew} rows={all} onClose={() => setEdit(null)} onChanged={(k) => { setSel(k); load(); }} />
      )}
      {edit && table !== "mdbarang" && !isSimple && (
        <PartyEdit table={table} row={edit.row} isNew={edit.isNew} rows={all} onClose={() => setEdit(null)} onChanged={(k) => { setSel(k); load(); }} />
      )}
    </div>
  );
}
