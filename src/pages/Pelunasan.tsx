import { useCallback, useEffect, useMemo, useState } from "react";
import { errText, Row } from "../api";
import { pelunasanApi } from "../api/retur";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { GridCol, useEnterNav, useMsgBox, VbGrid } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";

export type PelunasanJenis = "Piutang" | "Hutang";

const FORM: Record<PelunasanJenis, string> = { Piutang: "FrmTransJualPiutang", Hutang: "FrmTransBeliHutang" };
/**
 * Isi cModeBayar di Form_Load aslinya: "Sesuai Nominal Bayar" lalu "Per Transaksi", pilihan pertama aktif.
 * Pilihan pertama menampilkan panel picBayar(0), yang kedua picBayar(1) (cModeBayar_Click memanggil ZOrder).
 */
const MODE = ["Sesuai Nominal Bayar", "Per Transaksi"];
const HIDE = ["tKasirKode", "tPelangganKode", "tPemasokKode"];

interface Kontak { kode: string; nama: string }

const angka = (t: string) => Number(t.replace(/\D/g, "")) || 0;
const n = (v: unknown) => Number(v) || 0;

/** Pelunasan piutang pelanggan atau hutang ke pemasok, sebagai dialog di atas halaman yang sedang terbuka. */
export function Pelunasan({ jenis }: { jenis: PelunasanJenis }) {
  const { user, go } = useApp();
  const msg = useMsgBox();
  const piutang = jenis === "Piutang";
  const [tgl, setTgl] = useState(today());
  const [kontak, setKontak] = useState<Kontak | null>(null);
  const [kartu, setKartu] = useState<Row[]>([]);
  const [mode, setMode] = useState(MODE[0]);
  const [nominal, setNominal] = useState(0);
  const [cek, setCek] = useState<Set<string>>(new Set());
  const [cari, setCari] = useState(false);
  // Kasir awalnya user yang masuk; tombol [?] hanya aktif untuk level selain Kasir (Form_Load aslinya).
  const [kasir, setKasir] = useState<Kontak>({ kode: user.kodekaryawan, nama: user.namakaryawan });
  const [cariKasir, setCariKasir] = useState(false);
  const ref = useEnterNav(FORM[jenis]);

  const perTrans = mode === MODE[1];
  const total = kartu.reduce((s, k) => s + n(k.kekurangan), 0);

  // Mode "Sesuai Nominal Bayar": nominal dibagi ke kartu menurut urutan daftar (nomor kartu), tiap kartu dipenuhi dulu
  // sebelum kartu berikutnya (tPelunasan_Change). Kelebihan nominal tidak dibagi ke mana-mana.
  const alokasi = useMemo(() => {
    let sisa = nominal;
    return kartu.map((k) => {
      const kurang = n(k.jmlpiutang) - n(k.jmlterbayar);
      if (sisa <= 0) return 0;
      const a = sisa > kurang ? kurang : sisa;
      sisa -= a;
      return Math.max(a, 0);
    });
  }, [kartu, nominal]);

  // Mode "Per Transaksi": kartu yang dicentang dilunasi seluruh sisanya.
  const dicek = kartu.reduce((s, k) => s + (cek.has(String(k.nopiutang)) ? n(k.kekurangan) : 0), 0);

  const muat = useCallback(async (k: Kontak | null) => {
    setNominal(0);
    setCek(new Set());
    if (!k) { setKartu([]); return; }
    try { setKartu(await pelunasanApi.kartu(jenis, k.kode)); } catch (e) { msg.alert(errText(e)); }
  }, [jenis]); // eslint-disable-line react-hooks/exhaustive-deps

  const pilih = (r: Row) => {
    const k = piutang ? { kode: String(r.kodepelanggan), nama: String(r.namapelanggan) } : { kode: String(r.kodepemasok), nama: String(r.namapemasok) };
    setKontak(k);
    setCari(false);
    void muat(k);
  };

  const simpan = useCallback(async () => {
    // Urutan pemeriksaan sama dengan simpanData / simpanData2 aslinya: jumlah dulu.
    if ((perTrans ? dicek : nominal) <= 0) return msg.alert("Jumlah pelunasan masih kosong");
    if (!kontak) return msg.alert(`Silakan pilih ${piutang ? "pelanggan" : "pemasok"} dulu.`);
    try {
      await pelunasanApi.simpan({
        jenis, kode: kontak.kode, tgl, kodekaryawan: kasir.kode,
        mode: perTrans ? "transaksi" : "nominal", nominal, kartu: perTrans ? [...cek] : [],
      });
      msg.alert("Data pelunasan sudah tersimpan.");
      await muat(kontak); // cariPiutang: daftar dimuat ulang dan isian jumlah kembali 0
    } catch (e) {
      msg.alert(errText(e));
    }
  }, [kontak, perTrans, dicek, nominal, cek, kasir, jenis, tgl, piutang, msg, muat]);

  // cBatal_Click hanya menjalankan reset: tanggal hari ini, kasir user yang masuk, daftar dan jumlah dikosongkan,
  // cara bayar kembali ke pilihan pertama. Pelanggan / pemasok yang sudah dipilih tidak dihapus.
  const batal = useCallback(() => {
    setKartu([]); setNominal(0); setCek(new Set()); setTgl(today()); setMode(MODE[0]);
    setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan });
  }, [user]);

  const nomor: GridCol<Row> = { title: "No", width: 35, align: "right", render: (_r, i) => i + 1 };
  // Hanya kolom Terbayar yang berubah saat jumlah diisi; Kekurangan tetap sisa sebelum pelunasan.
  const kolom = (terbayar: (r: Row, i: number) => number): GridCol<Row>[] => [
    { title: "No. Piutang", width: 110, render: (r) => r.nopiutang },
    { title: "No. Trans", width: 110, render: (r) => r.noreftrans },
    { title: "Jth. Tempo", width: 80, render: (r) => tglID(r.jthtempo) },
    { title: "Piutang", width: 100, align: "right", render: (r) => rp(r.jmlpiutang) },
    { title: "Terbayar", width: 100, align: "right", render: (r, i) => rp(n(r.jmlterbayar) + terbayar(r, i)) },
    { title: "Kekurangan", width: 100, align: "right", render: (r) => rp(r.kekurangan) },
  ];
  const kolomNominal = [nomor, ...kolom((_r, i) => alokasi[i] ?? 0)];
  const kolomCek: GridCol<Row>[] = [
    {
      title: "", width: 40, align: "center",
      render: (r) => {
        const no = String(r.nopiutang);
        return <input type="checkbox" checked={cek.has(no)} style={{ margin: 0, verticalAlign: "middle" }}
          onChange={(e) => setCek((s) => { const t = new Set(s); if (e.target.checked) t.add(no); else t.delete(no); return t; })} />;
      },
    },
    ...kolom((r) => (cek.has(String(r.nopiutang)) ? n(r.kekurangan) : 0)),
  ];

  const bind: Record<string, Bind> = {
    dtTglTrans: { value: tgl, onChange: (v) => v && setTgl(v) },
    tKasirNama: { value: kasir.nama },
    cCariKasir: { disabled: user.level.toUpperCase() === "KASIR", onClick: () => setCariKasir(true) },
    tPelangganNama: { value: kontak?.nama ?? "" },
    tPemasokNama: { value: kontak?.nama ?? "" },
    cCariPelanggan: { onClick: () => setCari(true) },
    cCariPemasok: { onClick: () => setCari(true) },
    cModeBayar: {
      value: mode,
      onChange: setMode,
      children: MODE.map((m) => <option key={m} value={m}>{m}</option>),
    },
    // Panel "Sesuai Nominal Bayar". Sisa = jumlah bayar dikurangi total, jadi negatif selama belum lunas.
    tTotalPiutang: { value: rp(total) },
    tPelunasan: { value: rp(nominal), onChange: (v) => setNominal(angka(v)) },
    tSisa: { value: rp(nominal - total) },
    tdDetail: () => <VbGrid cols={kolomNominal} rows={kartu} rowKey={(r) => String(r.nopiutang)} selected={null} onSelect={() => undefined} />,
    // Panel "Per Transaksi" (lsData_ItemCheck): Total dan Jml. Pelunasan sama-sama jumlah yang dicentang, Sisa selalu 0.
    tTotal: { value: rp(dicek) },
    tJmlBayar: { value: rp(dicek) },
    tJmlSisa: { value: "0" },
    lsData: () => <VbGrid cols={kolomCek} rows={kartu} rowKey={(r) => String(r.nopiutang)} selected={null} onSelect={() => undefined} />,
    cSimpan: { onClick: () => void simpan() },
    cBatal: { onClick: batal },
    cTutup: { onClick: () => go("home") },
  };

  const hide = [...HIDE, perTrans ? "picBayar(0)" : "picBayar(1)"];

  // Form_KeyDown aslinya: Esc = tutup, Alt+2 = cari Kasir, Alt+3 = cari Pelanggan/Pemasok, Alt+T = fokus ke tabel.
  const terbuka = cari || cariKasir || !!msg.node;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (terbuka) return;
      if (e.key === "Escape") { e.preventDefault(); go("home"); }
      else if (e.altKey && e.code === "Digit2") { e.preventDefault(); if (user.level.toUpperCase() !== "KASIR") setCariKasir(true); }
      else if (e.altKey && e.code === "Digit3") { e.preventDefault(); setCari(true); }
      else if (e.altKey && e.code === "KeyT") { e.preventDefault(); document.querySelector<HTMLElement>(".vbg")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      <VbForm form={FORM[jenis]} bind={bind} hide={hide} />
      {msg.node}
      {cari && <CariMaster table={piutang ? "mdpelanggan" : "mdpemasok"} onPick={pilih} onClose={() => setCari(false)} />}
      {cariKasir && (
        <CariMaster table="mdkaryawan" onClose={() => setCariKasir(false)}
          onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setCariKasir(false); }} />
      )}
    </div>
  );
}
