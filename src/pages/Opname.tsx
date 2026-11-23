import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { qty, tglID, today } from "../format";
import { useMsgBox } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";
import { FilterBarang } from "./inventoriLib";
import { NumInput } from "./Transaksi";

/** Satu baris tabel. Barang yang sama boleh muncul lebih dari sekali, jadi baris dikenali lewat `uid`. */
interface Item { uid: number; b: Row; fisik: number }

/** Isi bukti stok opname yang baru disimpan. */
interface Bukti { notrans: string; tgl: string; catatan: string; kasir: string; baris: { b: Row; fisik: number }[] }

let uidSeq = 0;
const NOT_FOUND = "Data tidak ditemukan, atau barang tidak aktif.";

/** Lebar kolom (No, Kode, Nama Barang, Satuan, Stok Buku, Stok Fisik, Selisih Stok) dalam persen. */
const COLS = [5, 14, 34, 8, 13, 13, 13];

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
              <input ref={scanRef} data-slot="grid-input" value={scan} autoComplete="off" autoFocus onChange={(e) => setScan(e.target.value)}
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
      <div className="tj-grid vb-modern" tabIndex={0} ref={gridRef} onKeyDown={onKeyDown}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.dataset.fisik) { e.preventDefault(); scanRef.current?.focus(); }
        }}>
        <table>
          <colgroup>{COLS.map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
          <thead>
            <tr><th className="r">No</th><th className="text-left">Kode / Barcode</th><th className="text-left">Nama Barang</th><th className="text-left">Satuan</th><th className="r">Stok Buku</th><th className="r">Stok Fisik</th><th className="r">Selisih Stok</th></tr>
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

  const selisihCount = items.filter((i) => Math.abs(i.fisik - (Number(i.b.stokakhir) || 0)) >= 0.005).length;

  return (
    <div className="flex size-full flex-col overflow-hidden bg-background font-sans text-foreground" data-form="FrmTransStokOpname">
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
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan stok opname (opsional)" className="border-foreground/20 bg-background text-foreground" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-display px-4 py-2 text-display-foreground">
        <div className="flex items-center gap-4">
          <div className="flex flex-col" data-vb="lblJmlItem">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Jml. Jenis Barang</span>
            <span className="text-2xl leading-none font-bold tabular-nums">{items.length}</span>
          </div>
          <div className="h-8 w-px bg-display-foreground/15" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Barang Berselisih</span>
            <span className="text-2xl leading-none font-bold tabular-nums">{selisihCount}</span>
          </div>
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
