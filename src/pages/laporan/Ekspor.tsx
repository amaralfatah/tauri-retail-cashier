import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { pilihSimpan } from "../../api/dialog";
import { berkasApi } from "../../api/berkas";
import { ModalFrame } from "../../vb/VbGrid";

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
  return (
    <ModalFrame
      title="Ekspor File Text"
      width={480}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="btnCancel" onClick={props.onClose}>
            Batal <Kbd>Esc</Kbd>
          </Button>
          <Button
            type="button"
            className="h-8 text-xs"
            data-vb="btnOK"
            onClick={() => props.onSimpan(path, { pemisahKolom: kol, pemisahHalaman: hal, lewatiKosong: kosong, unicode: uni })}
          >
            Simpan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="eks-path" className="text-xs text-muted-foreground">Lokasi File</Label>
          <InputGroup className="h-8">
            <InputGroupInput id="eks-path" data-vb="txtFileName" className="text-xs" value={path} onChange={(e) => setPath(e.target.value)} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton data-vb="btnOpen" onClick={() => void pilihSimpan(path, "txt", "Text (*.txt)").then((p) => { if (p) setPath(p); })}>...</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="eks-kol" className="text-xs text-muted-foreground">Pemisah Kolom</Label>
            <Input id="eks-kol" data-vb="txtFieldDelimiter" className="h-8 text-xs font-mono" value={kol} onChange={(e) => setKol(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="eks-hal" className="text-xs text-muted-foreground">Pemisah Halaman</Label>
            <Input id="eks-hal" data-vb="txtPageDelimiter" className="h-8 text-xs font-mono" value={hal} onChange={(e) => setHal(e.target.value)} placeholder="Opsional" />
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <Label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-normal">
            <Checkbox data-vb="chkUnicaode" checked={uni} onCheckedChange={(c) => setUni(Boolean(c))} />
            <span>Simpan sebagai Unicode (UTF-8 BOM)</span>
          </Label>
          <Label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-normal">
            <Checkbox data-vb="chkSuppressBlank" checked={kosong} onCheckedChange={(c) => setKosong(Boolean(c))} />
            <span>Lewati baris kosong</span>
          </Label>
        </div>
      </div>
    </ModalFrame>
  );
}
