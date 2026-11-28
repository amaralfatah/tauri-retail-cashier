import { pilihFolder, pilihGambar } from "../api/dialog";
import { CircleHelpIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errText, Row } from "../api";
import { useApp } from "../appContext";
import { Theme, useTheme } from "../lib/theme";
import { terapkanUkuran, UKURAN_TAMPILAN } from "../lib/ukuranTampilan";
import { ModalFrame, useMsgBox } from "../vb/VbGrid";
import { kertasStruk } from "./kasirSettings";
import { FORMAT_HRG, FORMAT_QTY, HOME, JENIS_PORT, JENIS_PRINTER, KODE_DRAWER_BAWAAN, LocalKey, LocalSettings, MODE_SCAN, UKURAN_KERTAS, loadLocal, rapikan, saveLocal } from "./localSettings";

export { Pengguna } from "./Pengguna";

const TABS = ["Info Usaha", "Transaksi", "Peralatan"];
/** Kolom tseting yang berisi angka; sisanya teks atau 0/1. */
const ANGKA = ["tempopiutang", "mintranspoin", "jmlpointrans"];

const TEMA: [Theme, string][] = [["light", "Terang"], ["dark", "Gelap"], ["system", "Ikut Sistem"]];

const muatLokal = () => rapikan(loadLocal());
/** Angka contoh yang diketik (koma = desimal) menjadi angka biasa. */
const angkaContoh = (t: string) => Number(t.replace(/\./g, "").replace(",", ".")) || 0;

/** Terapkan pola angka gaya VB (mis. ###,##0.00) pada sebuah angka. */
export function formatPola(pola: string, n: number): string {
  const des = (pola.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: des, maximumFractionDigits: des, useGrouping: pola.includes(",") }).format(n);
}

export function Pengaturan() {
  const { user, setting, reloadSetting, go } = useApp();
  const { theme, setTheme } = useTheme();
  const msg = useMsgBox();
  const [tab, setTab] = useState(0);
  const [v, setV] = useState<Row>(setting);
  const [l, setL] = useState<LocalSettings>(muatLokal);
  const [tema, setTema] = useState<Theme>(theme);
  const [profil, setProfil] = useState(false);
  const [mulaiUlang, setMulaiUlang] = useState(false);
  const [exQty, setExQty] = useState("1234567,891");
  const [exHrg, setExHrg] = useState("1234567");
  const [printers, setPrinters] = useState<string[]>([]);
  const [sibukUji, setSibukUji] = useState<"cetak" | "laci" | null>(null);
  const bisaUbah = user.level !== "Kasir";

  useEffect(() => setV(setting), [setting]);
  useEffect(() => {
    void api.daftarPrinter().then(setPrinters).catch(() => undefined);
  }, []);

  // Esc menutup layar ini. Dialog yang sedang terbuka menangkap Esc lebih dulu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); go("home"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const setLocalVal = (k: LocalKey, val: string) => setL((x) => ({ ...x, [k]: val }));

  const simpan = async () => {
    try {
      if (bisaUbah) {
        const data: Row = { ...v };
        for (const k of ANGKA) data[k] = Number(String(v[k] ?? "").replace(",", ".")) || 0;
        await api.saveSettings(data);
        await reloadSetting();
      }
      saveLocal(l);
      void terapkanUkuran(l.ukuranTampilan);
      setTheme(tema);
      setMulaiUlang(true);
    } catch (e) {
      msg.alert(errText(e));
    }
  };
  const batal = () => { setV(setting); setL(muatLokal()); setTema(theme); };
  const pilihGbr = (k: LocalKey) => async () => { const p = await pilihGambar(); if (p) setLocalVal(k, p); };
  const pilihFolderFoto = async () => { const p = await pilihFolder(); if (p) setLocalVal("lokasiFoto", p); };

  const tesCetak = async () => {
    if (sibukUji) return;
    const tujuan = l.portPrinter.trim();
    if (!tujuan) {
      msg.alert("Nama atau port printer belum diisi. Pilih nama printer Windows atau ketik nama port (mis. LPT1) dulu.");
      return;
    }
    setSibukUji("cetak");
    try {
      const w = kertasStruk(l.ukuranKertas).kolom;
      const garis = "-".repeat(w);
      const nama = String(v.namausaha || "KASIRJET");
      const isi = [nama, garis, "TES CETAK STRUK", `Printer: ${tujuan}`, `Port: ${l.jnsPort} (${l.jnsPrinter})`, garis, "Printer struk siap dipakai."].join("\n");
      await api.cetakLangsung(l.jnsPort, tujuan, isi, true);
      toast.success(`Tes cetak sudah dikirim ke "${tujuan}".`);
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      setSibukUji(null);
    }
  };

  const tesBukaLaci = async () => {
    if (sibukUji) return;
    setSibukUji("laci");
    try {
      const tujuan = l.portDrawer.trim() || l.portPrinter.trim();
      const kode = l.kodeDrawer.trim() || KODE_DRAWER_BAWAAN;
      await api.bukaLaci(l.jnsPort, tujuan, kode);
      toast.success("Perintah buka laci sudah dikirim.");
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      setSibukUji(null);
    }
  };

  const bitChecked = (col: string, mask: number) => (Number(v[col]) & mask) !== 0;
  const setBit = (col: string, mask: number, on: boolean) =>
    set(col, on ? Number(v[col]) | mask : Number(v[col]) & ~mask);
  const chkChecked = (col: string) => Number(v[col]) === 1;
  const setChk = (col: string, on: boolean) => set(col, on ? 1 : 0);

  const CheckRow = (p: { vb: string; label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) => (
    <div data-vb={p.vb}>
      <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-foreground">
        <Checkbox checked={p.checked} disabled={p.disabled} onCheckedChange={(val) => p.onChange(!!val)} />
        <span>{p.label}</span>
      </Label>
    </div>
  );

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col justify-between bg-background p-3 font-sans text-xs text-foreground" data-form="FrmZPengaturan">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex gap-1 border-b border-border" data-vb="xTab">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              data-slot="tab-trigger"
              onClick={() => setTab(i)}
              className={`-mb-px rounded-t-md border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                i === tab
                  ? "border-border border-b-card bg-card text-primary"
                  : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="tp-scroll-always min-h-0 flex-1 rounded-b-md rounded-tr-md border border-t-0 border-border bg-card p-4">
          {tab === 0 && (
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2" data-vb="picTab(0)">
              <div className="flex flex-col gap-1 sm:col-span-2" data-vb="tNamaUsaha">
                <Label className="text-xs font-medium text-foreground">Nama Usaha</Label>
                <Input value={String(v.namausaha ?? "")} disabled={!bisaUbah} onChange={(e) => set("namausaha", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tBidangUsaha">
                <Label className="text-xs font-medium text-foreground">Bidang Usaha</Label>
                <Input value={String(v.bidangusaha ?? "")} disabled={!bisaUbah} onChange={(e) => set("bidangusaha", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tPemilik">
                <Label className="text-xs font-medium text-foreground">Nama Pemilik</Label>
                <Input value={String(v.pemilik ?? "")} disabled={!bisaUbah} onChange={(e) => set("pemilik", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2" data-vb="tAlamat">
                <Label className="text-xs font-medium text-foreground">Alamat</Label>
                <Input value={String(v.alamat ?? "")} disabled={!bisaUbah} onChange={(e) => set("alamat", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tKota">
                <Label className="text-xs font-medium text-foreground">Kota</Label>
                <Input value={String(v.kota ?? "")} disabled={!bisaUbah} onChange={(e) => set("kota", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1" data-vb="tProvinsi">
                  <Label className="text-xs font-medium text-foreground">Provinsi</Label>
                  <Input value={String(v.provinsi ?? "")} disabled={!bisaUbah} onChange={(e) => set("provinsi", e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex flex-col gap-1" data-vb="tKodePos">
                  <Label className="text-xs font-medium text-foreground">Kode Pos</Label>
                  <Input value={String(v.kodepos ?? "")} disabled={!bisaUbah} onChange={(e) => set("kodepos", e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="flex flex-col gap-1" data-vb="tNoTlp">
                <Label className="text-xs font-medium text-foreground">No. Telepon</Label>
                <Input value={String(v.tlp ?? "")} disabled={!bisaUbah} onChange={(e) => set("tlp", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tFax">
                <Label className="text-xs font-medium text-foreground">Fax</Label>
                <Input value={String(v.fax ?? "")} disabled={!bisaUbah} onChange={(e) => set("fax", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tEmail">
                <Label className="text-xs font-medium text-foreground">Email</Label>
                <Input value={String(v.email ?? "")} disabled={!bisaUbah} onChange={(e) => set("email", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tWeb">
                <Label className="text-xs font-medium text-foreground">Website</Label>
                <Input value={String(v.website ?? "")} disabled={!bisaUbah} onChange={(e) => set("website", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex flex-col gap-1" data-vb="tLogo">
                <Label className="text-xs font-medium text-foreground">File Logo</Label>
                <div className="flex gap-1">
                  <Input value={l.logo} onChange={(e) => setLocalVal("logo", e.target.value)} className="h-8 flex-1 text-xs" />
                  <Button type="button" variant="outline" size="sm" data-vb="cOpenLogo" title="Pilih file logo" aria-label="Pilih file logo" className="h-8 px-2" onClick={() => void pilihGbr("logo")()}>...</Button>
                </div>
              </div>
              <div className="flex flex-col gap-1" data-vb="tBackground">
                <Label className="text-xs font-medium text-foreground">File Background</Label>
                <div className="flex gap-1">
                  <Input value={l.background} onChange={(e) => setLocalVal("background", e.target.value)} className="h-8 flex-1 text-xs" />
                  <Button type="button" variant="outline" size="sm" data-vb="cOpenBG" title="Pilih file background" aria-label="Pilih file background" className="h-8 px-2" onClick={() => void pilihGbr("background")()}>...</Button>
                </div>
              </div>
              <div className="flex items-center justify-end pt-1 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="pengaturan-ukuran" className="text-xs font-medium text-foreground">Ukuran tampilan</Label>
                  <NativeSelect id="pengaturan-ukuran" data-vb="cmbUkuranTampilan" value={l.ukuranTampilan} onChange={(e) => setLocalVal("ukuranTampilan", e.target.value)} className="w-44"
                    title="Memperbesar huruf, tabel, dan tombol di semua layar komputer ini">
                    {UKURAN_TAMPILAN.map(([val, t]) => <NativeSelectOption key={val} value={val}>{t}</NativeSelectOption>)}
                  </NativeSelect>
                  <Label htmlFor="pengaturan-tema" className="ml-3 text-xs font-medium text-foreground">Tema</Label>
                  <NativeSelect id="pengaturan-tema" value={tema} onChange={(e) => setTema(e.target.value as Theme)} className="w-32">
                    {TEMA.map(([val, label]) => <NativeSelectOption key={val} value={val}>{label}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
              </div>
            </div>
          )}

          {tab === 1 && (
            <div className="flex flex-col gap-3" data-vb="picTab(1)">
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <CheckRow vb="chkAktifLogin" label="Aktifkan User Login saat masuk" checked={chkChecked("aktiflogin")} onChange={(on) => setChk("aktiflogin", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkUpdateharga" label="Update Harga Beli saat Pembelian" checked={bitChecked("updateharga", 1)} onChange={(on) => setBit("updateharga", 1, on)} disabled={!bisaUbah} />
                <CheckRow vb="chkAktifPromo" label="Aktifkan Promo Penjualan" checked={chkChecked("aktifpromo")} onChange={(on) => setChk("aktifpromo", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkUpdatehargaJual" label="Update Harga Jual dari margin saat Pembelian" checked={bitChecked("updateharga", 2)} onChange={(on) => setBit("updateharga", 2, on)} disabled={!bisaUbah} />
                <CheckRow vb="chkAktifLevel" label="Aktifkan Harga Level Pelanggan" checked={chkChecked("aktiflevel")} onChange={(on) => setChk("aktiflevel", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkIzinHrg" label="Izinkan Kasir mengubah Harga Jual" checked={chkChecked("izinharga")} onChange={(on) => setChk("izinharga", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkAktifSatuan" label="Aktifkan Multi Satuan Barang" checked={chkChecked("aktifsatuan")} onChange={(on) => setChk("aktifsatuan", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkIzinDiskon" label="Izinkan Kasir mengisi Diskon" checked={chkChecked("izindiskon")} onChange={(on) => setChk("izindiskon", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkIzinStokMinus" label="Izinkan Stok Minus saat Penjualan" checked={chkChecked("izinstokmin")} onChange={(on) => setChk("izinstokmin", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkHubungkanKas" label="Hubungkan Semua Transaksi dengan Kas" checked={chkChecked("aktiftranskas")} onChange={(on) => setChk("aktiftranskas", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkKonfirmasiKredit" label="Konfirmasi saat Batas Kredit terlampaui" checked={chkChecked("konfirmasikredit")} onChange={(on) => setChk("konfirmasikredit", on)} disabled={!bisaUbah} />
                <CheckRow vb="chkDefaultJmlByr" label="Isi otomatis Jml. Bayar = Total Transaksi" checked={l.defaultJmlByr === "1"} onChange={(on) => setLocalVal("defaultJmlByr", on ? "1" : "0")} />
                <CheckRow vb="chkAutoLoad" label="Tampilkan semua data saat membuka Master Data" checked={l.autoLoad === "1"} onChange={(on) => setLocalVal("autoLoad", on ? "1" : "0")} />
                <CheckRow vb="chkKursor" label="Arahkan kursor ke kolom Jumlah setelah scan" checked={l.kursor === "1"} onChange={(on) => setLocalVal("kursor", on ? "1" : "0")} />
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-border pt-2.5 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2.5">
                  <CheckRow vb="chkAktifPoin" label="Aktifkan Poin Member" checked={chkChecked("aktifpoin")} onChange={(on) => setChk("aktifpoin", on)} disabled={!bisaUbah} />
                  <CheckRow vb="chkAktifPoinTrans" label="Hitung Poin dari Total Transaksi" checked={chkChecked("aktiftranspoin")} onChange={(on) => setChk("aktiftranspoin", on)} disabled={!bisaUbah} />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1" data-vb="tMinTransPoin">
                      <Label className="text-[11px] text-muted-foreground">Min. Transaksi Poin</Label>
                      <Input value={String(v.mintranspoin ?? "")} disabled={!bisaUbah} onChange={(e) => set("mintranspoin", e.target.value)} className="h-8 text-right text-xs tabular-nums" />
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tJmlPoin">
                      <Label className="text-[11px] text-muted-foreground">Jml. Poin Didapat</Label>
                      <Input value={String(v.jmlpointrans ?? "")} disabled={!bisaUbah} onChange={(e) => set("jmlpointrans", e.target.value)} className="h-8 text-right text-xs tabular-nums" />
                    </div>
                  </div>
                  <CheckRow vb="chkBerlakuKelipatan" label="Berlaku kelipatan total belanja" checked={chkChecked("berlakukelipatanpoin")} onChange={(on) => setChk("berlakukelipatanpoin", on)} disabled={!bisaUbah} />
                </div>

                <div className="flex flex-col justify-between gap-2 rounded-md border border-border bg-muted/30 p-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1" data-vb="tJthTempo">
                      <Label className="text-[11px] text-muted-foreground">Tempo Piutang (Hari)</Label>
                      <Input value={String(v.tempopiutang ?? "")} disabled={!bisaUbah} onChange={(e) => set("tempopiutang", e.target.value.replace(/\D/g, ""))} className="h-8 text-right text-xs tabular-nums" />
                    </div>
                    <div className="flex flex-col gap-1" data-vb="cmbModeScan">
                      <Label className="text-[11px] text-muted-foreground">Mode Scan Barcode</Label>
                      <NativeSelect value={l.modeScan} onChange={(e) => setLocalVal("modeScan", e.target.value)} className="w-full">
                        {MODE_SCAN.map((x, i) => <NativeSelectOption key={x} value={String(i)}>{x}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1" data-vb="cmbHome">
                    <Label className="text-[11px] text-muted-foreground">Pilihan Home Screen</Label>
                    <NativeSelect value={l.home} onChange={(e) => setLocalVal("home", e.target.value)} className="w-full">
                      {HOME.map(([val, t]) => <NativeSelectOption key={val} value={val}>{t}</NativeSelectOption>)}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1">
                    <CheckRow vb="chkAktifFoto" label="Tampilkan Foto Barang" checked={l.aktifFoto === "1"} onChange={(on) => setLocalVal("aktifFoto", on ? "1" : "0")} />
                    <div className="flex gap-1" data-vb="tLokasiFoto">
                      <Input value={l.lokasiFoto} onChange={(e) => setLocalVal("lokasiFoto", e.target.value)} placeholder="Folder foto barang" className="h-8 flex-1 text-xs" />
                      <Button type="button" variant="outline" size="sm" data-vb="cOpenFoto" title="Pilih folder foto barang" aria-label="Pilih folder foto barang" className="h-8 px-2" onClick={() => void pilihFolderFoto()}>...</Button>
                    </div>
                  </div>
                  {bisaUbah && (
                    <div className="flex justify-end pt-1">
                      <Button type="button" variant="outline" size="sm" className="h-8 bg-background text-xs font-medium" onClick={() => go("nontunai")}>
                        Jenis Non Tunai
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div className="flex flex-col gap-3" data-vb="picTab(2)">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="flex flex-col gap-1" data-vb="tHeader1">
                  <Label className="text-xs font-medium text-foreground">Header Struk Baris 1</Label>
                  <Input value={String(v.header1 ?? "")} disabled={!bisaUbah} onChange={(e) => set("header1", e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex flex-col gap-1" data-vb="tHeader2">
                  <Label className="text-xs font-medium text-foreground">Header Struk Baris 2</Label>
                  <Input value={String(v.header2 ?? "")} disabled={!bisaUbah} onChange={(e) => set("header2", e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex flex-col gap-1" data-vb="tFooter1">
                  <Label className="text-xs font-medium text-foreground">Footer Struk Baris 1</Label>
                  <Input value={String(v.footer1 ?? "")} disabled={!bisaUbah} onChange={(e) => set("footer1", e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="flex flex-col gap-1" data-vb="tFooter2">
                  <Label className="text-xs font-medium text-foreground">Footer Struk Baris 2</Label>
                  <Input value={String(v.footer2 ?? "")} disabled={!bisaUbah} onChange={(e) => set("footer2", e.target.value)} className="h-8 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 border-t border-border pt-2.5 sm:grid-cols-4">
                <div className="flex flex-col gap-1" data-vb="cUkuranKertas">
                  <Label className="text-xs font-medium text-foreground">Ukuran Kertas</Label>
                  <NativeSelect value={l.ukuranKertas} onChange={(e) => setLocalVal("ukuranKertas", e.target.value)} className="w-full">
                    {UKURAN_KERTAS.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1" data-vb="cJnsPrinter">
                  <Label className="text-xs font-medium text-foreground">Jenis Printer</Label>
                  <NativeSelect value={l.jnsPrinter} onChange={(e) => setLocalVal("jnsPrinter", e.target.value)} className="w-full">
                    {JENIS_PRINTER.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1" data-vb="cJnsPort">
                  <Label className="text-xs font-medium text-foreground">Jenis Port</Label>
                  <NativeSelect value={l.jnsPort} onChange={(e) => setLocalVal("jnsPort", e.target.value)} className="w-full">
                    {JENIS_PORT.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1" data-vb="tPortPrinter">
                  <Label className="text-xs font-medium text-foreground">Nama / Port Printer</Label>
                  <Input value={l.portPrinter} list="daftar-printer-sistem" placeholder="Nama printer Windows / LPT1" onChange={(e) => setLocalVal("portPrinter", e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <datalist id="daftar-printer-sistem">
                {printers.map((p) => <option key={p} value={p} />)}
              </datalist>

              <div className="grid grid-cols-1 gap-3 border-t border-border pt-2.5 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2.5">
                  <CheckRow vb="chkKonfirmasiCetak" label="Tampilkan konfirmasi sebelum mencetak struk" checked={l.konfirmasiCetak === "1"} onChange={(on) => setLocalVal("konfirmasiCetak", on ? "1" : "0")} />
                  <CheckRow vb="chkDrawer" label="Aktifkan Cash Drawer (Laci Kasir)" checked={l.drawer === "1"} onChange={(on) => setLocalVal("drawer", on ? "1" : "0")} />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1" data-vb="tPortDrawer">
                      <Label className="text-[11px] text-muted-foreground">Port Drawer</Label>
                      <Input value={l.portDrawer} list="daftar-printer-sistem" placeholder="Kosong = ikut printer struk" onChange={(e) => setLocalVal("portDrawer", e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tKodeDrawer">
                      <Label className="text-[11px] text-muted-foreground">Kode Drawer</Label>
                      <Input value={l.kodeDrawer} placeholder={KODE_DRAWER_BAWAAN} onChange={(e) => setLocalVal("kodeDrawer", e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Button type="button" variant="outline" size="sm" className="h-7 bg-background px-2.5 text-xs" disabled={sibukUji !== null} onClick={() => void tesCetak()}>
                      {sibukUji === "cetak" ? "Mengirim..." : "Tes Cetak"}
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 bg-background px-2.5 text-xs" disabled={sibukUji !== null} onClick={() => void tesBukaLaci()}>
                      {sibukUji === "laci" ? "Membuka..." : "Tes Buka Laci"}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2.5">
                  <div className="grid grid-cols-3 items-end gap-2">
                    <div className="flex flex-col gap-1" data-vb="cbFormatQty">
                      <Label className="text-[11px] text-muted-foreground">Format Qty</Label>
                      <NativeSelect value={l.formatQty} onChange={(e) => setLocalVal("formatQty", e.target.value)} className="w-full">
                        {FORMAT_QTY.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tExQty">
                      <Label className="text-[11px] text-muted-foreground">Contoh</Label>
                      <Input value={exQty} onChange={(e) => setExQty(e.target.value.replace(/[^\d,.]/g, ""))} className="h-8 text-right text-xs tabular-nums" />
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tExQty2">
                      <Label className="text-[11px] text-muted-foreground">Hasil</Label>
                      <Input readOnly value={formatPola(l.formatQty, angkaContoh(exQty))} className="h-8 bg-muted text-right text-xs tabular-nums" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 items-end gap-2">
                    <div className="flex flex-col gap-1" data-vb="cbFormatHrg">
                      <Label className="text-[11px] text-muted-foreground">Format Harga</Label>
                      <NativeSelect value={l.formatHrg} onChange={(e) => setLocalVal("formatHrg", e.target.value)} className="w-full">
                        {FORMAT_HRG.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
                      </NativeSelect>
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tExHrg">
                      <Label className="text-[11px] text-muted-foreground">Contoh</Label>
                      <Input value={exHrg} onChange={(e) => setExHrg(e.target.value.replace(/[^\d,.]/g, ""))} className="h-8 text-right text-xs tabular-nums" />
                    </div>
                    <div className="flex flex-col gap-1" data-vb="tExHrg2">
                      <Label className="text-[11px] text-muted-foreground">Hasil</Label>
                      <Input readOnly value={formatPola(l.formatHrg, angkaContoh(exHrg))} className="h-8 bg-muted text-right text-xs tabular-nums" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2" data-vb="Picture1">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive" onClick={batal}>
            Batal
          </Button>
          <Button type="button" variant="outline" size="default" className="h-8 px-3 text-xs font-medium" onClick={() => setProfil(true)}>
            Profil Pengguna
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 px-4 text-xs font-semibold" onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>

      {msg.node}
      {mulaiUlang && (
        <ModalFrame title="KasirJet" onClose={() => window.location.reload()} width={380}>
          <div className="flex flex-col gap-3 p-4 text-sm">
            <p>Pengaturan tersimpan.</p>
            <p>Aplikasi akan dimuat ulang supaya pengaturan baru berlaku.</p>
            <div className="flex justify-end">
              <Button type="button" className="min-w-20" autoFocus onClick={() => window.location.reload()}>Muat Ulang</Button>
            </div>
          </div>
        </ModalFrame>
      )}
      {profil && <Profil onClose={() => setProfil(false)} />}
    </div>
  );
}

/** FrmZEditProfil: kode, nama, nama user, dan kata sandi akun yang sedang masuk. */
function Profil({ onClose }: { onClose: () => void }) {
  const { user } = useApp();
  const msg = useMsgBox();
  const [sandi, setSandi] = useState("");

  const simpan = async () => {
    if (!sandi) return msg.alert("Kata sandi baru belum diisi.");
    try {
      await api.changePassword("", sandi);
      setSandi("");
      msg.alert("Kata sandi Anda sudah diganti.");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  return (
    <ModalFrame title="Profil Pengguna" width={400} onClose={onClose}>
      <div className="flex flex-col gap-3.5 p-4 font-sans text-xs text-foreground" data-form="FrmZEditProfil">
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-2.5">
          <div>
            <div className="text-[11px] text-muted-foreground">Kode Karyawan</div>
            <div className="font-semibold text-foreground" data-vb="lblKode">{user.kodekaryawan || "-"}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Nama Karyawan</div>
            <div className="font-semibold text-foreground" data-vb="lblNama">{user.namakaryawan || "-"}</div>
          </div>
        </div>
        <div className="flex flex-col gap-1" data-vb="tNamaUser">
          <Label className="text-xs font-medium text-foreground">Nama Pengguna</Label>
          <Input readOnly value={user.iduser} className="h-8 bg-muted text-xs" />
        </div>
        <div className="flex flex-col gap-1" data-vb="tSandi">
          <Label className="text-xs font-medium text-foreground">Kata Sandi Baru</Label>
          <div className="flex gap-1.5">
            <Input
              type="password"
              value={sandi}
              autoComplete="new-password"
              placeholder="Ketik kata sandi baru"
              onChange={(e) => setSandi(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void simpan()}
              className="h-8 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="default"
              data-vb="cCek"
              className="h-8 px-2.5 text-xs"
              title="Kenapa kata sandi tidak terlihat?"
              aria-label="Kenapa kata sandi tidak terlihat?"
              onClick={() => msg.alert("Kata sandi Anda disimpan dalam bentuk terenkripsi, jadi tidak bisa ditampilkan. Kalau lupa, isi kata sandi baru lalu simpan.")}
            >
              <CircleHelpIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 px-3 text-xs font-medium" onClick={onClose}>
            Tutup
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 px-4 text-xs font-semibold" onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>
      {msg.node}
    </ModalFrame>
  );
}
