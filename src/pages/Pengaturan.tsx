import { pilihFolder, pilihGambar } from "../api/dialog";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { api, errText, Row } from "../api";
import { useApp } from "../appContext";
import { Geom, VbForm } from "../vb/VbForm";
import { ModalFrame, useMsgBox, VbModal } from "../vb/VbGrid";
import { LocalKey, LocalSettings, loadLocal, saveLocal } from "./localSettings";
import "./pengaturan.css";

export { Pengguna } from "./Pengguna";

const TABS = ["Info Usaha", "Transaksi", "Peralatan"];
/** Kolom tseting yang berisi angka; sisanya teks atau 0/1. */
const ANGKA = ["tempopiutang", "mintranspoin", "jmlpointrans"];

const UKURAN_KERTAS = ["Mini Printer 56mm-58mm", "Mini Printer 75mm-80mm", "Kertas A4", "Kertas A5"];
const JENIS_PRINTER = ["Direct", "Custom", "Direct-Custom"];
const JENIS_PORT = ["USB", "LPT"];
const FORMAT_QTY = ["###,##0", "###,##0.0", "###,##0.00"];
const FORMAT_HRG = ["###,##0", "###,##0.00"];
/** Urutan sama dengan nilai tersimpan: 0 = Grid, 1 = TextBox (kotak scan di atas tabel). */
const MODE_SCAN = ["Grid", "TextBox"];
/** Nilai tersimpan "Home" atau "Dashboard"; tulisan di combo mengikuti aslinya. */
const HOME: [string, string][] = [["Home", "Home Backgroud"], ["Dashboard", "Dashboard Transaksi"]];

/** Pengaturan lama bisa berisi pilihan yang tidak ada lagi di combo (mis. Mini Printer atau COM); pakai pilihan pertama. */
function rapikan(l: LocalSettings): LocalSettings {
  const pilih = (v: string, daftar: string[]) => (daftar.includes(v) ? v : daftar[0]);
  return {
    ...l,
    jnsPrinter: pilih(l.jnsPrinter, JENIS_PRINTER),
    jnsPort: pilih(l.jnsPort, JENIS_PORT),
    formatQty: pilih(l.formatQty, FORMAT_QTY),
    formatHrg: pilih(l.formatHrg, FORMAT_HRG),
    ukuranKertas: pilih(l.ukuranKertas, UKURAN_KERTAS),
    home: pilih(l.home, HOME.map((h) => h[0])),
  };
}
const muatLokal = () => rapikan(loadLocal());
/** Angka contoh yang diketik (koma = desimal) menjadi angka biasa. */
const angkaContoh = (t: string) => Number(t.replace(/\./g, "").replace(",", ".")) || 0;

/** Terapkan pola angka gaya VB (mis. ###,##0.00) pada sebuah angka. */
export function formatPola(pola: string, n: number): string {
  const des = (pola.split(".")[1] ?? "").replace(/[^0#]/g, "").length;
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: des, maximumFractionDigits: des, useGrouping: pola.includes(",") }).format(n);
}

const opsi = (xs: string[]) => <>{xs.map((x) => <option key={x} value={x}>{x}</option>)}</>;
const opsiHome = (xs: [string, string][]) => <>{xs.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</>;
const opsiIdx = (xs: string[]) => <>{xs.map((x, i) => <option key={x} value={String(i)}>{x}</option>)}</>;

export function Pengaturan() {
  const { user, setting, reloadSetting, go } = useApp();
  const msg = useMsgBox();
  const [tab, setTab] = useState(0);
  const [v, setV] = useState<Row>(setting);
  const [l, setL] = useState<LocalSettings>(muatLokal);
  const [profil, setProfil] = useState(false);
  const [mulaiUlang, setMulaiUlang] = useState(false);
  const [exQty, setExQty] = useState("1234567,891");
  const [exHrg, setExHrg] = useState("1234567");
  const bisaUbah = user.level !== "Kasir";

  useEffect(() => setV(setting), [setting]);

  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const setLocalVal = (k: LocalKey, val: string) => setL((x) => ({ ...x, [k]: val }));

  const simpan = async () => {
    try {
      if (bisaUbah) {
        const data: Row = { ...v };
        for (const k of ANGKA) data[k] = Number(String(v[k] ?? "").replace(",", ".")) || 0;
        await api.saveSettings(data);
        await reloadSetting();
      }
      saveLocal(l);
      setMulaiUlang(true);
    } catch (e) {
      msg.alert(errText(e));
    }
  };
  const batal = () => { setV(setting); setL(muatLokal()); };
  const pilihGbr = (k: LocalKey) => async () => { const p = await pilihGambar(); if (p) setLocalVal(k, p); };
  const pilihFolderFoto = async () => { const p = await pilihFolder(); if (p) setLocalVal("lokasiFoto", p); };

  /* ---- Pembantu pengikat kontrol ---- */
  const txt = (col: string) => ({ value: v[col] ?? "", onChange: (x: string) => set(col, x), disabled: !bisaUbah });
  /** Satu kolom tseting menyimpan beberapa pilihan sebagai bit: updateharga bit 1 = harga beli, bit 2 = harga jual. */
  const bit = (col: string, mask: number) => ({
    value: (Number(v[col]) & mask) !== 0 ? "1" : "0",
    onChange: (x: string) => set(col, x === "1" ? Number(v[col]) | mask : Number(v[col]) & ~mask),
    disabled: !bisaUbah,
  });
  const chk = (col: string) => ({ value: Number(v[col]) === 1 ? "1" : "0", onChange: (x: string) => set(col, Number(x)), disabled: !bisaUbah });
  const txtL = (k: LocalKey) => ({ value: l[k], onChange: (x: string) => setLocalVal(k, x) });
  const chkL = (k: LocalKey) => ({ value: l[k], onChange: (x: string) => setLocalVal(k, x) });
  const cboL = (k: LocalKey, children: ReactNode) => ({ value: l[k], onChange: (x: string) => setLocalVal(k, x), children });

  const bind = useMemo(() => ({
    xTab: (_g: Geom, c: { texts?: string[] }) => (
      <div className="vbp-tabs">
        <div className="vbp-page" />
        <div className="vbp-head">
          {(c.texts?.length ? c.texts : TABS).map((t, i) => <span key={t} className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{t}</span>)}
        </div>
      </div>
    ),

    /* Info Usaha */
    tNamaUsaha: txt("namausaha"), tBidangUsaha: txt("bidangusaha"), tPemilik: txt("pemilik"),
    tAlamat: txt("alamat"), tKota: txt("kota"), tProvinsi: txt("provinsi"), tKodePos: txt("kodepos"),
    tNoTlp: txt("tlp"), tFax: txt("fax"), tEmail: txt("email"), tWeb: txt("website"),
    tBackground: txtL("background"), tLogo: txtL("logo"),
    cOpenBG: { onClick: () => void pilihGbr("background")() }, cOpenLogo: { onClick: () => void pilihGbr("logo")() },
    chkAktifSkin: chkL("aktifSkin"),

    /* Transaksi */
    chkAktifLogin: chk("aktiflogin"), chkAktifPromo: chk("aktifpromo"), chkAktifLevel: chk("aktiflevel"), chkAktifSatuan: chk("aktifsatuan"),
    chkAktifPoin: chk("aktifpoin"), chkAktifPoinTrans: chk("aktiftranspoin"), tMinTransPoin: txt("mintranspoin"), tJmlPoin: txt("jmlpointrans"),
    chkBerlakuKelipatan: chk("berlakukelipatanpoin"),
    chkIzinStokMinus: chk("izinstokmin"), chkIzinHrg: chk("izinharga"), chkIzinDiskon: chk("izindiskon"), chkHubungkanKas: chk("aktiftranskas"),
    chkUpdateharga: bit("updateharga", 1),
    chkKonfirmasiKredit: chk("konfirmasikredit"),
    tJthTempo: { ...txt("tempopiutang"), onChange: (x: string) => set("tempopiutang", x.replace(/\D/g, "")) },
    chkUpdatehargaJual: bit("updateharga", 2), chkDefaultJmlByr: chkL("defaultJmlByr"),
    chkAutoLoad: chkL("autoLoad"), chkKursor: chkL("kursor"),
    chkAktifFoto: chkL("aktifFoto"), tLokasiFoto: txtL("lokasiFoto"), cOpenFoto: { onClick: () => void pilihFolderFoto() },
    cmbHome: cboL("home", opsiHome(HOME)),
    cmbModeScan: cboL("modeScan", opsiIdx(MODE_SCAN)),

    "picTab(1)": {
      children: bisaUbah ? (
        <button type="button" className="vb-btn" style={{ position: "absolute", left: 400, top: 316, width: 150, height: 24 }} onClick={() => go("nontunai")}>Jenis Non Tunai</button>
      ) : undefined,
    },

    /* Peralatan */
    tHeader1: txt("header1"), tHeader2: txt("header2"), tFooter1: txt("footer1"), tFooter2: txt("footer2"),
    cUkuranKertas: cboL("ukuranKertas", opsi(UKURAN_KERTAS)),
    cJnsPrinter: cboL("jnsPrinter", opsi(JENIS_PRINTER)),
    cJnsPort: cboL("jnsPort", opsi(JENIS_PORT)),
    tPortPrinter: txtL("portPrinter"),
    chkKonfirmasiCetak: chkL("konfirmasiCetak"),
    chkDrawer: chkL("drawer"), tPortDrawer: txtL("portDrawer"), tKodeDrawer: txtL("kodeDrawer"),
    cbFormatQty: cboL("formatQty", opsi(FORMAT_QTY)),
    cbFormatHrg: cboL("formatHrg", opsi(FORMAT_HRG)),
    tExQty: { value: exQty, onChange: (x: string) => setExQty(x.replace(/[^\d,.]/g, "")) }, tExQty2: { value: formatPola(l.formatQty, angkaContoh(exQty)) },
    tExHrg: { value: exHrg, onChange: (x: string) => setExHrg(x.replace(/[^\d,.]/g, "")) }, tExHrg2: { value: formatPola(l.formatHrg, angkaContoh(exHrg)) },

    /* Tombol bawah */
    cSimpan: { onClick: simpan }, cBatal: { onClick: batal }, cKeluar: { onClick: () => go("home") },
    Picture1: {
      children: <button type="button" className="vb-btn" style={{ position: "absolute", left: 224, top: 8, width: 120, height: 31 }} onClick={() => setProfil(true)}>Profil Pengguna</button>,
    },
  }), [v, l, tab, bisaUbah, exQty, exHrg]); // eslint-disable-line react-hooks/exhaustive-deps

  const hide = [0, 1, 2].filter((i) => i !== tab).map((i) => `picTab(${i})`);

  return (
    <div className="vbm-fill">
      <VbForm form="FrmZPengaturan" bind={bind} hide={hide} fill />
      {msg.node}
      {mulaiUlang && (
        <ModalFrame title="Software Toko Pro Unlimited" onClose={() => window.location.reload()} width={360}>
          <div className="vbm-msg">
            <p>Pengaturan Program sudah tersimpan.</p>
            <p>Program akan di restart untuk menyesuaikan perubahan pengaturan.</p>
            <div className="vbm-msg-btns">
              <button type="button" className="vb-btn" autoFocus onClick={() => window.location.reload()}>OK</button>
            </div>
          </div>
        </ModalFrame>
      )}
      {profil && <Profil onClose={() => setProfil(false)} />}
    </div>
  );
}

/** FrmZEditProfil: kode, nama, nama user, dan kata sandi akun yang sedang masuk. */
function Profil({ onClose }: { onClose: () => void }) {
  const { user } = useApp();
  const msg = useMsgBox();
  const [sandi, setSandi] = useState("");

  const simpan = async () => {
    if (!sandi) return msg.alert("Kata sandi baru belum diisi.");
    try {
      await api.changePassword("", sandi);
      setSandi("");
      msg.alert("Kata sandi Anda sudah diganti.");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  return (
    <VbModal form="FrmZEditProfil" bind={{
      lblKode: { text: user.kodekaryawan }, lblNama: { text: user.namakaryawan },
      tNamaUser: { value: user.iduser },
      tSandi: (g: Geom) => (
        <input className="vb-txt" style={{ width: g.width, height: g.height }} type="password" value={sandi}
          autoComplete="new-password" onChange={(e) => setSandi(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void simpan()} />
      ),
      // Aslinya menampilkan kata sandi. Di sini kata sandi disimpan terenkripsi, jadi tidak bisa ditampilkan.
      cCek: { onClick: () => msg.alert("Kata sandi Anda disimpan dalam bentuk terenkripsi, jadi tidak bisa ditampilkan. Kalau lupa, isi kata sandi baru lalu simpan.") },
      cSimpan: { onClick: () => void simpan() }, cTutup: { onClick: onClose },
    }} onClose={onClose}>
      {msg.node}
    </VbModal>
  );
}
