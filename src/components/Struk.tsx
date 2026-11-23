import { createPortal } from "react-dom";
import { api, Row } from "../api";
import { tglID } from "../format";
import { fmtHrgStruk as rp, fmtQtyStruk as qty, kertasStruk } from "../pages/kasirSettings";

/** Struk 58/80 mm. Hanya tampil saat dicetak (lihat CSS body[data-print="struk"]). */
export function Struk({ trans, setting }: { trans: { header: Row; detail: Row[] } | null; setting: Row | null }) {
  if (!trans) return null;
  const h = trans.header;
  const s = setting ?? {};
  const bayar = h.carabayar === "Non Tunai" ? Number(h.bayarlain1) : Number(h.jmlbayar);
  const kertas = kertasStruk();
  return createPortal(
    <div className="struk" style={{ width: kertas.lebar, fontSize: kertas.fontPx }}>
      <style>{`@media print { @page { size: ${kertas.halaman}; margin: ${kertas.halaman.includes("auto") ? "2mm" : "10mm"}; } }`}</style>
      <div className="center bold">{s.namausaha}</div>
      {s.alamat && <div className="center">{s.alamat}{s.kota ? `, ${s.kota}` : ""}</div>}
      {s.tlp && <div className="center">Telp. {s.tlp}</div>}
      {s.header1 && <div className="center">{s.header1}</div>}
      {s.header2 && <div className="center">{s.header2}</div>}
      <hr />
      <div className="row"><span>{h.notrans}</span><span>{tglID(h.tgltrans)} {String(h.jamupload ?? "").slice(0, 5)}</span></div>
      <div className="row"><span>Kasir: {h.namakasir}</span><span>{h.namapelanggan !== "Tunai" ? h.namapelanggan : ""}</span></div>
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
      <div className="row"><span>Jumlah</span><span>{rp(h.jmltrans)}</span></div>
      {Number(h.diskonnilai) > 0 && <div className="row"><span>Diskon</span><span>-{rp(h.diskonnilai)}</span></div>}
      {Number(h.biaya) > 0 && <div className="row"><span>Biaya lain</span><span>{rp(h.biaya)}</span></div>}
      {Number(h.ppnnilai) > 0 && <div className="row"><span>PPN {qty(h.ppn)}%</span><span>{rp(h.ppnnilai)}</span></div>}
      <div className="row bold"><span>TOTAL</span><span>{rp(h.totaltrans)}</span></div>
      <div className="row"><span>{h.carabayar === "Kredit" ? "Uang muka" : h.carabayar === "Non Tunai" ? `${h.ketbayarlain1} ${h.kartu ?? ""}` : "Bayar"}</span><span>{rp(bayar)}</span></div>
      {h.carabayar !== "Non Tunai" && Number(h.bayarlain1) > 0 && <div className="row"><span>{h.ketbayarlain1} {h.kartu ?? ""}</span><span>{rp(h.bayarlain1)}</span></div>}
      {h.carabayar === "Tunai" && <div className="row"><span>Kembali</span><span>{rp(h.sisa)}</span></div>}
      {h.carabayar === "Kredit" && <div className="row"><span>Sisa hutang</span><span>{rp(-Number(h.sisa))}</span></div>}
      {Number(h.poinmasuk) > 0 && (
        <>
          <div className="row"><span>Poin Anda bertambah</span><span>{qty(h.poinmasuk)}</span></div>
          <div className="row"><span>Total poin Anda</span><span>{qty(h.poinakhir)}</span></div>
        </>
      )}
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

export const cetakStruk = () => cetakMode("struk");
export const cetakLaporan = () => cetakMode("laporan");

/** Isi struk sebagai teks monospasi (kotak "tStruk" pada jendela Struk Penjualan). */
export function strukTeks(trans: { header: Row; detail: Row[] }, setting: Row | null): string {
  const h = trans.header;
  const s = setting ?? {};
  const W = kertasStruk().kolom;
  // Teks lebih panjang dari lebar kertas dibungkus per kata, tiap baris diratakan tengah.
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
  const garis = "-".repeat(W);
  const bayar = h.carabayar === "Non Tunai" ? Number(h.bayarlain1) : Number(h.jmlbayar);
  const L: string[] = [];
  const tambah = (t: unknown) => { if (t) L.push(tengah(t)); };
  tambah(s.namausaha);
  if (s.alamat) tambah(`${s.alamat}${s.kota ? `, ${s.kota}` : ""}`);
  if (s.tlp) tambah(`Telp. ${s.tlp}`);
  tambah(s.header1);
  tambah(s.header2);
  L.push(garis, dua(h.notrans, `${tglID(h.tgltrans)} ${String(h.jamupload ?? "").slice(0, 5)}`),
    dua(`Kasir: ${h.namakasir}`, h.namapelanggan !== "Tunai" ? h.namapelanggan : ""), garis);
  for (const d of trans.detail) {
    L.push(String(d.namabarang ?? ""));
    if (Number(d.hrgterjual) === 0 && Number(d.jmljual) > 0 && h.kode === "TJ") L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} (bonus)`, "Gratis"));
    else L.push(dua(`${qty(d.jmljual)} ${d.satuanjual} x ${rp(d.hrgterjual)}`, rp(d.subtotal)));
    if (Number(d.disknilai) > 0) L.push(dua("  Potongan", `-${rp(d.disknilai)}`));
  }
  L.push(garis, dua("Jumlah", rp(h.jmltrans)));
  if (Number(h.diskonnilai) > 0) L.push(dua("Diskon", `-${rp(h.diskonnilai)}`));
  if (Number(h.biaya) > 0) L.push(dua("Biaya lain", rp(h.biaya)));
  if (Number(h.ppnnilai) > 0) L.push(dua(`PPN ${qty(h.ppn)}%`, rp(h.ppnnilai)));
  L.push(dua("TOTAL", rp(h.totaltrans)));
  L.push(dua(h.carabayar === "Kredit" ? "Uang muka" : h.carabayar === "Non Tunai" ? `${h.ketbayarlain1} ${h.kartu ?? ""}` : "Bayar", rp(bayar)));
  if (h.carabayar !== "Non Tunai" && Number(h.bayarlain1) > 0) L.push(dua(`${h.ketbayarlain1} ${h.kartu ?? ""}`.trim(), rp(h.bayarlain1)));
  if (h.carabayar === "Tunai") L.push(dua("Kembali", rp(h.sisa)));
  if (h.carabayar === "Kredit") L.push(dua("Sisa hutang", rp(-Number(h.sisa))));
  if (Number(h.poinmasuk) > 0) L.push(dua("Poin Anda bertambah", qty(h.poinmasuk)), dua("Total poin Anda", qty(h.poinakhir)));
  L.push(garis);
  tambah(s.footer1);
  tambah(s.footer2);
  return L.join("\n");
}
