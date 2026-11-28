import { SearchIcon } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Row } from "../../api";
import { Modal } from "../../components/Modal";
import { ModalFrame } from "../../vb/VbGrid";
import { KEYS, useList } from "../masterLib";

export type LapFilterVal = Record<string, string>;
type Who = "pelanggan" | "pemasok" | "kasir" | "sales";
const TABEL: Record<Who, "mdpelanggan" | "mdpemasok" | "mdkaryawan"> = { pelanggan: "mdpelanggan", pemasok: "mdpemasok", kasir: "mdkaryawan", sales: "mdkaryawan" };
const JUDUL: Record<Who, string> = { pelanggan: "Pelanggan", pemasok: "Supplier", kasir: "Kasir", sales: "Sales" };

const FORM_TITLE: Record<string, string> = {
  FrmFilterPenjualan: "Filter Laporan Penjualan",
  FrmFilterPembelian: "Filter Laporan Pembelian",
  FrmFilterPenjualanPiutang: "Filter Laporan Piutang",
  FrmFilterPembelianHutang: "Filter Laporan Hutang",
  FrmFilterLabaRugi: "Filter Laporan Laba Rugi",
  FrmFilterTransaksiBarang: "Filter Laporan Transaksi Barang",
  FrmFilterBarang: "Filter Laporan Barang",
  FrmFilterKas: "Filter Laporan Kas",
};

function Pilih(props: { who: Who; rows: Row[]; onPick: (kode: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { key, name } = KEYS[TABEL[props.who]];
  const list = props.rows.filter((r) => `${r[key]} ${r[name]}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 300);
  return (
    <Modal title={`Pilih ${JUDUL[props.who]}`} onClose={props.onClose} footer={<Button variant="outline" className="h-8 text-xs" onClick={props.onClose}>Tutup <Kbd>Esc</Kbd></Button>}>
      <Input autoFocus className="h-8 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik kode atau nama..." />
      <div className="tp-scroll-always max-h-70 rounded-md border border-border bg-card font-sans text-xs text-foreground">
        <Table className="border-collapse">
          <TableBody>
            {list.map((r) => (
              <TableRow key={r[key]} className="cursor-pointer border-b border-border hover:bg-muted" onClick={() => props.onPick(String(r[key]))}>
                <TableCell className="h-7 border-r border-border px-2 py-0 font-mono">{r[key]}</TableCell>
                <TableCell className="h-7 px-2 py-0">{r[name]}</TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow className="border-0 hover:bg-transparent">
                <TableCell colSpan={2} className="p-4 text-center text-muted-foreground">Tidak ada data yang cocok.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Modal>
  );
}

/** Dialog filter laporan (Penjualan, Pembelian, Piutang, Hutang, Laba Rugi, Transaksi Barang, Barang). */
export function LapFilterDialog(props: { form: string; judul?: string; value: LapFilterVal; onApply: (f: LapFilterVal) => void; onClose: () => void }) {
  const [f, setF] = useState<LapFilterVal>(props.value);
  const [pick, setPick] = useState<Who | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const isBarang = props.form === "FrmFilterBarang";
  const isTransBrg = props.form === "FrmFilterTransaksiBarang";
  const isJual = props.form === "FrmFilterPenjualan" || props.form === "FrmFilterLabaRugi";
  const isBeli = props.form === "FrmFilterPembelian";
  const isPiutang = props.form === "FrmFilterPenjualanPiutang";
  const isHutang = props.form === "FrmFilterPembelianHutang";

  const pel = useList(isJual || isPiutang ? "mdpelanggan" : null).rows;
  const pem = useList(isBeli || isHutang || isTransBrg || isBarang ? "mdpemasok" : null).rows;
  const kar = useList(isJual || isBeli || isPiutang || isHutang ? "mdkaryawan" : null).rows;
  const kel = useList(isTransBrg || isBarang ? "mdkelompok" : null).rows;
  const kat = useList(isTransBrg || isBarang ? "mdkategori" : null).rows;
  const sat = useList(isBarang ? "mdsatuan" : null).rows;
  const data: Record<Who, Row[]> = { pelanggan: pel, pemasok: pem, kasir: kar, sales: kar };

  const namaDari = (who: Who) => {
    const { key, name } = KEYS[TABEL[who]];
    return String(data[who].find((r) => String(r[key]).toLowerCase() === (f[who] ?? "").toLowerCase())?.[name] ?? "");
  };

  const katFiltered = f.kelompok ? kat.filter((r) => r.kodekelompok === f.kelompok) : kat;
  const tampil = () => props.onApply(f);

  const enterTampil = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key !== "Enter" || e.defaultPrevented || t instanceof HTMLButtonElement) return;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) { e.preventDefault(); tampil(); }
  };

  const renderWho = (who: Who, label: string, vbKode: string, vbBtn: string) => (
    <div className="col-span-2 flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-[150px_1fr] gap-2">
        <InputGroup className="h-8">
          <InputGroupInput
            data-vb={vbKode}
            className="text-xs"
            value={f[who] ?? ""}
            onChange={(e) => set(who, e.target.value.trim())}
            placeholder="Kode..."
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton data-vb={vbBtn} aria-label={`Cari ${label}`} onClick={() => setPick(who)}>
              <SearchIcon className="size-3.5" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Input readOnly tabIndex={-1} value={namaDari(who) || "Semua"} className="h-8 bg-muted/40 text-xs text-muted-foreground" />
      </div>
    </div>
  );

  return (
    <div onKeyDown={enterTampil}>
      <ModalFrame
        title={props.judul ? `Filter ${props.judul}` : FORM_TITLE[props.form] ?? "Filter Laporan"}
        width={isBarang ? 580 : 520}
        onClose={props.onClose}
        footer={
          <>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
              Tutup <Kbd>Esc</Kbd>
            </Button>
            <Button type="button" className="h-8 text-xs" data-vb="cTampil" onClick={tampil}>
              Tampilkan
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="lap-d1" className="text-xs text-muted-foreground">Dari Tanggal</Label>
            <Input id="lap-d1" type="date" data-vb="dtTgl1" className="h-8 text-xs tabular-nums" value={f.dari ?? ""} onChange={(e) => set("dari", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="lap-d2" className="text-xs text-muted-foreground">Sampai Tanggal</Label>
            <Input id="lap-d2" type="date" data-vb="dtTgl2" className="h-8 text-xs tabular-nums" value={f.sampai ?? ""} onChange={(e) => set("sampai", e.target.value)} />
          </div>

          {(isJual || isBeli || isPiutang || isHutang) && (
            <>
              <div className="col-span-2 flex flex-col gap-1">
                <Label htmlFor="lap-notrans" className="text-xs text-muted-foreground">No. Transaksi</Label>
                <Input id="lap-notrans" data-vb="tNotrans" className="h-8 text-xs" value={f.notrans ?? ""} onChange={(e) => set("notrans", e.target.value)} placeholder="Kosongkan untuk semua" />
              </div>
              {(isJual || isPiutang) && renderWho("pelanggan", "Pelanggan", "tPelangganKode", "cOpenPelanggan")}
              {(isBeli || isHutang) && renderWho("pemasok", "Supplier", "tPemasokKode", "cOpenPemasok")}
              {renderWho("kasir", "Kasir", "tKasirKode", "cOpenKasir")}
              {isJual && renderWho("sales", "Sales", "tSalesKode", "cOpenSales")}
              {(isJual || isBeli) && (
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor="lap-bayar" className="text-xs text-muted-foreground">Cara Bayar</Label>
                  <NativeSelect id="lap-bayar" size="sm" data-vb="cmbCaraBayar" className="w-full" value={f.carabayar ?? ""} onChange={(e) => set("carabayar", e.target.value)}>
                    <NativeSelectOption value="">Semua</NativeSelectOption>
                    <NativeSelectOption value="Tunai">Tunai</NativeSelectOption>
                    <NativeSelectOption value="Kredit">Kredit</NativeSelectOption>
                    <NativeSelectOption value="Non Tunai">Non Tunai</NativeSelectOption>
                  </NativeSelect>
                </div>
              )}
            </>
          )}

          {(isTransBrg || isBarang) && (
            <>
              {isBarang && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-status" className="text-xs text-muted-foreground">Status</Label>
                    <NativeSelect id="lap-status" size="sm" data-vb="cmbStatus" className="w-full" value={f.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                      <NativeSelectOption value="">Semua</NativeSelectOption>
                      <NativeSelectOption value="Aktif">Aktif</NativeSelectOption>
                      <NativeSelectOption value="Tidak aktif">Tidak aktif</NativeSelectOption>
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-jenis" className="text-xs text-muted-foreground">Jenis</Label>
                    <NativeSelect id="lap-jenis" size="sm" data-vb="cJenis" className="w-full" value={f.jenis ?? ""} onChange={(e) => set("jenis", e.target.value)}>
                      <NativeSelectOption value="">Semua</NativeSelectOption>
                      <NativeSelectOption value="Barang">Barang</NativeSelectOption>
                      <NativeSelectOption value="Jasa">Jasa</NativeSelectOption>
                    </NativeSelect>
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1">
                <Label htmlFor="lap-kel" className="text-xs text-muted-foreground">Kelompok</Label>
                <NativeSelect
                  id="lap-kel"
                  size="sm"
                  data-vb="cKelompokNama"
                  className="w-full"
                  value={f.kelompok ?? ""}
                  onChange={(e) => { set("kelompok", e.target.value); set("kategori", ""); }}
                >
                  <NativeSelectOption value="">Semua</NativeSelectOption>
                  {kel.map((r) => <NativeSelectOption key={r.kodekelompok} value={r.kodekelompok}>{r.namakelompok}</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lap-kat" className="text-xs text-muted-foreground">Kategori</Label>
                <NativeSelect id="lap-kat" size="sm" data-vb="cKategoriNama" className="w-full" value={f.kategori ?? ""} onChange={(e) => set("kategori", e.target.value)}>
                  <NativeSelectOption value="">Semua</NativeSelectOption>
                  {katFiltered.map((r) => <NativeSelectOption key={r.kodekategori} value={r.kodekategori}>{r.namakategori}</NativeSelectOption>)}
                </NativeSelect>
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="lap-kode" className="text-xs text-muted-foreground">Kode Barang</Label>
                <Input id="lap-kode" data-vb="tKode" className="h-8 text-xs" value={f.kode ?? ""} onChange={(e) => set("kode", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lap-barcode" className="text-xs text-muted-foreground">Barcode</Label>
                <Input id="lap-barcode" data-vb="tBarcode" className="h-8 text-xs" value={f.barcode ?? ""} onChange={(e) => set("barcode", e.target.value)} />
              </div>

              <div className="col-span-2 flex flex-col gap-1">
                <Label htmlFor="lap-nama" className="text-xs text-muted-foreground">Nama Barang</Label>
                <Input id="lap-nama" data-vb="tNama" className="h-8 text-xs" value={f.nama ?? ""} onChange={(e) => set("nama", e.target.value)} placeholder="Mengandung teks..." />
              </div>

              {isBarang ? (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-sat" className="text-xs text-muted-foreground">Satuan</Label>
                    <NativeSelect id="lap-sat" size="sm" data-vb="cSatuan" className="w-full" value={f.satuan ?? ""} onChange={(e) => set("satuan", e.target.value)}>
                      <NativeSelectOption value="">Semua</NativeSelectOption>
                      {sat.map((r) => <NativeSelectOption key={r.kodesatuan} value={r.kodesatuan}>{r.namasatuan}</NativeSelectOption>)}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-pem" className="text-xs text-muted-foreground">Supplier</Label>
                    <NativeSelect id="lap-pem" size="sm" data-vb="cPemasokNama" className="w-full" value={f.pemasok ?? ""} onChange={(e) => set("pemasok", e.target.value)}>
                      <NativeSelectOption value="">Semua</NativeSelectOption>
                      {pem.map((r) => <NativeSelectOption key={r.kodepemasok} value={r.kodepemasok}>{r.namapemasok}</NativeSelectOption>)}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-s1" className="text-xs text-muted-foreground">Stok Minimal</Label>
                    <Input id="lap-s1" data-vb="tStok1" className="h-8 text-right text-xs tabular-nums" value={f.stok1 ?? ""} onChange={(e) => set("stok1", e.target.value)} placeholder="0" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="lap-s2" className="text-xs text-muted-foreground">Stok Maksimal</Label>
                    <Input id="lap-s2" data-vb="tStok2" className="h-8 text-right text-xs tabular-nums" value={f.stok2 ?? ""} onChange={(e) => set("stok2", e.target.value)} placeholder="∞" />
                  </div>
                </>
              ) : (
                renderWho("pemasok", "Supplier", "tPemasokKode", "cOpenPemasok")
              )}
            </>
          )}
        </div>
        {pick && <Pilih who={pick} rows={data[pick]} onClose={() => setPick(null)} onPick={(k) => { set(pick, k); setPick(null); }} />}
      </ModalFrame>
    </div>
  );
}
