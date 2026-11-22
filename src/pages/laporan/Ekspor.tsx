import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pilihSimpan } from "../../api/dialog";
import { berkasApi } from "../../api/berkas";
import { Bind } from "../../vb/VbForm";
import { VbModal } from "../../vb/VbGrid";

export type FormatEkspor = "text" | "excel" | "rtf" | "pdf" | "html";
/** Isi menu Ekspor seperti aslinya (LblMenuPopUp 0 sampai 4). */
export const MENU_EKSPOR: [FormatEkspor, string][] = [
  ["text", "Ekspor ke Text"], ["excel", "Ekspor ke Excel"], ["rtf", "Ekspor ke RTF"], ["pdf", "Ekspor ke PDF"], ["html", "Ekspor ke HTML"],
];

export interface OpsiText { pemisahKolom: string; pemisahHalaman: string; lewatiKosong: boolean; unicode: boolean }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Isi file text: kop, lalu baris laporan dengan sel dipisah `pemisahKolom`. */
export function buatText(kop: string[], grid: string[][], o: OpsiText): string {
  const sep = o.pemisahKolom === "\\t" ? "\t" : o.pemisahKolom;
  const isi = grid.map((b) => b.map((x) => x.trim()));
  const baris = o.lewatiKosong ? isi.filter((b) => b.some((x) => x !== "")) : isi;
  const semua = [...kop, "", ...baris.map((b) => b.join(sep))];
  return (o.unicode ? "\uFEFF" : "") + semua.join("\r\n") + "\r\n" + (o.pemisahHalaman ? o.pemisahHalaman + "\r\n" : "");
}

export function buatHtml(judul: string, kop: string[], grid: string[][]): string {
  const tbl = grid.filter((b) => b.some((x) => x.trim() !== ""))
    .map((b) => `<tr>${b.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("\n");
  return `<!DOCTYPE html>\n<html lang="id"><head><meta charset="utf-8"><title>${esc(judul)}</title>
<style>body{font:12px Arial,sans-serif}table{border-collapse:collapse}td{padding:1px 6px}</style></head>
<body>\n${kop.map((k, i) => (i === 0 ? `<h2>${esc(k)}</h2>` : `<div>${esc(k)}</div>`)).join("\n")}\n<table>\n${tbl}\n</table>\n</body></html>\n`;
}

/** RTF sederhana: teks tab-delimited dengan font monospasi. Huruf di luar ASCII ditulis sebagai kode \\uN. */
export function buatRtf(kop: string[], grid: string[][]): string {
  const rtf = (s: string) => [...s].map((ch) => {
    const k = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") return "\\" + ch;
    return k > 126 ? `\\u${k > 32767 ? k - 65536 : k}?` : ch;
  }).join("");
  const baris = [...kop, "", ...grid.filter((b) => b.some((x) => x.trim() !== "")).map((b) => b.join("\t"))];
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Courier New;}}\\f0\\fs18\n${baris.map((b) => rtf(b) + "\\par").join("\n")}\n}`;
}

/** Simpan hasil ekspor sebagai file baru di folder Documents. Mengembalikan alamat file. */
export async function simpanEkspor(format: Exclude<FormatEkspor, "pdf">, judul: string, kop: string[], grid: string[][], path?: string, o?: OpsiText): Promise<string> {
  const extBaru = format === "text" ? "txt" : format === "excel" ? "xlsx" : format;
  const dasar = path ?? (await berkasApi.eksporNama(judul, extBaru));
  const ganti = (ext: string) => dasar.replace(/\.[^./\\]+$/, `.${ext}`);
  if (format === "text") return berkasApi.simpanFile(ganti("txt"), buatText(kop, grid, o ?? { pemisahKolom: ";", pemisahHalaman: "", lewatiKosong: true, unicode: true }));
  if (format === "excel") {
    const baris = [...kop.map((k) => [k]), [""], ...grid.filter((b) => b.some((x) => x.trim() !== ""))];
    return berkasApi.simpanXlsx(ganti("xlsx"), "Laporan", [], [], baris);
  }
  const ext = format === "html" ? "html" : "rtf";
  const isi = format === "html" ? buatHtml(judul, kop, grid) : buatRtf(kop, grid);
  return invoke<string>("simpan_laporan", { path: ganti(ext), isi });
}

/** FrmOpsiTextEkspor ("Ekspor File Text"). Tombol "..." membuka dialog simpan; kotak nama file tetap bisa diketik. */
export function OpsiTextDialog(props: { nama: string; onClose: () => void; onSimpan: (path: string, o: OpsiText) => void }) {
  const [path, setPath] = useState(props.nama.replace(/\.[^./\\]+$/, ".txt"));
  const [kol, setKol] = useState(";");
  const [hal, setHal] = useState("");
  const [kosong, setKosong] = useState(true);
  const [uni, setUni] = useState(true);
  const bind: Record<string, Bind> = {
    txtFileName: { value: path, onChange: setPath },
    txtFieldDelimiter: { value: kol, onChange: setKol },
    txtPageDelimiter: { value: hal, onChange: setHal },
    chkUnicaode: { value: uni ? "1" : "0", onChange: (x) => setUni(x === "1") },
    chkSuppressBlank: { value: kosong ? "1" : "0", onChange: (x) => setKosong(x === "1") },
    btnOpen: { onClick: () => void pilihSimpan(path, "txt", "Text (*.txt)").then((p) => { if (p) setPath(p); }) },
    btnOK: { onClick: () => props.onSimpan(path, { pemisahKolom: kol, pemisahHalaman: hal, lewatiKosong: kosong, unicode: uni }) },
    btnCancel: { onClick: props.onClose },
  };
  return <VbModal form="FrmOpsiTextEkspor" title="Ekspor File Text" bind={bind} onClose={props.onClose} />;
}
