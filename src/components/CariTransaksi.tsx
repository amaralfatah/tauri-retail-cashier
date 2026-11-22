import { useEffect, useState } from "react";
import { api, Row } from "../api";
import { rp, tglID, today } from "../format";
import { Geom } from "../vb/VbForm";
import { VbModal } from "../vb/VbGrid";

/**
 * FrmCariTransJual / FrmCariTransBeli: daftar transaksi untuk dipilih (asal retur, cetak ulang, surat jalan, SPK).
 * Tanggal awal dan akhir hari ini, daftar dimuat ulang tiap ketikan, panah bawah dari kotak cari pindah ke daftar.
 */
export function CariTransaksi(props: { kode: "TJ" | "TB"; onPick: (notrans: string) => void; onClose: () => void }) {
  const jual = props.kode === "TJ";
  const [cari, setCari] = useState("");
  const [tgl1, setTgl1] = useState(today());
  const [tgl2, setTgl2] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState(0);
  const [muat, setMuat] = useState(0);

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      api.listTransaksi(props.kode, tgl1, tgl2, cari)
        .then((r) => { if (!batal) { setRows(r); setSel(0); } })
        .catch(() => !batal && setRows([]));
    }, 120);
    return () => { batal = true; clearTimeout(t); };
  }, [props.kode, tgl1, tgl2, cari, muat]);

  const ambil = () => rows[sel] && props.onPick(rows[sel].notrans);
  const bind = {
    tData: { value: cari, onChange: setCari },
    dtTgl1: { value: tgl1, onChange: (v: string) => v && setTgl1(v) },
    dtTgl2: { value: tgl2, onChange: (v: string) => v && setTgl2(v) },
    cOK: { onClick: () => setMuat((n) => n + 1) },
    cAmbil: { onClick: ambil },
    cClose: { onClick: props.onClose },
    lsData: (g: Geom) => (
      <div className="tj-grid cari-data" tabIndex={0} style={{ width: g.width, height: g.height }} onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
        else if (e.key === "Enter") { e.preventDefault(); ambil(); }
      }}>
        <table>
          <colgroup><col style={{ width: "22%" }} /><col style={{ width: "14%" }} /><col style={{ width: "28%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /></colgroup>
          <thead><tr><th style={{ textAlign: "left" }}>No. Transaksi</th><th>Tanggal</th><th>{jual ? "Pelanggan" : "Pemasok"}</th><th>Sales</th><th className="r">Total</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.notrans} className={i === sel ? "cur" : ""} onMouseDown={() => setSel(i)} onDoubleClick={() => props.onPick(r.notrans)}>
                <td>{r.notrans}</td><td>{tglID(r.tgltrans)}</td><td className="nm">{r.kontak}</td><td className="nm">{r.sales}</td><td className="r">{rp(r.totaltrans)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  };
  // Enter di kotak cari memuat ulang; panah bawah dari kotak cari pindah ke daftar bila ada isinya.
  return (
    <div style={{ display: "contents" }} onKeyDownCapture={(e) => {
      if (!(e.target instanceof HTMLInputElement)) return;
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setMuat((n) => n + 1); }
      else if (e.key === "ArrowDown" && e.target.closest('[data-vb="tData"]') && rows.length) {
        e.preventDefault();
        document.querySelector<HTMLElement>(".cari-data")?.focus();
      }
    }}>
      <VbModal form={jual ? "FrmCariTransJual" : "FrmCariTransBeli"} bind={bind} onClose={props.onClose} />
    </div>
  );
}
