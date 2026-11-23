import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errText, Row } from "../api";
import { returApi, ReturSumber } from "../api/retur";
import { useApp } from "../appContext";
import { CariBarang } from "../components/CariBarang";
import { CariTransaksi } from "../components/CariTransaksi";
import { cetakStruk } from "../components/Struk";
import { Modal } from "../components/Modal";
import { qty, rp, tglID, today } from "../format";
import { useMsgBox } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";
import { NumInput } from "./Transaksi";

/** jual = Retur Penjualan, beli = Retur Pembelian per Transaksi, brg = Retur Pembelian per Barang. */
export type ReturMode = "jual" | "beli" | "brg";

const FORM: Record<ReturMode, string> = { jual: "FrmTransJualRetur", beli: "FrmTransBeliRetur", brg: "FrmTransBeliReturBrg" };
const KODE: Record<ReturMode, string> = { jual: "RJ", beli: "RB", brg: "RB" };

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
  // Belum ada yang diretur: aksi berikutnya mencari transaksi (atau barang), jadi tombol itu yang biru.
  const cariUtama = brg ? barisan.length === 0 : !sumber;
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
    if (h.kas > 0) bagian.push(mode === "jual" ? `Uang Rp ${rp(h.kas)} dikembalikan ke pelanggan.` : `Uang Rp ${rp(h.kas)} diterima dari supplier.`);
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
      if (!pemasok) return msg.alert("Silakan pilih supplier dulu.");
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
        if (e.code === "Digit1") { e.preventDefault(); document.querySelector<HTMLElement>('[data-vb="dtTglTrans"] input')?.focus(); return; }
        if (e.code === "Digit5") { e.preventDefault(); document.querySelector<HTMLElement>('[data-vb="tCatatan"] input')?.focus(); return; }
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

  const renderGrid = () => {
    const detail = sumber?.detail ?? [];
    const n = brg ? barisan.length : detail.length;
    const lengkap = Math.max(n + 1, 16);
    const rows: ReactNode[] = [];
    for (let i = 0; i < lengkap; i++) {
      if (brg) {
        const x = barisan[i];
        if (!x) {
          rows.push(
            <tr key={`e${i}`}>
              <td className="no">{i + 1}</td>
              <td className="kd">{i === n && (
                <input ref={scanRef} data-slot="grid-input" value={scan} autoComplete="off" autoFocus onChange={(e) => setScan(e.target.value)}
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
    const kolom = brg ? [4, 14, 40, 8, 10, 12, 12] : mode === "beli" ? [4, 14, 38, 8, 10, 10, 8, 8] : [4, 12, 32, 7, 9, 10, 10, 8, 8];
    const judul = brg
      ? ["No.", "Kode / Barcode", "Nama Barang", "Satuan", "Jml. Retur", "Harga", "Subtotal"]
      : mode === "beli"
        ? ["No.", "Kode / Barcode", "Nama Barang", "Satuan", "Jumlah", "Jml. Retur", "Hrg. Beli", "Subtotal"]
        : ["No.", "Kode", "Nama Barang", "Satuan", "Jml. Jual", "Sudah Diretur", "Jml. Retur", "Harga", "Subtotal"];
    const kanan = brg ? [4, 5, 6] : mode === "beli" ? [4, 5, 6, 7] : [4, 5, 6, 7, 8];
    return (
      <div className="tj-grid vb-modern" tabIndex={0} onKeyDown={(e) => {
        if (e.key === "Delete" && brg && e.target === e.currentTarget) {
          setBarisan((xs) => xs.filter((x) => x.b.kodebarang !== selected));
          setSelected(null);
        }
      }}>
        <table>
          <colgroup>{kolom.map((c, i) => <col key={i} style={{ width: `${c}%` }} />)}</colgroup>
          <thead><tr>{judul.map((j, i) => <th key={i} className={i === 0 || kanan.includes(i) ? "r" : "text-left"}>{j}</th>)}</tr></thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  };

  const h = sumber?.header;
  const kontakKey = mode === "jual" ? "tPelangganNama" : "tPemasokNama";
  const kontakVal = mode === "jual"
    ? (h?.namakontak ?? manual.kontak?.namapelanggan ?? "")
    : brg
      ? (pemasok?.namapemasok ?? "")
      : (h?.namakontak ?? manual.kontak?.namapemasok ?? "");
  const salesVal = h?.namasales ?? manual.sales?.namakaryawan ?? "";

  // Enter pindah antar kolom kepala: Tanggal, Kasir, Pelanggan/Pemasok, Sales, Catatan, lalu tabel.
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
    <div className="flex size-full flex-col overflow-hidden bg-background font-sans text-foreground" data-form={FORM[mode]} onKeyDown={enterKepala}>
      <div className="grid grid-cols-2 items-end gap-3 border-b bg-background px-3 py-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1" data-vb="tNoTrans">
          <Label className="block truncate text-xs font-medium text-foreground">No. Retur</Label>
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
            <span>Kasir</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+2</span>
          </Label>
          <InputGroup className={kasirBisaDiganti ? "border-foreground/20 bg-background" : "border-transparent bg-muted"}>
            <InputGroupInput readOnly value={kasir.nama} className="cursor-default font-medium text-foreground" />
            {kasirBisaDiganti && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Pilih kasir" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setCariLain("kasir")}>
                  <SearchIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb={kontakKey}>
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>{mode === "jual" ? "Pelanggan" : "Supplier"}</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+3</span>
          </Label>
          <InputGroup className="border-foreground/20 bg-background">
            <InputGroupInput readOnly value={kontakVal} placeholder={mode === "jual" ? "Pilih pelanggan" : "Pilih supplier"} className="cursor-default font-medium text-foreground" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Pilih kontak" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => (mode === "jual" ? setCariLain("pelanggan") : setCariPemasok(true))}>
                <SearchIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb="tSalesNama">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Sales</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+4</span>
          </Label>
          <InputGroup className="border-foreground/20 bg-background">
            <InputGroupInput readOnly value={salesVal} placeholder="Tanpa sales" className="cursor-default text-foreground" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Pilih sales" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setCariLain("sales")}>
                <SearchIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb="tCatatan">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Catatan</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+5</span>
          </Label>
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan retur (opsional)" className="border-foreground/20 bg-background text-foreground" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-display px-4 py-2 text-display-foreground">
        <div className="flex items-center gap-4">
          <div className="flex flex-col" data-vb="lblJmlItem">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">Jml. Jenis Retur</span>
            <span className="text-2xl leading-none font-bold tabular-nums">{jenisItem}</span>
          </div>
          <div className="h-8 w-px bg-display-foreground/15" />
          <div className="flex flex-col" data-vb="Label2">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">
              {brg ? "Retur Pembelian per Barang" : "Transaksi Asal"}
            </span>
            <span className="text-sm font-semibold text-display-foreground/90">
              {sumber
                ? `${sumber.header.notrans} (${tglID(sumber.header.tgltrans)}) · Tekan Alt+T ke tabel`
                : brg
                  ? (selected ? `Stok Akhir: ${qty(barisan.find((x) => x.b.kodebarang === selected)?.b.stokakhir)}` : "Scan barcode atau ketik kode di tabel. F10 untuk mencari barang.")
                  : "Klik Cari Transaksi [F3] untuk memilih transaksi yang akan diretur"}
            </span>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5" data-vb="lblTotal">
          <span className="text-sm font-medium text-display-foreground/70 lg:text-base">Rp</span>
          <span className="text-3xl leading-none font-bold tracking-tight tabular-nums lg:text-[2.5rem]">{rp(total)}</span>
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
          {!brg ? (
            <Button type="button" variant={cariUtama ? "default" : "outline"} size="default" data-vb="cAmbilOrder" className={cariUtama ? "h-8 gap-1.5 px-2.5 text-xs font-semibold shadow-xs" : "h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs"} onClick={() => setCariTrans(true)}>
              <span>Cari Transaksi</span>
              <Kbd className={cariUtama ? "border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground" : "border border-border bg-muted text-foreground"}>F3</Kbd>
            </Button>
          ) : (
            <Button type="button" variant={cariUtama ? "default" : "outline"} size="default" className={cariUtama ? "h-8 gap-1.5 px-2.5 text-xs font-semibold shadow-xs" : "h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs"} onClick={() => setCariBarang(true)}>
              <span>Cari Barang</span>
              <Kbd className={cariUtama ? "border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground" : "border border-border bg-muted text-foreground"}>F10</Kbd>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant={cariUtama ? "outline" : "default"} size="default" data-vb="cSimpan" className={cariUtama ? "h-8 gap-1.5 border-foreground/20 bg-background px-3.5 text-xs font-medium text-foreground shadow-xs" : "h-8 gap-1.5 px-3.5 text-xs font-semibold shadow-xs"} onClick={() => void simpan()}>
            <span>Simpan</span>
            <Kbd className={cariUtama ? "border border-border bg-muted text-foreground" : "border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground"}>F4</Kbd>
          </Button>
        </div>
      </div>

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
    <Modal title="Cari Supplier" onClose={props.onClose}>
      <Input autoFocus placeholder="Ketik nama atau kode supplier" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) props.onPick(rows[0]); }} />
      <div className="tp-scroll-always h-75 rounded-md border border-border bg-card font-sans text-xs text-foreground [&>[data-slot=table-container]]:overflow-visible">
        <Table className="table-fixed border-separate border-spacing-0">
          <colgroup><col className="w-[28%]" /><col /></colgroup>
          <TableHeader>
            <TableRow className="border-b border-border bg-muted hover:bg-muted">
              <TableHead className="sticky top-0 z-20 h-7 border-r border-border bg-muted px-2 text-left text-xs font-semibold text-foreground">Kode</TableHead>
              <TableHead className="sticky top-0 z-20 h-7 bg-muted px-2 text-left text-xs font-semibold text-foreground">Nama Supplier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.kodepemasok} onClick={() => props.onPick(r)} className="cursor-pointer border-b border-border hover:bg-muted">
                <TableCell className="h-7 truncate border-r border-border px-2 py-0 font-mono">{r.kodepemasok}</TableCell>
                <TableCell className="h-7 truncate px-2 py-0">{r.namapemasok}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={2} className="p-4 text-center text-muted-foreground">Supplier yang Anda cari tidak ditemukan.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
      <div className="row"><span>{h.kode === "RJ" ? "Pelanggan" : "Supplier"}</span><span>{h.kode === "RJ" ? h.namapelanggan : h.namapemasok}</span></div>
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
