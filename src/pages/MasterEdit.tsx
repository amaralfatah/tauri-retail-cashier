import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, MasterTable, Row } from "../api";
import { useApp } from "../appContext";
import { rp } from "../format";
import { Bind, formSize, VbForm } from "../vb/VbForm";
import { GridCol, useEnterNav, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { berkasApi } from "../api/berkas";
import { AlamatFoto, kotakFoto, simpanFoto, useFotoBarang } from "./fotoBarang";
import { distinct, KEYS, kodeUrut, loadAll, q2, useList } from "./masterLib";

/** Angka dari isian: angka dipakai apa adanya; teks memakai aturan Indonesia (titik pemisah ribuan, koma desimal). */
const n = (v: unknown): number => (typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) || 0);
const s = (v: unknown) => String(v ?? "");
const txt = (v: unknown, set: (x: string) => void, disabled?: boolean): Bind => ({ value: s(v), onChange: set, disabled });
const fmt0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
/** Kotak angka: teks yang sedang diketik tampil apa adanya, angka tampil `###,##0` (rupiah) atau sampai dua desimal. */
const ntxt = (v: unknown, set: (x: string) => void, blur: () => void, rupiah = false): Bind => ({
  value: typeof v === "string" ? v : (rupiah ? fmt0 : fmt2).format(Number(v) || 0), onChange: set, onBlur: blur, num: true,
});
const opts = (list: [string, string][], blank?: string) => (
  <>
    {blank !== undefined && <option value="">{blank}</option>}
    {list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </>
);

/** Isian combo yang boleh diketik bebas, dengan saran dari data yang sudah ada. */
const freeCombo = (id: string, value: string, set: (x: string) => void, list: string[]): Bind => () => (
  <>
    <input className="vb-txt" list={id} value={value} onChange={(e) => set(e.target.value)} />
    <datalist id={id}>{list.map((o) => <option key={o} value={o} />)}</datalist>
  </>
);

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
  const [menu, setMenu] = useState(false);
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
    if (!s(v.kodebarang).trim() || !s(v.namabarang).trim()) return msg.alert("Lengkapi data anda!\nAda data yang harus diisi.", "Information");
    if (!s(v.kodekelompok)) return info("Kelompok harus dipilih!");
    if (!s(v.kodekategori)) return info("Kategori harus dipilih!");
    if (!s(v.kodesatuan)) return info("Satuan harus dipilih!");
    if (!s(v.kodepemasok)) return info("Nama Pemasok harus dipilih!");
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
    msg.confirm("Apakah data akan dihapus?", async () => {
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
    }, "Konfirmasi");
  };

  const katList = s(v.kodekelompok) ? kat.rows.filter((k) => k.kodekelompok === v.kodekelompok) : kat.rows;
  const pickKel = (x: string) => setV((p) => ({ ...p, kodekelompok: x, kodekategori: "" }));
  const pair = (rows: Row[], key: string, name: string, col: string, kode: boolean, pick?: (x: string) => void): Bind => ({
    value: s(v[col]), onChange: pick ?? ((x) => set(col, x)),
    children: opts(rows.map((r) => [r[key], kode ? r[key] : r[name]]), ""),
  });

  const bind: Record<string, Bind> = {
    cJenis: { value: s(v.jenis || "Barang"), onChange: (x) => set("jenis", x), children: opts([["Barang", "Barang"], ["Jasa", "Jasa"]]) },
    cKeloimpokNama: pair(kel.rows, "kodekelompok", "namakelompok", "kodekelompok", false, pickKel),
    cKelompokKode: pair(kel.rows, "kodekelompok", "namakelompok", "kodekelompok", true, pickKel),
    cKategoriNama: pair(katList, "kodekategori", "namakategori", "kodekategori", false),
    cKategoriKode: pair(katList, "kodekategori", "namakategori", "kodekategori", true),
    cSatuan: pair(sat.rows, "kodesatuan", "namasatuan", "kodesatuan", true),
    cPemasokNama: pair(pem.rows, "kodepemasok", "namapemasok", "kodepemasok", false),
    cPemasokKode: pair(pem.rows, "kodepemasok", "namapemasok", "kodepemasok", true),
    cAddKelompok: { onClick: () => setNested("mdkelompok") },
    cAddKategori: { onClick: () => setNested("mdkategori") },
    cAddSatuan: { onClick: () => setNested("mdsatuan") },
    cAddPemasok: { onClick: () => setNested("mdpemasok") },
    cAutoKode: { onClick: () => void isiKode() },
    cAutoBarcode: { onClick: () => void isiBarcode() },
    // Kotak foto aslinya menjorok ke bawah bilah tombol; di sini dipotong sampai bilah tombol.
    picFoto: kotakFoto(foto.src, (5265 - 3780) / 15),
    cOpenFoto: { onClick: () => (s(v.kodebarang).trim() ? setAlamatFoto(true) : msg.alert("Isi dulu kode barangnya, baru pilih fotonya.")) },
    cDelFoto: { onClick: () => {
      const k = fotoKode ?? "";
      if (!k || !foto.src) return msg.alert("Barang ini belum punya foto.");
      msg.confirm("Apakah file foto akan dihapus?", async () => {
        try { await berkasApi.fotoHapus(k); foto.muat(); } catch (e) { msg.alert(errText(e)); }
      });
    } },
    // Kolom Kode terisi sendiri saat difokus kalau masih kosong (tKode_GotFocus).
    tKode: { value: s(v.kodebarang), onChange: (x) => set("kodebarang", x), onFocus: () => { if (!s(v.kodebarang).trim()) void isiKode(); } },
    tBarcode: txt(v.barcode, (x) => set("barcode", x)),
    tNama: txt(v.namabarang, (x) => set("namabarang", x)),
    cRak: freeCombo("dl-rak", s(v.rak), (x) => set("rak", x), distinct(semua, "rak")),
    tHrgBeli: ntxt(v.hrgbeli, (x) => set("hrgbeli", x), hitungBeli, true),
    tMarginPersen: ntxt(v.marginpersen, (x) => set("marginpersen", x), hitungPersen),
    tMarginNilai: ntxt(v.marginnilai, (x) => set("marginnilai", x), hitungNilai, true),
    tHrgJual: ntxt(v.hrgjual, (x) => set("hrgjual", x), hitungJual, true),
    tStokAwal: { ...ntxt(v.stokawal, (x) => set("stokawal", x), rapikan("stokawal")), disabled: !!orig },
    tStokMin: ntxt(v.stokmin, (x) => set("stokmin", x), rapikan("stokmin")),
    tStokMax: ntxt(v.stokmax, (x) => set("stokmax", x), rapikan("stokmax")),
    tStokAkhir: { value: q2(orig ? v.stokakhir : n(v.stokawal)), disabled: true },
    chkAktif: { value: String(Number(v.aktif ?? 1)), onChange: (x) => set("aktif", x === "1" ? 1 : 0) },
    cBaru: { onClick: () => { setOrig(null); setFotoKode(null); setV(newBarang()); } },
    cSimpan: { onClick: () => void simpan() },
    cHapus: { onClick: hapus, disabled: !orig },
    cCustom: { onClick: () => setMenu((m) => !m) },
    cTutup: { onClick: props.onClose },
  };

  // Menu harga hanya bereaksi kalau Kode sudah terisi.
  const pick = (k: Sub) => { setMenu(false); if (s(v.kodebarang).trim()) setSub(k); };
  const { height } = formSize("FrmDataBarang");
  return (
    <VbModal form="FrmDataBarang" bind={bind} hide={["tFile", "lblID", "lblTmpKode"]} onClose={props.onClose}>
      {menu && (
        <div className="vbm-pop" style={{ left: 5730 / 15 + 1, bottom: height + 22 - (5265 + 150) / 15 - 21 }}>
          <button type="button" onClick={() => pick("satuan")}>Harga Multi Satuan</button>
          <button type="button" onClick={() => pick("level")}>Harga Level</button>
          <button type="button" onClick={() => pick("tingkat")}>Harga Tingkat</button>
        </div>
      )}
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
    </VbModal>
  );
}

const SUB_FORM: Record<Sub, string> = { satuan: "FrmDataBarangSatuan", level: "FrmDataBarangHrgLevel", tingkat: "FrmDataBarangHrgTingkat" };
const SUB_COLS: Record<Sub, string[]> = {
  satuan: [1, 2, 3, 4, 5].flatMap((i) => [`satuan${i}`, `konversi${i}`, `hrgsatuan${i}`, `hrgmultisatuan${i}`]),
  level: [1, 2, 3, 4, 5].map((i) => `hrglevel${i}`),
  tingkat: [1, 2, 3, 4, 5].flatMap((i) => [`minhrg${i}`, `hrgtingkat${i}`]),
};

/** Harga multi satuan, harga level, dan harga tingkat. Dipakai dari tombol Custom di Data Barang. */
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

  // Konversi hanya diformat. Harga multi = konversi x harga satuan (saat harga satuan ditinggalkan);
  // harga satuan = harga multi / konversi, 0 bila konversi 0 (saat harga multi ditinggalkan).
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
    // cekHarga: harga level/tingkat yang diisi tidak boleh di bawah harga pokok (harga beli).
    if (kind !== "satuan") {
      const pokok = n(v.hrgbeli);
      const kolom = kind === "level" ? "hrglevel" : "hrgtingkat";
      if ([1, 2, 3, 4, 5].some((i) => n(patch[`${kolom}${i}`]) > 0 && n(patch[`${kolom}${i}`]) < pokok)) {
        return msg.alert(`Harga ${kind === "level" ? "level" : "tingkat"} tidak boleh kurang dari harga pokok!`);
      }
    }
    if (props.orig) {
      try { await api.masterSave("mdbarang", { ...patch, kodebarang: props.orig }, props.orig); } catch (e) { return msg.alert(errText(e)); }
    }
    props.onApply(patch);
    msg.alert(props.orig ? "Data sudah tersimpan." : "Data sudah dicatat. Klik Simpan di Data Barang supaya ikut tersimpan.");
  };

  const info: Record<string, Bind> = {
    tKode: { value: s(v.kodebarang), disabled: true }, tBarcode: { value: s(v.barcode), disabled: true }, tNama: { value: s(v.namabarang), disabled: true },
    tSatuan: { value: s(v.kodesatuan), disabled: true }, tHrgBeli: { value: rp(v.hrgbeli), disabled: true }, tHrgJual: { value: rp(v.hrgjual), disabled: true },
  };
  const bind: Record<string, Bind> = {
    ...info,
    cSimpan: { onClick: () => void simpan() },
    cBatal: { onClick: () => setW(pick()) },
    cTutup: { onClick: props.onClose },
  };
  for (const i of [1, 2, 3, 4, 5]) {
    bind[`cSatuan${i}`] = { value: s(w[`satuan${i}`]), onChange: (x) => set(`satuan${i}`, x), children: opts(props.satuan.map((r) => [r.kodesatuan, r.kodesatuan]), "") };
    bind[`tKonversi${i}`] = ntxt(w[`konversi${i}`], (x) => set(`konversi${i}`, x), blurKonv(i));
    bind[`tHrgSatuan${i}`] = ntxt(w[`hrgsatuan${i}`], (x) => set(`hrgsatuan${i}`, x), blurPer(i), true);
    bind[`tHrgMulti${i}`] = ntxt(w[`hrgmultisatuan${i}`], (x) => set(`hrgmultisatuan${i}`, x), blurMulti(i), true);
    bind[`tHrgLevel${i}`] = ntxt(w[`hrglevel${i}`], (x) => set(`hrglevel${i}`, x), bulat(`hrglevel${i}`), true);
    bind[`tMinTingkat${i}`] = ntxt(w[`minhrg${i}`], (x) => set(`minhrg${i}`, x), bulat(`minhrg${i}`), true);
    bind[`tHrgTingkat${i}`] = ntxt(w[`hrgtingkat${i}`], (x) => set(`hrgtingkat${i}`, x), bulat(`hrgtingkat${i}`), true);
  }
  return <VbModal form={SUB_FORM[kind]} bind={bind} onClose={props.onClose}>{msg.node}</VbModal>;
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
    // Pemasok wajib kode dan nama; Karyawan dan Pelanggan aslinya tanpa pemeriksaan nama. Kode kosong tidak disimpan
    // karena aslinya baris berkode kosong tidak pernah tampil di daftar (`where kode<>''`).
    if (!kode || (props.table === "mdpemasok" && !s(v[cfg.name]).trim())) return msg.alert("Lengkapi data anda!\nAda data yang harus diisi.", "Information");
    // Kode yang sudah ada memperbarui data lama (select first 1 ... lalu update), bukan ditolak.
    const ada = props.rows.find((r) => s(r[cfg.key]).toUpperCase() === kode.toUpperCase());
    const asli = ada ? s(ada[cfg.key]) : null;
    const data: Row = { aktif: Number(v.aktif ?? 1) ? 1 : 0 };
    for (const col of [...Object.values(cfg.texts), ...Object.values(cfg.free)]) data[col] = NUMERIC.has(col) ? n(v[col]) : s(v[col]);
    if (props.table === "mdpelanggan") { data.level = s(v.level); data.masaaktif = s(v.masaaktif) || null; }
    try {
      await api.masterSave(props.table, data, asli);
      props.onChanged(kode);
      setOrig(null);
      setV(blank()); // aslinya isian dikosongkan sesudah simpan
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  };
  const hapus = () => {
    const kode = s(v[cfg.key]).trim();
    if (!kode) return;
    msg.confirm("Apakah data akan dihapus?", async () => {
      try {
        await api.masterDelete(props.table, kode);
        setOrig(null);
        setV(blank());
        props.onChanged(null);
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Konfirmasi");
  };

  const bind: Record<string, Bind> = {
    cAutoKode: { onClick: () => set(cfg.key, kodeUrut(props.rows.map((r) => r[cfg.key]), AWALAN[props.table], 3)) },
    chkAktif: { value: String(Number(v.aktif ?? 1)), onChange: (x) => set("aktif", x === "1" ? 1 : 0) },
    cBaru: { onClick: () => { setOrig(null); setV(blank()); } },
    cSimpan: { onClick: () => void simpan() },
    cHapus: { onClick: hapus },
    cTutup: { onClick: props.onClose },
    cLevel: { value: s(v.level), onChange: (x) => set("level", x), children: opts([1, 2, 3, 4, 5].map((i) => [`Level ${i}`, `Level ${i}`]), "") },
    dtMasaAktif: { value: s(v.masaaktif).slice(0, 10), onChange: (x) => set("masaaktif", x) },
    tPoin: { value: rp(v.poin), disabled: true },
  };
  for (const [ctl, col] of Object.entries(cfg.texts)) {
    const kunci = ctl === "tKode" && !!orig;
    bind[ctl] = NUMERIC.has(col)
      ? { value: typeof v[col] === "string" ? v[col] : fmt0.format(Number(v[col]) || 0), onChange: (x) => set(col, x), onBlur: () => set(col, n(v[col])), num: true }
      : txt(v[col] ?? "", (x) => set(col, x), kunci);
  }
  for (const [ctl, col] of Object.entries(cfg.free)) bind[ctl] = freeCombo(`dl-${ctl}`, s(v[col]), (x) => set(col, x), distinct(props.rows, col));
  return <VbModal form={cfg.form} bind={bind} onClose={props.onClose}>{msg.node}</VbModal>;
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
  const ref = useEnterNav(form);
  const close = props.onClose ?? (() => go("home"));
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  const load = () => { loadAll(table, { sort: key }).then(setRows).catch((e) => msg.alert(errText(e))); };
  useEffect(load, [table]); // eslint-disable-line react-hooks/exhaustive-deps

  // Isian terisi dari baris pada klik ganda (lsData_DblClick); klik tunggal hanya menyorot.
  const pickRow = (r: Row) => { setV({ ...r }); setSorot(r[key]); };
  const kosongkan = () => { setV({}); setSorot(null); };
  const simpan = async () => {
    const kode = s(v[key]).trim();
    if (!kode || !s(v[name]).trim()) return msg.alert("Lengkapi data anda!\nAda data yang harus diisi.", "Information");
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
    msg.confirm("Apakah data akan dihapus?", async () => {
      try {
        await api.masterDelete(table, kode);
        kosongkan();
        load();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Konfirmasi");
  };

  const kelName = (k: string) => kel.rows.find((r) => r.kodekelompok === k)?.namakelompok ?? k;
  const no: GridCol<Row> = { title: "No.", width: 40, align: "right", render: (_r, i) => i + 1 };
  const cols: GridCol<Row>[] = table === "mdkategori"
    ? [no, { title: "Kode", width: 90, render: (r) => r.kodekategori }, { title: "Kelompok", width: 140, render: (r) => kelName(r.kodekelompok) },
      { title: "Nama", width: 220, render: (r) => r.namakategori }]
    : table === "mdkelompok"
      ? [no, { title: "Kode", width: 110, render: (r) => r.kodekelompok }, { title: "Nama", width: 330, render: (r) => r.namakelompok }]
      : [no, { title: "Kode", width: 110, render: (r) => r.kodesatuan }, { title: "Nama", width: 330, render: (r) => r.namasatuan }];

  const pair = (kode: boolean): Bind => ({
    value: s(v.kodekelompok), onChange: (x) => set("kodekelompok", x),
    children: opts(kel.rows.map((r) => [r.kodekelompok, kode ? r.kodekelompok : r.namakelompok]), ""),
  });
  const autoKode = () => set(key, kodeUrut(rows.map((r) => r[key]), "", SIMPLE_LEBAR[table]));
  const bind: Record<string, Bind> = {
    tKode: txt(v[key], (x) => set(key, x)),
    tNama: txt(v[name], (x) => set(name, x)),
    cAutoKode: { onClick: autoKode },
    // "+" di Data Satuan tidak punya handler di aslinya; Command1 hanya ada di form itu.
    Command1: { onClick: () => undefined },
    cKeloimpokNama: pair(false), cKelompokKode: pair(true),
    cAddKelompok: { onClick: () => setAddKel(true) },
    lsData: () => <VbGrid cols={cols} rows={rows} rowKey={(r) => r[key]} selected={sorot} onSelect={setSorot} onOpen={pickRow} />,
    cBaru: { onClick: kosongkan },
    cSimpan: { onClick: () => void simpan() },
    cHapus: { onClick: hapus },
    cTutup: { onClick: close },
  };
  const extra = (
    <>
      {msg.node}
      {addKel && <SimpleMaster table="mdkelompok" onClose={() => { setAddKel(false); kel.reload(); }} />}
    </>
  );

  if (props.onClose) return <VbModal form={form} bind={bind} onClose={close}>{extra}</VbModal>;
  return (
    <div className="vbm-area" ref={ref}>
      <VbForm form={form} bind={bind} />
      {extra}
    </div>
  );
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
