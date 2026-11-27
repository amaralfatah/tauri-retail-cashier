import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { errText, Row } from "../api";
import { pilihBackup, pilihFolder } from "../api/dialog";
import { alatApi, dbApi, FileBackup, folderBackup, HasilSql, imporApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { GridCol, ModalFrame, useMsgBox, VbGrid } from "../vb/VbGrid";
import { ImporExcel } from "./ImporExcel";
import { PindahLama } from "./PindahLama";
import { Checklist } from "./keuanganLib";
import { KunciPusat, useKunciPusat } from "../components/KunciPusat";
import { KomputerPusat } from "./KomputerPusat";

const TABS = ["Backup Data", "Restore Data", "Hapus Data", "Import Data", "SQL Editor", "Perbaiki Data", "Hapus Transaksi", "Komputer Pusat"];
/** Tab yang hanya bisa dipakai di komputer Pusat (perintahnya "Khusus Pusat"): terkunci di komputer kasir. */
const TAB_KHUSUS_PUSAT = new Set([0, 1, 3, 4, 5]);
/** Tab yang bisa menghapus atau mengubah data: ditaruh terpisah di kanan dan berwarna merah. */
const TAB_BAHAYA = new Set([2, 4, 6]);
const URUT_TAB = [...TABS.keys()].filter((i) => !TAB_BAHAYA.has(i)).concat([...TABS.keys()].filter((i) => TAB_BAHAYA.has(i)));
const BERDASAR_TANGGAL = new Set(["jual", "beli", "opname", "stokawal", "piutang", "hutang", "kas"]);
const JENIS_TRANS: [string, string][] = [
  ["Penjualan", "Penjualan"],
  ["Retur Penjualan", "Retur Penjualan"],
  ["Pelunasan Piutang Customer", "Pelunasan Piutang Pelanggan"],
  ["Pembelian", "Pembelian"],
  ["Retur Pembelian", "Retur Pembelian"],
  ["Pelunasan Hutang Supplier", "Pelunasan Hutang Supplier"],
];
const kunciTrans = (r: Row) => String(r.kunci ?? r.notrans);
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("id-ID")} KB`;

export function Alat() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [tab, setTab] = useState(0);
  const [lokasi, setLokasi] = useState("");
  const [folder, setFolder] = useState("");
  const [fileRestore, setFileRestore] = useState("");
  const [daftarBackup, setDaftarBackup] = useState<FileBackup[] | null>(null);
  const [itemHapus, setItemHapus] = useState<{ kunci: string; nama: string }[]>([]);
  const [hapusPick, setHapusPick] = useState<Set<string>>(new Set());
  const [semuaHapus, setSemuaHapus] = useState(false);
  const [periode, setPeriode] = useState<{ dari: string; sampai: string } | null>(null);
  const [jenisImpor, setJenisImpor] = useState<{ kunci: string; nama: string }[]>([]);
  const [imporPick, setImporPick] = useState<string>("");
  const [impor, setImpor] = useState(false);
  const [sql, setSql] = useState("");
  const [hasilSql, setHasilSql] = useState<HasilSql | null>(null);
  const [jenisTrans, setJenisTrans] = useState("Penjualan");
  const [noTrans, setNoTrans] = useState("");
  const [tgl1, setTgl1] = useState(today());
  const [tgl2, setTgl2] = useState(today());
  const [trans, setTrans] = useState<Row[]>([]);
  const [transPick, setTransPick] = useState<Set<string>>(new Set());
  const [transSel, setTransSel] = useState<string | null>(null);
  const [backupSel, setBackupSel] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pindahLama, setPindahLama] = useState(false);
  const kunci = useKunciPusat();

  useEffect(() => {
    dbApi.info().then((i) => { setLokasi(i?.path ?? ""); setFolder(folderBackup.get() || i?.folder_backup || ""); }).catch((e) => msg.alert(errText(e)));
    alatApi.itemHapus().then((l) => setItemHapus(Array.isArray(l) ? l : [])).catch(() => undefined);
    imporApi.jenis().then((j) => { const list = Array.isArray(j) ? j : []; setJenisImpor(list); setImporPick(list[0]?.kunci ?? ""); }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Jalankan tindakan dan tampilkan hasilnya; kesalahan jadi pesan biasa. */
  const jalan = async (f: () => Promise<string>) => {
    setSibuk(true);
    try { msg.alert(await f()); } catch (e) { msg.alert(errText(e)); } finally { setSibuk(false); }
  };
  const fld = folder.trim() || undefined;

  // Esc menutup layar ini. Dialog yang sedang terbuka menangkap Esc lebih dulu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sibuk) { e.preventDefault(); go("home"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---- Backup ---- */
  const pilihFolderBackup = async () => {
    const p = await pilihFolder();
    if (p) setFolder(p);
  };
  const pilihFileRestore = async () => {
    const p = await pilihBackup();
    if (p) { setFileRestore(p); setDaftarBackup(null); }
  };
  const backup = () => jalan(async () => {
    const r = await dbApi.backup(fld);
    folderBackup.set(folder);
    return `Backup berhasil. File tersimpan di ${r.path} (${kb(r.ukuran)}).`;
  });
  const periksaData = () => jalan(async () => {
    const r = await dbApi.cek(true);
    return r.ok ? "Data Anda dalam keadaan baik. Tidak ada data yang rusak." : `Ditemukan masalah di data: ${r.masalah.slice(0, 3).join("; ")}. Klik Perbaiki Data untuk memperbaikinya.`;
  });
  const perbaiki = () => msg.confirm("Kasir Jet akan membuat cadangan dulu, lalu merapikan dan memperbaiki indeks data. Lanjutkan?", () => void jalan(async () => {
    const r = await dbApi.perbaiki(fld);
    return `Perbaikan selesai. Cadangan sebelum perbaikan ada di ${r.cadangan}.`;
  }), undefined, undefined, "Ya, perbaiki");

  /* ---- Restore ---- */
  const bukaDaftar = async () => {
    try { setDaftarBackup(await dbApi.daftarBackup(fld)); } catch (e) { msg.alert(errText(e)); }
  };
  const restore = () => {
    if (!fileRestore.trim()) return msg.alert("Pilih dulu file backup yang akan dipulihkan.");
    msg.confirm("Data Anda saat ini akan diganti dengan isi file backup ini. Kasir Jet akan membuat cadangan data sekarang dulu. Lanjutkan?", () => void jalan(async () => {
      const r = await dbApi.restore(fileRestore.trim(), fld);
      setTimeout(() => window.location.reload(), 2500);
      return `Data sudah dipulihkan. Cadangan data sebelumnya disimpan di ${r.cadangan}. Aplikasi akan dimuat ulang, silakan masuk lagi.`;
    }), undefined, undefined, "Ya, pulihkan");
  };

  /* ---- Hapus data ---- */
  const toggleHapus = (k: string) => setHapusPick((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const hapusData = (rentang: { dari: string; sampai: string } | null) => {
    const pilih = itemHapus.filter((i) => hapusPick.has(i.kunci));
    const ada = pilih.some((i) => i.kunci === "jual" || i.kunci === "beli" || i.kunci === "opname" || i.kunci === "stokawal");
    msg.confirm(
      `Data yang akan dihapus: ${pilih.map((i) => i.nama).join(", ")}.${rentang ? ` Periode ${tglID(rentang.dari)} sampai ${tglID(rentang.sampai)}.` : ""} ` +
      `${ada ? "Stok barang dihitung ulang dari transaksi yang masih ada. " : ""}Data yang dihapus tidak bisa dikembalikan, tetapi Kasir Jet membuat cadangan dulu. Lanjutkan?`,
      () => void jalan(async () => {
        const r = await alatApi.hapusData([...hapusPick], rentang?.dari ?? "", rentang?.sampai ?? "", fld);
        setHapusPick(new Set());
        setSemuaHapus(false);
        return `Data sudah dihapus. Cadangan sebelum menghapus ada di ${r.cadangan}.`;
      }),
      undefined, undefined, "Ya, hapus",
    );
  };
  const klikHapus = () => {
    if (!hapusPick.size) return msg.alert("Data yang akan dihapus belum dipilih.");
    if ([...hapusPick].some((k) => BERDASAR_TANGGAL.has(k))) setPeriode({ dari: today(), sampai: today() });
    else hapusData(null);
  };

  /* ---- SQL ---- */
  const prosesSql = () => {
    const q = sql.trim();
    if (!q) return msg.alert("Perintah SQL belum diisi.");
    const jalanSql = () => void jalan(async () => {
      const r = await alatApi.sql(q, fld);
      if (r.kolom.length) { setHasilSql(r); return `Perintah sudah dijalankan: ${r.baris.length} baris${r.terpotong ? " (hanya 500 baris pertama)" : ""}.`; }
      return "Perintah sudah dijalankan.";
    });
    if (/^\s*(select|with|explain|pragma)/i.test(q)) jalanSql();
    else msg.confirm("Perintah ini akan mengubah data Anda. Kasir Jet membuat cadangan dulu. Lanjutkan?", jalanSql, undefined, undefined, "Ya, jalankan");
  };

  /* ---- Repair ---- */
  const hitungStok = () => msg.confirm("Kasir Jet akan menghitung ulang stok akhir semua barang. Lanjutkan?", () => void jalan(async () => {
    const r = await alatApi.hitungStok();
    return `Stok akhir sudah dihitung ulang. ${r.berubah} barang stoknya berubah.`;
  }));
  const sinkronHarga = () => msg.confirm("Harga beli di penjualan yang kosong atau lebih besar dari harga jual akan diganti dengan harga beli di data barang. Lanjutkan?", () => void jalan(async () => {
    const r = await alatApi.sinkronHargaBeli(fld);
    return `Harga beli sudah diperbaiki. ${r.berubah} baris transaksi diperbarui.`;
  }));
  const sinkronJual = () => msg.confirm("Kasir Jet akan menghapus transaksi penjualan yang tidak punya barang, beserta kas dan piutangnya, serta membuat cadangan dulu. Lanjutkan?", () => void jalan(async () => {
    const r = await alatApi.sinkronJual(fld);
    return `Selesai. ${r.dihapus} transaksi penjualan tanpa barang sudah dihapus.`;
  }), undefined, undefined, "Ya, hapus");

  /* ---- Hapus transaksi ---- */
  const tampil = async () => {
    try { setTrans(await alatApi.daftarTransaksi(jenisTrans, noTrans, tgl1, tgl2)); setTransPick(new Set()); } catch (e) { msg.alert(errText(e)); }
  };
  const hapusTrans = () => {
    if (!transPick.size) return msg.alert("Pilih dulu transaksi yang akan dihapus.");
    const retur = jenisTrans.startsWith("Retur");
    const lunas = jenisTrans.startsWith("Pelunasan");
    const akibat = retur
      ? "Stok barang dikembalikan, jumlah retur di transaksi asalnya dikurangi, dan piutang atau hutang yang tadinya dipotong kembali terbuka. Uang retur di kas ikut dihapus."
      : lunas
        ? "Tagihan yang tadinya lunas kembali terbuka sebesar pembayaran itu, dan uang pelunasan di kas ikut dihapus."
        : "Kartu piutang, stok, dan data keuangan yang terkait ikut terhapus.";
    msg.confirm(`Anda akan menghapus ${lunas ? "data pelunasan" : "data transaksi"}. ${akibat} ${transPick.size} ${lunas ? "pembayaran" : "transaksi"} dipilih. Data yang dihapus tidak bisa dikembalikan, tetapi Kasir Jet membuat cadangan dulu.`, () => void jalan(async () => {
      const r = await alatApi.hapusTransaksi([...transPick], fld);
      await tampil();
      return `Data transaksi sudah dihapus (${r.dihapus} transaksi). Cadangan sebelum menghapus ada di ${r.cadangan}.`;
    }), undefined, undefined, "Ya, hapus");
  };
  const kolTrans: GridCol<Row>[] = useMemo(() => [
    {
      title: "", width: 32, align: "center",
      render: (r) => (
        <Checkbox
          checked={transPick.has(kunciTrans(r))}
          onCheckedChange={() => setTransPick((p) => { const n = new Set(p); const k = kunciTrans(r); n.has(k) ? n.delete(k) : n.add(k); return n; })}
        />
      ),
    },
    { title: jenisTrans.startsWith("Pelunasan") ? "No. Kartu" : "No. Transaksi", width: 115, render: (r) => r.notrans },
    { title: "Tanggal", width: 85, render: (r) => tglID(r.tgltrans) },
    { title: "No. Ref", width: 95, render: (r) => r.noref },
    { title: "Nama", width: 200, render: (r) => r.namakontak ?? r.kodekontak },
    { title: jenisTrans.startsWith("Pelunasan") ? "Jml. Bayar" : "Total Trans", width: 105, align: "right", render: (r) => rp(r.totaltrans) },
  ], [transPick, jenisTrans]);

  const jenisNama = jenisImpor.find((j) => j.kunci === imporPick)?.nama ?? "";

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col justify-between bg-background p-3 font-sans text-xs text-foreground" data-form="FrmZAlat">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap gap-1 border-b border-border" data-vb="xTab">
          {URUT_TAB.map((i) => {
            const t = TABS[i];
            const bahaya = TAB_BAHAYA.has(i);
            return (
            <button
              key={t}
              type="button"
              data-slot="tab-trigger"
              onClick={() => setTab(i)}
              className={`-mb-px rounded-t-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                bahaya && i === URUT_TAB.find((x) => TAB_BAHAYA.has(x)) ? "ml-auto " : ""
              }${
                i === tab
                  ? `border-border border-b-card bg-card ${bahaya ? "text-destructive" : "text-primary"}`
                  : `border-transparent bg-muted/60 hover:bg-muted ${bahaya ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`
              }`}
            >
              {t}
            </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-b-md rounded-tr-md border border-t-0 border-border bg-card p-4">
          {kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab) && <KunciPusat />}
          {tab === 7 && <KomputerPusat />}
          {!(kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab)) && tab === 0 && (
            <div className="flex flex-col gap-3.5" data-vb="picTab(0)">
              <div className="flex flex-col gap-1.5" data-vb="tLokasiData">
                <Label className="text-xs font-medium text-foreground">Lokasi Database</Label>
                <Input readOnly value={lokasi} className="h-8 bg-muted font-mono text-xs" />
              </div>
              <div className="flex flex-col gap-1.5" data-vb="tLokasiBackup">
                <Label className="text-xs font-medium text-foreground">Lokasi Backup</Label>
                <div className="flex gap-1.5">
                  <Input value={folder} onChange={(e) => setFolder(e.target.value)} className="h-8 flex-1 font-mono text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    data-vb="cOpenFolderBackup"
                    className="h-8 px-2.5 text-xs"
                    title="Pilih lokasi folder backup"
                    aria-label="Pilih lokasi folder backup"
                    onClick={() => void pilihFolderBackup()}
                  >
                    ...
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" variant="default" size="default" data-vb="cBackup" className="h-8 px-4 text-xs font-semibold" onClick={() => void backup()}>
                  Backup
                </Button>
                <Button type="button" variant="outline" size="default" data-vb="cCekCorrupt" className="h-8 px-3 text-xs font-medium" onClick={() => void periksaData()}>
                  Periksa Kerusakan Data
                </Button>
                <Button type="button" variant="outline" size="default" data-vb="cRepair" className="h-8 px-3 text-xs font-medium" onClick={perbaiki}>
                  Perbaiki Data
                </Button>
              </div>
            </div>
          )}

          {!(kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab)) && tab === 1 && (
            <div className="flex flex-col gap-3.5" data-vb="picTab(1)">
              <div className="flex flex-col gap-1.5" data-vb="tLokasiDataRestore">
                <Label className="text-xs font-medium text-foreground">Lokasi Database</Label>
                <Input readOnly value={lokasi} className="h-8 bg-muted font-mono text-xs" />
              </div>
              <div className="flex flex-col gap-1.5" data-vb="tFileBackup">
                <Label className="text-xs font-medium text-foreground">File Backup yang Akan Dipulihkan</Label>
                <div className="flex gap-1.5">
                  <Input value={fileRestore} onChange={(e) => setFileRestore(e.target.value)} placeholder="Pilih file backup..." className="h-8 flex-1 font-mono text-xs" />
                  <Button type="button" variant="outline" size="default" data-vb="cOpenBackup" className="h-8 px-2.5 text-xs" title="Pilih file backup" aria-label="Pilih file backup" onClick={() => void bukaDaftar()}>
                    ...
                  </Button>
                </div>
              </div>
              <div className="pt-1">
                <Button type="button" variant="default" size="default" data-vb="cRestore" className="h-8 px-4 text-xs font-semibold" onClick={restore}>
                  Restore Data
                </Button>
              </div>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3.5">
                <p className="text-xs text-foreground">Dulu memakai Toko Pro versi lama? Anda bisa memindahkan datanya ke sini.</p>
                <div>
                  <Button type="button" variant="outline" size="default" className="h-8 px-3 text-xs font-medium" onClick={() => setPindahLama(true)}>
                    Ambil dari Toko Pro Lama…
                  </Button>
                </div>
              </div>
            </div>
          )}

          {tab === 2 && (
            <div className="flex h-full flex-col gap-3" data-vb="picTab(2)">
              <div className="min-h-0 flex-1" data-vb="lsHapus">
                <Checklist items={itemHapus} picked={hapusPick} onToggle={toggleHapus} />
              </div>
              <div className="flex items-center justify-between pt-1">
                <div data-vb="cPilihSemua">
                  <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-foreground">
                    <Checkbox
                      checked={semuaHapus}
                      onCheckedChange={(v) => {
                        const on = !!v;
                        setSemuaHapus(on);
                        setHapusPick(on ? new Set(itemHapus.map((i) => i.kunci)) : new Set());
                      }}
                    />
                    <span>Pilih Semua</span>
                  </Label>
                </div>
                <Button type="button" variant="destructive" size="default" data-vb="cHapus" className="h-8 px-4 text-xs font-semibold" onClick={klikHapus}>
                  Hapus Data
                </Button>
              </div>
            </div>
          )}

          {!(kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab)) && tab === 3 && (
            <div className="flex h-full flex-col gap-3" data-vb="picTab(3)">
              <div className="min-h-0 flex-1" data-vb="lsImport">
                <Checklist radio items={jenisImpor} picked={new Set([imporPick])} onToggle={setImporPick} />
              </div>
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  variant="default"
                  size="default"
                  data-vb="cImport"
                  className="h-8 px-4 text-xs font-semibold"
                  onClick={() => (imporPick ? setImpor(true) : msg.alert("Pilih dulu data yang akan diimpor."))}
                >
                  Import Data Excel
                </Button>
              </div>
            </div>
          )}

          {!(kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab)) && tab === 4 && (
            <div className="flex h-full flex-col gap-3" data-vb="picTab(4)">
              <div className="min-h-0 flex-1" data-vb="tSQL">
                <Textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  placeholder="Ketik perintah SQL (mis. SELECT * FROM mdbarang LIMIT 20)..."
                  className="h-full min-h-48 resize-none font-mono text-xs"
                />
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="default" size="default" data-vb="cProsesSQL" className="h-8 px-4 text-xs font-semibold" onClick={prosesSql}>
                  Proses SQL
                </Button>
              </div>
            </div>
          )}

          {!(kunci.terkunci && TAB_KHUSUS_PUSAT.has(tab)) && tab === 5 && (
            <div className="flex flex-col gap-3" data-vb="picTab(5)">
              <p className="text-xs text-muted-foreground">
                Pakai alat di bawah ini kalau stok akhir tidak cocok atau harga pokok di laporan laba rugi terlihat janggal.
              </p>
              <div className="flex flex-col gap-2 sm:max-w-sm">
                <Button type="button" variant="outline" size="default" data-vb="cHitungUlangStok" className="h-9 justify-start px-3.5 text-xs font-medium" onClick={hitungStok}>
                  Hitung Ulang Stok Akhir Barang
                </Button>
                <Button type="button" variant="outline" size="default" data-vb="cRepairLaba" className="h-9 justify-start px-3.5 text-xs font-medium" onClick={sinkronHarga}>
                  Perbaiki Harga Beli di Penjualan
                </Button>
                <Button type="button" variant="outline" size="default" data-vb="cSinkronJual" className="h-9 justify-start px-3.5 text-xs font-medium" onClick={sinkronJual}>
                  Hapus Transaksi Penjualan Tanpa Barang
                </Button>
              </div>
            </div>
          )}

          {tab === 6 && (
            <div className="flex h-full flex-col gap-2.5" data-vb="picTab(6)">
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1.2fr_1fr_auto]">
                <div className="flex flex-col gap-1" data-vb="cmbJenisTrans">
                  <Label className="text-xs font-medium text-foreground">Jenis Transaksi</Label>
                  <NativeSelect
                    value={jenisTrans}
                    onChange={(e) => { setJenisTrans(e.target.value); setTrans([]); setTransPick(new Set()); }}
                    className="w-full"
                  >
                    {JENIS_TRANS.map(([v, label]) => <NativeSelectOption key={v} value={v}>{label}</NativeSelectOption>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1" data-vb="tNoTrans">
                  <Label className="text-xs font-medium text-foreground">No. Transaksi</Label>
                  <Input value={noTrans} onChange={(e) => setNoTrans(e.target.value)} placeholder="Semua nomor" className="h-7 text-xs" />
                </div>
                <div className="flex items-end gap-1.5">
                  <div className="flex flex-col gap-1" data-vb="dtTgl1">
                    <Label className="text-xs font-medium text-foreground">Dari</Label>
                    <Input type="date" value={tgl1} onChange={(e) => e.target.value && setTgl1(e.target.value)} className="h-7 w-32 text-xs tabular-nums" />
                  </div>
                  <div className="flex flex-col gap-1" data-vb="dtTgl2">
                    <Label className="text-xs font-medium text-foreground">Sampai</Label>
                    <Input type="date" value={tgl2} onChange={(e) => e.target.value && setTgl2(e.target.value)} className="h-7 w-32 text-xs tabular-nums" />
                  </div>
                  <Button type="button" variant="outline" size="sm" data-vb="cTampil" className="h-7 px-3 text-xs font-medium" onClick={() => void tampil()}>
                    Tampilkan
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1" data-vb="lsData">
                <VbGrid
                  cols={kolTrans}
                  rows={trans}
                  rowKey={kunciTrans}
                  selected={transSel}
                  onSelect={setTransSel}
                  onOpen={(r) => setTransPick((p) => { const n = new Set(p); const k = kunciTrans(r); n.has(k) ? n.delete(k) : n.add(k); return n; })}
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div data-vb="chkPilih">
                  <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-foreground">
                    <Checkbox
                      checked={trans.length > 0 && transPick.size === trans.length}
                      onCheckedChange={(v) => setTransPick(v ? new Set(trans.map(kunciTrans)) : new Set())}
                    />
                    <span>Pilih Semua ({transPick.size} dipilih)</span>
                  </Label>
                </div>
                <Button type="button" variant="destructive" size="default" data-vb="cHapusTrans" className="h-8 px-4 text-xs font-semibold" onClick={hapusTrans}>
                  Hapus Transaksi
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="button" variant="outline" size="default" data-vb="cTutup" disabled={sibuk} className="h-8 gap-1.5 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
          <span>Tutup</span>
          <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
        </Button>
      </div>

      {msg.node}
      {pindahLama && <PindahLama onClose={() => setPindahLama(false)} />}
      {periode && (
        <ModalFrame title="Pilih Periode Hapus Data" width={360} onClose={() => setPeriode(null)}>
          <div className="flex flex-col gap-3.5 p-4 font-sans text-xs text-foreground" data-form="FrmZAlatTgl">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="flex flex-col gap-1" data-vb="dtTgl1">
                <Label className="text-xs font-medium text-foreground">Dari Tanggal</Label>
                <Input type="date" value={periode.dari} onChange={(e) => e.target.value && setPeriode((p) => p && { ...p, dari: e.target.value })} className="h-8 text-xs tabular-nums" />
              </div>
              <div className="flex flex-col gap-1" data-vb="dtTgl2">
                <Label className="text-xs font-medium text-foreground">Sampai Tanggal</Label>
                <Input type="date" value={periode.sampai} onChange={(e) => e.target.value && setPeriode((p) => p && { ...p, sampai: e.target.value })} className="h-8 text-xs tabular-nums" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" size="default" className="h-8 px-3 text-xs" onClick={() => setPeriode(null)}>Batal</Button>
              <Button type="button" variant="default" size="default" data-vb="cOK" className="h-8 px-4 text-xs font-semibold" onClick={() => { const p = periode; setPeriode(null); hapusData(p); }}>
                Lanjutkan
              </Button>
            </div>
          </div>
        </ModalFrame>
      )}
      {daftarBackup && (
        <ModalFrame
          title="File Backup"
          width={560}
          height={340}
          onClose={() => setDaftarBackup(null)}
          footer={
            <>
              <Button type="button" variant="outline" className="mr-auto h-8 text-xs" onClick={() => void pilihFileRestore()}>
                Pilih File Lain…
              </Button>
              <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setDaftarBackup(null)}>
                Tutup <Kbd>Esc</Kbd>
              </Button>
              <Button
                type="button"
                className="h-8 text-xs"
                disabled={!backupSel}
                onClick={() => { if (backupSel) { setFileRestore(backupSel); setDaftarBackup(null); } }}
              >
                Pilih
              </Button>
            </>
          }
        >
          <div className="h-full min-h-0 p-2">
            {daftarBackup.length === 0
              ? <p className="p-3 text-sm text-muted-foreground">Belum ada file backup di folder ini. Klik Pilih File Lain… untuk memilih file backup dari folder lain.</p>
              : <VbGrid cols={[
                { title: "No", width: 42, align: "right", render: (_r: FileBackup, i: number) => i + 1 },
                { title: "Nama File", width: 260, render: (r: FileBackup) => r.nama },
                { title: "Waktu", width: 120, render: (r: FileBackup) => r.waktu },
                { title: "Ukuran", width: 80, align: "right", render: (r: FileBackup) => kb(r.ukuran) },
              ]} rows={daftarBackup} rowKey={(r) => r.path} selected={backupSel} onSelect={setBackupSel}
                onOpen={(r) => { setFileRestore(r.path); setDaftarBackup(null); }} />}
          </div>
        </ModalFrame>
      )}
      {impor && <ImporExcel jenis={imporPick} nama={jenisNama} onClose={() => setImpor(false)} />}
      {hasilSql && (
        <ModalFrame title="SQL Editor" width={640} onClose={() => setHasilSql(null)}>
          <div className="tp-scroll-always max-h-80 p-2 font-sans text-xs text-foreground">
            <Table className="border-collapse">
              <TableHeader>
                <TableRow className="border-b border-border bg-muted hover:bg-muted">
                  {hasilSql.kolom.map((k) => <TableHead key={k} className="h-7 border-r border-border px-2 text-xs font-semibold text-foreground last:border-r-0">{k}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {hasilSql.baris.map((r, i) => (
                  <TableRow key={i} className="border-b border-border">
                    {r.map((c, j) => <TableCell key={j} className="h-6.5 border-r border-border px-2 py-0 whitespace-nowrap last:border-r-0">{c == null ? "" : String(c)}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
