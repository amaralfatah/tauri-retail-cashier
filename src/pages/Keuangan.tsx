import { useCallback, useEffect, useRef, useState } from "react";
import { errText, Row } from "../api";
import { perluVerifikasi } from "../api/kasir";
import { kasApi, KasDaftar } from "../api/keuangan";
import { Otentikasi } from "../components/Otentikasi";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { BELUM_ADA, GridCol, ToolItem, useMsgBox, VbGrid, VbModal, VbToolbar } from "../vb/VbGrid";
import { CariMaster, opsi, s, txt } from "./keuanganLib";
import { useDaftarFile } from "./daftarFile";
import { useListLayout } from "./masterLib";
import { formCaption } from "../vb/VbForm";

const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;
const uang = (n: unknown) => `Rp. ${rp(n)}`;

export function Keuangan() {
  const { go, user } = useApp();
  const lay = useListLayout("FrmTranskas");
  const [mintaIzin, setMintaIzin] = useState<{ idkas: number } | null>(null);
  const msg = useMsgBox();
  const [data, setData] = useState<KasDaftar>({ rows: [], masuk: 0, keluar: 0, kas: 0 });
  const [sel, setSel] = useState<string | null>(null);
  // Seperti aslinya, daftar kas dibuka dengan kas hari ini saja.
  const [filter, setFilter] = useState({ dari: today(), sampai: today() });
  const [showFilter, setShowFilter] = useState(false);
  const [baru, setBaru] = useState(false);

  const load = useCallback((f = filter) => {
    kasApi.list(f.dari, f.sampai).then(setData).catch((e) => msg.alert(errText(e)));
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
    msg.confirm("Apakah data kas terpilih akan dihapus?\nProses ini mungkin akan membutuhkan waktu beberapa saat untuk proses perhitungan ulang kas.", () => void hapusKas(idkas, tanda));
  const hapusKas = async (idkas: number, tanda?: string) => {
    try {
      await kasApi.hapus(idkas, tanda);
      setSel(null);
      load();
      msg.alert("Data kas sudah terhapus.");
    } catch (e) { msg.alert(errText(e)); }
  };

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
    { title: "No.", width: 40, align: "right", render: (_, i) => i + 1 },
    { title: "ID", width: 45, align: "right", render: (r) => r.idkas },
    { title: "No.Kas", width: 100, render: (r) => r.nokas },
    { title: "Tanggal", width: 80, render: (r) => tglID(r.tglkas) },
    { title: "No.Ref", width: 100, render: (r) => r.noreftrans },
    { title: "Jenis", width: 70, render: (r) => r.jenis },
    { title: "Kategori", width: 150, render: (r) => r.kategori },
    { title: "Karyawan", width: 110, render: (r) => r.namakaryawan },
    { title: "Kontak", width: 110, render: (r) => r.namakontak },
    { title: "Keterangan", width: 200, render: (r) => r.keterangan },
    { title: "Masuk", width: 90, align: "right", render: (r) => rp(r.masuk) },
    { title: "Keluar", width: 90, align: "right", render: (r) => rp(r.keluar) },
    { title: "Saldo", width: 100, align: "right", render: (r) => rp(r.saldo) },
  ];
  const file = useDaftarFile(formCaption("FrmTranskas"), cols, data.rows, msg);
  const bind: Record<string, Bind> = {
    tbMenu: (_g, ctrl) => (
      <VbToolbar items={(ctrl.texts ?? []).map<ToolItem>((c) => ({ caption: c, onClick: handlers[c] ?? (() => msg.alert(BELUM_ADA)), sepBefore: sepBefore.has(c) }))} />
    ),
    lsData: () => <VbGrid cols={cols} rows={data.rows} rowKey={(r) => String(r.idkas)} selected={sel} onSelect={setSel} />,
    lblTotal: { text: `Total Pemasukan : ${uang(data.masuk)}  |  Total Pengeluaran : ${uang(data.keluar)}  |  Total Kas : ${uang(data.kas)}` },
  };

  return (
    <div className="vbm-fill">
      <VbForm form="FrmTranskas" bind={bind} fill anchor={lay.anchor} pos={lay.pos} />
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
    cTampil: { onClick: () => props.onApply(f) },
    cTutup: { onClick: props.onClose },
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
    cSimpan: { onClick: () => void simpan() },
    cBatal: { onClick: batal },
    cKeluar: { onClick: props.onClose },
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
