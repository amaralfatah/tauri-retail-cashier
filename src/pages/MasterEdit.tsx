import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errText, MasterTable, Row } from "../api";
import { useApp } from "../appContext";
import { rp } from "../format";
import { formCaption } from "../vb/VbForm";
import { GridCol, ModalFrame, useMsgBox, useTopEscape, VbGrid } from "../vb/VbGrid";
import { berkasApi } from "../api/berkas";
import { AlamatFoto, simpanFoto, useFotoBarang } from "./fotoBarang";
import { distinct, GridKosong, HAPUS_MERAH, KEYS, kodeUrut, loadAll, q2, useList } from "./masterLib";

/** Angka dari isian: angka dipakai apa adanya; teks memakai aturan Indonesia (titik pemisah ribuan, koma desimal). */
const n = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);
const s = (v: unknown) => String(v ?? "");
const fmt0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const fmtNum = (v: unknown, rupiah = false) => (typeof v === "string" ? v : (rupiah ? fmt0 : fmt2).format(Number(v) || 0));

/* =========================================================================
   FrmDataBarang (+ FrmDataBarangSatuan, FrmDataBarangHrgLevel, FrmDataBarangHrgTingkat)
   ========================================================================= */

const NUM_COLS = ["hrgbeli", "marginpersen", "marginnilai", "hrgjual", "stokawal", "stokmin", "stokmax", "aktif",
  ...[1, 2, 3, 4, 5].flatMap((i) => [`konversi${i}`, `hrgsatuan${i}`, `hrgmultisatuan${i}`, `hrglevel${i}`, `hrgtingkat${i}`, `minhrg${i}`])];
const TEXT_COLS = ["kodebarang", "namabarang", "barcode", "barcode2", "jenis", "kodekelompok", "kodekategori", "kodepemasok", "kodesatuan", "rak",
  ...[1, 2, 3, 4, 5].map((i) => `satuan${i}`)];
const newBarang = (): Row => ({ jenis: "Barang", aktif: 1, hrgbeli: 0, marginpersen: 0, marginnilai: 0, hrgjual: 0, stokawal: 0, stokmin: 0, stokmax: 0, stokakhir: 0 });

type Sub = "satuan" | "level" | "tingkat";
type Nested = "mdkelompok" | "mdkategori" | "mdsatuan" | "mdpemasok";

export function BarangEdit(props: { row: Row; isNew: boolean; onClose: () => void; onChanged: (key: string | null) => void }) {
  const [v, setV] = useState<Row>(props.isNew ? { ...newBarang(), ...props.row } : { ...props.row });
  const [orig, setOrig] = useState<string | null>(props.isNew ? null : props.row.kodebarang);
  const [sub, setSub] = useState<Sub | null>(null);
  const [nested, setNested] = useState<Nested | null>(null);
  const msg = useMsgBox();
  const [fotoKode, setFotoKode] = useState<string | null>(props.isNew ? null : props.row.kodebarang);
  const [alamatFoto, setAlamatFoto] = useState(false);
  const foto = useFotoBarang(fotoKode);
  const kel = useList("mdkelompok");
  const kat = useList("mdkategori");
  const sat = useList("mdsatuan");
  const pem = useList("mdpemasok");
  const [semua, setSemua] = useState<Row[]>([]);
  const muatSemua = () => { loadAll("mdbarang", {}).then(setSemua).catch(() => undefined); };
  useEffect(muatSemua, []);
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  // Hitungan harga dijalankan saat kolom kehilangan fokus (LostFocus di aslinya), bukan setiap ketikan.
  const hitungBeli = () => setV((x) => {
    const b = Math.round(n(x.hrgbeli)), nilai = Math.round(b * n(x.marginpersen) / 100);
    return { ...x, hrgbeli: b, marginnilai: nilai, hrgjual: b + nilai };
  });
  const hitungPersen = () => setV((x) => {
    const b = n(x.hrgbeli), p = n(x.marginpersen), nilai = Math.round(b * p / 100);
    return { ...x, marginpersen: p, marginnilai: nilai, hrgjual: Math.round(b + nilai) };
  });
  const hitungNilai = () => setV((x) => {
    const b = n(x.hrgbeli), nilai = Math.round(n(x.marginnilai));
    return { ...x, marginnilai: nilai, hrgjual: Math.round(b + nilai), marginpersen: b > 0 ? Math.round((nilai / b) * 10000) / 100 : 0 };
  });
  const hitungJual = () => setV((x) => {
    const b = n(x.hrgbeli), j = Math.round(n(x.hrgjual)), nilai = j - b;
    return { ...x, hrgjual: j, marginnilai: nilai, marginpersen: b > 0 ? Math.round((nilai / b) * 10000) / 100 : 0 };
  });
  const rapikan = (k: string) => () => setV((x) => ({ ...x, [k]: n(x[k]) }));

  /** Kode berikutnya: kode kelompok + kode kategori + 5 angka; mulai dari 00001 kalau belum ada (AutoNumber 0x728). */
  const autoNomor = async (): Promise<string> => {
    const awalan = s(v.kodekelompok) + s(v.kodekategori);
    const ada = (await loadAll("mdbarang", {})).filter((r) => s(r.kodebarang).slice(0, awalan.length) === awalan);
    if (!ada.length) return awalan + "00001";
    const akhir = ada.reduce((a, b) => (Number(b.bid) > Number(a.bid) ? b : a));
    const urut = (parseInt(s(akhir.kodebarang).slice(awalan.length), 10) || 0) + 1;
    return awalan + String(urut).padStart(5, "0");
  };
  const isiKode = async () => {
    try { set("kodebarang", await autoNomor()); } catch (e) { msg.alert(errText(e)); }
  };
  const isiBarcode = async () => {
    try { set("barcode", await autoNomor()); } catch (e) { msg.alert(errText(e)); }
  };

  const simpan = async () => {
    const info = (t: string) => msg.alert(t, "Informasi");
    if (!s(v.kodebarang).trim()) return info("Kode barang belum diisi.");
    if (!s(v.namabarang).trim()) return info("Nama barang belum diisi.");
    if (!s(v.kodekelompok)) return info("Kelompok belum dipilih.");
    if (!s(v.kodekategori)) return info("Kategori belum dipilih.");
    if (!s(v.kodesatuan)) return info("Satuan belum dipilih.");
    if (!s(v.kodepemasok)) return info("Supplier belum dipilih.");
    const data: Row = {};
    for (const k of NUM_COLS) data[k] = n(v[k]);
    for (const k of TEXT_COLS) data[k] = v[k] ?? "";
    if (orig) delete data.stokawal;
    try {
      await api.masterSave("mdbarang", data, orig);
      setOrig(data.kodebarang);
      setFotoKode(data.kodebarang);
      setV((x) => ({ ...x, ...data, stokakhir: orig ? x.stokakhir : data.stokawal }));
      props.onChanged(data.kodebarang);
      muatSemua();
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) {
      const t = errText(e);
      msg.alert(/UNIQUE|constraint/i.test(t) ? "Kode barang sudah digunakan pada item barang lain, gunakan kode yang lain." : t, "Informasi");
    }
  };
  const hapus = () => {
    if (!orig) return;
    msg.confirm(`Hapus barang ${s(v.namabarang) || orig}? Barang yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.masterDelete("mdbarang", orig);
        setOrig(null);
        setFotoKode(null);
        setV(newBarang());
        props.onChanged(null);
        muatSemua();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Hapus barang", undefined, true);
  };

  const katList = s(v.kodekelompok) ? kat.rows.filter((k) => k.kodekelompok === v.kodekelompok) : kat.rows;
  const pickKel = (x: string) => setV((p) => ({ ...p, kodekelompok: x, kodekategori: "" }));
  const rakList = distinct(semua, "rak");
  const pickSub = (k: Sub) => {
    if (!s(v.kodebarang).trim()) return msg.alert("Isi dulu kode barang sebelum mengatur harga khusus.", "Informasi");
    setSub(k);
  };

  return (
    <ModalFrame
      title={orig ? `Edit Barang — ${orig}` : "Tambah Barang Baru"}
      width={840}
      onClose={props.onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            <Button type="button" variant="outline" className={`h-8 text-xs ${HAPUS_MERAH}`} data-vb="cHapus" disabled={!orig} onClick={hapus}>
              Hapus
            </Button>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cBaru" onClick={() => { setOrig(null); setFotoKode(null); setV(newBarang()); }}>
              Baru
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="h-8 gap-1 text-xs" data-vb="cCustom">
                    <span>Harga Khusus</span>
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => pickSub("satuan")}>Harga Multi Satuan</DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickSub("level")}>Harga Level</DropdownMenuItem>
                <DropdownMenuItem onClick={() => pickSub("tingkat")}>Harga Tingkat (Grosir)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 px-4 text-xs font-semibold" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_180px] gap-4">
        <div className="flex flex-col gap-3.5">
          {/* Identitas & Klasifikasi */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-kode" className="text-xs text-muted-foreground">Kode Barang <span className="text-destructive">*</span></Label>
              <InputGroup className="h-8">
                <InputGroupInput
                  id="brg-kode"
                  data-vb="tKode"
                  className="text-xs font-mono"
                  value={s(v.kodebarang)}
                  onChange={(e) => set("kodebarang", e.target.value)}
                  onFocus={() => { if (!s(v.kodebarang).trim()) void isiKode(); }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton data-vb="cAutoKode" onClick={() => void isiKode()}>Auto</InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-barcode" className="text-xs text-muted-foreground">Barcode</Label>
              <InputGroup className="h-8">
                <InputGroupInput
                  id="brg-barcode"
                  data-vb="tBarcode"
                  className="text-xs font-mono"
                  value={s(v.barcode)}
                  onChange={(e) => set("barcode", e.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton data-vb="cAutoBarcode" onClick={() => void isiBarcode()}>Auto</InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="brg-nama" className="text-xs text-muted-foreground">Nama Barang <span className="text-destructive">*</span></Label>
              <Input id="brg-nama" data-vb="tNama" className="h-8 text-xs" value={s(v.namabarang)} onChange={(e) => set("namabarang", e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-kel" className="text-xs text-muted-foreground">Kelompok <span className="text-destructive">*</span></Label>
              <div className="flex gap-1.5">
                <NativeSelect id="brg-kel" size="sm" data-vb="cKeloimpokNama" className="min-w-0 flex-1" value={s(v.kodekelompok)} onChange={(e) => pickKel(e.target.value)}>
                  <NativeSelectOption value="">— Pilih —</NativeSelectOption>
                  {kel.rows.map((r) => <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>{r.namakelompok} ({r.kodekelompok})</NativeSelectOption>)}
                </NativeSelect>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs font-semibold" data-vb="cAddKelompok" onClick={() => setNested("mdkelompok")}>+</Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-kat" className="text-xs text-muted-foreground">Kategori <span className="text-destructive">*</span></Label>
              <div className="flex gap-1.5">
                <NativeSelect id="brg-kat" size="sm" data-vb="cKategoriNama" className="min-w-0 flex-1" value={s(v.kodekategori)} onChange={(e) => set("kodekategori", e.target.value)}>
                  <NativeSelectOption value="">— Pilih —</NativeSelectOption>
                  {katList.map((r) => <NativeSelectOption key={r.kodekategori} value={r.kodekategori}>{r.namakategori} ({r.kodekategori})</NativeSelectOption>)}
                </NativeSelect>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs font-semibold" data-vb="cAddKategori" onClick={() => setNested("mdkategori")}>+</Button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-sat" className="text-xs text-muted-foreground">Satuan Dasar <span className="text-destructive">*</span></Label>
              <div className="flex gap-1.5">
                <NativeSelect id="brg-sat" size="sm" data-vb="cSatuan" className="min-w-0 flex-1" value={s(v.kodesatuan)} onChange={(e) => set("kodesatuan", e.target.value)}>
                  <NativeSelectOption value="">— Pilih —</NativeSelectOption>
                  {sat.rows.map((r) => <NativeSelectOption key={r.kodesatuan} value={r.kodesatuan}>{r.kodesatuan}</NativeSelectOption>)}
                </NativeSelect>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs font-semibold" data-vb="cAddSatuan" onClick={() => setNested("mdsatuan")}>+</Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-pem" className="text-xs text-muted-foreground">Supplier <span className="text-destructive">*</span></Label>
              <div className="flex gap-1.5">
                <NativeSelect id="brg-pem" size="sm" data-vb="cPemasokNama" className="min-w-0 flex-1" value={s(v.kodepemasok)} onChange={(e) => set("kodepemasok", e.target.value)}>
                  <NativeSelectOption value="">— Pilih —</NativeSelectOption>
                  {pem.rows.map((r) => <NativeSelectOption key={r.kodepemasok} value={r.kodepemasok}>{r.namapemasok}</NativeSelectOption>)}
                </NativeSelect>
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs font-semibold" data-vb="cAddPemasok" onClick={() => setNested("mdpemasok")}>+</Button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-jenis" className="text-xs text-muted-foreground">Jenis</Label>
              <NativeSelect id="brg-jenis" size="sm" data-vb="cJenis" className="w-full" value={s(v.jenis || "Barang")} onChange={(e) => set("jenis", e.target.value)}>
                <NativeSelectOption value="Barang">Barang</NativeSelectOption>
                <NativeSelectOption value="Jasa">Jasa</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-rak" className="text-xs text-muted-foreground">Lokasi Rak</Label>
              <Input id="brg-rak" list="dl-rak" data-vb="cRak" className="h-8 text-xs" value={s(v.rak)} onChange={(e) => set("rak", e.target.value)} placeholder="Opsional" />
              <datalist id="dl-rak">{rakList.map((o) => <option key={o} value={o} />)}</datalist>
            </div>
          </div>

          {/* Harga & Margin */}
          <div className="rounded-md border border-border bg-muted/25 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Harga & Margin</div>
            <div className="grid grid-cols-4 gap-2.5">
              <div className="flex flex-col gap-1">
                <Label htmlFor="brg-hbeli" className="text-xs text-muted-foreground">Harga Beli</Label>
                <Input id="brg-hbeli" data-vb="tHrgBeli" className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.hrgbeli, true)} onChange={(e) => set("hrgbeli", e.target.value)} onBlur={hitungBeli} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="brg-mp" className="text-xs text-muted-foreground">Margin (%)</Label>
                <Input id="brg-mp" data-vb="tMarginPersen" className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.marginpersen)} onChange={(e) => set("marginpersen", e.target.value)} onBlur={hitungPersen} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="brg-mn" className="text-xs text-muted-foreground">Margin (Rp)</Label>
                <Input id="brg-mn" data-vb="tMarginNilai" className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.marginnilai, true)} onChange={(e) => set("marginnilai", e.target.value)} onBlur={hitungNilai} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="brg-hjual" className="text-xs font-medium text-foreground">Harga Jual</Label>
                <Input id="brg-hjual" data-vb="tHrgJual" className="h-8 text-right text-xs font-semibold tabular-nums" value={fmtNum(v.hrgjual, true)} onChange={(e) => set("hrgjual", e.target.value)} onBlur={hitungJual} />
              </div>
            </div>
          </div>

          {/* Stok */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-sawal" className="text-xs text-muted-foreground">Stok Awal</Label>
              <Input id="brg-sawal" data-vb="tStokAwal" disabled={!!orig} className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.stokawal)} onChange={(e) => set("stokawal", e.target.value)} onBlur={rapikan("stokawal")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-smin" className="text-xs text-muted-foreground">Stok Min</Label>
              <Input id="brg-smin" data-vb="tStokMin" className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.stokmin)} onChange={(e) => set("stokmin", e.target.value)} onBlur={rapikan("stokmin")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-smax" className="text-xs text-muted-foreground">Stok Max</Label>
              <Input id="brg-smax" data-vb="tStokMax" className="h-8 text-right text-xs tabular-nums" value={fmtNum(v.stokmax)} onChange={(e) => set("stokmax", e.target.value)} onBlur={rapikan("stokmax")} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="brg-sakhir" className="text-xs text-muted-foreground">Stok Akhir</Label>
              <Input id="brg-sakhir" data-vb="tStokAkhir" disabled className="h-8 text-right text-xs font-semibold tabular-nums" value={q2(orig ? v.stokakhir : n(v.stokawal))} />
            </div>
          </div>
        </div>

        {/* Kolom Foto & Status */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Foto Barang</Label>
            <div className="flex h-44 items-center justify-center overflow-hidden rounded-md border border-border bg-card p-2">
              {foto.src ? (
                <img src={foto.src} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="px-2 text-center text-xs text-muted-foreground">Belum ada foto</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-8 text-xs"
                data-vb="cOpenFoto"
                onClick={() => (s(v.kodebarang).trim() ? setAlamatFoto(true) : msg.alert("Isi dulu kode barangnya, baru pilih fotonya."))}
              >
                Pilih
              </Button>
              <Button
                type="button"
                variant="outline"
                className={`h-8 text-xs ${HAPUS_MERAH}`}
                data-vb="cDelFoto"
                disabled={!foto.src}
                onClick={() => {
                  const k = fotoKode ?? "";
                  if (!k || !foto.src) return msg.alert("Barang ini belum punya foto.");
                  msg.confirm("Hapus foto barang ini? Fotonya tidak bisa dikembalikan.", async () => {
                    try { await berkasApi.fotoHapus(k); foto.muat(); } catch (e) { msg.alert(errText(e)); }
                  }, "Hapus foto", undefined, true);
                }}
              >
                Hapus
              </Button>
            </div>
          </div>

          <div className="mt-auto rounded-md border border-border bg-muted/25 p-2.5">
            <Label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Checkbox data-vb="chkAktif" checked={Number(v.aktif ?? 1) === 1} onCheckedChange={(c) => set("aktif", c ? 1 : 0)} />
              <span>Barang Aktif</span>
            </Label>
          </div>
        </div>
      </div>

      {msg.node}
      {alamatFoto && (
        <AlamatFoto onClose={() => setAlamatFoto(false)}
          onPick={async (path) => {
            const k = s(v.kodebarang).trim();
            setAlamatFoto(false);
            if (await simpanFoto(k, path, msg.alert)) { setFotoKode(k); foto.muat(); }
          }} />
      )}
      {sub && (
        <BarangSub kind={sub} v={v} orig={orig} satuan={sat.rows} onClose={() => setSub(null)}
          onApply={(patch) => { setV((x) => ({ ...x, ...patch })); if (orig) props.onChanged(orig); }} />
      )}
      {nested && (
        <SimpleMaster table={nested === "mdpemasok" ? "mdkelompok" : nested} onClose={() => { setNested(null); kel.reload(); kat.reload(); sat.reload(); pem.reload(); }}
          pemasok={nested === "mdpemasok"} />
      )}
    </ModalFrame>
  );
}

const SUB_TITLE: Record<Sub, string> = {
  satuan: "Harga Multi Satuan",
  level: "Harga Level Pelanggan",
  tingkat: "Harga Tingkat (Grosir)",
};
const SUB_COLS: Record<Sub, string[]> = {
  satuan: [1, 2, 3, 4, 5].flatMap((i) => [`satuan${i}`, `konversi${i}`, `hrgsatuan${i}`, `hrgmultisatuan${i}`]),
  level: [1, 2, 3, 4, 5].map((i) => `hrglevel${i}`),
  tingkat: [1, 2, 3, 4, 5].flatMap((i) => [`minhrg${i}`, `hrgtingkat${i}`]),
};

/** Harga multi satuan, harga level, dan harga tingkat. Dipakai dari tombol Harga Khusus di Data Barang. */
function BarangSub(props: { kind: Sub; v: Row; orig: string | null; satuan: Row[]; onClose: () => void; onApply: (patch: Row) => void }) {
  const { kind, v } = props;
  const pick = (): Row => {
    const o: Row = {};
    for (const k of SUB_COLS[kind]) {
      o[k] = v[k] ?? (k.startsWith("satuan") ? "" : 0);
    }
    if (kind === "satuan") {
      for (const i of [1, 2, 3, 4, 5]) {
        if (!n(o[`hrgsatuan${i}`]) && n(o[`hrgmultisatuan${i}`]) > 0 && n(o[`konversi${i}`]) > 0) o[`hrgsatuan${i}`] = Math.round(n(o[`hrgmultisatuan${i}`]) / n(o[`konversi${i}`]));
      }
    }
    return o;
  };
  const [w, setW] = useState<Row>(pick);
  const msg = useMsgBox();
  const set = (k: string, val: unknown) => setW((x) => ({ ...x, [k]: val }));
  const bulat = (k: string) => () => setW((x) => ({ ...x, [k]: Math.round(n(x[k])) }));

  const blurKonv = (i: number) => () => setW((x) => ({ ...x, [`konversi${i}`]: n(x[`konversi${i}`]) }));
  const blurPer = (i: number) => () => setW((x) => {
    const per = Math.round(n(x[`hrgsatuan${i}`]));
    return { ...x, [`hrgsatuan${i}`]: per, [`hrgmultisatuan${i}`]: Math.round(n(x[`konversi${i}`]) * per) };
  });
  const blurMulti = (i: number) => () => setW((x) => {
    const m = Math.round(n(x[`hrgmultisatuan${i}`])), k = n(x[`konversi${i}`]);
    return { ...x, [`hrgmultisatuan${i}`]: m, [`hrgsatuan${i}`]: k > 0 ? Math.round(m / k) : 0 };
  });

  const simpan = async () => {
    const patch: Row = {};
    for (const k of SUB_COLS[kind]) patch[k] = k.startsWith("satuan") ? s(w[k]) : n(w[k]);
    if (kind !== "satuan") {
      const pokok = n(v.hrgbeli);
      const kolom = kind === "level" ? "hrglevel" : "hrgtingkat";
      if ([1, 2, 3, 4, 5].some((i) => n(patch[`${kolom}${i}`]) > 0 && n(patch[`${kolom}${i}`]) < pokok)) {
        return msg.alert(`Harga ${kind === "level" ? "level" : "tingkat"} tidak boleh kurang dari harga pokok.`);
      }
    }
    if (props.orig) {
      try { await api.masterSave("mdbarang", { ...patch, kodebarang: props.orig }, props.orig); } catch (e) { return msg.alert(errText(e)); }
    }
    props.onApply(patch);
    msg.alert(props.orig ? "Data sudah tersimpan." : "Data sudah dicatat. Klik Simpan di Data Barang supaya ikut tersimpan.");
  };

  return (
    <ModalFrame
      title={SUB_TITLE[kind]}
      width={kind === "satuan" ? 680 : 560}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="mr-auto h-8 text-xs" data-vb="cBatal" onClick={() => setW(pick())}>
            Reset
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          <div><span className="text-muted-foreground">Kode:</span> <span className="font-mono font-semibold">{s(v.kodebarang)}</span></div>
          <div className="col-span-2 truncate"><span className="text-muted-foreground">Nama:</span> <span className="font-semibold">{s(v.namabarang) || "—"}</span></div>
          <div><span className="text-muted-foreground">Satuan:</span> <span className="font-medium">{s(v.kodesatuan) || "—"}</span></div>
          <div><span className="text-muted-foreground">Hrg. Beli:</span> <span className="font-semibold tabular-nums">Rp {rp(v.hrgbeli)}</span></div>
          <div><span className="text-muted-foreground">Hrg. Jual:</span> <span className="font-semibold tabular-nums">Rp {rp(v.hrgjual)}</span></div>
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="h-8 w-14 text-xs">No.</TableHead>
                {kind === "satuan" && (
                  <>
                    <TableHead className="h-8 text-xs">Satuan</TableHead>
                    <TableHead className="h-8 text-right text-xs">Konversi</TableHead>
                    <TableHead className="h-8 text-right text-xs">Hrg / Satuan Dasar</TableHead>
                    <TableHead className="h-8 text-right text-xs">Hrg Multi Satuan</TableHead>
                  </>
                )}
                {kind === "level" && (
                  <>
                    <TableHead className="h-8 text-xs">Level Pelanggan</TableHead>
                    <TableHead className="h-8 text-right text-xs">Harga Jual (Rp)</TableHead>
                  </>
                )}
                {kind === "tingkat" && (
                  <>
                    <TableHead className="h-8 text-right text-xs">Min. Qty</TableHead>
                    <TableHead className="h-8 text-right text-xs">Harga Jual (Rp)</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[1, 2, 3, 4, 5].map((i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  <TableCell className="py-1.5 text-xs text-muted-foreground tabular-nums">{i}</TableCell>
                  {kind === "satuan" && (
                    <>
                      <TableCell className="py-1.5">
                        <NativeSelect size="sm" data-vb={`cSatuan${i}`} className="w-28" value={s(w[`satuan${i}`])} onChange={(e) => set(`satuan${i}`, e.target.value)}>
                          <NativeSelectOption value="">—</NativeSelectOption>
                          {props.satuan.map((r) => <NativeSelectOption key={r.kodesatuan} value={r.kodesatuan}>{r.kodesatuan}</NativeSelectOption>)}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tKonversi${i}`} className="h-8 text-right text-xs tabular-nums" value={fmtNum(w[`konversi${i}`])} onChange={(e) => set(`konversi${i}`, e.target.value)} onBlur={blurKonv(i)} />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tHrgSatuan${i}`} className="h-8 text-right text-xs tabular-nums" value={fmtNum(w[`hrgsatuan${i}`], true)} onChange={(e) => set(`hrgsatuan${i}`, e.target.value)} onBlur={blurPer(i)} />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tHrgMulti${i}`} className="h-8 text-right text-xs font-semibold tabular-nums" value={fmtNum(w[`hrgmultisatuan${i}`], true)} onChange={(e) => set(`hrgmultisatuan${i}`, e.target.value)} onBlur={blurMulti(i)} />
                      </TableCell>
                    </>
                  )}
                  {kind === "level" && (
                    <>
                      <TableCell className="py-1.5 text-xs font-medium">Level {i}</TableCell>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tHrgLevel${i}`} className="h-8 text-right text-xs font-semibold tabular-nums" value={fmtNum(w[`hrglevel${i}`], true)} onChange={(e) => set(`hrglevel${i}`, e.target.value)} onBlur={bulat(`hrglevel${i}`)} />
                      </TableCell>
                    </>
                  )}
                  {kind === "tingkat" && (
                    <>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tMinTingkat${i}`} className="h-8 text-right text-xs tabular-nums" value={fmtNum(w[`minhrg${i}`], true)} onChange={(e) => set(`minhrg${i}`, e.target.value)} onBlur={bulat(`minhrg${i}`)} />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input data-vb={`tHrgTingkat${i}`} className="h-8 text-right text-xs font-semibold tabular-nums" value={fmtNum(w[`hrgtingkat${i}`], true)} onChange={(e) => set(`hrgtingkat${i}`, e.target.value)} onBlur={bulat(`hrgtingkat${i}`)} />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      {msg.node}
    </ModalFrame>
  );
}

/* =========================================================================
   FrmDataPelanggan, FrmDataPemasok, FrmDataKaryawan
   ========================================================================= */

interface Party {
  form: string; title: string; key: string; name: string;
  texts: Record<string, string>; free: Record<string, string>;
}
const COMMON_TXT = { tKode: "", tNama: "", tAlamat: "alamat", tTlp1: "tlp1", tTlp2: "tlp2", tEmail: "email", txtIDTele: "idtele" };
const PARTY: Record<string, Party> = {
  mdpelanggan: {
    form: "FrmDataPelanggan", title: "pelanggan", key: "kodepelanggan", name: "namapelanggan",
    texts: { ...COMMON_TXT, tKode: "kodepelanggan", tNama: "namapelanggan", tBatasKredit: "limitkredit" }, free: { cKota: "kota", cProvinsi: "provinsi" },
  },
  mdpemasok: {
    form: "FrmDataPemasok", title: "supplier", key: "kodepemasok", name: "namapemasok",
    texts: { ...COMMON_TXT, tKode: "kodepemasok", tNama: "namapemasok", tNamaKontak: "namakontak", tFax: "fax" }, free: { cKota: "kota", cProvinsi: "provinsi" },
  },
  mdkaryawan: {
    form: "FrmDataKaryawan", title: "karyawan", key: "kodekaryawan", name: "namakaryawan",
    texts: { ...COMMON_TXT, tKode: "kodekaryawan", tNama: "namakaryawan" }, free: { cKota: "kota", cProvinsi: "provinsi", cJabatan: "jabatan" },
  },
};
const NUMERIC = new Set(["limitkredit"]);

/** Awalan kode otomatis tiap tabel (AutoKode di EXE asli). */
const AWALAN: Record<string, string> = { mdkaryawan: "E", mdpemasok: "S", mdpelanggan: "C" };

export function PartyEdit(props: { table: MasterTable; row: Row; isNew: boolean; rows: Row[]; onClose: () => void; onChanged: (key: string | null) => void }) {
  const cfg = PARTY[props.table];
  const [v, setV] = useState<Row>({ aktif: 1, ...props.row });
  const [orig, setOrig] = useState<string | null>(props.isNew ? null : props.row[cfg.key]);
  const msg = useMsgBox();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const blank = (): Row => ({ aktif: 1 });

  const simpan = async () => {
    const kode = s(v[cfg.key]).trim();
    if (!kode) return msg.alert(`Kode ${cfg.title} belum diisi.`, "Informasi");
    if (props.table === "mdpemasok" && !s(v[cfg.name]).trim()) return msg.alert("Nama supplier belum diisi.", "Informasi");
    const ada = props.rows.find((r) => s(r[cfg.key]).toUpperCase() === kode.toUpperCase());
    const asli = ada ? s(ada[cfg.key]) : null;
    const data: Row = { aktif: Number(v.aktif ?? 1) ? 1 : 0 };
    for (const col of [...Object.values(cfg.texts), ...Object.values(cfg.free)]) data[col] = NUMERIC.has(col) ? n(v[col]) : s(v[col]);
    if (props.table === "mdpelanggan") { data.level = s(v.level); data.masaaktif = s(v.masaaktif) || null; }
    try {
      await api.masterSave(props.table, data, asli);
      props.onChanged(kode);
      setOrig(null);
      setV(blank());
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  };
  const hapus = () => {
    const kode = s(v[cfg.key]).trim();
    if (!kode) return;
    msg.confirm(`Hapus ${cfg.title} ${s(v[cfg.name]).trim() || kode}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.masterDelete(props.table, kode);
        setOrig(null);
        setV(blank());
        props.onChanged(null);
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, `Hapus ${cfg.title}`, undefined, true);
  };

  const kotaList = distinct(props.rows, "kota");
  const provList = distinct(props.rows, "provinsi");
  const jabList = distinct(props.rows, "jabatan");
  const titleLabel = props.table === "mdpelanggan" ? "Data Pelanggan" : props.table === "mdpemasok" ? "Data Supplier" : "Data Karyawan";

  return (
    <ModalFrame
      title={orig ? `Edit ${titleLabel} — ${orig}` : `Tambah ${titleLabel}`}
      width={620}
      onClose={props.onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            <Button type="button" variant="outline" className={`h-8 text-xs ${HAPUS_MERAH}`} data-vb="cHapus" disabled={!s(v[cfg.key]).trim()} onClick={hapus}>
              Hapus
            </Button>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cBaru" onClick={() => { setOrig(null); setV(blank()); }}>
              Baru
            </Button>
          </div>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 px-4 text-xs font-semibold" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-kode" className="text-xs text-muted-foreground">Kode <span className="text-destructive">*</span></Label>
          <InputGroup className="h-8">
            <InputGroupInput
              id="pty-kode"
              data-vb="tKode"
              disabled={!!orig}
              className="text-xs font-mono"
              value={s(v[cfg.key])}
              onChange={(e) => set(cfg.key, e.target.value)}
            />
            {!orig && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton data-vb="cAutoKode" onClick={() => set(cfg.key, kodeUrut(props.rows.map((r) => r[cfg.key]), AWALAN[props.table], 3))}>
                  Auto
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-nama" className="text-xs text-muted-foreground">Nama {props.table === "mdpemasok" && <span className="text-destructive">*</span>}</Label>
          <Input id="pty-nama" data-vb="tNama" className="h-8 text-xs" value={s(v[cfg.name])} onChange={(e) => set(cfg.name, e.target.value)} />
        </div>

        {props.table === "mdpemasok" && (
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="pty-kontak" className="text-xs text-muted-foreground">Nama Kontak (PIC)</Label>
            <Input id="pty-kontak" data-vb="tNamaKontak" className="h-8 text-xs" value={s(v.namakontak)} onChange={(e) => set("namakontak", e.target.value)} />
          </div>
        )}

        {props.table === "mdkaryawan" && (
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="pty-jab" className="text-xs text-muted-foreground">Jabatan</Label>
            <Input id="pty-jab" list="dl-cJabatan" data-vb="cJabatan" className="h-8 text-xs" value={s(v.jabatan)} onChange={(e) => set("jabatan", e.target.value)} />
            <datalist id="dl-cJabatan">{jabList.map((o) => <option key={o} value={o} />)}</datalist>
          </div>
        )}

        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor="pty-alamat" className="text-xs text-muted-foreground">Alamat</Label>
          <Input id="pty-alamat" data-vb="tAlamat" className="h-8 text-xs" value={s(v.alamat)} onChange={(e) => set("alamat", e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-kota" className="text-xs text-muted-foreground">Kota</Label>
          <Input id="pty-kota" list="dl-cKota" data-vb="cKota" className="h-8 text-xs" value={s(v.kota)} onChange={(e) => set("kota", e.target.value)} />
          <datalist id="dl-cKota">{kotaList.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-prov" className="text-xs text-muted-foreground">Provinsi</Label>
          <Input id="pty-prov" list="dl-cProvinsi" data-vb="cProvinsi" className="h-8 text-xs" value={s(v.provinsi)} onChange={(e) => set("provinsi", e.target.value)} />
          <datalist id="dl-cProvinsi">{provList.map((o) => <option key={o} value={o} />)}</datalist>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-tlp1" className="text-xs text-muted-foreground">Telepon 1</Label>
          <Input id="pty-tlp1" data-vb="tTlp1" className="h-8 text-xs tabular-nums" value={s(v.tlp1)} onChange={(e) => set("tlp1", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-tlp2" className="text-xs text-muted-foreground">Telepon 2</Label>
          <Input id="pty-tlp2" data-vb="tTlp2" className="h-8 text-xs tabular-nums" value={s(v.tlp2)} onChange={(e) => set("tlp2", e.target.value)} />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-email" className="text-xs text-muted-foreground">Email</Label>
          <Input id="pty-email" data-vb="tEmail" className="h-8 text-xs" value={s(v.email)} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pty-tele" className="text-xs text-muted-foreground">{props.table === "mdpemasok" ? "Fax" : "ID Telegram"}</Label>
          {props.table === "mdpemasok" ? (
            <Input id="pty-tele" data-vb="tFax" className="h-8 text-xs" value={s(v.fax)} onChange={(e) => set("fax", e.target.value)} />
          ) : (
            <Input id="pty-tele" data-vb="txtIDTele" className="h-8 text-xs" value={s(v.idtele)} onChange={(e) => set("idtele", e.target.value)} />
          )}
        </div>

        {props.table === "mdpelanggan" && (
          <div className="col-span-2 grid grid-cols-4 gap-2.5 rounded-md border border-border bg-muted/25 p-2.5">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pty-level" className="text-xs text-muted-foreground">Level Harga</Label>
              <NativeSelect id="pty-level" size="sm" data-vb="cLevel" className="w-full" value={s(v.level)} onChange={(e) => set("level", e.target.value)}>
                <NativeSelectOption value="">Umum</NativeSelectOption>
                {[1, 2, 3, 4, 5].map((i) => <NativeSelectOption key={i} value={`Level ${i}`}>Level {i}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pty-kredit" className="text-xs text-muted-foreground">Limit Kredit</Label>
              <Input
                id="pty-kredit"
                data-vb="tBatasKredit"
                className="h-8 text-right text-xs tabular-nums"
                value={fmtNum(v.limitkredit, true)}
                onChange={(e) => set("limitkredit", e.target.value)}
                onBlur={() => set("limitkredit", n(v.limitkredit))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pty-masa" className="text-xs text-muted-foreground">Masa Aktif</Label>
              <Input id="pty-masa" type="date" data-vb="dtMasaAktif" className="h-8 text-xs tabular-nums" value={s(v.masaaktif).slice(0, 10)} onChange={(e) => set("masaaktif", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pty-poin" className="text-xs text-muted-foreground">Poin</Label>
              <Input id="pty-poin" data-vb="tPoin" disabled className="h-8 text-right text-xs font-semibold tabular-nums" value={rp(v.poin)} />
            </div>
          </div>
        )}

        <div className="col-span-2 pt-1">
          <Label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-medium">
            <Checkbox data-vb="chkAktif" checked={Number(v.aktif ?? 1) === 1} onCheckedChange={(c) => set("aktif", c ? 1 : 0)} />
            <span>Status Aktif</span>
          </Label>
        </div>
      </div>
      {msg.node}
    </ModalFrame>
  );
}

/* =========================================================================
   FrmDataKelompok, FrmDataKategori, FrmDataSatuan (daftar dan isian dalam satu jendela)
   ========================================================================= */

type Simple = "mdkelompok" | "mdkategori" | "mdsatuan";
const SIMPLE_FORM: Record<Simple, string> = { mdkelompok: "FrmDataKelompok", mdkategori: "FrmDataKategori", mdsatuan: "FrmDataSatuan" };

/**
 * Tanpa `onClose` tampil sebagai halaman menu; dengan `onClose` tampil sebagai jendela modal
 * (dibuka dari tombol "+" di Data Barang atau Data Kategori).
 * Kalau `pemasok` menyala, yang dibuka adalah Data Supplier.
 */
export function SimpleMaster(props: { table: Simple; onClose?: () => void; pemasok?: boolean }) {
  if (props.pemasok) return <PemasokQuick onClose={props.onClose!} />;
  return <SimpleBody {...props} />;
}

/** Panjang angka dan awalan kode otomatis: Kelompok "01", Kategori "001". */
const SIMPLE_LEBAR: Record<Simple, number> = { mdkelompok: 2, mdkategori: 3, mdsatuan: 0 };
const NAMA_SIMPLE: Record<Simple, string> = { mdkelompok: "kelompok", mdkategori: "kategori", mdsatuan: "satuan" };
const LABEL_SIMPLE: Record<Simple, string> = { mdkelompok: "Data Kelompok", mdkategori: "Data Kategori", mdsatuan: "Data Satuan" };

/**
 * Modal tambah / ubah Data Kelompok, Data Kategori, dan Data Satuan.
 * Konsisten dengan BarangEdit dan PartyEdit (dipakai dari layar daftar Master Data).
 */
export function SimpleEdit(props: {
  table: Simple;
  row: Row;
  isNew: boolean;
  rows: Row[];
  onClose: () => void;
  onChanged: (key: string | null) => void;
}) {
  const { table } = props;
  const { key, name } = KEYS[table];
  const [v, setV] = useState<Row>({ ...props.row });
  const [orig, setOrig] = useState<string | null>(props.isNew ? null : s(props.row[key]) || null);
  const [addKel, setAddKel] = useState(false);
  const kel = useList(table === "mdkategori" ? "mdkelompok" : null);
  const msg = useMsgBox();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  const autoKode = () => set(key, kodeUrut(props.rows.map((r) => r[key]), "", SIMPLE_LEBAR[table]));

  const simpan = async () => {
    const kode = s(v[key]).trim();
    if (!kode) return msg.alert(`Kode ${NAMA_SIMPLE[table]} belum diisi.`, "Informasi");
    if (!s(v[name]).trim()) return msg.alert(`Nama ${NAMA_SIMPLE[table]} belum diisi.`, "Informasi");
    const ada = props.rows.find((r) => s(r[key]).toUpperCase() === kode.toUpperCase());
    const asli = orig ?? (ada ? s(ada[key]) : null);
    const data: Row = { [key]: kode, [name]: s(v[name]).trim() };
    if (table === "mdkategori") data.kodekelompok = s(v.kodekelompok);
    try {
      await api.masterSave(table, data, asli);
      props.onChanged(kode);
      setOrig(null);
      setV(table === "mdkategori" && v.kodekelompok ? { kodekelompok: v.kodekelompok } : {});
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const hapus = () => {
    const kode = orig ?? s(v[key]).trim();
    if (!kode) return;
    const nm = s(v[name]).trim() || kode;
    msg.confirm(`Hapus ${NAMA_SIMPLE[table]} ${nm}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.masterDelete(table, kode);
        setOrig(null);
        setV({});
        props.onChanged(null);
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, `Hapus ${NAMA_SIMPLE[table]}`, undefined, true);
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void simpan();
    }
  };

  return (
    <ModalFrame
      title={orig ? `Edit ${LABEL_SIMPLE[table]} — ${orig}` : `Tambah ${LABEL_SIMPLE[table]}`}
      width={480}
      onClose={props.onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            <Button type="button" variant="outline" className={`h-8 text-xs ${HAPUS_MERAH}`} data-vb="cHapus" disabled={!orig} onClick={hapus}>
              Hapus
            </Button>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cBaru" onClick={() => { setOrig(null); setV({}); }}>
              Baru
            </Button>
          </div>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 px-4 text-xs font-semibold" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {table === "mdkategori" && (
          <div className="flex flex-col gap-1" data-vb="cKeloimpokNama">
            <Label htmlFor="smp-kel" className="text-xs text-muted-foreground">Kelompok</Label>
            <div className="flex gap-1.5">
              <NativeSelect
                id="smp-kel"
                size="sm"
                className="min-w-0 flex-1"
                value={s(v.kodekelompok)}
                onChange={(e) => set("kodekelompok", e.target.value)}
              >
                <NativeSelectOption value="">— Pilih Kelompok —</NativeSelectOption>
                {kel.rows.map((r) => (
                  <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>
                    {r.namakelompok} ({r.kodekelompok})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs font-semibold" data-vb="cAddKelompok" onClick={() => setAddKel(true)}>
                +
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1" data-vb="tKode">
          <Label htmlFor="smp-kode" className="text-xs text-muted-foreground">
            Kode <span className="text-destructive">*</span>
          </Label>
          {SIMPLE_LEBAR[table] > 0 ? (
            <InputGroup className="h-8">
              <InputGroupInput
                id="smp-kode"
                disabled={!!orig}
                autoFocus={!orig}
                className="font-mono text-xs"
                value={s(v[key])}
                onChange={(e) => set(key, e.target.value)}
                onKeyDown={onEnter}
              />
              {!orig && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton data-vb="cAutoKode" onClick={autoKode}>
                    Auto
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          ) : (
            <Input
              id="smp-kode"
              disabled={!!orig}
              autoFocus={!orig}
              className="h-8 font-mono text-xs"
              value={s(v[key])}
              onChange={(e) => set(key, e.target.value)}
              onKeyDown={onEnter}
            />
          )}
        </div>

        <div className="flex flex-col gap-1" data-vb="tNama">
          <Label htmlFor="smp-nama" className="text-xs text-muted-foreground">
            Nama <span className="text-destructive">*</span>
          </Label>
          <Input
            id="smp-nama"
            autoFocus={!!orig}
            className="h-8 text-xs"
            value={s(v[name])}
            onChange={(e) => set(name, e.target.value)}
            onKeyDown={onEnter}
          />
        </div>
      </div>
      {msg.node}
      {addKel && <SimpleMaster table="mdkelompok" onClose={() => { setAddKel(false); kel.reload(); }} />}
    </ModalFrame>
  );
}

function SimpleBody(props: { table: Simple; onClose?: () => void }) {
  const { table } = props;
  const { go } = useApp();
  const { key, name } = KEYS[table];
  const msg = useMsgBox();
  const form = SIMPLE_FORM[table];
  const [rows, setRows] = useState<Row[]>([]);
  const [v, setV] = useState<Row>({});
  const [sorot, setSorot] = useState<string | null>(null);
  const [addKel, setAddKel] = useState(false);
  const kel = useList(table === "mdkategori" ? "mdkelompok" : null);
  const close = props.onClose ?? (() => go("home"));
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  // Sebagai halaman, Esc menutup layar ini; sebagai jendela, ModalFrame yang mengurus Esc.
  useTopEscape(props.onClose ? undefined : close);

  const load = () => { loadAll(table, { sort: key }).then(setRows).catch((e) => msg.alert(errText(e))); };
  useEffect(load, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  // Isian terisi dari baris pada klik ganda (lsData_DblClick); klik tunggal hanya menyorot.
  const pickRow = (r: Row) => { setV({ ...r }); setSorot(r[key]); };
  const kosongkan = () => { setV({}); setSorot(null); };
  const simpan = async () => {
    const kode = s(v[key]).trim();
    if (!kode) return msg.alert(`Kode ${NAMA_SIMPLE[table]} belum diisi.`, "Informasi");
    if (!s(v[name]).trim()) return msg.alert(`Nama ${NAMA_SIMPLE[table]} belum diisi.`, "Informasi");
    // Kode yang sudah ada memperbarui data lama, seperti aslinya.
    const ada = rows.find((r) => s(r[key]).toUpperCase() === kode.toUpperCase());
    const data: Row = { [key]: kode, [name]: s(v[name]) };
    if (table === "mdkategori") data.kodekelompok = s(v.kodekelompok);
    try {
      await api.masterSave(table, data, ada ? s(ada[key]) : null);
      load();
      msg.alert("Data sudah tersimpan.", "Informasi");
      if (table === "mdkategori") kosongkan();
    } catch (e) {
      msg.alert(errText(e));
    }
  };
  const hapus = () => {
    // Kelompok memakai baris terpilih; Satuan dan Kategori memakai isi kolom Kode.
    const kode = table === "mdkelompok" ? sorot ?? "" : s(v[key]).trim();
    if (!kode) return;
    const nm = s(rows.find((r) => s(r[key]) === kode)?.[name] ?? v[name]).trim();
    msg.confirm(`Hapus ${NAMA_SIMPLE[table]} ${nm || kode}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.masterDelete(table, kode);
        kosongkan();
        load();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, `Hapus ${NAMA_SIMPLE[table]}`, undefined, true);
  };

  const kelName = (k: string) => kel.rows.find((r) => r.kodekelompok === k)?.namakelompok ?? k;
  const no: GridCol<Row> = { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 };
  const cols: GridCol<Row>[] = table === "mdkategori"
    ? [no, { title: "Kode", width: 95, render: (r) => r.kodekategori }, { title: "Kelompok", width: 145, render: (r) => kelName(r.kodekelompok) },
      { title: "Nama", width: 220, render: (r) => r.namakategori }]
    : table === "mdkelompok"
      ? [no, { title: "Kode", width: 110, render: (r) => r.kodekelompok }, { title: "Nama", width: 330, render: (r) => r.namakelompok }]
      : [no, { title: "Kode", width: 110, render: (r) => r.kodesatuan }, { title: "Nama", width: 330, render: (r) => r.namasatuan }];

  const autoKode = () => set(key, kodeUrut(rows.map((r) => r[key]), "", SIMPLE_LEBAR[table]));

  const body = (
    <div className="vb-modern flex size-full min-h-0 flex-col justify-between gap-3 bg-background p-3 font-sans text-xs text-foreground" data-form={form}>
      <div className="flex flex-col gap-2.5 rounded-md border border-border bg-card p-3">
        {table === "mdkategori" && (
          <div className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
            <div className="flex flex-col gap-1" data-vb="cKeloimpokNama">
              <Label className="text-xs font-medium text-foreground">Kelompok</Label>
              <NativeSelect value={s(v.kodekelompok)} onChange={(e) => set("kodekelompok", e.target.value)} className="w-full">
                <NativeSelectOption value="">— Pilih Kelompok —</NativeSelectOption>
                {kel.rows.map((r) => <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>{r.namakelompok}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1" data-vb="cKelompokKode">
              <Label className="text-xs font-medium text-foreground">Kode</Label>
              <NativeSelect value={s(v.kodekelompok)} onChange={(e) => set("kodekelompok", e.target.value)} className="w-full">
                <NativeSelectOption value="">—</NativeSelectOption>
                {kel.rows.map((r) => <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>{r.kodekelompok}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" size="default" data-vb="cAddKelompok" className="h-8 px-2.5 text-xs font-semibold" onClick={() => setAddKel(true)}>
              +
            </Button>
          </div>
        )}
        <div className={`grid items-end gap-2 ${SIMPLE_LEBAR[table] > 0 ? "grid-cols-[140px_auto_1fr]" : "grid-cols-[140px_1fr]"}`}>
          <div className="flex flex-col gap-1" data-vb="tKode">
            <Label className="text-xs font-medium text-foreground">Kode <span className="text-destructive">*</span></Label>
            <Input value={s(v[key])} readOnly={false} onChange={(e) => set(key, e.target.value)} className="h-8 bg-background text-xs" />
          </div>
          {SIMPLE_LEBAR[table] > 0 ? (
            <Button type="button" variant="outline" size="default" data-vb="cAutoKode" className="h-8 px-2.5 text-xs font-medium" onClick={autoKode}>
              Kode otomatis
            </Button>
          ) : null}
          <div className="flex flex-col gap-1" data-vb="tNama">
            <Label className="text-xs font-medium text-foreground">Nama <span className="text-destructive">*</span></Label>
            <Input value={s(v[name])} readOnly={false} onChange={(e) => set(name, e.target.value)} className="h-8 bg-background text-xs" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1" data-vb="lsData">
        <GridKosong kosong={rows.length === 0} teks="Belum ada data. Isi kode dan nama di atas, lalu klik Simpan.">
          <VbGrid cols={cols} rows={rows} rowKey={(r) => r[key]} selected={sorot} onSelect={setSorot} onOpen={pickRow} />
        </GridKosong>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cHapus" className={`h-8 bg-background px-3 text-xs font-medium ${HAPUS_MERAH}`} onClick={hapus}>
            Hapus
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cBaru" className="h-8 px-3 text-xs font-medium" onClick={kosongkan}>
            Baru
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 px-2.5 text-xs font-medium" onClick={close}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 px-4 text-xs font-semibold" onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>
      {msg.node}
      {addKel && <SimpleMaster table="mdkelompok" onClose={() => { setAddKel(false); kel.reload(); }} />}
    </div>
  );

  if (props.onClose) {
    return (
      <ModalFrame title={formCaption(form)} width={560} height={table === "mdkategori" ? 450 : 410} onClose={close}>
        {body}
      </ModalFrame>
    );
  }
  return body;
}

/** "+" di samping Pemasok pada Data Barang: daftar supplier dengan isiannya, lalu kembali ke Data Barang. */
function PemasokQuick(props: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [row, setRow] = useState<Row | null>(null);
  const ok = useRef(true);
  // Daftar dimuat ulang setiap kali ada yang tersimpan, supaya Auto Kode berikutnya tidak memakai kode yang sama.
  const muat = useCallback(() => { loadAll("mdpemasok", { sort: "kodepemasok" }).then((r) => ok.current && setRows(r)).catch(() => undefined); }, []);
  useEffect(() => { muat(); return () => { ok.current = false; }; }, [muat]);
  return <PartyEdit table="mdpemasok" row={row ?? { aktif: 1 }} isNew rows={rows} onClose={props.onClose} onChanged={(k) => { muat(); if (k) setRow(null); }} />;
}
