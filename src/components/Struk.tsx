import { createPortal } from "react-dom";
import { api, Row } from "../api";
import { localDate, sekarang, tglID } from "../format";
import { fmtHrgStruk as rp, fmtQtyStruk as qty, kertasStruk, polaAngka } from "../pages/kasirSettings";
import { getLocal, KODE_DRAWER_BAWAAN } from "../pages/localSettings";

/** Struk 58/80 mm untuk dialog cetak sistem, isinya sama persis dengan teks struk. Hanya tampil saat dicetak (lihat CSS body[data-print="struk"]). */
export function Struk({ trans, setting, teks, cetakUlang }: { trans: { header: Row; detail: Row[] } | null; setting: Row | null; teks?: string; cetakUlang?: boolean }) {
  if (!trans) return null;
  const kertas = kertasStruk();
  return createPortal(
    <div className="struk" style={{ width: kertas.lebar, fontSize: kertas.fontPx }}>
      <style>{`@media print { @page { size: ${kertas.halaman}; margin: ${kertas.halaman.includes("auto") ? "2mm" : "10mm"}; } }`}</style>
      <pre>{teks ?? strukTeks(trans, setting, { cetakUlang })}</pre>
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

/** Pembulatan CInt VB: setengah dibulatkan ke bilangan genap terdekat. */
function bulatVb(x: number): number {
  const f = Math.floor(x);
  const sisa = x - f;
  if (sisa > 0.5) return f + 1;
  if (sisa < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Right(Space(n) & s, n) gaya VB: rata kanan sepanjang n, kelebihan di kiri terpotong. */
const kananVb = (s: unknown, n: number) => String(s ?? "").padStart(n).slice(-n);
/** Left(s & Space(n), n) gaya VB. */
const kiriVb = (s: unknown, n: number) => String(s ?? "").padEnd(n).slice(0, n);
const angkaBulat = (n: unknown) => String(Math.round(Number(n) || 0));

/**
 * Isi struk penjualan sebagai teks monospasi (kotak "tStruk" pada jendela Struk Penjualan dan cetak langsung ESC/POS).
 * Susunannya disalin dari aplikasi lama: CetkNotaBesar (80 mm) dan CetakNotaKecil (58 mm) di FrmTransJualBayar untuk
 * struk sesudah bayar, dan CetakData di FrmTransJual untuk Cetak Ulang (tanggal transaksi tanpa jam, poin berupa
 * "Total poin Anda"). Lebar baris: 40 kolom (garis) dengan isi 39 kolom di 80 mm, 32 kolom di 58 mm.
 */
export function strukTeks(trans: { header: Row; detail: Row[] }, setting: Row | null, opsi: { cetakUlang?: boolean } = {}): string {
  const h = trans.header;
  const s = setting ?? {};
  const kecil = kertasStruk().kolom <= 32;
  const ulang = !!opsi.cetakUlang;
  const lebarTengah = kecil ? 30 : 38;
  const garis = "-".repeat(kecil ? 32 : 40);
  const tengah = (t: unknown) => {
    const x = String(t ?? "");
    if (x.length >= lebarTengah) return x;
    const n = bulatVb((lebarTengah - x.length) / 2);
    return " ".repeat(n) + x + " ".repeat(n);
  };
  const L: string[] = [];

  // Kepala: nama usaha, alamat, dan kota selalu dicetak (baris kosong kalau tidak diisi); pesan header hanya bila diisi.
  L.push(tengah(s.namausaha), tengah(s.alamat), tengah(s.kota));
  if (String(s.header1 ?? "")) L.push(tengah(s.header1));
  if (String(s.header2 ?? "")) L.push(tengah(s.header2));
  L.push("");

  // Struk sesudah bayar memakai tanggal dan jam saat dicetak; Cetak Ulang memakai tanggal transaksi.
  const kini = sekarang();
  const tgl = ulang ? tglID(h.tgltrans) : tglID(localDate(kini));
  const jam = `${String(kini.getHours()).padStart(2, "0")}:${String(kini.getMinutes()).padStart(2, "0")}`;
  const kasir = `Kasir : ${h.namakasir ?? ""}`;
  if (kecil) {
    L.push(`No    : ${h.notrans}${kananVb(`#${tgl}`, 12)}`);
    L.push(ulang ? kasir : kiriVb(kasir, 20) + kananVb(jam, 12));
  } else {
    L.push(`No    : ${h.notrans}${kananVb(ulang ? `#${tgl}` : `#${tgl}-${jam}`, 19)}`);
    L.push(kasir);
  }
  if (String(h.namasales ?? "")) L.push(`Sales : ${h.namasales}`);
  // Pelanggan Tunai tertulis "Tunai"; pelanggan lain dengan namanya.
  L.push(`Pel.  : ${!h.kodepelanggan || h.kodepelanggan === "Tunai" ? "Tunai" : (h.namapelanggan ?? "")}`);
  L.push(garis);

  // Barang: nama (dipotong), lalu "jml satuan X @harga : subtotal". Barang bonus (harga 0) dicetak dengan susunan yang sama.
  for (const d of trans.detail) {
    const jml = Number(d.jmljual) || 0;
    const harga = Number(d.hrgterjual) || 0;
    const sub = rp(harga * jml);
    if (kecil) {
      L.push(kiriVb(d.namabarang, 31));
      L.push(`${kananVb(`${qty(jml)} ${String(d.satuanjual ?? "").slice(0, 3)}`, 9)} X ${kananVb(`@${rp(harga)}`, 9)}:${kananVb(sub, 10)}`);
      if (Number(d.disknilai)) L.push(`            Potongan :${kananVb(polaAngka("-###,##0", Number(d.disknilai)), 10)}`);
    } else {
      L.push(kiriVb(d.namabarang, 39));
      L.push(`${kananVb(`${qty(jml)} ${d.satuanjual ?? ""}`, 11)} X${kananVb(`@${rp(harga)}`, 11)} :${kananVb(sub, 13)}`);
      if (Number(d.disknilai)) L.push(`                Potongan :${kananVb(polaAngka("-###,##0", Number(d.disknilai)), 13)}`);
    }
  }
  L.push(garis);

  // Total: label rata kanan dengan titik dua sejajar, nilai rata kanan.
  const W = kecil ? 11 : 13;
  const label: Record<string, string> = kecil
    ? { jenis: "       Total Jenis : ", item: "       Total Item  : ", jual: "       Total Jual  : ", diskon: "       Diskon      : ",
        biaya: "       Biaya Lain  : ", total: "       Total       : ", dp: "       Uang Muka   : ", tunai: "       Tunai       : ",
        nontunai: "       Non Tunai   : ", piutang: "       Piutang     : ", tempo: "       Jth. Tempo  : ", kembali: "       Kembali     : ",
        card: "       Card : ", belum: "Piutang blm dibayar:" }
    : { jenis: "            Total Jenis  :", item: "            Total Item   :", jual: "            Total Jual   :", diskon: "            Diskon Total :",
        biaya: "            Biaya Lain   :", total: "            Total        :", dp: "            Uang Muka    :", tunai: "            Tunai        :",
        nontunai: "            Non Tunai    :", piutang: "            Piutang      :", tempo: "            Jatuh Tempo  :", kembali: "            Kembali      :",
        card: "            Card : ", belum: "  Piutang belum terbayar :" };
  const baris = (k: string, nilai: string, lebar = W) => L.push(label[k] + kananVb(nilai, lebar));
  const totalItem = trans.detail.reduce((n, d) => n + (Number(d.jmljual) || 0), 0);
  baris("jenis", polaAngka("###,##0", trans.detail.length));
  baris("item", qty(totalItem));
  baris("jual", rp(h.jmltrans));
  L.push(garis);
  if (Number(h.diskonnilai)) baris("diskon", rp(h.diskonnilai));
  if (Number(h.biaya)) baris("biaya", rp(h.biaya));
  // PPN tidak ada di aplikasi lama; dicetak hanya kalau toko memakainya, supaya total tetap terbaca.
  if (Number(h.ppnnilai)) {
    const ppn = `PPN ${qty(h.ppn)}%`;
    L.push((kecil ? kiriVb(`       ${ppn}`, 19) + ": " : kiriVb(`            ${ppn}`, 25) + ":") + kananVb(rp(h.ppnnilai), W));
  }
  baris("total", rp(h.totaltrans));
  const uangMuka = Number(h.uangmuka) || 0;
  const tunai = h.tunaibayar != null ? Number(h.tunaibayar) || 0 : (Number(h.jmlbayar) || 0) - uangMuka;
  const nonTunai = Number(h.bayarlain1) || 0;
  const sisa = Number(h.sisa) || 0;
  if (uangMuka) baris("dp", rp(uangMuka));
  baris("tunai", rp(tunai));
  if (nonTunai > 0) baris("nontunai", rp(nonTunai));
  if (sisa < 0) {
    baris("piutang", rp(-sisa));
    baris("tempo", tglID(h.tgljthtempo));
  } else {
    baris("kembali", rp(sisa));
  }
  if (nonTunai > 0) L.push(`${label.card}${h.ketbayarlain1 ?? ""} ${h.kartu ?? ""}`);
  // 58 mm: lebar nilai 12 (aslinya 13), supaya baris tidak melebihi 32 kolom kertas.
  if (Number(h.piutangpelanggan) > 0) baris("belum", rp(h.piutangpelanggan), kecil ? 12 : 13);
  L.push(garis);

  // Poin: struk sesudah bayar menyebut tambahan dan total poin; Cetak Ulang menyebut poin pelanggan saat ini.
  if (Number(h.poinmasuk) > 0) {
    if (ulang) L.push(tengah(`Total poin Anda : ${angkaBulat(h.poinpelanggan ?? h.poinakhir)}`));
    else L.push(tengah(`Poin Anda bertambah ${angkaBulat(h.poinmasuk)}`), tengah(`Total poin : ${angkaBulat(h.poinakhir)}`));
    L.push(garis);
  }
  const catatan = String(h.catatan ?? "");
  if (catatan) L.push("Catatan:", catatan, garis);
  if (String(s.footer1 ?? "")) L.push(tengah(s.footer1));
  if (String(s.footer2 ?? "")) L.push(tengah(s.footer2));
  // Garis penutup lalu empat baris kosong untuk jarak sobek, seperti aslinya.
  L.push(garis, "", "", "", "", "");
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
