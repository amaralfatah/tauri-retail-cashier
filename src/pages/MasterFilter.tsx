import { useState } from "react";
import { MasterTable, Row } from "../api";
import { Bind } from "../vb/VbForm";
import { VbModal } from "../vb/VbGrid";
import { distinct, TUTUP, useList } from "./masterLib";

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

const FORM: Record<string, string> = { mdbarang: "FrmFilterBarang", mdpelanggan: "FrmFilterPelanggan", mdpemasok: "FrmFilterPemasok", mdkaryawan: "FrmFilterKaryawan" };

export function FilterWindow(props: { table: MasterTable; rows: Row[]; value: FilterVal; onApply: (f: FilterVal) => void; onClose: () => void }) {
  const { table } = props;
  const [f, setF] = useState<FilterVal>(props.value);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const kel = useList(table === "mdbarang" ? "mdkelompok" : null).rows;
  const kat = useList(table === "mdbarang" ? "mdkategori" : null).rows;
  const sat = useList(table === "mdbarang" ? "mdsatuan" : null).rows;
  const pem = useList(table === "mdbarang" ? "mdpemasok" : null).rows;

  const txt = (k: string): Bind => ({ value: f[k] ?? "", onChange: (v) => set(k, v) });
  const angka = (k: string): Bind => ({ value: f[k] ?? "", onChange: (v) => set(k, v), num: true });
  const opt = (list: string[], all = "{Semua}") => (
    <>
      <option value="">{all}</option>
      {list.map((o) => <option key={o} value={o}>{o}</option>)}
    </>
  );
  const combo = (k: string, list: string[]): Bind => ({ value: f[k] ?? "", onChange: (v) => set(k, v), children: opt(list) });
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

  const bind: Record<string, Bind> = {
    tKode: txt("kode"), tNama: txt("nama"), tAlamat: txt("alamat"), tNamaKontak: txt("kontak"), tBarcode: txt("barcode"),
    tStok1: angka("stok1"), tStok2: angka("stok2"),
    cmbStatus: { value: f.status ?? "", onChange: (v) => set("status", v), children: <><option value="">Semua</option><option value="Aktif">Aktif</option><option value="Tidak aktif">Tidak aktif</option></> },
    cJenis: combo("jenis", ["Barang", "Jasa"]),
    cKelompokNama: pair("kelompok", kel, "kodekelompok", "namakelompok", false),
    cKelompokKode: pair("kelompok", kel, "kodekelompok", "namakelompok", true),
    cKategoriNama: pair("kategori", kat, "kodekategori", "namakategori", false, ["kelompok", "kodekelompok"]),
    cKategoriKode: pair("kategori", kat, "kodekategori", "namakategori", true, ["kelompok", "kodekelompok"]),
    cSatuan: pair("satuan", sat, "kodesatuan", "namasatuan", false),
    cPemasokNama: pair("pemasok", pem, "kodepemasok", "namapemasok", false),
    cPemasokKode: pair("pemasok", pem, "kodepemasok", "namapemasok", true),
    cKota: combo("kota", distinct(props.rows, "kota")),
    cProvinsi: combo("provinsi", distinct(props.rows, "provinsi")),
    cJabatan: combo("jabatan", distinct(props.rows, "jabatan")),
    cTampil: { onClick: () => props.onApply(f), variant: "default" },
    cTutup: { onClick: props.onClose, text: TUTUP },
    ...(table === "mdbarang" ? { Label9: { text: "Supplier" } } : {}),
  };
  const hide = table === "mdbarang" ? ["picTgl"] : table === "mdpelanggan" ? ["tNamaKontak", "LabelNamaBarang"] : [];
  return <VbModal form={FORM[table]} bind={bind} hide={hide} onClose={props.onClose} />;
}
