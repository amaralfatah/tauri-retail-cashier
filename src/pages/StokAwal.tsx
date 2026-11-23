import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { api, errText, Row } from "../api";
import { inventoriApi } from "../api/inventori";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { EntryGrid, type EntryGridCol, GridKodeInput } from "../components/EntryGrid";
import { qty, today } from "../format";
import { useMsgBox } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";
import { NumInput } from "./Transaksi";
import { FilterBarang } from "./inventoriLib";

/** Satu baris tabel. Barang yang sama boleh muncul lebih dari sekali, jadi baris dikenali lewat `uid`. */
interface Item { uid: number; b: Row; awal: number }

let uidSeq = 0;
const NOT_FOUND = "Data tidak ditemukan, atau barang tidak aktif.";

/** Kolom tabel stok awal (lebar dalam persen). */
const COLS: EntryGridCol[] = [
  { label: "No", width: 4, align: "right" },
  { label: "Kode / Barcode", width: 12, align: "left" },
  { label: "Nama Barang", width: 26, align: "left" },
  { label: "Satuan", width: 7, align: "left" },
  { label: "Stok Awal", width: 11, align: "right" },
  { label: "Stok Masuk", width: 10, align: "right" },
  { label: "Stok Keluar", width: 10, align: "right" },
  { label: "Stok Opname", width: 10, align: "right" },
  { label: "Stok Akhir", width: 10, align: "right" },
];

export function StokAwal() {
  const { user, go } = useApp();
  const msg = useMsgBox();
  const [tgl, setTgl] = useState(today());
  const [notrans, setNotrans] = useState("");
  const [catatan, setCatatan] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [cari, setCari] = useState(false);
  const [kasir, setKasir] = useState({ kode: user.kodekaryawan, nama: user.namakaryawan });
  const [cariKasir, setCariKasir] = useState(false);
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

  const kosongkan = useCallback(() => { setItems([]); setSelected(null); setCatatan(""); setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan }); }, [user]);

  const simpan = useCallback(async () => {
    if (items.length === 0) return msg.alert("Belum ada barang yang diisi. Silakan tambahkan barang dulu.");
    try {
      await inventoriApi.saveStokAwal(tgl, catatan, items.map((i) => ({ kodebarang: i.b.kodebarang, stokawal: i.awal })), kasir.kode);
      kosongkan();
      msg.alert("Data sudah disimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [items, tgl, catatan, kasir, msg, kosongkan]);

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
      else if (e.altKey && e.code === "Digit1") { e.preventDefault(); document.querySelector<HTMLElement>('[data-vb="dtTglTrans"] input')?.focus(); }
      else if (e.altKey && e.code === "Digit2") { e.preventDefault(); bukaKasir(); }
      else if (e.altKey && e.code === "KeyT") { e.preventDefault(); gridRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cari, cariKasir, filter, ada, simpan, batal, go]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderGrid = () => {
    const total = Math.max(items.length + 1, 16);
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
              <GridKodeInput
                inputRef={scanRef}
                value={scan}
                autoFocus
                onChange={(e) => setScan(e.target.value)}
                onSearch={() => setCari(true)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void onScan(); } }}
              />
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
      <EntryGrid
        cols={COLS}
        gridRef={gridRef}
        onKeyDown={onKeyDown}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.dataset.awal) { e.preventDefault(); scanRef.current?.focus(); }
        }}
      >
        {rows}
      </EntryGrid>
    );
  };

  // Kotak stok awal di baris terpilih ditandai supaya Enter bisa memfokuskannya.
  useEffect(() => {
    gridRef.current?.querySelectorAll<HTMLInputElement>("td.r input").forEach((el) => el.setAttribute("data-awal", "1"));
  });

  return (
    <div className="flex size-full flex-col overflow-hidden bg-background font-sans text-foreground" data-form="FrmTransStokAwal">
      <div className="grid grid-cols-2 items-end gap-2.5 border-b bg-background px-3 py-1.5 sm:grid-cols-4">
        <div className="flex flex-col gap-1" data-vb="tNoTrans">
          <Label className="block truncate text-xs font-medium text-foreground">No. Transaksi</Label>
          <Input readOnly tabIndex={-1} value={notrans} className="cursor-default border-transparent bg-muted font-semibold text-foreground tabular-nums shadow-none focus-visible:ring-0" />
        </div>
        <div className="flex flex-col gap-1" data-vb="dtTglTrans">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Tanggal</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+1</span>
          </Label>
          <Input type="date" value={tgl} onChange={(e) => e.target.value && setTgl(e.target.value)} className="border-foreground/20 bg-background pr-1.5 text-foreground tabular-nums" />
        </div>
        <div className="flex flex-col gap-1" data-vb="tKasirNama">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Petugas</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+2</span>
          </Label>
          <InputGroup className="border-foreground/20 bg-background">
            <InputGroupInput readOnly value={kasir.nama} className="cursor-default font-medium text-foreground" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Pilih petugas" onClick={bukaKasir}>
                <SearchIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb="tCatatan">
          <Label className="text-xs font-medium text-foreground">Catatan</Label>
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan stok awal (opsional)" className="border-foreground/20 bg-background text-foreground" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-display px-4 py-2 text-display-foreground">
        <div className="flex flex-col" data-vb="lblJmlItem">
          <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Jml. Jenis Barang</span>
          <span className="text-2xl leading-none font-bold tabular-nums">{items.length}</span>
        </div>
        <div className="text-xs font-medium text-display-foreground/80">
          Scan barcode atau ketik kode di tabel. F10 untuk mencari barang, Alt+T untuk ke tabel.
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/20 p-2.5" data-vb="dtDetil">
        {renderGrid()}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive" onClick={batal}>
            <span>Batal</span>
            <Kbd className="border border-destructive/35 bg-destructive/10 text-destructive">F1</Kbd>
          </Button>
          <Button type="button" variant="outline" size="default" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => setCari(true)}>
            <span>Cari Barang</span>
            <Kbd className="border border-border bg-muted text-foreground">F10</Kbd>
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cFilter" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => setFilter(true)}>
            <span>Filter Barang</span>
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 gap-1.5 px-3.5 text-xs font-semibold shadow-xs" onClick={() => void simpan()}>
            <span>Simpan</span>
            <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">F4</Kbd>
          </Button>
        </div>
      </div>

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
        setItems((xs) => [...xs, ...baru.map((b) => ({ uid: ++uidSeq, b, awal: Number(b.stokawal) || 0 }))]);
        setFilter(false);
        msg.alert(baru.length ? `${baru.length} barang sudah ditambahkan ke daftar.` : "Tidak ada barang baru yang bisa ditambahkan.");
      }} />}
    </div>
  );
}
