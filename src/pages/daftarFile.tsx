import { ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { errText } from "../api";
import { berkasApi } from "../api/berkas";
import { useApp } from "../appContext";
import { cetakLaporan } from "../components/Struk";
import { tglID, today } from "../format";
import { Bind } from "../vb/VbForm";
import { GridCol, useMsgBox, VbModal } from "../vb/VbGrid";
import "./daftarFile.css";

/** Teks isi sel daftar. Sel daftar berupa teks atau angka; yang lain dianggap kosong. */
export const teks = (v: ReactNode): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export interface OpsiCsv { pemisah: string; bom: boolean; lewatiKosong: boolean }

/** Isi file CSV dari kolom dan baris daftar. Dipisah titik koma supaya langsung terbaca di Excel berbahasa Indonesia. */
export function buatCsv<T>(cols: GridCol<T>[], rows: T[], o: OpsiCsv): string {
  const sep = o.pemisah === "\\t" ? "\t" : o.pemisah || ";";
  const esc = (s: string) => (s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const baris = rows.map((r, i) => cols.map((c) => teks(c.render(r, i)).trim()));
  const isi = o.lewatiKosong ? baris.filter((b) => b.some((x) => x !== "")) : baris;
  const semua = [cols.map((c) => c.title), ...isi].map((b) => b.map(esc).join(sep));
  return (o.bom ? "﻿" : "") + semua.join("\r\n") + "\r\n";
}

type Msg = ReturnType<typeof useMsgBox>;

/**
 * Tombol Export dan Cetak untuk daftar bergaya ListView. Export menyimpan daftar yang sedang tampil
 * (sesudah filter) sebagai CSV; Cetak mencetak daftar yang sama sebagai laporan sederhana.
 * Taruh `node` di dalam tampilan halaman.
 */
export function useDaftarFile<T>(judul: string, cols: GridCol<T>[], rows: T[], msg: Msg, excel?: string) {
  const { setting } = useApp();
  const [dlg, setDlg] = useState<string | null>(null);
  const [lembar, setLembar] = useState<T[] | null>(null);

  const ekspor = async () => {
    if (!rows.length) return msg.alert("Belum ada data yang bisa diekspor.");
    try {
      const nama = await berkasApi.eksporNama(judul);
      if (!excel) return setDlg(nama);
      // Aslinya daftar dikirim ke lembar Excel; di sini disimpan sebagai file .xlsx di folder Documents.
      const baris = rows.map((r, i) => cols.map((c) => teks(c.render(r, i)).trim()));
      const f = await berkasApi.simpanXlsx(nama.replace(/\.csv$/i, ".xlsx"), excel, cols.map((c) => c.title), cols.map((c) => c.align === "right"), baris);
      msg.alert(`File tersimpan di ${f}.`);
    } catch (e) { msg.alert(errText(e)); }
  };
  const cetak = async () => {
    if (!rows.length) return msg.alert("Belum ada data yang bisa dicetak.");
    setLembar(rows);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    try { await cetakLaporan(); } catch (e) { msg.alert(errText(e)); }
  };

  const total = cols.reduce((s, c) => s + c.width, 0);
  const s = setting;
  const alamat = [s.alamat, s.kota].filter(Boolean).join(", ") + (s.tlp ? `\nTelp. ${s.tlp}` : "");
  const node = (
    <>
      {dlg !== null && (
        <EksporDialog nama={dlg} onClose={() => setDlg(null)}
          onSimpan={async (path, o) => {
            try {
              const f = await berkasApi.simpanFile(path, buatCsv(cols, rows, o));
              setDlg(null);
              msg.alert(`File tersimpan di ${f}.`);
            } catch (e) { msg.alert(errText(e)); }
          }} />
      )}
      {lembar && createPortal(
        <div className="daftar-cetak">
          <div className="dc-nama">{s.namausaha}</div>
          <div className="dc-alamat">{alamat}</div>
          <div className="dc-judul">{judul}</div>
          <div className="dc-tgl">Dicetak {tglID(today())}</div>
          <table>
            <colgroup>{cols.map((c, i) => <col key={i} style={{ width: `${(c.width / total) * 100}%` }} />)}</colgroup>
            <thead><tr>{cols.map((c, i) => <th key={i} className={c.align === "right" ? "r" : ""}>{c.title}</th>)}</tr></thead>
            <tbody>
              {lembar.map((r, i) => (
                <tr key={i}>{cols.map((c, j) => <td key={j} className={c.align === "right" ? "r" : ""}>{teks(c.render(r, i))}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <div className="dc-jumlah">Jumlah data : {lembar.length}</div>
        </div>,
        document.body,
      )}
    </>
  );
  return { ekspor, cetak, node };
}

/** FrmOpsiTextEkspor ("Ekspor File Text"): nama file, pemisah kolom, dan pilihan isi. */
function EksporDialog(props: { nama: string; onClose: () => void; onSimpan: (path: string, o: OpsiCsv) => void }) {
  const [path, setPath] = useState(props.nama);
  const [pemisah, setPemisah] = useState(";");
  const [bom, setBom] = useState(true);
  const [kosong, setKosong] = useState(true);
  const bind: Record<string, Bind> = {
    txtFileName: { value: path, onChange: setPath },
    txtFieldDelimiter: { value: pemisah, onChange: setPemisah },
    chkUnicaode: { value: bom ? "1" : "0", onChange: (x) => setBom(x === "1") },
    chkSuppressBlank: { value: kosong ? "1" : "0", onChange: (x) => setKosong(x === "1") },
    btnOK: { onClick: () => props.onSimpan(path, { pemisah, bom, lewatiKosong: kosong }) },
    btnCancel: { onClick: props.onClose },
  };
  return <VbModal form="FrmOpsiTextEkspor" title="Ekspor File Text" bind={bind} hide={["btnOpen", "txtPageDelimiter", "lblTag(0)"]} onClose={props.onClose} />;
}
