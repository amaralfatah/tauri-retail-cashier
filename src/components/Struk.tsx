import { createPortal } from "react-dom";
import { api, Row } from "../api";
import { tglID } from "../format";
import { fmtHrgStruk as rp, fmtQtyStruk as qty, kertasStruk } from "../pages/kasirSettings";
import { getLocal, KODE_DRAWER_BAWAAN } from "../pages/localSettings";

/**
 * Baris kepala dan baris total struk penjualan, mengikuti struk aplikasi lama (CetakNotaKecil / CetakData):
 * No, Kasir, Sales, Pel., lalu Total Jenis, Total Item, Total Jual, Diskon Total, Biaya Lain, Total, Uang Muka, Tunai,
 * Non Tunai + Card, Piutang, Jatuh Tempo, Kembali (hanya bila lebih dari 0), Piutang belum terbayar, poin, dan Catatan.
 * Kertas 58 mm memakai label pendek seperti aslinya (Jth. Tempo, Piutang blm dibayar).
 */
function barisStruk(trans: { header: Row; detail: Row[] }, kolom: number) {
  const h = trans.header;
  const pendek = kolom <= 32;
  const kepala: [string, string][] = [[`No    : ${h.notrans}`, `${tglID(h.tgltrans)} ${String(h.jamupload ?? "").slice(0, 5)}`], [`Kasir : ${h.namakasir ?? ""}`, ""]];
  if (h.namasales) kepala.push([`Sales : ${h.namasales}`, ""]);
  if (h.namapelanggan && h.namapelanggan !== "Tunai") kepala.push([`Pel.  : ${h.namapelanggan}`, ""]);
  const item = trans.detail.reduce((n, d) => n + Number(d.jmljual || 0), 0);
  const kredit = h.carabayar === "Kredit";
  const tunai = Number(h.jmlbayar) || 0;
  const nonTunai = Number(h.bayarlain1) || 0;
  const total: [string, string, boolean?][] = [
    ["Total Jenis", String(trans.detail.length)],
    ["Total Item", qty(item)],
    ["Total Jual", rp(h.jmltrans)],
  ];
  if (Number(h.diskonnilai) > 0) total.push([pendek ? "Diskon" : "Diskon Total", rp(h.diskonnilai)]);
  if (Number(h.biaya) > 0) total.push(["Biaya Lain", rp(h.biaya)]);
  if (Number(h.ppnnilai) > 0) total.push([`PPN ${qty(h.ppn)}%`, rp(h.ppnnilai)]);
  total.push(["Total", rp(h.totaltrans), true]);
  if (kredit && tunai > 0) total.push(["Uang Muka", rp(tunai)]);
  if (!kredit && (tunai > 0 || nonTunai === 0)) total.push(["Tunai", rp(tunai)]);
  if (nonTunai > 0) {
    total.push(["Non Tunai", rp(nonTunai)]);
    const kartu = `${h.ketbayarlain1 ?? ""} ${h.kartu ?? ""}`.trim();
    if (kartu) total.push([`Card : ${kartu}`, ""]);
  }
  if (kredit) {
    total.push(["Piutang", rp(-Number(h.sisa))]);
    if (h.tgljthtempo) total.push([pendek ? "Jth. Tempo" : "Jatuh Tempo", tglID(h.tgljthtempo)]);
  }
  if (!kredit && Number(h.sisa) > 0) total.push(["Kembali", rp(h.sisa)]);
  if (Number(h.piutangpelanggan) > 0) total.push([pendek ? "Piutang blm dibayar" : "Piutang belum terbayar", rp(h.piutangpelanggan)]);
  if (Number(h.poinmasuk) > 0) total.push(["Poin Anda bertambah", qty(h.poinmasuk)], ["Total poin Anda", qty(h.poinakhir)]);
  return { kepala, total, catatan: String(h.catatan ?? "").trim() };
}

/** Struk 58/80 mm. Hanya tampil saat dicetak (lihat CSS body[data-print="struk"]). */
export function Struk({ trans, setting }: { trans: { header: Row; detail: Row[] } | null; setting: Row | null }) {
  if (!trans) return null;
  const h = trans.header;
  const s = setting ?? {};
  const kertas = kertasStruk();
  const b = barisStruk(trans, kertas.kolom);
  return createPortal(
    <div className="struk" style={{ width: kertas.lebar, fontSize: kertas.fontPx }}>
      <style>{`@media print { @page { size: ${kertas.halaman}; margin: ${kertas.halaman.includes("auto") ? "2mm" : "10mm"}; } }`}</style>
      <div className="center bold">{s.namausaha}</div>
      {s.alamat && <div className="center">{s.alamat}{s.kota ? `, ${s.kota}` : ""}</div>}
      {s.tlp && <div className="center">Telp. {s.tlp}</div>}
      {s.header1 && <div className="center">{s.header1}</div>}
      {s.header2 && <div className="center">{s.header2}</div>}
      <hr />
      {b.kepala.map(([a, c]) => <div key={a} className="row"><span>{a}</span><span>{c}</span></div>)}
      <hr />
      {trans.detail.map((d) => (
        <div key={d.nourut}>
          <div>{d.namabarang}</div>
          {Number(d.hrgterjual) === 0 && Number(d.jmljual) > 0 && h.kode === "TJ" ? (
            <div className="row"><span>{qty(d.jmljual)} {d.satuanjual} (bonus)</span><span>Gratis</span></div>
          ) : (
            <div className="row"><span>{qty(d.jmljual)} {d.satuanjual} x {rp(d.hrgterjual)}</span><span>{rp(d.subtotal)}</span></div>
          )}
          {Number(d.disknilai) > 0 && <div className="row"><span>  Potongan</span><span>-{rp(d.disknilai)}</span></div>}
        </div>
      ))}
      <hr />
      {b.total.map(([a, c, tebal]) => <div key={a} className={tebal ? "row bold" : "row"}><span>{c ? `${a} :` : a}</span><span>{c}</span></div>)}
      {b.catatan && <div>Catatan: {b.catatan}</div>}
      <hr />
      {s.footer1 && <div className="center">{s.footer1}</div>}
      {s.footer2 && <div className="center">{s.footer2}</div>}
    </div>,
    document.body,
  );
}

/**
 * Pilih apa yang dicetak lalu buka dialog cetak. Atribut data-print hanya dipakai
 * di dalam @media print, jadi tidak perlu dibersihkan setelah dialog ditutup.
 */
async function cetakMode(mode: "struk" | "laporan") {
  document.body.dataset.print = mode;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await api.cetak();
}

/**
 * Apakah struk dikirim langsung ke printer kasir (ESC/POS / RAW) tanpa dialog cetak Windows.
 * Aktif bila Jenis Printer bukan Custom, ukuran kertas Mini Printer, dan Nama / Port Printer sudah diisi.
 */
export function pakaiCetakLangsung(): boolean {
  const jenis = getLocal("jnsPrinter");
  const kertas = getLocal("ukuranKertas");
  const port = getLocal("portPrinter").trim();
  return jenis !== "Custom" && !/A4|A5/i.test(kertas) && port.length > 0;
}

/**
 * Cetak struk. Bila printer struk Direct sudah diisi di Pengaturan dan kertasnya Mini Printer,
 * kirim langsung ke printer tanpa dialog cetak Windows; selain itu buka dialog cetak sistem.
 */
export async function cetakStruk(teks?: string) {
  if (teks && pakaiCetakLangsung()) {
    await api.cetakLangsung(getLocal("jnsPort"), getLocal("portPrinter").trim(), teks, true);
    return;
  }
  await cetakMode("struk");
}

/** Buka laci kasir (cash drawer) bila diaktifkan di Pengaturan → Peralatan. */
export async function bukaLaciOtomatis() {
  if (getLocal("drawer") !== "1") return;
  const jenisPort = getLocal("jnsPort");
  const tujuan = getLocal("portDrawer").trim() || getLocal("portPrinter").trim();
  const kode = getLocal("kodeDrawer").trim() || KODE_DRAWER_BAWAAN;
  await api.bukaLaci(jenisPort, tujuan, kode);
}

export const cetakLaporan = () => cetakMode("laporan");

function pembantuTeks(W: number) {
  const bungkus = (x: string): string[] => {
    const out: string[] = [];
    let baris = "";
    for (let kata of x.split(/\s+/).filter(Boolean)) {
      while (kata.length > W) { // satu kata lebih panjang dari kertas: potong
        if (baris) { out.push(baris); baris = ""; }
        out.push(kata.slice(0, W)); kata = kata.slice(W);
      }
      if (!baris) baris = kata;
      else if (baris.length + 1 + kata.length <= W) baris += ` ${kata}`;
      else { out.push(baris); baris = kata; }
    }
    if (baris) out.push(baris);
    return out;
  };
  const tengah = (t: unknown) => bungkus(String(t ?? "")).map((x) => x.padStart(Math.floor((W + x.length) / 2))).join("\n");
  const dua = (a: unknown, b: unknown) => {
    const kiri = String(a ?? ""), kanan = String(b ?? "");
    return kiri.length + kanan.length + 1 > W ? `${kiri}\n${kanan.padStart(W)}` : kiri + kanan.padStart(W - kiri.length);
  };
  return { tengah, dua, garis: "-".repeat(W) };
}

/** Isi struk sebagai teks monospasi (kotak "tStruk" pada jendela Struk Penjualan dan cetak langsung ESC/POS). */
export function strukTeks(trans: { header: Row; detail: Row[] }, setting: Row | null): string {
  const h = trans.header;
  const s = setting ?? {};
  const kolom = kertasStruk().kolom;
  const { tengah, dua, garis } = pembantuTeks(kolom);
  const b = barisStruk(trans, kolom);
  const L: string[] = [];
  const tambah = (t: unknown) => { if (t) L.push(tengah(t)); };
  tambah(s.namausaha);
  if (s.alamat) tambah(`${s.alamat}${s.kota ? `, ${s.kota}` : ""}`);
  if (s.tlp) tambah(`Telp. ${s.tlp}`);
  tambah(s.header1);
  tambah(s.header2);
  L.push(garis, ...b.kepala.map(([a, c]) => (c ? dua(a, c) : a)), garis);
  for (const d of trans.detail) {
    L.push(String(d.namabarang ?? ""));
    if (Number(d.hrgterjual) === 0 && Number(d.jmljual) > 0 && h.kode === "TJ") L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} (bonus)`, "Gratis"));
    else L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} x ${rp(d.hrgterjual)}`, rp(d.subtotal)));
    if (Number(d.disknilai) > 0) L.push(dua("  Potongan", `-${rp(d.disknilai)}`));
  }
  L.push(garis, ...b.total.map(([a, c]) => (c ? dua(`${a} :`, c) : a)));
  if (b.catatan) L.push("Catatan:", b.catatan);
  L.push(garis);
  tambah(s.footer1);
  tambah(s.footer2);
  return L.join("\n");
}

/** Isi struk order penjualan / pembelian sebagai teks monospasi untuk cetak langsung. */
export function strukOrderTeks(order: { header: Row; detail: Row[] }, setting: Row | null): string {
  const h = order.header;
  const s = setting ?? {};
  const jual = h.kode === "SO";
  const { tengah, dua, garis } = pembantuTeks(kertasStruk().kolom);
  const L: string[] = [];
  if (s.namausaha) L.push(tengah(s.namausaha));
  if (s.alamat) L.push(tengah(`${s.alamat}${s.kota ? `, ${s.kota}` : ""}`));
  L.push(tengah(jual ? "ORDER PENJUALAN" : "ORDER PEMBELIAN"));
  L.push(garis, dua(h.notrans, tglID(h.tglorder)),
    dua(jual ? "Pelanggan" : "Supplier", jual ? h.namapelanggan : h.namapemasok),
    dua("Petugas", h.namakasir), garis);
  for (const d of order.detail) {
    L.push(String(d.namabarang ?? ""));
    L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} x ${rp(d.hrgterjual)}`, rp(Number(d.jmljual) * Number(d.hrgterjual) - Number(d.disknilai || 0))));
  }
  L.push(garis, dua("TOTAL", rp(h.jmltrans)));
  if (jual && Number(h.jmlbayar) > 0) L.push(dua("Uang muka", rp(h.jmlbayar)));
  if (h.catatan) L.push(String(h.catatan));
  return L.join("\n");
}

/** Isi bukti retur penjualan / pembelian sebagai teks monospasi untuk cetak langsung. */
export function buktiReturTeks(data: { header: Row; detail: Row[] }, setting: Row | null): string {
  const h = data.header;
  const s = setting ?? {};
  const { tengah, dua, garis } = pembantuTeks(kertasStruk().kolom);
  const L: string[] = [];
  if (s.namausaha) L.push(tengah(s.namausaha));
  L.push(tengah(h.kode === "RJ" ? "BUKTI RETUR PENJUALAN" : "BUKTI RETUR PEMBELIAN"));
  L.push(garis, dua(h.notrans, tglID(h.tgltrans)),
    dua(h.kode === "RJ" ? "Pelanggan" : "Supplier", h.kode === "RJ" ? h.namapelanggan : h.namapemasok),
    dua("Petugas", h.namakasir), garis);
  for (const d of data.detail) {
    L.push(String(d.namabarang ?? ""));
    L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} x ${rp(d.hrgterjual)}`, rp(Number(d.jmljual) * Number(d.hrgterjual))));
  }
  L.push(garis, dua("TOTAL", rp(h.totaltrans ?? h.jmltrans)));
  return L.join("\n");
}
