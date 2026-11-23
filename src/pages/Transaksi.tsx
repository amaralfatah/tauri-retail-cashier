import { invoke } from "@/lib/panggil";
import { ChevronDownIcon, CornerDownLeftIcon, ScanBarcodeIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, Row, TransInput } from "../api";
import { ntApi } from "../api/keuangan";
import { kasirApi, perluVerifikasi, pesanKonfirmasi } from "../api/kasir";
import { orderApi } from "../api/order";
import { useApp } from "../appContext";
import { useKasirAktif } from "../lib/kasirAktif";
import { CariBarang } from "../components/CariBarang";
import { CariSatuan } from "../components/CariSatuan";
import { CariTransaksi } from "../components/CariTransaksi";
import { EntryGrid, type EntryGridCol, GRID_TH, GridSearchButton } from "../components/EntryGrid";
import { Alert, Modal } from "../components/Modal";
import { Otentikasi } from "../components/Otentikasi";
import { toast } from "sonner";
import { bukaLaciOtomatis, cetakStruk, Struk, strukOrderTeks, strukTeks } from "../components/Struk";
import { StrukPenjualan } from "../components/StrukPenjualan";
import { addDays, hargaJual, num, qty, rp, tglID, today, Unit, unitsOf } from "../format";
import { Geom, formCaption } from "../vb/VbForm";
import { GridCol, ModalFrame, useMsgBox, VbGrid } from "../vb/VbGrid";
import { BarangEdit } from "./MasterEdit";
import { PoinMember } from "./Poin";
import { CariMaster } from "./keuanganLib";
import { getLocal } from "./localSettings";
import { bunyiGagal, getLihatStruk, setLihatStruk } from "./kasirSettings";
import { getModeScan } from "./modeScan";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Mode = "jual" | "beli";
type Kol = "kode" | "nama" | "satuan" | "jml" | "hrg" | "hjual" | "margin" | "subtotal";

interface Line {
  key: number;
  b: Row;
  units: Unit[];
  ui: number;
  jml: number;
  harga: number;
  manual: boolean;
  /** Nama barang yang diubah khusus untuk transaksi ini (tidak mengubah Master Barang). */
  nama?: string;
  /** Pembelian: harga jual per satuan transaksi yang diisi di kolom Hrg. Jual (kosong = harga jual master). */
  hrgjual?: number;
}

const namaBaris = (l: Line) => l.nama ?? l.b.namabarang;
/** Harga jual yang dipakai kolom Hrg. Jual pembelian: yang diisi, atau harga jual master per satuan transaksi. */
const hrgJualBaris = (l: Line) => l.hrgjual ?? Math.round((Number(l.b.hrgjual) || 0) * l.units[l.ui].konversi);

/** Baris yang ditampilkan: harga sudah memakai promo, `pdp` = potongan PDP untuk seluruh baris. */
type ShownLine = Line & { pdp: number };

interface PromoHitung {
  baris: { harga: number; disknilai: number }[];
  bonus: { kodebarang: string; namabarang: string; kodesatuan: string; jml: number }[];
}

const promoKeranjang = (tgl: string, items: Row[]) => invoke<PromoHitung>("promo_keranjang", { tgl, items });

// Kunci baris detail. Dimulai dari waktu muat modul, bukan 1: saat hot reload modul dimuat ulang tetapi
// baris di layar tetap ada, dan penghitung yang kembali ke 1 membuat kunci kembar (beberapa baris ikut terpilih).
let lineKey = Date.now();

/** Jumlah per baris yang dianggap tidak wajar untuk satu kali belanja (biasanya salah ketik atau barcode masuk ke kolom jumlah). */
const JML_BESAR = 100;

/** Tombol sekunder di baris bawah layar kasir. */
const TOMBOL_BAWAH = "border-foreground/20 bg-background text-foreground shadow-xs";
const KBD_BAWAH = "border border-border bg-muted text-foreground";

/** Label kolom kepala layar kasir: nama kolom hitam dan tombol pintasnya di kanan. */
function LabelKepala({ teks, pintas }: { teks: string; pintas: string }) {
  return (
    <Label className="flex items-center justify-between gap-1 text-xs font-medium text-foreground" title={`Pintasan: ${pintas}`}>
      <span>{teks}</span>
      <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{pintas}</span>
    </Label>
  );
}

/** Beri titik ribuan pada teks angka mentah ("100000" jadi "100.000"); koma desimal dipertahankan. */
export function formatRibuan(mentah: string): string {
  const [bulat, ...sisa] = mentah.split(",");
  const b = bulat.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sisa.length ? `${b},${sisa.join("")}` : b;
}
/** Kebalikannya: "1.250.000" jadi 1250000. Teks kosong atau bukan angka menjadi 0. */
export function parseRibuan(teks: string): number {
  return Number(teks.replace(/\./g, "").replace(",", ".")) || 0;
}

/** Kotak isian angka: teks mentah saat difokus, berformat saat tidak. `ribuan`: titik ribuan juga tampil saat mengetik. */
function VNum(props: { value: number; onChange?: (v: number) => void; f: string; right?: boolean; readOnly?: boolean; dec2?: boolean; ribuan?: boolean; inputRef?: React.Ref<HTMLInputElement>; className?: string }) {
  const [text, setText] = useState(String(props.value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(props.value)); }, [props.value, focus]);
  // Nilai diubah dari luar saat Anda mengetik (misalnya jumlah dikembalikan ke stok): tampilkan nilai barunya.
  useEffect(() => { if (focus && (Number(text.replace(",", ".")) || 0) !== props.value) setText(String(props.value)); }, [props.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const formatted = focus ? (props.ribuan ? formatRibuan(text) : text) : new Intl.NumberFormat("id-ID", { minimumFractionDigits: props.dec2 ? 2 : 0, maximumFractionDigits: 2 }).format(props.value);
  const readOnly = props.readOnly || !props.onChange;
  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => { setFocus(true); setText(String(props.value)); const el = e.target; setTimeout(() => el.select(), 0); };
  const onBlur = () => setFocus(false);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!props.ribuan) { setText(e.target.value); props.onChange?.(Number(e.target.value.replace(",", ".")) || 0); return; }
    const el = e.target;
    const mentah = el.value.replace(/[^\d,]/g, "");
    // Kursor: hitung angka di kiri kursor, lalu pasang lagi di posisi yang sama setelah titik ribuan disusun ulang.
    const kiri = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/[^\d,]/g, "").length;
    setText(mentah);
    props.onChange?.(parseRibuan(mentah));
    requestAnimationFrame(() => {
      const baru = formatRibuan(mentah);
      let n = 0, pos = 0;
      while (pos < baru.length && n < kiri) { if (baru[pos] !== ".") n++; pos++; }
      if (kiri >= mentah.length) pos = baru.length;
      try { el.setSelectionRange(pos, pos); } catch { /* abaikan */ }
    });
  };
  return (
    <Input
      ref={props.inputRef}
      data-f={props.f}
      inputMode="decimal"
      readOnly={readOnly}
      value={formatted}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={onChange}
      className={cn(
        "h-full! w-full rounded-none border-0 bg-transparent dark:bg-transparent read-only:bg-transparent dark:read-only:bg-transparent px-1.5! py-0! shadow-none tabular-nums focus-visible:ring-0 [font-family:inherit] [font-size:inherit] [font-weight:inherit] md:[font-size:inherit]",
        props.right && "text-right",
        readOnly && "cursor-default text-foreground",
        props.className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Tabel detail (pengganti xTableEdit)                                 */
/* ------------------------------------------------------------------ */

const ROW_H = 28;
const HEAD_H = 32;
/** Lebar kolom (No, Kode, Nama, Satuan, Jml, Harga, Subtotal) dalam persen, mengikuti aslinya. */
const COLS = [3.7, 12.4, 43.5, 6.3, 6.3, 13.4, 14.4];
/** Pembelian: tambah kolom Hrg. Jual dan Margin (sebelum Subtotal). */
const COLS_BELI = [3.5, 11, 29, 6, 6, 12, 12, 9, 11.5];

/** Bingkai sel aktif ala spreadsheet: garis biru 2px + pegangan kotak di pojok kanan bawah. */
const ACT_CELL =
  "relative z-10 overflow-visible bg-card p-0! before:pointer-events-none before:absolute before:-inset-px before:z-10 before:border-2 before:border-ring after:pointer-events-none after:absolute after:-right-0.75 after:-bottom-0.75 after:z-20 after:size-1.5 after:border after:border-card after:bg-ring";
const GRID_INPUT =
  "h-full! w-full rounded-none border-0 bg-transparent dark:bg-transparent read-only:bg-transparent dark:read-only:bg-transparent px-1.5! py-0! text-[13px] text-foreground shadow-none focus-visible:ring-0 md:text-[13px]";
const GRID_TD =
  "h-7! truncate border-r border-b border-foreground/15 px-2! py-0! text-[13px] text-foreground tabular-nums last:border-r-0";
const GRID_TD_EMPTY =
  "h-7! truncate border-r border-b border-foreground/15 px-2! py-0! text-[13px] tabular-nums last:border-r-0";
const GRID_TD_NO =
  "h-7! border-r border-b border-foreground/15 bg-muted px-1.5! py-0! text-right text-xs font-semibold text-foreground/85 tabular-nums";
const GRID_TD_NO_EMPTY =
  "h-7! border-r border-b border-foreground/15 bg-muted px-1.5! py-0! text-right text-xs font-medium text-foreground/75 tabular-nums";

function DetailGrid(props: {
  g?: Geom; jual: boolean; lines: ShownLine[]; selected: number | null;
  onSelect: (k: number | null) => void;
  onUpdate: (key: number, patch: Partial<Line>) => void;
  onDelete: (key: number) => void;
  onEnterScan: () => void;
  onCariKode: (key: number) => void;
  onCariSatuan: (key: number) => void;
  stokKurang: (l: Line) => boolean;
  /** Stok sisa setelah barang ini terjual sudah sampai batas minimum (hanya penanda, tidak memblokir). */
  stokTipis?: (l: Line) => boolean;
  /** Kolom harga hanya bisa dibaca (Kasir, pengaturan "Izinkan user bisa edit harga jual" mati). */
  hargaTerkunci?: boolean;
  /** Naik tiap kali kursor harus pindah ke kolom jumlah baris terpilih. */
  fokusJml?: number;
  /** Baris yang baru masuk disorot sebentar; `n` naik setiap kali barang ditambahkan. */
  flash?: { key: number; n: number };
  /** Jumlah yang tidak wajar ditandai supaya kasir mengecek ulang. */
  jmlBesar?: (l: Line) => boolean;
  entry?: { value: string; onChange: (v: string) => void; onEnter: () => void; onCari?: () => void; inputRef: React.Ref<HTMLInputElement> };
  gridRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { lines, selected, g } = props;
  const wantFocus = useRef(false);
  const [entryFocus, setEntryFocus] = useState(false);
  const [col, setCol] = useState<Kol>("jml");
  const [boxH, setBoxH] = useState(460);
  const defaultCols = props.jual ? COLS : COLS_BELI;
  useEffect(() => {
    if (g || !props.gridRef.current) return;
    const el = props.gridRef.current;
    const updateH = () => setBoxH(el.clientHeight || 460);
    updateH();
    const ro = new ResizeObserver(updateH);
    ro.observe(el);
    return () => ro.disconnect();
  }, [g, props.gridRef]);
  const headH = HEAD_H;
  const rowH = ROW_H;
  const availH = (g?.height ?? boxH) - 2 - headH;
  const minRows = Math.max(1, Math.floor(availH / rowH));
  const total = Math.max(lines.length + (props.entry ? 1 : 0), minRows);
  const fillRowH = total === minRows ? availH / minRows : undefined;

  useEffect(() => {
    if (!props.fokusJml) return;
    setCol("jml");
    const t = setTimeout(() => props.gridRef.current?.querySelector<HTMLInputElement>("input[data-act]")?.focus(), 30);
    return () => clearTimeout(t);
  }, [props.fokusJml, props.gridRef]);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    props.gridRef.current?.querySelector<HTMLInputElement>("input[data-act]")?.focus();
  }, [selected, col, props.gridRef]);

  const urutan: Kol[] = props.hargaTerkunci ? ["kode", "satuan", "jml"] : props.jual ? ["kode", "satuan", "jml", "hrg"] : ["kode", "satuan", "jml", "hrg", "hjual", "margin"];
  const navCols: Kol[] = props.jual ? ["kode", "nama", "satuan", "jml", "hrg", "subtotal"] : ["kode", "nama", "satuan", "jml", "hrg", "hjual", "margin", "subtotal"];
  const pindah = (c: Kol) => { wantFocus.current = true; setCol(c); };

  const idx = lines.findIndex((l) => l.key === selected);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const inInput = e.target !== e.currentTarget;
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && selected != null && !entryFocus) {
      if (e.target instanceof HTMLInputElement && !e.target.readOnly) {
        const s = e.target.selectionStart ?? 0;
        const end = e.target.selectionEnd ?? 0;
        const len = e.target.value.length;
        const allSel = s === 0 && end === len;
        if (e.key === "ArrowLeft" && !allSel && s > 0) return;
        if (e.key === "ArrowRight" && !allSel && end < len) return;
      }
      const ci = navCols.indexOf(col);
      const next = ci + (e.key === "ArrowRight" ? 1 : -1);
      if (next >= 0 && next < navCols.length) {
        e.preventDefault();
        pindah(navCols[next]);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.target instanceof HTMLSelectElement) return;
      // Dari baris kosong (isian barang baru), panah atas kembali ke barang terakhir.
      if (entryFocus) {
        if (e.key === "ArrowUp" && lines.length) {
          e.preventDefault();
          // Sel barang baru dirender setelah kotak isian ini kehilangan fokus, jadi fokuskan setelah render.
          (e.target as HTMLElement).blur();
          setCol("kode");
          props.onSelect(lines[lines.length - 1].key);
          setTimeout(() => props.gridRef.current?.querySelector<HTMLInputElement>("input[data-act]")?.focus(), 30);
        }
        return;
      }
      const n = idx + (e.key === "ArrowDown" ? 1 : -1);
      if (n >= 0 && n < lines.length) {
        e.preventDefault();
        wantFocus.current = inInput;
        props.onSelect(lines[n].key);
      } else if (e.key === "ArrowDown" && n === lines.length && props.entry) {
        // Dari barang terakhir, panah bawah pindah ke baris kosong untuk mengisi barang baru.
        e.preventDefault();
        props.gridRef.current?.querySelector<HTMLInputElement>('input[data-entry], .kd-edit input:not([data-act])')?.focus();
      }
    } else if (e.key === "Delete" && !inInput && selected != null) {
      e.preventDefault();
      props.onDelete(selected);
    } else if (e.key === "Enter" && !inInput && selected != null) {
      e.preventDefault();
      pindah("jml");
    } else if (e.key === "Tab" && inInput && (e.target as HTMLElement).dataset.act !== undefined && selected != null && !entryFocus) {
      const i = urutan.indexOf(col) + (e.shiftKey ? -1 : 1);
      e.preventDefault();
      if (i >= 0 && i < urutan.length) pindah(urutan[i]);
      else if (i >= urutan.length) props.onEnterScan();
    }
  };

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    const act = e.target instanceof HTMLInputElement ? e.target.dataset.act : undefined;
    if (e.key !== "Enter" || !act) return;
    e.preventDefault();
    if (act === "kode" && selected != null) props.onCariKode(selected);
    else if (act === "satuan" && selected != null) props.onCariSatuan(selected);
    else if (act === "nama") pindah("jml");
    else if (act === "jml" && !props.hargaTerkunci) pindah("hrg");
    else if (act === "hrg" && !props.jual) pindah("hjual");
    else if (act === "hjual") pindah("margin");
    else props.onEnterScan();
  };

    const entryActive = selected == null || entryFocus;
    const rows: ReactNode[] = [];
    for (let i = 0; i < total; i++) {
      const l = lines[i];
      if (!l) {
        const isEntry = !!props.entry && i === lines.length;
        rows.push(
          <TableRow key={`e${i}`} className="border-0 hover:bg-transparent" style={fillRowH ? { height: fillRowH } : undefined}>
            <TableCell className={isEntry ? GRID_TD_NO : GRID_TD_NO_EMPTY}>{i + 1}</TableCell>
            <TableCell className={cn(isEntry ? GRID_TD : GRID_TD_EMPTY, isEntry && "p-0!", isEntry && entryActive && ACT_CELL)}>
              {isEntry && (
                <div className="relative h-full">
                  <Input
                    ref={props.entry!.inputRef}
                    data-entry="1"
                    value={props.entry!.value}
                    autoComplete="off"
                    onFocus={() => setEntryFocus(true)}
                    onBlur={() => setEntryFocus(false)}
                    onChange={(e) => props.entry!.onChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); props.entry!.onEnter(); } }}
                    className={cn(GRID_INPUT, "pr-6!")}
                  />
                  {entryActive && <GridSearchButton title="Cari barang [F10]" onClick={props.entry!.onCari} />}
                </div>
              )}
            </TableCell>
            {Array.from({ length: props.jual ? 5 : 7 }, (_, k) => <TableCell key={k} className={isEntry ? GRID_TD : GRID_TD_EMPTY} />)}
          </TableRow>,
        );
        continue;
      }
      const cur = selected === l.key && !entryFocus;
      const klik = (c: Kol) => () => { if (!(cur && col === c)) { wantFocus.current = true; setCol(c); } if (selected !== l.key) props.onSelect(l.key); };
      const kodeTampil = l.b.kodebarang;
      const act = (c: Kol) => cur && col === c;
      rows.push(
        <TableRow
          key={l.key}
          style={fillRowH ? { height: fillRowH } : undefined}
          className={cn(
            "border-0 hover:bg-transparent",
            cur && "bg-[color-mix(in_oklab,var(--primary)_20%,var(--card))] hover:bg-[color-mix(in_oklab,var(--primary)_20%,var(--card))]",
            props.flash && props.flash.n > 0 && props.flash.key === l.key && `tp-flash-${props.flash.n % 2}`,
          )}
        >
          <TableCell className={cn(GRID_TD_NO, cur && "bg-primary! text-primary-foreground!")}>{i + 1}</TableCell>
          <TableCell className={cn(GRID_TD, act("kode") && ACT_CELL)} onMouseDown={klik("kode")}>
            {act("kode") ? (
              <div className="relative h-full">
                <Input readOnly data-act="kode" value={kodeTampil} className={cn(GRID_INPUT, "cursor-default pr-6!")} />
                <GridSearchButton title="Cari barang [F10]" onClick={() => props.onCariKode(l.key)} />
              </div>
            ) : kodeTampil}
          </TableCell>
          <TableCell className={cn(GRID_TD, act("nama") && ACT_CELL)} onMouseDown={klik("nama")} title={namaBaris(l)}>
            {act("nama") ? (
              <Input
                data-act="nama"
                value={namaBaris(l)}
                onFocus={(e) => { e.currentTarget.dataset.orig = e.currentTarget.value; }}
                onChange={(e) => props.onUpdate(l.key, { nama: e.target.value })}
                onBlur={(e) => { if (!e.target.value.trim()) props.onUpdate(l.key, { nama: undefined }); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    const orig = e.currentTarget.dataset.orig;
                    if (orig != null && orig !== e.currentTarget.value) {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onUpdate(l.key, { nama: orig === l.b.namabarang ? undefined : orig });
                    }
                  }
                }}
                className={GRID_INPUT}
              />
            ) : (
              <>
                {namaBaris(l)}
                {props.stokTipis?.(l) && (
                  <span data-slot="badge" className="ml-1.5 inline-block rounded-sm bg-warning px-1.5 align-middle text-[10px] leading-4 font-semibold text-warning-foreground">Stok menipis</span>
                )}
              </>
            )}
          </TableCell>
          <TableCell className={cn(GRID_TD, "px-1! text-center", act("satuan") && ACT_CELL)} onMouseDown={klik("satuan")}>
            {act("satuan") ? (
              <div className="relative h-full">
                <Input readOnly data-act="satuan" value={l.units[l.ui].satuan} className={cn(GRID_INPUT, "cursor-default pr-6! text-center")} />
                <GridSearchButton title="Cari satuan" onClick={() => props.onCariSatuan(l.key)} />
              </div>
            ) : l.units[l.ui].satuan}
          </TableCell>
          <TableCell
            className={cn(
              GRID_TD, "text-right font-semibold",
              props.jmlBesar?.(l) && "bg-warning/25 text-foreground",
              props.stokKurang(l) && "bg-destructive/15 text-destructive",
              act("jml") && ACT_CELL,
              act("jml") && props.stokKurang(l) && "bg-destructive/15!",
              act("jml") && !props.stokKurang(l) && props.jmlBesar?.(l) && "bg-warning/25!",
            )}
            title={props.stokKurang(l) ? "Stok barang ini tidak cukup" : props.jmlBesar?.(l) ? "Jumlahnya besar (≥ 100). Pastikan bukan salah ketik atau scan barcode." : undefined}
            onMouseDown={klik("jml")}
          >
            {act("jml") ? (
              <VNum f="jml" right value={l.jml} onChange={(v) => props.onUpdate(l.key, { jml: v })}
                inputRef={(el) => { if (el) el.setAttribute("data-act", "jml"); }}
                className={cn("text-[13px] font-semibold md:text-[13px]", props.stokKurang(l) && "text-destructive")} />
            ) : qty(l.jml)}
          </TableCell>
          <TableCell className={cn(GRID_TD, "text-right", l.pdp > 0 && "text-success font-medium", act("hrg") && ACT_CELL)} onMouseDown={klik("hrg")}
            title={l.pdp > 0 ? `Potongan promo: −Rp ${rp(l.pdp)}` : undefined}>
            {act("hrg") ? (
              <VNum f="hrg" right value={l.harga} readOnly={props.hargaTerkunci} onChange={(v) => props.onUpdate(l.key, { harga: v, manual: true })}
                inputRef={(el) => { if (el) el.setAttribute("data-act", "hrg"); }} className="text-[13px] md:text-[13px]" />
            ) : rp(l.harga)}
          </TableCell>
          {!props.jual && (
            <TableCell className={cn(GRID_TD, "text-right", act("hjual") && ACT_CELL)} onMouseDown={klik("hjual")}>
              {act("hjual") ? (
                <VNum f="hjual" right value={hrgJualBaris(l)} onChange={(v) => props.onUpdate(l.key, { hrgjual: v })}
                  inputRef={(el) => { if (el) el.setAttribute("data-act", "hjual"); }} className="text-[13px] md:text-[13px]" />
              ) : rp(hrgJualBaris(l))}
            </TableCell>
          )}
          {!props.jual && (
            <TableCell className={cn(GRID_TD, "text-right", act("margin") && ACT_CELL)} onMouseDown={klik("margin")}>
              {act("margin") ? (
                <VNum f="margin" right value={hrgJualBaris(l) - l.harga} onChange={(v) => props.onUpdate(l.key, { hrgjual: l.harga + v })}
                  inputRef={(el) => { if (el) el.setAttribute("data-act", "margin"); }} className="text-[13px] md:text-[13px]" />
              ) : rp(hrgJualBaris(l) - l.harga)}
            </TableCell>
          )}
          <TableCell className={cn(GRID_TD, "text-right font-semibold", act("subtotal") && ACT_CELL)} onMouseDown={klik("subtotal")}>
            {act("subtotal") ? (
              <Input readOnly data-act="subtotal" value={rp(l.jml * l.harga - l.pdp)} className={cn(GRID_INPUT, "cursor-default text-right font-semibold")} />
            ) : rp(l.jml * l.harga - l.pdp)}
          </TableCell>
        </TableRow>,
      );
    }

    const headers: { label: string; align: EntryGridCol["align"] }[] = [
      { label: "No", align: "right" },
      { label: "Kode / Barcode", align: "left" },
      { label: "Nama Barang", align: "left" },
      { label: "Satuan", align: "center" },
      { label: "Jml", align: "right" },
      { label: props.jual ? "Hrg. Jual" : "Hrg. Beli", align: "right" },
      ...(!props.jual ? [{ label: "Hrg. Jual", align: "right" as const }, { label: "Margin", align: "right" as const }] : []),
      { label: "Subtotal", align: "right" },
    ];
    const gridCols: EntryGridCol[] = headers.map((h, i) => ({ ...h, width: defaultCols[i] }));

    return (
      <EntryGrid
        cols={gridCols}
        colKey={props.jual ? "jual" : "beli"}
        gridRef={props.gridRef}
        onKeyDown={onKeyDown}
        onKeyDownCapture={onKeyDownCapture}
        cellStyles={false}
      >
        {rows}
      </EntryGrid>
    );
}

function BonusGrid({ g, bonus }: { g?: Geom; bonus: PromoHitung["bonus"] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState(420);
  useEffect(() => {
    if (g || !ref.current) return;
    const el = ref.current;
    const updateH = () => setBoxH(el.clientHeight || 420);
    updateH();
    const ro = new ResizeObserver(updateH);
    ro.observe(el);
    return () => ro.disconnect();
  }, [g]);
  const availH = (g?.height ?? boxH) - 2 - 32;
  const minRows = Math.max(1, Math.floor(availH / 28));
  const n = Math.max(bonus.length, minRows);
  const fillRowH = n === minRows ? availH / minRows : undefined;
  return (
    <div ref={ref} className="tp-scroll-always size-full bg-card font-sans text-foreground [&>[data-slot=table-container]]:overflow-visible [&_td]:py-0! [&_th]:py-0!">
      <Table className="table-fixed border-separate border-spacing-0">
        <colgroup><col className="w-8" /><col /><col className="w-12" /></colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className={cn(GRID_TH, "px-1.5! text-right")}>No</TableHead>
            <TableHead className={cn(GRID_TH, "text-left")}>Nama Barang Bonus</TableHead>
            <TableHead className={cn(GRID_TH, "text-right")}>Jml</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: n }, (_, i) => {
            const b = bonus[i];
            return (
              <TableRow key={i} className="border-0 hover:bg-transparent" style={fillRowH ? { height: fillRowH } : undefined}>
                <TableCell className={b ? GRID_TD_NO : GRID_TD_NO_EMPTY}>{i + 1}</TableCell>
                <TableCell className="h-7! truncate border-r border-b border-foreground/15 px-2! py-0! text-[13px] font-medium" title={b ? `${b.namabarang} (${b.kodebarang})` : undefined}>{b?.namabarang}</TableCell>
                <TableCell className="h-7! truncate border-b border-foreground/15 px-2! py-0! text-right text-[13px] font-semibold tabular-nums">{b ? qty(b.jml) : ""}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pilih pelanggan / pemasok / sales                                   */
/* ------------------------------------------------------------------ */

function PilihModal(props: { title: string; rows: { kode: string; nama: string }[]; kosong: string; onPick: (kode: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = props.rows.filter((r) => r.nama.toLowerCase().includes(q.toLowerCase()) || r.kode.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik nama untuk mencari" className="h-8 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); props.onPick(list[0]?.kode ?? ""); } }} />
      <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-auto">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => props.onPick("")}>{props.kosong}</Button>
        {list.slice(0, 200).map((r) => <Button key={r.kode} variant="ghost" className="w-full justify-start" onClick={() => props.onPick(r.kode)}>{r.nama}</Button>)}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Cari order / data pending (FrmCariOrderJual, FrmCariOrderBeli,      */
/* FrmCariPendingJual)                                                 */
/* ------------------------------------------------------------------ */

type CariJenis = "orderjual" | "orderbeli" | "pending";
const CARI_FORM: Record<CariJenis, string> = { orderjual: "FrmCariOrderJual", orderbeli: "FrmCariOrderBeli", pending: "FrmCariPendingJual" };

function CariDataDialog(props: { jenis: CariJenis; onAmbil: (nomor: string) => void; onClose: () => void }) {
  const formName = CARI_FORM[props.jenis];
  const [q, setQ] = useState("");
  const [dari, setDari] = useState(today());
  const [sampai, setSampai] = useState(today());
  const [list, setList] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const { user } = useApp();
  const [hapus, setHapus] = useState(false);
  const [mintaIzin, setMintaIzin] = useState(false);
  /** Tanda izin dari Verifikasi Admin; dipakai saat penghapusan setelah pertanyaan dijawab Ya. */
  const [izin, setIzin] = useState<string | undefined>(undefined);
  const [muat, setMuat] = useState(0);
  const nomorKey = props.jenis === "pending" ? "nopending" : "notrans";
  const kontakLabel = props.jenis === "orderjual" || props.jenis === "pending" ? "Pelanggan" : "Supplier";

  useEffect(() => {
    let batal = false;
    const t = setTimeout(() => {
      const ambil = props.jenis === "pending"
        ? orderApi.listPending(dari, sampai, q)
        : orderApi.listOrder(props.jenis === "orderjual", dari, sampai, q);
      ambil.then((r) => { if (!batal) { setList(r); setSel((s) => (r.some((x) => x[nomorKey] === s) ? s : r[0]?.[nomorKey] ?? null)); } })
        .catch((e) => !batal && setErr(errText(e)));
    }, 150);
    return () => { batal = true; clearTimeout(t); };
  }, [props.jenis, q, dari, sampai, muat, nomorKey]);

  const ambil = (r?: Row) => {
    const no = r ? r[nomorKey] : sel;
    if (no) props.onAmbil(no);
    else setErr("Pilih dulu data yang akan diambil.");
  };
  // Seperti aslinya: Kasir dan Lainnya login lewat Verifikasi Admin dulu, baru ditanya "akan dihapus?".
  const mulaiHapus = () => {
    if (!sel) return;
    setIzin(undefined);
    if (perluVerifikasi(user.level)) setMintaIzin(true);
    else setHapus(true);
  };
  const hapusData = async (tanda?: string) => {
    if (!sel) return;
    try {
      if (props.jenis === "pending") await orderApi.deletePending(sel, tanda);
      else await orderApi.deleteOrder(sel, tanda);
      setHapus(false);
      setMuat((n) => n + 1);
    } catch (e) {
      setHapus(false);
      setErr(errText(e));
    }
  };

  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: props.jenis === "pending" ? "No. Pending" : "No. Order", width: 150, render: (r) => r[nomorKey] },
    {
      title: "Tanggal",
      width: 100,
      align: "center",
      render: (r) => tglID(props.jenis === "pending" ? r.tgltrans : r.tglorder),
      sortValue: (r) => String((props.jenis === "pending" ? r.tgltrans : r.tglorder) ?? ""),
    },
    { title: kontakLabel, width: 220, render: (r) => r.kontak },
    { title: "Kasir", width: 120, render: (r) => r.kasir },
    { title: "Jumlah", width: 120, align: "right", render: (r) => rp(r.jmltrans), sortValue: (r) => Number(r.jmltrans) || 0 },
  ];

  const apa = props.jenis === "pending" ? "data pending" : "order";
  const judul = props.jenis === "pending" ? "Data Transaksi Pending" : props.jenis === "orderjual" ? "Cari Order Penjualan" : "Cari Order Pembelian";
  return (
    <div
      className="contents"
      onKeyDownCapture={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setMuat((n) => n + 1); }
        else if (e.key === "ArrowDown" && e.target.closest('[data-vb="tData"]') && list.length) {
          e.preventDefault();
          e.currentTarget.querySelector<HTMLElement>('[data-slot="vbg"], .vbg')?.focus();
        }
      }}
    >
      <ModalFrame
        title={judul}
        width={780}
        height={480}
        onClose={() => { if (!err && !hapus && !mintaIzin) props.onClose(); }}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              className="mr-auto h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              data-vb="cHapus"
              disabled={!sel}
              onClick={mulaiHapus}
            >
              Hapus
            </Button>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cClose" onClick={props.onClose}>
              Tutup <Kbd>Esc</Kbd>
            </Button>
            <Button type="button" className="h-8 text-xs" data-vb="cAmbil" disabled={!sel} onClick={() => ambil()}>
              Ambil <Kbd className="bg-primary-foreground/15 text-primary-foreground">Enter</Kbd>
            </Button>
          </>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <Label htmlFor="cari-data-q" className="text-xs text-muted-foreground">Cari Nomor / {kontakLabel}</Label>
              <Input
                id="cari-data-q"
                autoFocus
                data-vb="tData"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ketik nomor atau nama..."
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cari-data-d1" className="text-xs text-muted-foreground">Dari</Label>
              <Input id="cari-data-d1" type="date" data-vb="dtTgl1" value={dari} onChange={(e) => e.target.value && setDari(e.target.value)} className="h-8 w-36 text-xs tabular-nums" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cari-data-d2" className="text-xs text-muted-foreground">Sampai</Label>
              <Input id="cari-data-d2" type="date" data-vb="dtTgl2" value={sampai} onChange={(e) => e.target.value && setSampai(e.target.value)} className="h-8 w-36 text-xs tabular-nums" />
            </div>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cOK" onClick={() => setMuat((n) => n + 1)}>
              Tampilkan
            </Button>
          </div>

          <div className="relative min-h-0 flex-1" data-vb="lsData">
            <VbGrid cols={cols} rows={list} rowKey={(r) => String(r[nomorKey])} selected={sel} onSelect={setSel} onOpen={ambil} />
            {list.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
                {props.jenis === "pending" ? "Belum ada transaksi yang di-pending." : "Belum ada order yang menunggu diambil."}
              </div>
            )}
          </div>
        </div>

        {err && (
          <Modal title={formCaption(formName)} onClose={() => setErr("")} footer={<Button autoFocus className="h-8 text-xs" onClick={() => setErr("")}>OK</Button>}>
            <Alert>{err}</Alert>
          </Modal>
        )}
        {hapus && (
          <Modal
            title={formCaption(formName)}
            onClose={() => setHapus(false)}
            footer={
              <>
                <Button variant="outline" className="h-8 text-xs" onClick={() => setHapus(false)}>Tidak</Button>
                <Button autoFocus className="h-8 text-xs" onClick={() => void hapusData(izin)}>Ya</Button>
              </>
            }
          >
            <p>Apakah data {apa} yang dipilih akan dihapus?</p>
          </Modal>
        )}
        {mintaIzin && (
          <Otentikasi
            alasan={`Untuk menghapus ${apa}, masukkan nama user dan kata sandi supervisor atau pemilik toko.`}
            onBatal={() => setMintaIzin(false)}
            onOk={(t) => { setMintaIzin(false); setIzin(t); setHapus(true); }}
          />
        )}
      </ModalFrame>
    </div>
  );
}

/** Tombol Stok Min: daftar barang yang stoknya sudah di bawah atau sama dengan stok minimal; pengguna memilih satu per satu. */
function StokMinDialog(props: { onPick: (b: Row) => void; onClose: () => void }) {
  const [daftar, setDaftar] = useState<Row[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const semua: Row[] = [];
      for (let off = 0; ; off += 1000) {
        const r = await api.masterList("mdbarang", { limit: 1000, offset: off, onlyActive: true });
        semua.push(...r.rows);
        if (semua.length >= r.total || r.rows.length === 0) break;
      }
      const tipis = semua.filter((b) => b.jenis === "Barang" && Number(b.stokmin) > 0 && Number(b.stokakhir) <= Number(b.stokmin));
      setDaftar(tipis);
      setSel(tipis[0]?.kodebarang ?? null);
    })().catch((e) => setErr(errText(e)));
  }, []);

  const pilih = (b?: Row) => {
    const x = b ?? (daftar ?? []).find((y) => y.kodebarang === sel);
    if (!x) return;
    props.onPick(x);
    setDipilih((s) => new Set(s).add(x.kodebarang));
  };

  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 110, render: (b) => b.kodebarang },
    { title: "Nama Barang", width: 260, render: (b) => b.namabarang },
    { title: "Stok", width: 85, align: "right", render: (b) => qty(b.stokakhir), sortValue: (b) => Number(b.stokakhir) || 0 },
    { title: "Stok Min", width: 85, align: "right", render: (b) => qty(b.stokmin), sortValue: (b) => Number(b.stokmin) || 0 },
    { title: "Dipilih", width: 56, align: "center", render: (b) => <span className="font-bold text-primary">{dipilih.has(b.kodebarang) ? "✓" : ""}</span> },
  ];

  return (
    <Modal
      title="Stok Minimum"
      onClose={props.onClose}
      wide
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>Tutup <Kbd>Esc</Kbd></Button>
          <Button disabled={!sel} onClick={() => pilih()}>Pilih <Kbd className="bg-primary-foreground/15 text-primary-foreground">Enter</Kbd></Button>
        </>
      }
    >
      <Alert>{err}</Alert>
      <p>Klik dua kali atau tekan Enter pada barang yang akan dipesan. Jumlahnya bisa Anda ubah di tabel.</p>
      <div className="relative h-75">
        <VbGrid cols={cols} rows={daftar ?? []} rowKey={(b) => String(b.kodebarang)} selected={sel} onSelect={setSel} onOpen={pilih} />
        {daftar && daftar.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
            Tidak ada barang yang stoknya sudah di bawah stok minimal.
          </div>
        )}
        {!daftar && !err && (
          <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
            Mohon tunggu sebentar.
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Halaman transaksi                                                   */
/* ------------------------------------------------------------------ */

/**
 * Layar transaksi: Penjualan, Pembelian, Order Penjualan, dan Order Pembelian.
 */
export function TransaksiForm(props: { mode: Mode; order?: boolean }) {
  return <TransaksiIsi {...props} />;
}

function TransaksiIsi({ mode, order = false }: { mode: Mode; order?: boolean }) {
  const { user, setting, go } = useApp();
  const { aktif, laporIsi } = useKasirAktif();
  const modern = true;
  const jual = mode === "jual";
  const formName = order ? (jual ? "FrmTransJualOrder" : "FrmTransBeliOrder") : jual ? "FrmTransJual" : "FrmTransBeli";
  const kodeTrans = order ? (jual ? "SO" : "PO") : jual ? "TJ" : "TB";
  const [tgl, setTgl] = useState(today());
  const [notrans, setNotrans] = useState("");
  const [kontak, setKontak] = useState("");
  const [sales, setSales] = useState("");
  const [catatan, setCatatan] = useState("");
  const [kontakList, setKontakList] = useState<Row[]>([]);
  const [salesList, setSalesList] = useState<Row[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  // Beri tahu App isi keranjang, supaya Log Off/Keluar bisa memperingatkan transaksi yang belum dibayar.
  useEffect(() => { laporIsi(order ? 0 : lines.length); }, [lines.length, order, laporIsi]);
  const tanya = useMsgBox();
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "cari" | "bayar" | "kontak" | "sales" | "ambilorder" | "satuan" | "koreksi" | "pending" | "poin" | "editbarang" | "kasir" | "pilihtrans" | "pilihorder" | "stokmin">(null);
  const [kasir, setKasir] = useState({ kode: user.kodekaryawan, nama: user.namakaryawan });
  /** Dokumen yang akan dicetak dari transaksi atau order yang dipilih di daftar. */
  const [pilihUntuk, setPilihUntuk] = useState<"ulang" | "sj" | "spk">("ulang");
  // Order yang sedang diambil, pending yang sedang dipulihkan, order yang sedang dikoreksi.
  const [noOrder, setNoOrder] = useState("");
  const [noPending, setNoPending] = useState("");
  const [noKoreksi, setNoKoreksi] = useState("");
  const [dp, setDp] = useState(0);
  const [cariAwal, setCariAwal] = useState("");
  const [gantiKey, setGantiKey] = useState<number | null>(null);
  const [satuanKey, setSatuanKey] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [modeScan] = useState(getModeScan);
  const kotakScan = jual && modeScan && !order;
  const [ulang, setUlang] = useState<{ header: Row; detail: Row[] } | null>(null);
  const [ulangOrder, setUlangOrder] = useState<{ header: Row; detail: Row[] } | null>(null);
  const [promo, setPromo] = useState<PromoHitung | null>(null);
  const [dok, setDok] = useState<{ jenis: "sj" | "spk"; header: Row; detail: Row[] } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [fokusJml, setFokusJml] = useState(0);
  /** Barang yang terakhir masuk, ditampilkan besar di panel total dan disorot di tabel. */
  const [flash, setFlash] = useState<{ key: number; n: number }>({ key: -1, n: 0 });
  /** Transaksi yang baru selesai: nomor dan kembaliannya tetap terlihat sampai barang berikutnya discan. */
  const [selesai, setSelesai] = useState<{ notrans: string; kembali?: number } | null>(null);
  const [scanFokus, setScanFokus] = useState(true);
  /** Pesan merah di panel atas saat barcode yang discan belum terdaftar; hilang saat scan berikutnya berhasil. */
  const [gagalScan, setGagalScan] = useState<string | null>(null);

  const aktifLevel = Number(setting.aktiflevel) === 1;
  const level = useMemo(() => kontakList.find((k) => k.kodepelanggan === kontak)?.level ?? "", [kontak, kontakList]);
  const kontakNama = useMemo(() => {
    const k = kontakList.find((x) => (jual ? x.kodepelanggan : x.kodepemasok) === kontak);
    return k ? (jual ? k.namapelanggan : k.namapemasok) : "Tunai";
  }, [kontak, kontakList, jual]);
  const salesNama = salesList.find((k) => k.kodekaryawan === sales)?.namakaryawan ?? "";

  const refreshNo = useCallback(() => {
    api.previewNotrans(kodeTrans, tgl).then(setNotrans).catch(() => setNotrans(""));
  }, [kodeTrans, tgl]);
  useEffect(refreshNo, [refreshNo]);

  useEffect(() => {
    api.masterList(jual ? "mdpelanggan" : "mdpemasok", { limit: 5000, onlyActive: true }).then((r) => setKontakList(r.rows)).catch(() => undefined);
    api.masterList("mdkaryawan", { limit: 1000, onlyActive: true }).then((r) => setSalesList(r.rows)).catch(() => undefined);
    scanRef.current?.focus();
  }, [jual]);

  const priceOf = useCallback(
    (l: Line) => (l.manual ? l.harga : jual ? hargaJual(l.b, l.units[l.ui], l.jml, level, aktifLevel) : l.units[l.ui].hargaBeli),
    [jual, level, aktifLevel],
  );

  // Harga dihitung ulang saat pelanggan (level) berubah.
  useEffect(() => { setLines((ls) => ls.map((l) => ({ ...l, harga: priceOf(l) }))); }, [priceOf]);

  // Promo (harga diskon, bonus, PDP) dihitung backend, aturannya sama dengan saat simpan.
  const promoAktif = jual && !order && Number(setting.aktifpromo) === 1;
  const isKasir = user.level === "Kasir";
  // Kasir tanpa izin harga: kolom Hrg. Jual hanya bisa dibaca.
  const hargaTerkunci = jual && !order && isKasir && Number(setting.izinharga) !== 1;
  const kursorKeJml = jual && !order && getLocal("kursor") === "1";
  // Pengaturan izinstokmin mati (semua level): jumlah tidak boleh melebihi stok.
  const batasiStok = jual && !order && Number(setting.izinstokmin) !== 1;
  /** Jumlah terbanyak (dalam satuan transaksi) yang masih ada stoknya; null kalau tanpa batas. */
  const stokMaks = (b: Row, u: Unit): number | null =>
    batasiStok && b.jenis === "Barang" ? Math.max(0, Math.floor((Number(b.stokakhir) / u.konversi) * 100 + 1e-9) / 100) : null;
  /** Setelah barang masuk: kursor ke kolom jumlah (pengaturan "Arahkan kursor ke kolom jumlah") atau kembali ke kotak scan. */
  const setelahTambah = () => {
    if (kursorKeJml) setFokusJml((n) => n + 1);
    else setTimeout(() => scanRef.current?.focus(), 0);
  };
  useEffect(() => {
    if (!promoAktif || lines.length === 0) { setPromo(null); return; }
    let batal = false;
    const t = setTimeout(() => {
      promoKeranjang(tgl, lines.map((l) => ({
        kodebarang: l.b.kodebarang, namabarang: namaBaris(l).trim() || l.b.namabarang, kodesatuan: l.b.kodesatuan || l.units[0].satuan,
        satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga,
      }))).then((r) => { if (!batal) setPromo(r); }).catch(() => { if (!batal) setPromo(null); });
    }, 120);
    return () => { batal = true; clearTimeout(t); };
  }, [promoAktif, lines, tgl]);

  const shown: ShownLine[] = useMemo(() => {
    const p = promo && promo.baris.length === lines.length ? promo : null;
    return lines.map((l, i) => ({ ...l, harga: p ? Math.min(l.harga, p.baris[i].harga) : l.harga, pdp: p ? p.baris[i].disknilai : 0 }));
  }, [lines, promo]);
  const bonus = promoAktif && promo && promo.baris.length === lines.length ? promo.bonus : [];

  const addBarang = (b: Row, jml = 1) => {
    const ada = lines.find((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
    const maks = stokMaks(b, ada ? ada.units[0] : unitsOf(b)[0]);
    const sudah = ada?.jml ?? 0;
    if (maks !== null && sudah + jml > maks + 1e-9) {
      jml = Math.max(0, maks - sudah);
      if (jml <= 0 && !ada) return setMsg("Stok tidak mencukupi");
      setMsg("Stok tidak mencukupi");
    } else setMsg(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
      if (i >= 0) {
        const copy = [...ls];
        const l = { ...copy[i], jml: maks !== null ? sudah + jml : copy[i].jml + jml };
        copy[i] = { ...l, harga: priceOf(l) };
        setSelected(copy[i].key);
        tandaiBaru(copy[i].key);
        return copy;
      }
      const l: Line = { key: lineKey++, b, units: unitsOf(b), ui: 0, jml, harga: 0, manual: false };
      l.harga = priceOf(l);
      setSelected(l.key);
      tandaiBaru(l.key);
      return [...ls, l];
    });
  };
  const tandaiBaru = (key: number) => { setFlash((f) => ({ key, n: f.n + 1 })); setSelesai(null); setGagalScan(null); };

  const onScan = async () => {
    const code = scan.trim();
    if (!code) return setModal("cari");
    // Format "3*kode" untuk langsung mengisi jumlah, seperti kebiasaan kasir.
    const m = /^(\d+(?:[.,]\d+)?)\*(.+)$/.exec(code);
    const jml = m ? num(m[1]) : 1;
    const kode = m ? m[2] : code;
    try {
      const b = await (jual && !order ? kasirApi.findBarang(kode) : api.barangFind(kode));
      if (b) {
        setGagalScan(null);
        addBarang(b, jml);
        setScan("");
        setelahTambah();
      } else if (!jual) {
        // Pembelian dan order: pesan seperti aslinya, bukan dialog cari.
        setMsg("Data tidak ditemukan, atau barang tidak aktif.");
        setScan("");
      } else {
        // Barcode tidak terdaftar: bunyi dan pesan di panel atas, kursor tetap di kolom scan supaya scan berikutnya tidak salah masuk.
        bunyiGagal();
        setGagalScan(`Barcode ${kode} belum terdaftar. Tekan F10 untuk mencari barang.`);
        setScan("");
        setTimeout(() => scanRef.current?.focus(), 0);
      }
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const update = (key: number, patch: Partial<Line>) => {
    // Jumlah melebihi stok: kembalikan ke stok yang ada.
    const cur = lines.find((l) => l.key === key);
    if (cur && ("jml" in patch || "ui" in patch)) {
      const n = { ...cur, ...patch };
      const maks = stokMaks(n.b, n.units[n.ui]);
      if (maks !== null && n.jml > maks + 1e-9) {
        patch = { ...patch, jml: maks };
        setMsg("Stok tidak mencukupi");
      }
    }
    setLines((ls) => ls.map((l) => {
      if (l.key !== key) return l;
      const n = { ...l, ...patch };
      if ("ui" in patch && !("hrgjual" in patch)) n.hrgjual = undefined;
      return "harga" in patch || "hrgjual" in patch || "nama" in patch ? n : { ...n, harga: priceOf(n) };
    }));
  };

  const hapusBaris = (key: number) => {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const rest = ls.filter((l) => l.key !== key);
      setSelected(rest.length ? rest[Math.min(i, rest.length - 1)].key : null);
      return rest;
    });
  };

  const total = shown.reduce((s, l) => s + l.jml * l.harga - l.pdp, 0);
  // Barang terakhir: yang terakhir discan, atau baris terakhir di tabel kalau barang datang dari pending/order.
  const terakhir = shown.find((l) => l.key === flash.key) ?? shown[shown.length - 1] ?? null;
  const totalItem = lines.reduce((s, l) => s + l.jml, 0);

  const reset = () => {
    setTgl(today());
    setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan });
    setLines([]);
    setGagalScan(null);
    setKontak("");
    setSales("");
    setCatatan("");
    setNoOrder("");
    setNoPending("");
    setNoKoreksi("");
    setDp(0);
    setMsg(null);
    setSelected(null);
    setPromo(null);
    refreshNo();
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  /** Batal [F6]: seperti aslinya (cBatal_Click) langsung mengosongkan form tanpa bertanya, lalu kursor ke Pelanggan. */
  const batal = () => {
    const kosongkan = () => {
      reset();
      setTimeout(() => fokusCtl(jual ? "tPelangganNama" : "tPemasokNama"), 0);
    };
    // Skin modern: Batal menghapus semua barang, jadi tanyakan dulu kalau sudah ada barang.
    if (modern && lines.length > 0) tanya.confirm("Hapus semua barang di transaksi ini? Barang yang sudah discan akan hilang.", kosongkan, "Batalkan transaksi", undefined, "Ya, kosongkan");
    else kosongkan();
  };

  const bayar = () => {
    if (lines.length === 0) return setMsg("Belum ada barang. Scan barcode atau tekan F10 untuk mencari barang.");
    if (lines.some((l) => l.jml <= 0)) return setMsg("Ada barang dengan jumlah 0. Perbaiki dulu jumlahnya.");
    if (order) return void simpanOrder();
    // Skin modern: jumlah yang tidak wajar (biasanya barcode masuk ke kolom jumlah) ditanyakan sekali sebelum bayar.
    const besar = modern ? lines.filter(jmlBesar) : [];
    if (besar.length) {
      const daftar = besar.map((l) => `• ${namaBaris(l)}: ${qty(l.jml)} ${l.units[l.ui].satuan}`).join("\n");
      return tanya.confirm(`Jumlah barang ini besar:\n${daftar}\n\nSudah benar dan lanjut ke pembayaran?`, () => setModal("bayar"), "Cek jumlah barang");
    }
    setModal("bayar");
  };
  const jmlBesar = (l: Line) => l.jml >= JML_BESAR;

  const itemsInput = () => lines.map((l) => ({
    kodebarang: l.b.kodebarang, namabarang: namaBaris(l).trim() || l.b.namabarang, kodesatuan: l.b.kodesatuan || l.units[0].satuan,
    satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga,
  }));

  /** Simpan order (SO/PO). Stok tidak berubah. */
  const simpanOrder = async () => {
    try {
      const r = await orderApi.saveOrder({
        jual, tgl, kodepelanggan: jual ? kontak : undefined, kodepemasok: jual ? undefined : kontak, kodesales: sales, catatan,
        dp: jual ? dp : 0, items: itemsInput(), notrans: noKoreksi || undefined, kodekasir: kasir.kode,
      });
      const o = await orderApi.getOrder(r.notrans);
      reset();
      tanya.confirm(`Data sudah disimpan (${r.notrans}). Apakah akan cetak nota order?`, () => setUlangOrder(o));
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Isi layar dari baris order atau pending. Harga yang tersimpan dipakai apa adanya. */
  const muatBaris = async (detail: Row[]) => {
    const baru: Line[] = [];
    const hilang: string[] = [];
    for (const d of detail) {
      const b = await api.barangFind(d.kodebarang);
      if (!b) { hilang.push(d.namabarang || d.kodebarang); continue; }
      const units = unitsOf(b);
      let ui = units.findIndex((u) => u.satuan === d.satuanjual);
      let jml = Number(d.jmljual) || 0;
      let harga = Number(d.hrgterjual) || 0;
      if (ui < 0) { // satuan sudah tidak ada di master: pakai satuan dasar
        const k = Number(d.konversi) > 0 ? Number(d.konversi) : 1;
        ui = 0; jml *= k; harga /= k;
      }
      baru.push({ key: lineKey++, b, units, ui, jml, harga, manual: true });
    }
    setLines(baru);
    setSelected(baru[0]?.key ?? null);
    if (hilang.length) setMsg(`Barang ini sudah tidak ada di data barang, jadi tidak ikut diambil: ${hilang.join(", ")}.`);
  };

  const kontakDari = (h: Row, kode: string) => (h[kode] && h[kode] !== "Tunai" ? String(h[kode]) : "");

  // window.confirm tidak muncul di WebView Tauri, jadi pakai kotak pesan aplikasi.
  const konfirmGanti = () => new Promise<boolean>((ok) => {
    if (lines.length === 0) ok(true);
    else tanya.confirm("Barang yang ada di layar akan diganti. Lanjutkan?", () => ok(true));
  });

  /** Ambil Order [F3] (kasir/pembelian) dan Koreksi Order (layar order). */
  const ambilOrder = async (nomor: string, koreksi: boolean) => {
    if (!(await konfirmGanti())) return;
    try {
      const o = await orderApi.getOrder(nomor);
      const h = o.header;
      if (Number(h.status) === 1) return setMsg("Order ini sudah diambil. Silakan pilih order lain.");
      setModal(null);
      setKontak(kontakDari(h, jual ? "kodepelanggan" : "kodepemasok"));
      setSales(h.kodesales ?? "");
      setCatatan(h.catatan ?? "");
      setDp(jual ? Number(h.jmlbayar) || 0 : 0);
      if (koreksi) { setNoKoreksi(nomor); setTgl(String(h.tglorder || today())); setNoOrder(""); }
      else { setNoOrder(nomor); setNoKoreksi(""); }
      await muatBaris(o.detail);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Tombol Pending: tunda penjualan yang belum selesai. */
  const simpanPending = async () => {
    if (lines.length === 0) return setMsg("Data transaksi masih kosong.");
    try {
      await orderApi.savePending({
        nopending: noPending || undefined, tgl, kodepelanggan: kontak, kodesales: sales, catatan,
        items: itemsInput(), kodekasir: kasir.kode,
      });
      reset();
      setMsg("Pending transaksi sudah tersimpan");
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const ambilPending = async (nomor: string) => {
    if (!(await konfirmGanti())) return;
    try {
      const p = await orderApi.getPending(nomor);
      const h = p.header;
      setModal(null);
      setNoPending(nomor);
      setNoOrder("");
      setDp(0);
      setKontak(kontakDari(h, "kodepelanggan"));
      setSales(h.kodesales ?? "");
      setCatatan(h.catatan ?? "");
      await muatBaris(p.detail);
    } catch (e) {
      setMsg(errText(e));
    }
  };

  /** Cetak ulang nota order: pilih order dari daftar (FrmCariOrderJual / FrmCariOrderBeli). */
  const cetakOrderPilih = async (nomor: string) => {
    try {
      setModal(null);
      setUlangOrder(await orderApi.getOrder(nomor));
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    if (!ulangOrder) return;
    cetakStruk(strukOrderTeks(ulangOrder, setting)).catch((e) => setMsg(errText(e))).finally(() => setUlangOrder(null));
  }, [ulangOrder]);

  const cekPoin = () => {
    if (!kontak) return setMsg("Pilih dulu pelanggannya (tombol ? di samping kolom Pelanggan). Poin hanya dimiliki pelanggan terdaftar.");
    setModal("poin");
  };

  /** Surat Jalan dan SPK Gudang: dicetak dari transaksi penjualan yang dipilih di daftar (FrmCariTransJual). */
  const cetakDokumen = async (jenis: "sj" | "spk", no: string) => {
    try {
      setModal(null);
      const t = await api.getTransaksi(no);
      const detail = await Promise.all(t.detail.map(async (d) => {
        const b = await api.barangFind(d.kodebarang).catch(() => null);
        return { ...d, barcode: b?.barcode ?? "", rak: b?.rak ?? "" };
      }));
      setDok({ jenis, header: t.header, detail });
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const bukaPilih = (untuk: "ulang" | "sj" | "spk") => { setPilihUntuk(untuk); setModal("pilihtrans"); };
  useEffect(() => {
    if (!dok) return;
    cetakDokumen_(setMsg).finally(() => setDok(null));
  }, [dok]);

  /** Isi pesanan dengan barang yang dipilih dari daftar Stok Min: jumlah = kekurangan sampai stok maksimal. */
  const tambahStokMin = (b: Row) => {
    const min = Number(b.stokmin), max = Number(b.stokmax), akhir = Number(b.stokakhir);
    const jml = Math.round((max > min ? max - akhir : min - akhir) * 100) / 100;
    if (jml <= 0) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.b.kodebarang === b.kodebarang && l.ui === 0);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], jml: Math.max(c[i].jml, jml) }; return c; }
      const l: Line = { key: lineKey++, b, units: unitsOf(b), ui: 0, jml, harga: 0, manual: false };
      l.harga = priceOf(l);
      return [...ls, l];
    });
  };
  const stokMin = () => setModal("stokmin");

  const editBarang = () => {
    if (selected == null) return setMsg("Pilih dulu barang di tabel yang akan diubah datanya.");
    setModal("editbarang");
  };
  /** Setelah data barang diubah: ambil ulang barangnya dan hitung ulang harga barisnya. */
  const barangBerubah = async (key: string | null) => {
    const lama = lines.find((l) => l.key === selected);
    if (!lama) return;
    try {
      const b = await api.barangFind(key || lama.b.kodebarang);
      if (!b) return setMsg("Barang ini sudah tidak ditemukan di data barang.");
      const units = unitsOf(b);
      const sat = lama.units[lama.ui].satuan;
      const ui = Math.max(0, units.findIndex((u) => u.satuan === sat));
      setLines((ls) => ls.map((l) => {
        if (l.key !== lama.key) return l;
        const n = { ...l, b, units, ui, manual: false };
        return { ...n, harga: priceOf(n) };
      }));
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const cariBarang = () => { setCariAwal(scan); setModal("cari"); };

  /** Cetak Ulang: pilih transaksi dari daftar lalu cetak. */
  const cetakUlang = async (no: string) => {
    try {
      setModal(null);
      setUlang(await api.getTransaksi(no));
    } catch (e) {
      setMsg(errText(e));
    }
  };
  useEffect(() => {
    if (!ulang) return;
    cetakStruk(strukTeks(ulang, setting)).catch((e) => setMsg(errText(e))).finally(() => setUlang(null));
  }, [ulang]);

  const fokusCtl = (name: string) => document.querySelector<HTMLElement>(`[data-vb="${name}"] input, [data-vb="${name}"] textarea`)?.focus();
  const tutupLayar = () => {
    if (lines.length > 0 && !order) tanya.confirm("Masih ada barang di transaksi ini. Batalkan transaksi dan tutup layar kasir?", () => go("home"), "Tutup layar kasir", undefined, "Ya, batalkan");
    else go("home");
  };
  const kasirBisaDiganti = user.level.toUpperCase() !== "KASIR";

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Layar kasir yang sedang disembunyikan tidak boleh menanggapi tombol.
      if (!aktif || modal || msg || tanya.node) return;
      if (ev.key === "Escape") { ev.preventDefault(); tutupLayar(); return; }
      if (ev.altKey) {
        const m: Record<string, () => void> = {
          KeyT: () => (kotakScan ? gridRef.current?.focus() : scanRef.current?.focus()),
          Digit1: () => document.querySelector<HTMLElement>('[data-vb="dtTglTrans"] input')?.focus(),
          Digit2: () => { if (kasirBisaDiganti) setModal("kasir"); },
          Digit3: () => setModal("kontak"),
          Digit4: () => setModal("sales"),
          Digit5: () => fokusCtl("tCatatan"),
        };
        if (m[ev.code]) { ev.preventDefault(); m[ev.code](); }
        return;
      }
      const cariBarangF10 = () => { setCariAwal(""); setModal("cari"); };
      const f: Record<string, () => void> = order
        ? { F1: batal, F4: bayar, F10: cariBarangF10, ...(jual ? {} : { F6: stokMin }) }
        : jual
          ? {
            F1: () => { setScan(""); scanRef.current?.focus(); }, F3: () => setModal("ambilorder"), F4: bayar, F6: batal, F10: cariBarangF10,
            ...(modern ? { F7: simpanPending, F8: () => setModal("pending"), ...(poinAktif ? { F9: cekPoin } : {}) } : {}),
          }
          : { F1: batal, F3: () => setModal("ambilorder"), F4: bayar, F6: stokMin, F10: cariBarangF10 };
      if (f[ev.key]) { ev.preventDefault(); f[ev.key](); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stokKurang = (l: Line) => jual && !order && l.b.jenis === "Barang" && l.jml * l.units[l.ui].konversi > Number(l.b.stokakhir);
  const stokTipis = (l: Line) => {
    if (!jual || order || l.b.jenis !== "Barang") return false;
    const min = Number(l.b.stokmin);
    return min > 0 && Number(l.b.stokakhir) - l.jml * l.units[l.ui].konversi <= min;
  };
  const kontakKey = jual ? "tPelangganNama" : "tPemasokNama";
  const poinAktif = Number(setting.aktifpoin) === 1 && Number(setting.aktiftranspoin) === 1;

  // Enter di kolom kepala pindah ke kolom berikutnya: Tanggal, Kasir, Pelanggan/Pemasok, Sales, Catatan, lalu kotak scan.
  const rantai = ["dtTglTrans", "tKasirNama", kontakKey, "tSalesNama", "tCatatan"];
  const enterKepala = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || modal || msg || tanya.node) return;
    const nama = (e.target as HTMLElement).closest<HTMLElement>("[data-vb]")?.dataset.vb ?? "";
    const i = rantai.indexOf(nama);
    if (i < 0 || !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    if (i < rantai.length - 1) fokusCtl(rantai[i + 1]);
    else scanRef.current?.focus();
  };

  return (
    <div className="flex size-full flex-col overflow-hidden bg-background" data-form={formName} onKeyDown={enterKepala}>
      {tanya.node}
      <>
          <div className="grid grid-cols-2 items-end gap-3 border-b bg-background px-3 py-1.5 sm:grid-cols-3 lg:grid-cols-6">
            <div className="flex flex-col gap-1" data-vb="tNoTrans">
              <Label className="block truncate text-xs font-medium text-foreground">{order ? "No. Order" : "No. Transaksi"}</Label>
              <Input readOnly tabIndex={-1} value={noKoreksi || notrans} className="cursor-default border-transparent bg-muted font-semibold text-foreground tabular-nums shadow-none focus-visible:ring-0" />
            </div>

            <div className="flex flex-col gap-1" data-vb="dtTglTrans">
              <LabelKepala teks="Tanggal" pintas="Alt+1" />
              <Input
                type="date"
                value={tgl}
                onChange={(e) => e.target.value && setTgl(e.target.value)}
                disabled={!kasirBisaDiganti}
                title={!kasirBisaDiganti ? "Tanggal hanya bisa diubah oleh Manager" : undefined}
                className="border-foreground/20 bg-background pr-1.5 text-foreground tabular-nums [&::-webkit-calendar-picker-indicator]:ml-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-datetime-edit]:p-0"
              />
            </div>

            <div className="flex flex-col gap-1" data-vb="tKasirNama">
              <LabelKepala teks="Kasir" pintas="Alt+2" />
              <InputGroup className={cn("border-foreground/20", kasirBisaDiganti ? "bg-background" : "border-transparent bg-muted")}>
                <InputGroupInput readOnly value={kasir.nama} className="cursor-default font-medium text-foreground" />
                {kasirBisaDiganti && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton size="icon-xs" aria-label="Pilih kasir" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setModal("kasir")}>
                      <SearchIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1" data-vb={kontakKey}>
              <LabelKepala teks={jual ? "Pelanggan" : "Supplier"} pintas="Alt+3" />
              <InputGroup className="border-foreground/20 bg-background">
                <InputGroupInput readOnly value={kontakNama} className="cursor-default font-medium text-foreground" />
                <InputGroupAddon align="inline-end">
                  {jual && kontak && (
                    <span className="rounded-sm border border-border bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-foreground" title={level ? `Level harga: ${level}` : "Pelanggan terdaftar"}>
                      {level || "Member"}
                    </span>
                  )}
                  <InputGroupButton size="icon-xs" aria-label={jual ? "Pilih pelanggan" : "Pilih supplier"} className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setModal("kontak")}>
                    <SearchIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1" data-vb="tSalesNama">
              <LabelKepala teks="Sales" pintas="Alt+4" />
              <InputGroup className="border-foreground/20 bg-background">
                <InputGroupInput readOnly value={salesNama} placeholder="Tanpa sales" className="cursor-default text-foreground" />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Pilih sales" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setModal("sales")}>
                    <SearchIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>

            <div className="flex flex-col gap-1" data-vb="tCatatan">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">Catatan</span>
                  {(noOrder || noPending || noKoreksi) && (
                    <span className="inline-flex items-center gap-1 rounded-xs border border-border bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-foreground tabular-nums">
                      <span>{noKoreksi ? "Koreksi:" : noOrder ? "Order:" : "Pending:"}</span>
                      <span>{noKoreksi || noOrder || noPending}</span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">Alt+5</span>
              </div>
              <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Catatan transaksi (opsional)" className="border-foreground/20 bg-background text-foreground" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-display px-4 py-2 text-display-foreground">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[11px] font-medium uppercase tracking-wider text-display-foreground/65">Jenis Barang</span>
                <span className="text-2xl leading-none font-bold tabular-nums">{lines.length}</span>
              </div>
              <div className="h-8 w-px bg-display-foreground/15" />
              <div className="flex flex-col">
                <span className="text-[11px] font-medium uppercase tracking-wider text-display-foreground/65">Total Item</span>
                <span className="text-2xl leading-none font-bold tabular-nums">{qty(totalItem)}</span>
              </div>
            </div>
            <div className="hidden min-w-0 flex-1 flex-col justify-center border-l border-display-foreground/20 pl-5 md:flex" aria-live="polite">
              {gagalScan ? (
                <div role="alert" className="flex items-center gap-2 rounded-md border-2 border-destructive bg-background px-3 py-1.5 text-sm font-semibold text-destructive lg:text-base">
                  <span className="min-w-0">{gagalScan}</span>
                </div>
              ) : terakhir ? (
                <>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-display-foreground/65">Barang Terakhir</div>
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <span className="truncate text-lg leading-tight font-semibold lg:text-xl">{namaBaris(terakhir)}</span>
                    <span className="shrink-0 rounded-xs bg-display-foreground/12 px-1.5 py-0.5 text-xs font-medium tabular-nums text-display-foreground/95 lg:text-sm">
                      {qty(terakhir.jml)} {terakhir.units[terakhir.ui].satuan} × {rp(terakhir.harga)}
                    </span>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-display-foreground/70 lg:text-sm">= Rp {rp(terakhir.jml * terakhir.harga - terakhir.pdp)}</span>
                    {stokTipis(terakhir) && (
                      <span data-slot="badge" className="shrink-0 rounded-sm bg-warning px-1.5 py-0.5 text-xs font-semibold text-warning-foreground">Stok menipis</span>
                    )}
                  </div>
                </>
              ) : selesai ? (
                <>
                  <div className="text-xs text-display-foreground/75">Transaksi {selesai.notrans} sudah tersimpan</div>
                  <div className="text-base font-semibold lg:text-lg">Silakan scan barang berikutnya</div>
                </>
              ) : (
                <div className="text-base font-semibold text-display-foreground/85 lg:text-lg">
                  {kotakScan ? "Silakan scan barang pertama" : "Scan barcode atau ketik kode. Ketik 3*kode untuk 3 barang sekaligus. F10 untuk mencari."}
                </div>
              )}
            </div>
            {selesai && lines.length === 0 ? (
              <div className="flex items-center gap-2.5" data-vb="lblTotal" aria-live="polite">
                <span className="text-sm font-medium text-display-foreground/80 lg:text-base">{selesai.kembali != null ? "Kembalian" : "Tersimpan"}</span>
                {selesai.kembali != null && (
                  <span className="-my-1 rounded-md bg-success px-3 py-1 text-3xl leading-none font-bold tracking-tight text-success-foreground tabular-nums lg:text-[2.5rem]">
                    {selesai.kembali > 0 ? `Rp ${rp(selesai.kembali)}` : "Rp 0"}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-baseline gap-1.5" data-vb="lblTotal">
                <span className="text-sm font-medium text-display-foreground/70 lg:text-base">Rp</span>
                <span className="text-3xl leading-none font-bold tracking-tight tabular-nums lg:text-[2.5rem]">{rp(total)}</span>
              </div>
            )}
          </div>

          {kotakScan && (
            <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5">
              <div
                onClick={() => scanRef.current?.focus()}
                className={cn(
                  "flex h-8 max-w-xl flex-1 cursor-text items-center overflow-hidden rounded-md border bg-background shadow-xs transition-all",
                  scanFokus
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-foreground/25 hover:border-primary/50",
                )}
              >
                <Label
                  htmlFor="tp-scan"
                  className={cn(
                    "flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r px-2.5 text-xs font-semibold transition-colors select-none",
                    scanFokus
                      ? "border-primary bg-accent text-foreground"
                      : "border-border bg-muted/60 text-foreground/80",
                  )}
                >
                  <ScanBarcodeIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>Scan Barcode</span>
                  <Kbd className={cn("border", scanFokus ? "border-primary/30 bg-background text-primary" : "border-border bg-background text-foreground")}>F1</Kbd>
                </Label>
                <Input
                  id="tp-scan"
                  ref={scanRef}
                  value={scan}
                  autoComplete="off"
                  placeholder="Scan atau ketik kode barang (mis. 3*kode)"
                  className="h-full flex-1 rounded-none border-0 bg-transparent dark:bg-transparent px-2.5 text-sm font-medium text-foreground shadow-none placeholder:font-normal placeholder:text-muted-foreground/75 focus-visible:ring-0 md:text-sm"
                  onFocus={() => setScanFokus(true)}
                  onBlur={() => setScanFokus(false)}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onScan();
                    else if (e.key === "Escape" && scan) { e.preventDefault(); e.stopPropagation(); setScan(""); }
                  }}
                />
                {scan ? (
                  <div className="flex shrink-0 items-center gap-1 pr-1.5">
                    <button
                      type="button"
                      data-slot="scan-clear"
                      tabIndex={-1}
                      title="Bersihkan ketikan (Esc)"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setScan(""); scanRef.current?.focus(); }}
                      className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      data-slot="scan-submit"
                      tabIndex={-1}
                      title="Masukkan barang (Enter)"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void onScan()}
                      className="flex h-6 items-center gap-1 rounded-sm bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      <span>Enter</span>
                      <CornerDownLeftIcon className="size-3" />
                    </button>
                  </div>
                ) : (
                  <span className="pointer-events-none flex shrink-0 items-center gap-1 pr-1.5 text-[11px] text-muted-foreground select-none">
                    <Kbd className="border border-border bg-muted/60 px-1.5 text-[10px] text-muted-foreground">Enter ↵</Kbd>
                  </span>
                )}
              </div>
              <Button type="button" variant="outline" size="default" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={cariBarang}>
                <SearchIcon className="size-3.5" />
                <span>Cari Barang</span>
                <Kbd className="border border-border bg-muted text-foreground">F10</Kbd>
              </Button>
              {selected != null && (
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  title="Hapus baris barang yang dipilih (Delete)"
                  onClick={() => { hapusBaris(selected); scanRef.current?.focus(); }}
                  className={cn(
                    "h-8 px-2.5 text-xs font-medium shadow-xs",
                    !scanFokus
                      ? "border-destructive/35 bg-background text-destructive hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                      : "border-foreground/20 bg-background text-foreground/80 hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
                  )}
                >
                  <Trash2Icon className="size-3.5" />
                  <span>Hapus Baris</span>
                  <Kbd className={cn("border", !scanFokus ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted text-foreground")}>Del</Kbd>
                </Button>
              )}
              {!scanFokus && !modal ? (
                <button
                  type="button"
                  data-slot="scan-ingat"
                  onClick={() => scanRef.current?.focus()}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-warning bg-warning/20 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-warning/30"
                >
                  Kursor di tabel · Tekan <Kbd className="border border-warning bg-background text-foreground">F1</Kbd> ke scan
                </button>
              ) : (
                <div className="ml-auto hidden items-center gap-2.5 text-xs text-muted-foreground xl:flex">
                  <span className="flex items-center gap-1"><Kbd className="border border-border bg-background text-foreground">3*kode</Kbd> Langsung 3 barang</span>
                  <span className="flex items-center gap-1"><Kbd className="border border-border bg-background text-foreground">Alt+T</Kbd> Ke tabel</span>
                </div>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 gap-2.5 bg-muted/20 px-3 py-2">
            <div className="min-w-0 flex-1">
              <DetailGrid
                jual={jual}
                lines={shown}
                selected={selected}
                onSelect={setSelected}
                onUpdate={update}
                onDelete={hapusBaris}
                onEnterScan={() => scanRef.current?.focus()}
                onCariKode={(k) => { setGantiKey(k); setCariAwal(""); setModal("cari"); }}
                onCariSatuan={(k) => { setSatuanKey(k); setModal("satuan"); }}
                stokKurang={stokKurang}
                stokTipis={stokTipis}
                gridRef={gridRef}
                hargaTerkunci={hargaTerkunci}
                fokusJml={fokusJml}
                flash={flash}
                jmlBesar={jmlBesar}
                entry={kotakScan ? undefined : { value: scan, onChange: setScan, onEnter: onScan, onCari: cariBarang, inputRef: scanRef }}
              />
            </div>
            {promoAktif && bonus.length > 0 && (
              <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-md border border-success/40 bg-card">
                <div className="flex h-8 items-center justify-center bg-success px-3 text-sm font-semibold tracking-tight text-success-foreground">
                  Barang Bonus ({bonus.length})
                </div>
                <div className="min-h-0 flex-1">
                  <BonusGrid bonus={bonus} />
                </div>
              </div>
            )}
          </div>

          {order && jual && (
            <div className="flex items-center justify-end gap-3 border-t border-display-foreground/15 bg-display px-4 py-1.5 text-display-foreground">
              <Label className="text-xs font-semibold tracking-wide uppercase">DP / Uang Muka</Label>
              <div className="h-8 w-44 rounded-md border border-input bg-background text-foreground">
                <VNum f="tDP" right ribuan value={dp} onChange={setDp} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive" onClick={batal}>
                <span>Batal</span>
                <Kbd className="border border-destructive/35 bg-destructive/10 text-destructive">{jual && !order ? "F6" : "F1"}</Kbd>
              </Button>
              <Separator orientation="vertical" className="mx-0.5 h-5 bg-foreground/20 data-vertical:self-center" />
              {!order && (
                <Button type="button" variant="outline" size="default" data-vb="cAmbilOrder" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={() => setModal("ambilorder")}>
                  <span>Ambil Order</span>
                  <Kbd className={KBD_BAWAH}>F3</Kbd>
                </Button>
              )}
              {order && (
                <Button type="button" variant="outline" size="default" data-vb="cEdit" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={() => setModal("koreksi")}>
                  <span>Koreksi Order</span>
                </Button>
              )}
              {jual && !order && (
                <>
                  <Button type="button" variant="outline" size="default" data-vb="cPending" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={simpanPending}>
                    <span>Pending</span>
                    <Kbd className={KBD_BAWAH}>F7</Kbd>
                  </Button>
                  <Button type="button" variant="outline" size="default" data-vb="cDataPending" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={() => setModal("pending")}>
                    <span>Data Pending</span>
                    <Kbd className={KBD_BAWAH}>F8</Kbd>
                  </Button>
                  {poinAktif && (
                    <Button type="button" variant="outline" size="default" data-vb="cCekPoin" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={cekPoin}>
                      <span>Cek Poin</span>
                      <Kbd className={KBD_BAWAH}>F9</Kbd>
                    </Button>
                  )}
                </>
              )}
              <Button type="button" variant="outline" size="default" data-vb="cCetakUlang" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={() => (order ? setModal("pilihorder") : bukaPilih("ulang"))}>
                <span>Cetak Ulang</span>
              </Button>
              {!jual && (
                <>
                  <Button type="button" variant="outline" size="default" data-vb="cStokMin" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={stokMin}>
                    <span>Stok Menipis</span>
                    <Kbd className={KBD_BAWAH}>F6</Kbd>
                  </Button>
                  {!order && (
                    <Button type="button" variant="outline" size="default" data-vb="cEditBarang" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={editBarang}>
                      <span>Edit Barang</span>
                    </Button>
                  )}
                </>
              )}
              {jual && !order && (
                <>
                  <Separator orientation="vertical" className="mx-0.5 h-5 bg-foreground/20 data-vertical:self-center" />
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button type="button" variant="outline" size="default" data-vb="cLainnya" className={cn(TOMBOL_BAWAH, "h-8 gap-1 px-2.5 text-xs font-medium")} />}>
                      Lainnya <ChevronDownIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" className="w-44">
                      <DropdownMenuItem data-vb="cSuratJalan" onClick={() => bukaPilih("sj")}>Surat Jalan</DropdownMenuItem>
                      <DropdownMenuItem data-vb="cSPK" onClick={() => bukaPilih("spk")}>SPK Gudang</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {!kotakScan && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground select-none" title="Tekan F10 untuk mencari barang">
                  <Kbd className={KBD_BAWAH}>F10</Kbd>
                  <span>Cari barang</span>
                </span>
              )}
              <Button type="button" variant="outline" size="default" data-vb="cTutup" className={cn(TOMBOL_BAWAH, "h-8 px-2.5 text-xs font-medium")} onClick={tutupLayar}>
                <span>Tutup</span>
                <Kbd className={KBD_BAWAH}>Esc</Kbd>
              </Button>
              <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 gap-1.5 px-3.5 text-xs font-semibold shadow-xs" onClick={bayar}>
                <span>{order ? "Simpan" : "Bayar"}</span>
                <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">F4</Kbd>
              </Button>
            </div>
          </div>
      </>

      {modal === "cari" && (
        <CariBarang initial={cariAwal} showBeli={!jual} kasir={jual && !order} onClose={() => { setModal(null); setGantiKey(null); scanRef.current?.focus(); }}
          onPick={(b) => {
            if (gantiKey != null) {
              update(gantiKey, { b, units: unitsOf(b), ui: 0, manual: false });
              setGantiKey(null); setModal(null); setelahTambah();
            } else { addBarang(b); setModal(null); setelahTambah(); }
          }} />
      )}
      {modal === "satuan" && lines.find((l) => l.key === satuanKey) && (() => {
        const l = lines.find((x) => x.key === satuanKey)!;
        return <CariSatuan units={l.units} aktif={l.ui} jual={jual}
          onClose={() => { setModal(null); setSatuanKey(null); scanRef.current?.focus(); }}
          onPick={(i) => { update(l.key, { ui: i, manual: false }); setModal(null); setSatuanKey(null); setelahTambah(); }} />;
      })()}
      {modal === "kontak" && (
        <PilihModal title={jual ? "Pilih Pelanggan" : "Pilih Supplier"} kosong="Tunai"
          rows={kontakList.map((k) => ({ kode: jual ? k.kodepelanggan : k.kodepemasok, nama: jual ? `${k.namapelanggan}${k.level ? ` · ${k.level}` : ""}` : k.namapemasok }))}
          onClose={() => setModal(null)} onPick={(k) => { setKontak(k); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "sales" && (
        <PilihModal title="Pilih Sales" kosong="Tanpa sales"
          rows={salesList.map((k) => ({ kode: k.kodekaryawan, nama: k.namakaryawan }))}
          onClose={() => setModal(null)} onPick={(k) => { setSales(k); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "bayar" && (
        <BayarDialog mode={mode} tgl={tgl} kontak={kontak} sales={sales} kasir={kasir.kode} catatan={catatan} lines={shown} noorder={noOrder} dpAwal={dp}
          onClose={() => setModal(null)}
          onTanpaPemasok={(pesan) => { setModal(null); setMsg(pesan); setTimeout(() => fokusCtl("tPemasokNama"), 0); }}
          onSaved={(no, cetak, kembali) => {
            if (cetak) setUlang(cetak);
            if (no) setSelesai({ notrans: no, kembali });
            if (noPending) orderApi.pendingSelesai(noPending).catch(() => undefined);
            setModal(null);
            reset();
          }} />
      )}
      {modal === "ambilorder" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void ambilOrder(n, false)} />}
      {modal === "koreksi" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void ambilOrder(n, true)} />}
      {modal === "kasir" && (
        <CariMaster table="mdkaryawan" onClose={() => setModal(null)}
          onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setModal(null); scanRef.current?.focus(); }} />
      )}
      {modal === "pilihtrans" && (
        <CariTransaksi kode={jual ? "TJ" : "TB"} onClose={() => setModal(null)}
          onPick={(no) => (pilihUntuk === "ulang" ? void cetakUlang(no) : void cetakDokumen(pilihUntuk, no))} />
      )}
      {modal === "pilihorder" && <CariDataDialog jenis={jual ? "orderjual" : "orderbeli"} onClose={() => setModal(null)} onAmbil={(n) => void cetakOrderPilih(n)} />}
      {modal === "stokmin" && <StokMinDialog onPick={tambahStokMin} onClose={() => setModal(null)} />}
      {modal === "pending" && <CariDataDialog jenis="pending" onClose={() => setModal(null)} onAmbil={(n) => void ambilPending(n)} />}
      {msg && (
        <Modal title={formCaption(formName)} onClose={() => setMsg(null)}
          footer={<Button autoFocus onClick={() => setMsg(null)}>OK</Button>}>
          <Alert kind="info">{msg}</Alert>
        </Modal>
      )}
      {modal === "poin" && <PoinMember kode={kontak} onClose={() => { setModal(null); scanRef.current?.focus(); }} />}
      {modal === "editbarang" && (() => {
        const l = lines.find((x) => x.key === selected);
        return l ? <BarangEdit row={l.b} isNew={false} onClose={() => setModal(null)} onChanged={(k) => void barangBerubah(k)} /> : null;
      })()}
      {dok && <DokumenGudang dok={dok} setting={setting} />}
      {ulang && <Struk trans={ulang} setting={setting} />}
      {ulangOrder && <StrukOrder order={ulangOrder} setting={setting} />}
    </div>
  );
}

/** Cetak ulang order di kertas struk. */
function StrukOrder({ order, setting }: { order: { header: Row; detail: Row[] }; setting: Row }) {
  const h = order.header;
  const jual = h.kode === "SO";
  return createPortal(
    <div className="struk">
      <div className="center bold">{setting.namausaha}</div>
      {setting.alamat && <div className="center">{setting.alamat}{setting.kota ? `, ${setting.kota}` : ""}</div>}
      <div className="center bold">{jual ? "ORDER PENJUALAN" : "ORDER PEMBELIAN"}</div>
      <hr />
      <div className="row"><span>{h.notrans}</span><span>{tglID(h.tglorder)}</span></div>
      <div className="row"><span>{jual ? "Pelanggan" : "Supplier"}</span><span>{jual ? h.namapelanggan : h.namapemasok}</span></div>
      <div className="row"><span>Petugas</span><span>{h.namakasir}</span></div>
      <hr />
      {order.detail.map((d) => (
        <div key={d.nourut}>
          <div>{d.namabarang}</div>
          <div className="row"><span>{qty(d.jmljual)} {d.satuanjual} x {rp(d.hrgterjual)}</span><span>{rp(Number(d.jmljual) * Number(d.hrgterjual) - Number(d.disknilai || 0))}</span></div>
        </div>
      ))}
      <hr />
      <div className="row bold"><span>TOTAL</span><span>{rp(h.jmltrans)}</span></div>
      {jual && Number(h.jmlbayar) > 0 && <div className="row"><span>Uang muka</span><span>{rp(h.jmlbayar)}</span></div>}
      {h.catatan && <div>{h.catatan}</div>}
    </div>,
    document.body,
  );
}

/** Buka dialog cetak untuk dokumen gudang (kertas A4, bukan struk). */
async function cetakDokumen_(setMsg: (m: string) => void) {
  try {
    document.body.dataset.print = "dokumen";
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await api.cetak();
  } catch (e) {
    setMsg(errText(e));
  }
}

/** Surat Jalan (RptSuratJalan) dan Faktur SPK (RptSPK): daftar barang tanpa harga. SPK menambah kolom Rak/Etalase. */
function DokumenGudang({ dok, setting }: { dok: { jenis: "sj" | "spk"; header: Row; detail: Row[] }; setting: Row }) {
  const h = dok.header;
  const spk = dok.jenis === "spk";
  const jenisBarang = new Set(dok.detail.map((d) => d.kodebarang)).size;
  const totalItem = dok.detail.reduce((s, d) => s + (Number(d.jmljual) || 0), 0);
  return createPortal(
    <div className="tj-dok">
      <div className="dk-kop">
        <div className="dk-judul">{spk ? "Faktur SPK" : "Surat Jalan"}</div>
        <div><strong>{setting.namausaha}</strong></div>
        {setting.alamat && <div>{setting.alamat}{setting.kota ? `, ${setting.kota}` : ""}</div>}
      </div>
      <table className="dk-info">
        <tbody>
          <tr><td>{spk ? "No. Transaksi" : "Nomor"}</td><td>: {h.notrans}</td><td>Tanggal</td><td>: {tglID(h.tgltrans)}</td></tr>
          <tr><td>Pelanggan</td><td>: {h.namapelanggan}</td><td>Karyawan</td><td>: {h.namakasir}</td></tr>
          {!spk && <tr><td>Cara bayar</td><td>: {h.carabayar}</td><td>Jth Tempo</td><td>: {h.tgljthtempo ? tglID(h.tgljthtempo) : ""}</td></tr>}
          {!spk && <tr><td>Catatan</td><td colSpan={3}>: {h.catatan}</td></tr>}
        </tbody>
      </table>
      <table className="dk-detail">
        <thead>
          <tr><th>No.</th><th>Kode</th><th>Nama</th><th>Jumlah</th><th>Satuan</th>{spk && <th>Rak/Etalase</th>}</tr>
        </thead>
        <tbody>
          {dok.detail.map((d, i) => (
            <tr key={d.nourut}>
              <td className="r">{i + 1}</td><td>{d.barcode || d.kodebarang}</td><td>{d.namabarang}</td>
              <td className="r">{qty(d.jmljual)}</td><td>{d.satuanjual}</td>{spk && <td>{d.rak}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dk-foot">
        <div>Jml. Item : {qty(totalItem)}<br />Jml. Jenis : {jenisBarang}</div>
        <div>Petugas<br /><br /><br />( {spk ? "" : h.namakasir} )</div>
        <div>Penerima<br /><br /><br />( {h.namapelanggan !== "Tunai" ? h.namapelanggan : "                    "} )</div>
      </div>
    </div>,
    document.body,
  );
}

export function NumInput(props: { value: number; onChange: (v: number) => void; className?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(String(props.value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(props.value)); }, [props.value, focus]);
  return (
    <Input
      inputMode="decimal"
      autoFocus={props.autoFocus}
      value={focus ? text : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(props.value)}
      onFocus={(e) => { setFocus(true); setText(String(props.value)); setTimeout(() => e.target.select(), 0); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => { setText(e.target.value); props.onChange(Number(e.target.value.replace(",", ".")) || 0); }}
      className={cn(
        "num h-full! w-full rounded-none border-0 bg-transparent dark:bg-transparent read-only:bg-transparent dark:read-only:bg-transparent px-1.5! py-0! text-right text-sm text-foreground shadow-none tabular-nums focus-visible:ring-0 md:text-sm",
        props.className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Pembayaran (FrmTransJualBayar / FrmTransBeliBayar)                  */
/* ------------------------------------------------------------------ */

/** Nominal uang yang biasa diterima kasir untuk tagihan `n`: dibulatkan ke atas ke pecahan 5 rb sampai 100 rb. */
function pecahanUang(n: number): number[] {
  if (n <= 0) return [];
  const hasil = new Set<number>();
  // Pembulatan ke atas ke kelipatan pecahan uang kertas yang paling sering dipakai.
  for (const p of [5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(n / p) * p;
    if (v > n) hasil.add(v);
  }
  // Kelipatan 100.000 berikutnya selalu ada, karena pelanggan sering membayar dengan satu lembar 100 ribu.
  const seratus = (Math.floor(n / 100000) + 1) * 100000;
  const urut = [...hasil].sort((x, y) => x - y).slice(0, 4);
  if (!urut.includes(seratus)) { urut.pop(); urut.push(seratus); }
  return [...new Set(urut)].sort((x, y) => x - y);
}

function BayarDialog(props: { mode: Mode; tgl: string; kontak: string; sales: string; kasir: string; catatan: string; lines: ShownLine[]; noorder?: string; dpAwal?: number; onClose: () => void; onTanpaPemasok: (pesan: string) => void; onSaved: (notrans?: string, cetak?: { header: Row; detail: Row[] }, kembali?: number) => void }) {
  const { setting, user } = useApp();
  const jual = props.mode === "jual";
  const formName = jual ? "FrmTransJualBayar" : "FrmTransBeliBayar";
  const subtotal = props.lines.reduce((s, l) => s + l.jml * l.harga - l.pdp, 0);
  const [diskonPersen, setDiskonPersen] = useState(0);
  const [diskonNilai, setDiskonNilai] = useState(0);
  const [biaya, setBiaya] = useState(0);
  const [dp, setDp] = useState(props.dpAwal ?? 0);
  const [bayar, setBayarNilai] = useState(0);
  // Non tunai punya nominal sendiri, jadi bisa dicampur dengan tunai dan uang muka (tBayarNonTunai).
  const [bayarNt, setBayarNt] = useState(0);
  const [bayarManual, setBayarManual] = useState(false);
  const setBayar = (v: number) => { setBayarManual(true); setBayarNilai(v); };
  // Pertanyaan Ya/Tidak: jumlah bayar kurang dari total (jadi piutang), atau batas kredit pelanggan terlampaui.
  const [tanya, setTanya] = useState<{ pesan: string; piutang: boolean; kredit: boolean } | null>(null);
  const [tanyaCetak, setTanyaCetak] = useState<{ header: Row; detail: Row[]; notrans: string } | null>(null);
  const [jenisList, setJenisList] = useState<Row[]>([]);
  const [itemNt, setItemNt] = useState<Row[]>([]);
  const [jenis, setJenis] = useState("");
  const [kartu, setKartu] = useState("");
  const [noref, setNoref] = useState("");
  // Jatuh tempo = hari ini + pengaturan Tempo Piutang (FrmTransJualBayar.Form_Load).
  const [tempo, setTempo] = useState(addDays(today(), Number(setting.tempopiutang) || 0));
  const [preview, setPreviewNilai] = useState(getLihatStruk);
  const setPreview = (v: boolean | ((p: boolean) => boolean)) => setPreviewNilai((p) => { const n = typeof v === "function" ? v(p) : v; setLihatStruk(n); return n; });
  const defaultJmlByr = jual && getLocal("defaultJmlByr") === "1";
  const diskonTerkunci = jual && user.level === "Kasir" && Number(setting.izindiskon) !== 1;
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasil, setHasil] = useState<{ notrans: string; kembali?: number; cara: string; poin?: number; trans?: { header: Row; detail: Row[] } } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Bagian diskon, biaya, uang muka, dan non tunai (skin modern) terbuka kalau sudah ada isinya. */
  const [lain, setLain] = useState(!!props.dpAwal);
  // Kembalian dari transaksi yang baru disimpan, diteruskan ke layar kasir supaya tetap terlihat setelah dialog tertutup.
  const kembaliRef = useRef<number | undefined>(undefined);
  const selesai = (no?: string, cetak?: { header: Row; detail: Row[] }) => props.onSaved(no, cetak, kembaliRef.current);

  // Jenis dan item non tunai diambil dari data Jenis Non Tunai (MDJENISNONTUNAI / MDJENISNONTUNAIITEM).
  useEffect(() => { if (jual) ntApi.list().then((r) => { setJenisList(r.jenis); setItemNt(r.item); }).catch(() => undefined); }, [jual]);

  const diskon = diskonNilai > 0 ? diskonNilai : Math.round(subtotal * diskonPersen) / 100;
  // Aplikasi lama tidak punya PPN di layar bayar: total = jumlah - diskon + biaya.
  const total = Math.round((subtotal - diskon + biaya) * 100) / 100;

  // Jumlah bayar dibiarkan kosong seperti aslinya. Penjualan terisi total hanya kalau pengaturan lokal
  // "Default jml bayar sama dgn total" aktif dan Anda belum mengetik sendiri; uang muka (DP) dan non tunai dikurangkan.
  useEffect(() => {
    if (jual && defaultJmlByr && !bayarManual) setBayarNilai(Math.max(0, Math.round((total - dp - bayarNt) * 100) / 100));
  }, [jual, total, defaultJmlByr, bayarManual, dp, bayarNt]);

  // Jumlah yang sudah diterima = uang muka + tunai + non tunai. Kurang dari total ditanyakan dulu, lalu jadi piutang (hutang di pembelian).
  const diterima = jual ? bayar + dp + bayarNt : bayar;
  const sisa = total - diterima;
  const jenisNama = [...new Set(jenisList.map((j) => j.namajenis))];
  const itemList = itemNt.filter((j) => j.namajenis === jenis && j.namaitem);

  const pilihJenis = (v: string) => {
    setJenis(v); setKartu("");
    // Pilih jenis tanpa mengetik nominal: sisa yang belum dibayar dianggap non tunai.
    if (v && bayarNt === 0) setBayarNt(Math.max(0, Math.round((total - dp - bayar) * 100) / 100));
    if (!v) setBayarNt(0);
  };

  // Metode bayar mengikuti jenis non tunai yang terpilih: kosong berarti tunai.
  const metode: "tunai" | "qris" | "debit" | "lain" = !jenis ? "tunai" : /qris/i.test(jenis) ? "qris" : /debit|kartu/i.test(jenis) ? "debit" : "lain";
  const pilihMetode = (m: "tunai" | "qris" | "debit") => {
    if (!jual) return;
    if (m === "tunai") {
      setJenis(""); setKartu(""); setBayarNt(0); setNoref("");
      setTimeout(() => field("tJmlBayar")?.focus(), 0);
      return;
    }
    const cocok = jenisNama.find((j) => (m === "qris" ? /qris/i.test(j) : /debit|kartu/i.test(j)));
    const j = cocok ?? jenisNama[0];
    if (!j) { setErr("Belum ada jenis pembayaran non tunai. Tambahkan dulu di menu Jenis Non Tunai."); return; }
    setJenis(j);
    const item = itemNt.filter((x) => x.namajenis === j && x.namaitem);
    setKartu(item.length === 1 ? String(item[0].namaitem) : "");
    // Sisa tagihan (setelah uang muka) dibayar lewat non tunai.
    setBayarNt(Math.max(0, Math.round((total - dp) * 100) / 100));
    setBayarNilai(0);
    // Tidak ada jenis yang cocok dengan namanya: buka bagian tambahan supaya Anda memilih sendiri.
    if (!cocok) setLain(true);
    setTimeout(() => field("tNoRefNonTunai")?.focus(), 0);
  };

  const field = (name: string) => boxRef.current?.querySelector<HTMLElement>(`[data-f="${name}"], [data-vb="${name}"] input, [data-vb="${name}"] select`);

  // `dariTanya`: dipanggil dari tombol Ya pada pertanyaan; closure `tanya` masih berisi nilai lama saat itu.
  const simpanBusy = useRef(false);
  const simpan = async (o: { piutang?: boolean; lanjutkredit?: boolean; dariTanya?: boolean } = {}) => {
    if (simpanBusy.current || busy || hasil || tanyaCetak || (tanya && !o.dariTanya)) return;
    setErr("");
    if (jual && bayarNt > 0 && !jenis) return setErr("Pilih dulu jenis pembayaran non tunai.");
    let caraKirim: TransInput["carabayar"] = "Tunai";
    if (diterima + 0.005 < total) {
      if (!o.piutang) {
        return setTanya({
          pesan: jual
            ? "Jumlah bayar kurang dari total transaksi, apakah akan dilanjutkan sebagai piutang transaksi?"
            : "Jumlah bayar kurang dari total transaksi, apakah akan dilanjutkan sebagai hutang transaksi?",
          piutang: true, kredit: false,
        });
      }
      caraKirim = "Kredit";
    }
    if (caraKirim === "Kredit" && !props.kontak) {
      if (jual) {
        return setErr("Transaksi piutang tidak bisa dilakukan untuk pelanggan 'Tunai'. Pilih nama pelanggan yang terdaftar untuk melanjutkan proses transaksi piutang.");
      }
      // Seperti aslinya: dialog bayar ditutup, kursor ke kolom pemasok di layar pembelian.
      props.onTanpaPemasok("Transaksi hutang tidak bisa dilakukan ke Supplier 'Tunai'.\nPilih nama Supplier yang terdaftar untuk melanjutkan proses transaksi piutang");
      return;
    }
    simpanBusy.current = true;
    setBusy(true);
    const input: TransInput = {
      tgl: props.tgl,
      kodepelanggan: jual ? props.kontak : undefined,
      kodepemasok: jual ? undefined : props.kontak,
      kodesales: props.sales,
      kodekasir: props.kasir,
      catatan: props.catatan,
      hargajual: jual ? undefined : props.lines.map((l) => ({ kodebarang: l.b.kodebarang, hrgjual: hrgJualBaris(l) / l.units[l.ui].konversi })),
      items: props.lines.map((l) => ({
        kodebarang: l.b.kodebarang, namabarang: namaBaris(l).trim() || l.b.namabarang, kodesatuan: l.b.kodesatuan || l.units[0].satuan,
        satuanjual: l.units[l.ui].satuan, konversi: l.units[l.ui].konversi, jmljual: l.jml, harga: l.harga, disknilai: l.pdp,
      })),
      diskonpersen: diskonNilai > 0 ? 0 : diskonPersen,
      diskonnilai: diskon,
      biaya,
      carabayar: caraKirim,
      jmlbayar: jual ? bayar + dp : diterima,
      bayarnontunai: jual ? bayarNt : 0,
      jenisnontunai: jual && bayarNt > 0 ? jenis : "",
      kartu,
      norefkartu: noref,
      jthtempo: tempo,
      lanjutkredit: o.lanjutkredit,
    };
    try {
      if (jual) {
        const r = props.noorder ? await orderApi.savePenjualanOrder(input, props.noorder) : await kasirApi.savePenjualan(input);
        void bukaLaciOtomatis().catch((e) => toast.error(errText(e)));
        const trans = await api.getTransaksi(r.notrans);
        const poin = Number((r as { poin?: number }).poin) || 0;
        kembaliRef.current = caraKirim === "Tunai" ? Number(r.kembali) || 0 : undefined;
        if (preview) setHasil({ notrans: r.notrans, kembali: r.kembali, cara: caraKirim, poin, trans });
        else if (getLocal("konfirmasiCetak") === "1") setTanyaCetak({ ...trans, notrans: r.notrans });
        else selesai(r.notrans, trans);
      } else {
        const r = props.noorder ? await orderApi.savePembelianOrder(input, props.noorder) : await kasirApi.savePembelian(input);
        const trans = await api.getTransaksi(r.notrans);
        // "Data sudah disimpan. Apakah akan cetak nota pembelian?"
        setTanyaCetak({ ...trans, notrans: r.notrans });
      }
    } catch (e) {
      const pertanyaan = pesanKonfirmasi(errText(e));
      if (pertanyaan) setTanya({ pesan: pertanyaan, piutang: !!o.piutang, kredit: true });
      else setErr(errText(e));
    } finally {
      simpanBusy.current = false;
      setBusy(false);
    }
  };

  // Alt+huruf sesuai tanda & pada caption; Esc menutup.
  useEffect(() => {
    if (hasil || err || tanya || tanyaCetak) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onClose(); return; }
      if (!ev.altKey) return;
      const k: Record<string, () => void> = {
        KeyS: () => void simpan(),
        KeyT: props.onClose,
        KeyB: () => field("tJmlBayar")?.focus(),
        KeyP: () => setPreview((p) => !p),
        KeyL: () => setLain((v) => !v),
        Digit1: () => pilihMetode("tunai"),
        Digit2: () => pilihMetode("qris"),
        Digit3: () => pilihMetode("debit"),
        KeyU: () => { if (jual) setBayar(Math.max(0, Math.round((total - dp - bayarNt) * 100) / 100)); },
      };
      if (k[ev.code]) { ev.preventDefault(); ev.stopPropagation(); k[ev.code](); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  useEffect(() => { setTimeout(() => field("tJmlBayar")?.focus(), 0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Enter pindah ke kolom berikutnya; di kolom terakhir menyimpan.
  // Isian tambahan berakhir di Uang tunai yang diterima, lalu Enter di sana menyimpan.
  const urutan = jual
    ? ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tDP", "cmbJenis", "cmbItem", "tBayarNonTunai", "tNoRefNonTunai", "tJmlBayar", "dtJthTempo"]
    : ["tDiskonPersen", "tDiskonNilai", "tBiaya", "tJmlBayar", "dtJthTempo"];
  const onEnter = (ev: React.KeyboardEvent) => {
    if (ev.key !== "Enter" || ev.target instanceof HTMLButtonElement) return;
    ev.preventDefault();
    const el = ev.target as HTMLElement;
    const cur = urutan.findIndex((n) => field(n) === el);
    const akhir = ["tJmlBayar", "dtJthTempo"];
    if (cur < 0 || akhir.includes(urutan[cur])) return void simpan();
    // Lewati isian yang sedang tidak tampil (bagian tambahan tertutup).
    let n = cur + 1;
    while (n < urutan.length && !field(urutan[n])) n++;
    if (n < urutan.length) field(urutan[n])?.focus();
    else void simpan();
  };

  if (hasil && jual && hasil.trans) {
    // Jendela "Struk Penjualan": Cetak mencetak lalu selesai, Batal selesai tanpa mencetak.
    return <StrukPenjualan trans={hasil.trans} setting={setting} onSelesai={() => selesai(hasil.notrans)} />;
  }

  if (hasil) {
    return (
      <Modal title="Transaksi tersimpan" onClose={() => selesai(hasil.notrans)}
        footer={<>
          {hasil.trans && <Button variant="outline" onClick={() => cetakStruk(strukTeks(hasil.trans!, setting)).catch((e) => setErr(errText(e)))}>Cetak Struk</Button>}
          <Button autoFocus onClick={() => selesai(hasil.notrans)}>Transaksi Baru [Enter]</Button>
        </>}>
        <div>
          <p>Nomor transaksi <strong className="font-mono">{hasil.notrans}</strong> sudah tersimpan.</p>
          {jual && hasil.cara === "Tunai" && <div className="mt-2 rounded-md bg-muted px-3 py-2 text-base tabular-nums">Kembalian <strong>Rp {rp(hasil.kembali)}</strong></div>}
          {jual && !!hasil.poin && <p>Poin Anda bertambah {qty(hasil.poin)} dari transaksi ini.</p>}
          <Alert>{err}</Alert>
        </div>
        <Struk trans={hasil.trans ?? null} setting={setting} />
      </Modal>
    );
  }

  const dialogTanya = (
    <>
    {tanya && (
      <Modal title={formCaption(formName)} onClose={() => setTanya(null)}
        footer={<>
          <Button variant="outline" onClick={() => setTanya(null)}>Tidak</Button>
          <Button autoFocus onClick={() => { const t = tanya; setTanya(null); void simpan({ piutang: t.piutang, lanjutkredit: t.kredit, dariTanya: true }); }}>Ya</Button>
        </>}>
        <p className="whitespace-pre-line">{tanya.pesan}</p>
      </Modal>
    )}
    {tanyaCetak && (
      <Modal title={formCaption(formName)} onClose={() => selesai(tanyaCetak.notrans)}
        footer={<>
          <Button variant="outline" onClick={() => selesai(tanyaCetak.notrans)}>Tidak</Button>
          <Button autoFocus onClick={() => selesai(tanyaCetak.notrans, tanyaCetak)}>Cetak</Button>
        </>}>
        <p>Data sudah disimpan ({tanyaCetak.notrans}). {jual ? "Cetak struknya?" : "Apakah akan cetak nota pembelian?"}</p>
      </Modal>
    )}
    </>
  );

  const tagihanTunai = Math.max(0, Math.round((total - dp - bayarNt) * 100) / 100);
  const saran = pecahanUang(tagihanTunai);
  const rincian = [
    (diskon > 0 || biaya > 0) && `Harga barang Rp ${rp(subtotal)}`,
    diskon > 0 && `Diskon −Rp ${rp(diskon)}`,
    biaya > 0 && `Biaya lain +Rp ${rp(biaya)}`,
    jual && dp > 0 && `Uang muka −Rp ${rp(dp)}`,
    jual && bayarNt > 0 && `${jenis || "Non tunai"} −Rp ${rp(bayarNt)}`,
  ].filter(Boolean) as string[];
  const kotak = "rounded-md border border-foreground/20 bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30";
  const hasilBayar = sisa < -0.005
    ? { label: "Kembalian", nilai: -sisa, cls: "bg-success text-success-foreground" }
    : sisa > 0.005
      ? diterima > 0
        ? { label: "Uang masih kurang", nilai: sisa, cls: "border-2 border-destructive bg-destructive/10 text-destructive" }
        : { label: "Belum dibayar", nilai: sisa, cls: "bg-muted text-foreground" }
      : { label: "Uang pas, tanpa kembalian", nilai: 0, cls: "bg-success/15 text-success" };
  return (
    <>
      <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
        <div ref={boxRef} onKeyDown={onEnter} role="dialog" aria-modal="true" aria-label="Pembayaran"
          className="vb-modern flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl">
          <header className="flex h-11 flex-none items-center gap-2 border-b bg-muted/40 pr-1.5 pl-4 select-none">
            <h2 className="flex-1 truncate text-base font-semibold">Pembayaran</h2>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onClose}><XIcon /></Button>
          </header>

          <div className="flex min-h-0 flex-col overflow-auto">
            <div className="bg-display px-5 py-4 text-display-foreground">
              <div className="flex items-end justify-between gap-4">
                <span className="pb-1 text-sm font-medium text-display-foreground/80">Total belanja</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-lg font-medium text-display-foreground/70">Rp</span>
                  <span className="text-5xl leading-none font-bold tracking-tight tabular-nums">{rp(total)}</span>
                </span>
              </div>
              {rincian.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-end gap-x-3 gap-y-0.5 text-xs text-display-foreground/80 tabular-nums">
                  {rincian.map((r) => <span key={r}>{r}</span>)}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 px-5 py-4">
              {jual && (
                <div className="flex flex-col gap-1.5" role="group" aria-label="Cara bayar">
                  <Label className="text-sm font-semibold text-foreground">Cara bayar</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([["tunai", "Tunai", "Alt+1"], ["qris", "QRIS", "Alt+2"], ["debit", "Debit/Kartu", "Alt+3"]] as const).map(([m, nama, pintas]) => (
                      <Button key={m} type="button" size="lg" data-f={`metode-${m}`} aria-pressed={metode === m}
                        variant={metode === m ? "default" : "outline"}
                        className={cn("font-semibold", metode !== m && "border-foreground/20 text-foreground")}
                        onClick={() => pilihMetode(m)}>
                        {nama} <Kbd className={metode === m ? "bg-primary-foreground/20 text-primary-foreground" : "border border-border bg-background text-foreground"}>{pintas}</Kbd>
                      </Button>
                    ))}
                  </div>
                  {metode !== "tunai" && (
                    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 text-sm">
                      <Label className="font-medium text-foreground">No. referensi</Label>
                      <Input data-f="tNoRefNonTunai" value={noref} onChange={(e) => setNoref(e.target.value)} placeholder="Nomor dari struk EDC atau QRIS"
                        className="h-9 border-foreground/20 text-foreground" />
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center justify-between text-sm font-semibold text-foreground">
                  <span>{jual ? "Uang tunai yang diterima" : "Jumlah yang dibayar"}</span>
                  <span className="text-xs font-normal text-muted-foreground">Alt+B</span>
                </Label>
                <div className={cn(kotak, "h-14 border-2 text-3xl font-bold")}>
                  <VNum f="tJmlBayar" right ribuan value={bayar} onChange={setBayar} />
                </div>
                {jual && tagihanTunai > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" variant="outline" size="lg" className="border-foreground/30 bg-muted font-semibold text-foreground hover:bg-accent"
                      onClick={() => setBayar(tagihanTunai)}>
                      Uang pas <Kbd className="border border-border bg-background text-foreground">Alt+U</Kbd>
                    </Button>
                    {saran.map((n) => (
                      <Button key={n} type="button" variant="outline" size="lg" className="border-foreground/20 font-semibold text-foreground tabular-nums"
                        onClick={() => setBayar(n)}>
                        {rp(n)}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              <div className={cn("flex items-center justify-between gap-4 rounded-md px-4 py-3", hasilBayar.cls)} aria-live="polite">
                <span className="text-base font-semibold">{hasilBayar.label}</span>
                {hasilBayar.nilai > 0 && <span className="text-4xl leading-none font-bold tabular-nums">Rp {rp(hasilBayar.nilai)}</span>}
              </div>

              {sisa > 0.005 && (props.kontak ? (
                <div className="grid grid-cols-[1fr_12rem] items-center gap-3">
                  <Label className="text-sm font-medium text-foreground">Kekurangannya jadi {jual ? "piutang" : "hutang"}, jatuh tempo</Label>
                  <Input type="date" data-f="dtJthTempo" value={tempo} onChange={(e) => e.target.value && setTempo(e.target.value)}
                    className="h-9 border-foreground/20 text-foreground tabular-nums" />
                </div>
              ) : jual && diterima > 0 && (
                <p className="text-xs text-muted-foreground">Pelanggan Tunai harus membayar lunas. Untuk piutang, pilih dulu nama pelanggannya.</p>
              ))}

              <div className="rounded-md border border-border">
                <button type="button" data-slot="bayar-lain" aria-expanded={lain} onClick={() => setLain((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
                  <span>Diskon, biaya lain{jual ? ", uang muka, dan non tunai" : ""}</span>
                  <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    Alt+L <ChevronDownIcon className={cn("size-4 transition-transform", lain && "rotate-180")} />
                  </span>
                </button>
                {lain && (
                  <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t px-3 py-3 text-sm">
                    <Label className="font-medium text-foreground">Diskon</Label>
                    <div className="flex items-center gap-2">
                      <div className={cn(kotak, "h-9 w-20", diskonTerkunci && "bg-muted")}>
                        <VNum f="tDiskonPersen" right readOnly={diskonTerkunci}
                          value={diskonNilai > 0 ? Math.round((diskon / (subtotal || 1)) * 10000) / 100 : diskonPersen}
                          onChange={(v) => { setDiskonPersen(v); setDiskonNilai(0); }} />
                      </div>
                      <span className="text-foreground">%</span>
                      <div className={cn(kotak, "h-9 flex-1", diskonTerkunci && "bg-muted")}>
                        <VNum f="tDiskonNilai" right ribuan readOnly={diskonTerkunci} value={diskon} onChange={(v) => { setDiskonNilai(v); setDiskonPersen(0); }} />
                      </div>
                    </div>
                    {diskonTerkunci && <p className="col-start-2 -mt-1 text-xs text-muted-foreground">Kasir belum diizinkan memberi diskon.</p>}

                    <Label className="font-medium text-foreground">Biaya lain</Label>
                    <div className={cn(kotak, "h-9")}><VNum f="tBiaya" right ribuan value={biaya} onChange={setBiaya} /></div>

                    {jual && (
                      <>
                        <Label className="font-medium text-foreground">Uang muka (DP)</Label>
                        <div className={cn(kotak, "h-9")}><VNum f="tDP" right ribuan value={dp} onChange={setDp} /></div>

                        <Label className="font-medium text-foreground">Non tunai</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <NativeSelect data-f="cmbJenis" className="w-full" value={jenis} onChange={(e) => pilihJenis(e.target.value)} aria-label="Jenis non tunai">
                            <option value="">Pilih jenis</option>
                            {jenisNama.map((j) => <option key={j} value={j}>{j}</option>)}
                          </NativeSelect>
                          <NativeSelect data-f="cmbItem" className="w-full" value={kartu} onChange={(e) => setKartu(e.target.value)} disabled={!jenis} aria-label="Bank atau kartu">
                            <option value="">{jenis ? "Pilih bank/kartu" : "Pilih jenis dulu"}</option>
                            {itemList.map((j) => <option key={j.namaitem} value={j.namaitem}>{j.namaitem}</option>)}
                          </NativeSelect>
                        </div>

                        <Label className="font-medium text-foreground">Nominal non tunai</Label>
                        <div className={cn(kotak, "h-9")}><VNum f="tBayarNonTunai" right ribuan value={bayarNt} onChange={setBayarNt} /></div>

                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <footer className="flex flex-none items-center gap-2 border-t bg-muted/30 px-5 py-3">
            <label data-slot="label" className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-foreground select-none">
              <input type="checkbox" data-slot="checkbox-native" className="size-4 accent-primary" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
              Lihat struk dulu <span className="text-xs text-muted-foreground">Alt+P</span>
            </label>
            <Button type="button" variant="outline" size="lg" className="border-foreground/20 text-foreground" onClick={props.onClose}>
              Tutup <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            <Button type="button" size="lg" className="h-10 min-w-36 px-6 text-base font-semibold" disabled={busy} onClick={() => void simpan()}>
              {busy ? "Menyimpan…" : "Simpan"} <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            </Button>
          </footer>
          {err && <div className="absolute"><Modal title="Pembayaran" onClose={() => setErr("")}
            footer={<Button autoFocus onClick={() => setErr("")}>OK</Button>}><Alert>{err}</Alert></Modal></div>}
        </div>
      </div>
      {dialogTanya}
    </>
  );
}
