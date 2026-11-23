import { useCallback, useEffect, useRef, useState } from "react";
import { errText, Row } from "../api";
import { perluVerifikasi } from "../api/kasir";
import { kasApi, KasDaftar } from "../api/keuangan";
import { Otentikasi } from "../components/Otentikasi";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { Bind, formCaption } from "../vb/VbForm";
import { BELUM_ADA, GridCol, ToolItem, useMsgBox, useTopEscape, VbGrid, VbModal, VbToolbar } from "../vb/VbGrid";
import { CariMaster, opsi, s, txt } from "./keuanganLib";
import { HAPUS_MERAH, TUTUP } from "./masterLib";
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
    { title: "No.", width: 42, align: "right", render: (_, i) => i + 1 },
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
  const bind: Record<string, Bind> = {
    dtTgl1: { value: f.dari, onChange: (v) => v && setF((x) => ({ ...x, dari: v })) },
    dtTgl2: { value: f.sampai, onChange: (v) => v && setF((x) => ({ ...x, sampai: v })) },
    cTampil: { onClick: () => props.onApply(f), variant: "default" },
    cTutup: { onClick: props.onClose, text: TUTUP },
  };
  return <VbModal form="FrmFilterKas" bind={bind} onClose={props.onClose} />;
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

  const bind: Record<string, Bind> = {
    dtTgl: { value: v.tgl, onChange: (x) => x && set("tgl", x) },
    tNoRef: txt(v.noref, (x) => set("noref", x)),
    cJenis: { value: v.jenis, onChange: (x) => { setV((o) => ({ ...o, jenis: x, masuk: "", keluar: "" })); }, children: opsi(["Saldo Awal", "Masuk", "Keluar"]) },
    cKategori: { value: v.kategori, onChange: (x) => set("kategori", x), children: opsi(kategori) },
    tPetugasNama: txt(petugas.namakaryawan),
    tPelangganNama: txt(pelanggan?.namapelanggan),
    tPemasokNama: txt(pemasok?.namapemasok),
    cCariPetugas: { onClick: () => setCari("mdkaryawan") },
    cCariPelanggan: { onClick: () => setCari("mdpelanggan") },
    cCariPemasok: { onClick: () => setCari("mdpemasok") },
    tKasMasuk: txt(v.masuk, (x) => set("masuk", x), !masuk),
    tKasKeluar: txt(v.keluar, (x) => set("keluar", x), masuk),
    tKet: txt(v.ket, (x) => set("ket", x)),
    cSimpan: { onClick: () => void simpan(), variant: "default" },
    cBatal: { onClick: batal, className: HAPUS_MERAH },
    cKeluar: { onClick: props.onClose, text: TUTUP },
    Label7: { text: "Supplier" },
  };
  return (
    <VbModal form="FrmTransKasAdd" bind={bind} hide={["tPetugasKode", "tPelangganKode", "tPemasokKode"]} onClose={props.onClose}>
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
    </VbModal>
  );
}
