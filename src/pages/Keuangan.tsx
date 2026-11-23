import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { errText, Row } from "../api";
import { perluVerifikasi } from "../api/kasir";
import { kasApi, KasDaftar } from "../api/keuangan";
import { Otentikasi } from "../components/Otentikasi";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { formCaption } from "../vb/VbForm";
import { BELUM_ADA, GridCol, ModalFrame, ToolItem, useMsgBox, useTopEscape, VbGrid, VbToolbar } from "../vb/VbGrid";
import { CariMaster, s } from "./keuanganLib";
import { HAPUS_MERAH } from "./masterLib";
import { useDaftarFile } from "./daftarFile";

const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;
const uang = (n: unknown) => `Rp ${rp(n)}`;

const ACTIONS = ["Baru", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Tutup"];

export function Keuangan() {
  const { go, user } = useApp();
  const [mintaIzin, setMintaIzin] = useState<{ idkas: number } | null>(null);
  const msg = useMsgBox();
  const [data, setData] = useState<KasDaftar>({ rows: [], masuk: 0, keluar: 0, kas: 0 });
  const [sel, setSel] = useState<string | null>(null);
  // Seperti aslinya, daftar kas dibuka dengan kas hari ini saja.
  const [filter, setFilter] = useState({ dari: today(), sampai: today() });
  const [showFilter, setShowFilter] = useState(false);
  const [baru, setBaru] = useState(false);

  const load = useCallback((f = filter) => {
    kasApi.list(f.dari, f.sampai)
      .then((res) => setData(res && Array.isArray(res.rows) ? res : { rows: [], masuk: 0, keluar: 0, kas: 0 }))
      .catch((e) => msg.alert(errText(e)));
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const hapus = () => {
    const r = data.rows.find((x) => String(x.idkas) === sel);
    if (!r) return msg.alert("Pilih dulu data kas yang akan dihapus.");
    // Kasir dan Lainnya login lewat Verifikasi Admin dulu, baru ditanya; level lain langsung ditanya.
    if (perluVerifikasi(user.level)) setMintaIzin({ idkas: r.idkas });
    else tanyaHapus(r.idkas);
  };
  const tanyaHapus = (idkas: number, tanda?: string) =>
    msg.confirm("Hapus data kas yang Anda pilih? Data yang sudah dihapus tidak bisa dikembalikan, dan saldo kas dihitung ulang. Ini bisa memakan waktu beberapa saat.", () => void hapusKas(idkas, tanda), "Hapus data kas", undefined, true);
  const hapusKas = async (idkas: number, tanda?: string) => {
    try {
      await kasApi.hapus(idkas, tanda);
      setSel(null);
      load();
      msg.alert("Data kas sudah terhapus.");
    } catch (e) { msg.alert(errText(e)); }
  };

  // Esc menutup layar Transaksi Kas (jendela yang terbuka di atasnya menutup lebih dulu).
  useTopEscape(() => go("home"));

  const handlers: Record<string, () => void> = {
    Baru: () => setBaru(true),
    Hapus: hapus,
    Filter: () => setShowFilter(true),
    Refresh: () => { const f = { dari: today(), sampai: today() }; setFilter(f); load(f); },
    Export: () => void file.ekspor(),
    Cetak: () => void file.cetak(),
    Tutup: () => go("home"),
  };
  const sepBefore = new Set(["Filter", "Export", "Tutup"]);
  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_, i) => i + 1 },
    { title: "ID", width: 50, align: "right", render: (r) => r.idkas },
    { title: "No. Kas", width: 110, render: (r) => r.nokas },
    { title: "Tanggal", width: 90, render: (r) => tglID(r.tglkas) },
    { title: "No. Ref", width: 105, render: (r) => r.noreftrans },
    { title: "Jenis", width: 75, render: (r) => r.jenis },
    { title: "Kategori", width: 160, render: (r) => r.kategori },
    { title: "Karyawan", width: 120, render: (r) => r.namakaryawan },
    { title: "Kontak", width: 120, render: (r) => r.namakontak },
    { title: "Keterangan", width: 210, render: (r) => r.keterangan },
    { title: "Masuk", width: 105, align: "right", render: (r) => rp(r.masuk) },
    { title: "Keluar", width: 105, align: "right", render: (r) => rp(r.keluar) },
    { title: "Saldo", width: 115, align: "right", render: (r) => rp(r.saldo) },
  ];
  const file = useDaftarFile(formCaption("FrmTranskas"), cols, data.rows, msg);
  const toolItems: ToolItem[] = ACTIONS.map((c) => ({ caption: c, onClick: handlers[c] ?? (() => msg.alert(BELUM_ADA)), sepBefore: sepBefore.has(c) }));

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col bg-background font-sans text-foreground" data-form="FrmTranskas">
      <div data-vb="tbMenu">
        <VbToolbar items={toolItems} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-display px-4 py-2 text-display-foreground">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-display-foreground/65">Total Pemasukan</span>
            <span className="text-base font-bold text-display-foreground tabular-nums">{uang(data.masuk)}</span>
          </div>
          <div className="h-7 w-px bg-display-foreground/15" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-display-foreground/65">Total Pengeluaran</span>
            <span className="text-base font-bold text-display-foreground tabular-nums">{uang(data.keluar)}</span>
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-display-foreground/70">Saldo Kas</span>
          <span className="text-xl font-bold tabular-nums">{uang(data.kas)}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-2.5" data-vb="lsData">
        <VbGrid cols={cols} rows={data.rows} rowKey={(r) => String(r.idkas)} selected={sel} onSelect={setSel} />
      </div>
      <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground" data-vb="lblTotal">
        <span>Total Pemasukan : {uang(data.masuk)}  |  Total Pengeluaran : {uang(data.keluar)}  |  Total Kas : {uang(data.kas)}</span>
        <span className="text-muted-foreground tabular-nums">Periode: {tglID(filter.dari)} s/d {tglID(filter.sampai)}</span>
      </div>
      {msg.node}
      {file.node}
      {mintaIzin && (
        <Otentikasi alasan="Untuk menghapus data kas, masukkan nama user dan kata sandi supervisor atau pemilik toko."
          onBatal={() => setMintaIzin(null)}
          onOk={(t) => { const m = mintaIzin; setMintaIzin(null); tanyaHapus(m.idkas, t); }} />
      )}
      {baru && <KasAdd onClose={() => setBaru(false)} onSaved={() => load()} />}
      {showFilter && <FilterKas value={filter} onClose={() => setShowFilter(false)} onApply={(f) => { setFilter(f); setShowFilter(false); }} />}
    </div>
  );
}

function FilterKas(props: { value: { dari: string; sampai: string }; onApply: (f: { dari: string; sampai: string }) => void; onClose: () => void }) {
  const [f, setF] = useState({ dari: props.value.dari || today().slice(0, 8) + "01", sampai: props.value.sampai || today() });
  return (
    <ModalFrame
      title="Filter Transaksi Kas"
      width={400}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cTampil" onClick={() => props.onApply(f)}>
            Tampilkan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kas-tgl1" className="text-xs text-muted-foreground">Dari Tanggal</Label>
          <Input id="kas-tgl1" type="date" data-vb="dtTgl1" className="h-8 text-xs tabular-nums" value={f.dari} onChange={(e) => e.target.value && setF((x) => ({ ...x, dari: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kas-tgl2" className="text-xs text-muted-foreground">Sampai Tanggal</Label>
          <Input id="kas-tgl2" type="date" data-vb="dtTgl2" className="h-8 text-xs tabular-nums" value={f.sampai} onChange={(e) => e.target.value && setF((x) => ({ ...x, sampai: e.target.value }))} />
        </div>
      </div>
    </ModalFrame>
  );
}

function KasAdd(props: { onClose: () => void; onSaved: () => void }) {
  const { user } = useApp();
  const msg = useMsgBox();
  const awal = () => ({ tgl: today(), noref: "", jenis: "Masuk", kategori: "", masuk: "", keluar: "", ket: "" });
  const [v, setV] = useState(awal);
  const [petugas, setPetugas] = useState<Row>({ kodekaryawan: user.kodekaryawan, namakaryawan: user.namakaryawan });
  const [pelanggan, setPelanggan] = useState<Row | null>(null);
  const [pemasok, setPemasok] = useState<Row | null>(null);
  const [kategori, setKategori] = useState<string[]>([]);
  const [cari, setCari] = useState<"mdkaryawan" | "mdpelanggan" | "mdpemasok" | null>(null);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  useEffect(() => { kasApi.kategori().then((k) => { setKategori(k); setV((x) => (x.kategori ? x : { ...x, kategori: k[0] ?? "" })); }).catch(() => undefined); }, []);

  const masuk = v.jenis !== "Keluar";
  const batal = () => { setV({ ...awal(), kategori: kategori[0] ?? "" }); setPelanggan(null); setPemasok(null); };
  const simpanBusy = useRef(false);
  const simpan = async () => {
    if (simpanBusy.current) return;
    simpanBusy.current = true;
    try {
      await kasApi.simpan({
        tgl: v.tgl, noref: v.noref, jenis: v.jenis as "Saldo Awal" | "Masuk" | "Keluar", kategori: v.kategori, kodekaryawan: s(petugas.kodekaryawan),
        kodepelanggan: s(pelanggan?.kodepelanggan), kodepemasok: s(pemasok?.kodepemasok), masuk: num(v.masuk), keluar: num(v.keluar), ket: v.ket,
      });
      props.onSaved();
      batal();
      msg.alert("Data kas sudah tersimpan.");
    } catch (e) { msg.alert(errText(e)); } finally { simpanBusy.current = false; }
  };

  return (
    <ModalFrame
      title="Input Transaksi Kas"
      width={560}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className={`mr-auto h-8 text-xs ${HAPUS_MERAH}`} data-vb="cBatal" onClick={batal}>
            Reset
          </Button>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cKeluar" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-tgl" className="text-xs text-muted-foreground">Tanggal</Label>
          <Input id="kas-tgl" type="date" data-vb="dtTgl" className="h-8 text-xs tabular-nums" value={v.tgl} onChange={(e) => e.target.value && set("tgl", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-noref" className="text-xs text-muted-foreground">No. Referensi</Label>
          <Input id="kas-noref" data-vb="tNoRef" className="h-8 text-xs" value={v.noref} onChange={(e) => set("noref", e.target.value)} placeholder="Opsional" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-jenis" className="text-xs text-muted-foreground">Jenis Transaksi</Label>
          <NativeSelect id="kas-jenis" size="sm" data-vb="cJenis" className="w-full" value={v.jenis} onChange={(e) => setV((o) => ({ ...o, jenis: e.target.value, masuk: "", keluar: "" }))}>
            <NativeSelectOption value="Saldo Awal">Saldo Awal</NativeSelectOption>
            <NativeSelectOption value="Masuk">Masuk</NativeSelectOption>
            <NativeSelectOption value="Keluar">Keluar</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-kat" className="text-xs text-muted-foreground">Kategori</Label>
          <NativeSelect id="kas-kat" size="sm" data-vb="cKategori" className="w-full" value={v.kategori} onChange={(e) => set("kategori", e.target.value)}>
            {kategori.map((k) => <NativeSelectOption key={k} value={k}>{k}</NativeSelectOption>)}
          </NativeSelect>
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor="kas-petugas" className="text-xs text-muted-foreground">Petugas / Karyawan</Label>
          <InputGroup className="h-8">
            <InputGroupInput id="kas-petugas" data-vb="tPetugasNama" readOnly value={s(petugas.namakaryawan)} className="text-xs" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton data-vb="cCariPetugas" onClick={() => setCari("mdkaryawan")}>Pilih...</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-pelanggan" className="text-xs text-muted-foreground">Pelanggan (Opsional)</Label>
          <InputGroup className="h-8">
            <InputGroupInput id="kas-pelanggan" data-vb="tPelangganNama" readOnly value={s(pelanggan?.namapelanggan)} placeholder="—" className="text-xs" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton data-vb="cCariPelanggan" onClick={() => setCari("mdpelanggan")}>...</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-pemasok" className="text-xs text-muted-foreground">Supplier (Opsional)</Label>
          <InputGroup className="h-8">
            <InputGroupInput id="kas-pemasok" data-vb="tPemasokNama" readOnly value={s(pemasok?.namapemasok)} placeholder="—" className="text-xs" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton data-vb="cCariPemasok" onClick={() => setCari("mdpemasok")}>...</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-masuk" className="text-xs text-muted-foreground">Kas Masuk (Rp)</Label>
          <Input id="kas-masuk" data-vb="tKasMasuk" disabled={!masuk} value={v.masuk} onChange={(e) => set("masuk", e.target.value)} className="h-8 text-right text-xs font-semibold tabular-nums" placeholder="0" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kas-keluar" className="text-xs text-muted-foreground">Kas Keluar (Rp)</Label>
          <Input id="kas-keluar" data-vb="tKasKeluar" disabled={masuk} value={v.keluar} onChange={(e) => set("keluar", e.target.value)} className="h-8 text-right text-xs font-semibold tabular-nums" placeholder="0" />
        </div>

        <div className="col-span-2 flex flex-col gap-1">
          <Label htmlFor="kas-ket" className="text-xs text-muted-foreground">Keterangan</Label>
          <Input id="kas-ket" data-vb="tKet" value={v.ket} onChange={(e) => set("ket", e.target.value)} className="h-8 text-xs" placeholder="Catatan transaksi kas..." />
        </div>
      </div>
      {msg.node}
      {cari && (
        <CariMaster table={cari} onClose={() => setCari(null)}
          onPick={(r) => {
            if (cari === "mdkaryawan") setPetugas(r);
            else if (cari === "mdpelanggan") { setPelanggan(r); setPemasok(null); }
            else { setPemasok(r); setPelanggan(null); }
            setCari(null);
          }} />
      )}
    </ModalFrame>
  );
}
