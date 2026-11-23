import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MasterTable, Row } from "../api";
import { ModalFrame } from "../vb/VbGrid";
import { distinct, useList } from "./masterLib";

export type FilterVal = Record<string, string>;

const has = (hay: unknown, needle: string) => !needle.trim() || String(hay ?? "").toLowerCase().includes(needle.trim().toLowerCase());

/** Cocokkan satu baris dengan isian Filter (kolom kosong berarti tidak disaring). */
export function matchFilter(table: MasterTable, f: FilterVal, r: Row): boolean {
  if (table === "mdbarang") {
    const aktif = Number(r.aktif ?? 1) !== 0;
    if (f.status === "Aktif" && !aktif) return false;
    if (f.status === "Tidak aktif" && aktif) return false;
    if (f.jenis && r.jenis !== f.jenis) return false;
    if (f.kelompok && r.kodekelompok !== f.kelompok) return false;
    if (f.kategori && r.kodekategori !== f.kategori) return false;
    // Kode dan barcode harus sama persis (upper(kodebarang) = 'X', upper(barcode) = 'X'); nama memakai like '%X%'.
    if (f.kode?.trim() && String(r.kodebarang ?? "").toUpperCase() !== f.kode.trim().toUpperCase()) return false;
    if (f.barcode?.trim() && String(r.barcode ?? "").toUpperCase() !== f.barcode.trim().toUpperCase()) return false;
    if (!has(r.namabarang, f.nama ?? "")) return false;
    if (f.satuan && r.kodesatuan !== f.satuan) return false;
    if (f.pemasok && r.kodepemasok !== f.pemasok) return false;
    const s = Number(r.stokakhir) || 0;
    const angka = (x: string) => Number(x.replace(/\./g, "").replace(",", "."));
    if (f.stok1?.trim() && s < angka(f.stok1)) return false;
    if (f.stok2?.trim() && s > angka(f.stok2)) return false;
    return true;
  }
  const k = { mdpelanggan: ["kodepelanggan", "namapelanggan"], mdpemasok: ["kodepemasok", "namapemasok"], mdkaryawan: ["kodekaryawan", "namakaryawan"] }[table as string]!;
  return has(r[k[0]], f.kode ?? "") && has(r[k[1]], f.nama ?? "") && has(r.namakontak, f.kontak ?? "") && (table === "mdpemasok" && f.alamat?.trim() ? String(r.alamat ?? "").toUpperCase() === f.alamat.trim().toUpperCase() : has(r.alamat, f.alamat ?? ""))
    && (!f.kota || r.kota === f.kota) && (!f.provinsi || r.provinsi === f.provinsi) && (!f.jabatan || r.jabatan === f.jabatan);
}

const TITLE: Record<string, string> = {
  mdbarang: "Filter Data Barang",
  mdpelanggan: "Filter Data Pelanggan",
  mdpemasok: "Filter Data Supplier",
  mdkaryawan: "Filter Data Karyawan",
};

export function FilterWindow(props: { table: MasterTable; rows: Row[]; value: FilterVal; onApply: (f: FilterVal) => void; onClose: () => void }) {
  const { table } = props;
  const [f, setF] = useState<FilterVal>(props.value);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const kel = useList(table === "mdbarang" ? "mdkelompok" : null).rows;
  const kat = useList(table === "mdbarang" ? "mdkategori" : null).rows;
  const sat = useList(table === "mdbarang" ? "mdsatuan" : null).rows;
  const pem = useList(table === "mdbarang" ? "mdpemasok" : null).rows;

  const katFiltered = f.kelompok ? kat.filter((r) => r.kodekelompok === f.kelompok) : kat;
  const kotaList = distinct(props.rows, "kota");
  const provList = distinct(props.rows, "provinsi");
  const jabList = distinct(props.rows, "jabatan");

  return (
    <ModalFrame
      title={TITLE[table] ?? "Filter Data"}
      width={560}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="mr-auto h-8 text-xs" onClick={() => setF({})}>
            Reset Filter
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cTampil" onClick={() => props.onApply(f)}>
            Tampilkan
          </Button>
        </>
      }
    >
      {table === "mdbarang" ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-status" className="text-xs text-muted-foreground">Status</Label>
            <NativeSelect id="flt-status" size="sm" data-vb="cmbStatus" className="w-full" value={f.status ?? ""} onChange={(e) => set("status", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              <NativeSelectOption value="Aktif">Aktif</NativeSelectOption>
              <NativeSelectOption value="Tidak aktif">Tidak aktif</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-jenis" className="text-xs text-muted-foreground">Jenis</Label>
            <NativeSelect id="flt-jenis" size="sm" data-vb="cJenis" className="w-full" value={f.jenis ?? ""} onChange={(e) => set("jenis", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              <NativeSelectOption value="Barang">Barang</NativeSelectOption>
              <NativeSelectOption value="Jasa">Jasa</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-kel" className="text-xs text-muted-foreground">Kelompok</Label>
            <NativeSelect
              id="flt-kel"
              size="sm"
              data-vb="cKelompokNama"
              className="w-full"
              value={f.kelompok ?? ""}
              onChange={(e) => { set("kelompok", e.target.value); set("kategori", ""); }}
            >
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {kel.map((r) => <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>{r.namakelompok} ({r.kodekelompok})</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-kat" className="text-xs text-muted-foreground">Kategori</Label>
            <NativeSelect id="flt-kat" size="sm" data-vb="cKategoriNama" className="w-full" value={f.kategori ?? ""} onChange={(e) => set("kategori", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {katFiltered.map((r) => <NativeSelectOption key={r.kodekategori} value={r.kodekategori}>{r.namakategori} ({r.kodekategori})</NativeSelectOption>)}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-kode" className="text-xs text-muted-foreground">Kode Barang (Persis)</Label>
            <Input id="flt-kode" data-vb="tKode" className="h-8 text-xs" value={f.kode ?? ""} onChange={(e) => set("kode", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-barcode" className="text-xs text-muted-foreground">Barcode (Persis)</Label>
            <Input id="flt-barcode" data-vb="tBarcode" className="h-8 text-xs" value={f.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} />
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="flt-nama" className="text-xs text-muted-foreground">Nama Barang</Label>
            <Input id="flt-nama" data-vb="tNama" className="h-8 text-xs" value={f.nama ?? ""} onChange={(e) => set("nama", e.target.value)} placeholder="Mengandung teks..." />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-sat" className="text-xs text-muted-foreground">Satuan</Label>
            <NativeSelect id="flt-sat" size="sm" data-vb="cSatuan" className="w-full" value={f.satuan ?? ""} onChange={(e) => set("satuan", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {sat.map((r) => <NativeSelectOption key={r.kodesatuan} value={r.kodesatuan}>{r.namasatuan}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-pem" className="text-xs text-muted-foreground">Supplier</Label>
            <NativeSelect id="flt-pem" size="sm" data-vb="cPemasokNama" className="w-full" value={f.pemasok ?? ""} onChange={(e) => set("pemasok", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {pem.map((r) => <NativeSelectOption key={r.kodepemasok} value={r.kodepemasok}>{r.namapemasok}</NativeSelectOption>)}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-stok1" className="text-xs text-muted-foreground">Stok Minimal</Label>
            <Input id="flt-stok1" data-vb="tStok1" className="h-8 text-right text-xs tabular-nums" value={f.stok1 ?? ""} onChange={(e) => set("stok1", e.target.value)} placeholder="0" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-stok2" className="text-xs text-muted-foreground">Stok Maksimal</Label>
            <Input id="flt-stok2" data-vb="tStok2" className="h-8 text-right text-xs tabular-nums" value={f.stok2 ?? ""} onChange={(e) => set("stok2", e.target.value)} placeholder="∞" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-kode" className="text-xs text-muted-foreground">Kode</Label>
            <Input id="flt-kode" data-vb="tKode" className="h-8 text-xs" value={f.kode ?? ""} onChange={(e) => set("kode", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-nama" className="text-xs text-muted-foreground">Nama</Label>
            <Input id="flt-nama" data-vb="tNama" className="h-8 text-xs" value={f.nama ?? ""} onChange={(e) => set("nama", e.target.value)} />
          </div>
          {table === "mdpemasok" && (
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="flt-kontak" className="text-xs text-muted-foreground">Nama Kontak</Label>
              <Input id="flt-kontak" data-vb="tNamaKontak" className="h-8 text-xs" value={f.kontak ?? ""} onChange={(e) => set("kontak", e.target.value)} />
            </div>
          )}
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor="flt-alamat" className="text-xs text-muted-foreground">Alamat</Label>
            <Input id="flt-alamat" data-vb="tAlamat" className="h-8 text-xs" value={f.alamat ?? ""} onChange={(e) => set("alamat", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-kota" className="text-xs text-muted-foreground">Kota</Label>
            <NativeSelect id="flt-kota" size="sm" data-vb="cKota" className="w-full" value={f.kota ?? ""} onChange={(e) => set("kota", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {kotaList.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="flt-prov" className="text-xs text-muted-foreground">Provinsi</Label>
            <NativeSelect id="flt-prov" size="sm" data-vb="cProvinsi" className="w-full" value={f.provinsi ?? ""} onChange={(e) => set("provinsi", e.target.value)}>
              <NativeSelectOption value="">Semua</NativeSelectOption>
              {provList.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          {table === "mdkaryawan" && (
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="flt-jab" className="text-xs text-muted-foreground">Jabatan</Label>
              <NativeSelect id="flt-jab" size="sm" data-vb="cJabatan" className="w-full" value={f.jabatan ?? ""} onChange={(e) => set("jabatan", e.target.value)}>
                <NativeSelectOption value="">Semua</NativeSelectOption>
                {jabList.map((o) => <NativeSelectOption key={o} value={o}>{o}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          )}
        </div>
      )}
    </ModalFrame>
  );
}
