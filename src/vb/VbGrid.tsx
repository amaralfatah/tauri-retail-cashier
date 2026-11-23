import { isValidElement, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { formSize, useTinggiJudul, useVbForm, VbWindow, Bind } from "./VbForm";

/** Ekstrak teks polos dari isi sel (termasuk elemen React sederhana seperti badge stok menipis). */
function isiTeks(n: ReactNode): string | undefined {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) {
    const joined = n.map((x) => isiTeks(x) ?? "").join("").trim();
    return joined || undefined;
  }
  if (isValidElement<{ children?: ReactNode }>(n)) {
    return isiTeks(n.props.children);
  }
  return undefined;
}

/** Ubah angka format Indonesia ("5.875", "-12", "2,5") menjadi number untuk pengurutan numerik. */
function parseIdNumber(s: string): number | null {
  const t = s.trim();
  if (!t || !/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(t)) return null;
  const num = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

/** Ubah angka format Indonesia (termasuk awalan "Rp ") menjadi number untuk ringkasan bilah status. */
function parseStatusNumber(s: string): number | null {
  const cleaned = s.trim().replace(/^Rp\s*/i, "").trim();
  return parseIdNumber(cleaned);
}

function loadStoredWidths(key: string): Record<number, number> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && idx >= 0 && typeof v === "number" && Number.isFinite(v) && v >= 40 && v <= 1200) {
        out[idx] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveStoredWidths(key: string, widths: Record<number, number>) {
  try {
    if (Object.keys(widths).length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(widths));
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
}

let measureCanvas: HTMLCanvasElement | null = null;
function measureTextPx(text: string, font: string): number {
  if (typeof document === "undefined") return text.length * 7;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/* ---- Tabel gaya Excel / ListView: garis kisi tegas, sortir kolom, ubah lebar kolom, navigasi sel ---- */
export interface GridCol<T> {
  title: string;
  width: number;
  align?: "right" | "center";
  render: (row: T, index: number) => ReactNode;
  sortValue?: (row: T) => string | number;
}

export function VbGrid<T>(props: {
  cols: GridCol<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onOpen?: (row: T) => void;
  onDelete?: (row: T) => void;
  sortable?: boolean;
  storageKey?: string;
  showStatus?: boolean;
}) {
  const { cols, rows, rowKey, selected, onSelect, onOpen, onDelete, sortable = true, storageKey, showStatus = true } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(300);
  const [vw, setVw] = useState(0);
  const [focused, setFocused] = useState(false);
  const [selCol, setSelCol] = useState<number | null>(null);
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  const rowH = 28;
  const headH = 32;
  const colsKey = cols.map((c) => c.title).join("|");
  const effectiveStorageKey = storageKey ?? `tp:vbgrid:${colsKey}`;
  const [customW, setCustomW] = useState<Record<number, number>>(() => loadStoredWidths(effectiveStorageKey));
  const hasRowNo = cols.length > 0 && (cols[0].title === "No." || cols[0].title === "No");
  const hasFixedFirst = hasRowNo || (cols.length > 0 && cols[0].title === "" && cols[0].width <= 48);

  const prevColsKeyRef = useRef(colsKey);
  const prevStorageKeyRef = useRef(effectiveStorageKey);
  useEffect(() => {
    if (prevColsKeyRef.current !== colsKey) {
      prevColsKeyRef.current = colsKey;
      setSort(null);
      setSelCol(null);
    }
    if (prevStorageKeyRef.current !== effectiveStorageKey) {
      prevStorageKeyRef.current = effectiveStorageKey;
      setCustomW(loadStoredWidths(effectiveStorageKey));
    }
  }, [colsKey, effectiveStorageKey]);

  useEffect(() => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const displayRows = useMemo(() => {
    if (!sort || sort.col < 0 || sort.col >= cols.length) return rows;
    const c = cols[sort.col];
    const dir = sort.dir === "asc" ? 1 : -1;
    const decorated = rows.map((r, i) => {
      const raw = c.sortValue ? c.sortValue(r) : (isiTeks(c.render(r, i)) ?? "");
      const num = typeof raw === "number" ? raw : parseIdNumber(String(raw));
      return { r, i, str: String(raw), num };
    });
    decorated.sort((a, b) => {
      if (a.num !== null && b.num !== null) {
        return a.num !== b.num ? (a.num - b.num) * dir : a.i - b.i;
      }
      const cmp = a.str.localeCompare(b.str, "id", { numeric: true, sensitivity: "base" });
      return cmp !== 0 ? cmp * dir : a.i - b.i;
    });
    return decorated.map((d) => d.r);
  }, [rows, cols, sort]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setVh(el.clientHeight);
      setVw(el.clientWidth);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  /*
   * Lebar kolom menyesuaikan isinya (diukur dari baris yang tampil), supaya kode, nomor, tanggal, dan angka
   * tidak terpotong "KS2611-000…". Lebar VB jadi batas bawah. Pengguna juga bisa menarik batas kolom seperti Excel.
   */
  const [fit, setFit] = useState<number[]>([]);
  useEffect(() => setFit([]), [colsKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const need = cols.map((_, j) => {
      let w = 0;
      el.querySelectorAll<HTMLElement>(`[data-c="${j}"] > span`).forEach((sp) => { w = Math.max(w, sp.scrollWidth); });
      return Math.min(w + 22, 420); // + padding kiri-kanan, ikon sortir, dan garis
    });
    setFit((old) => {
      const next = need.map((n, j) => Math.max(n, old[j] ?? 0));
      return next.length === old.length && next.every((n, j) => n === old[j]) ? old : next;
    });
  });
  const pakai = cols.map((c, j) => {
    if (hasFixedFirst && j === 0) return hasRowNo ? Math.max(48, Math.min(fit[0] ?? 48, 72)) : Math.max(40, c.width);
    return Math.max(fit[j] ?? 0, Math.min(c.width, 60));
  });
  const colWidths = [...pakai];
  const sumPakai = pakai.reduce((s, w) => s + w, 0) || 1;
  if (vw > 0 && sumPakai < vw) {
    // Ruang lebih dibagi ke kolom data menurut lebar asli VB; kolom "No." / centang tetap ramping seperti row header Excel.
    const sisa = vw - sumPakai;
    const startIdx = hasFixedFirst && cols.length > 1 ? 1 : 0;
    const bobot = cols.slice(startIdx).reduce((s, c) => s + c.width, 0) || 1;
    for (let j = startIdx; j < cols.length; j++) {
      colWidths[j] += Math.floor((sisa * cols[j].width) / bobot);
    }
    colWidths[colWidths.length - 1] += vw - colWidths.reduce((s, w) => s + w, 0);
  } else if (vw > 0 && sumPakai > vw) {
    // Kurang ruang: kecilkan kolom teks lebar (>160px) sampai minimal 140px.
    const kurang = sumPakai - vw;
    const lebar = colWidths.map((w, j) => ({ w, j })).filter((x) => x.w > 160).sort((a, b) => b.w - a.w);
    const ruang = lebar.reduce((s, x) => s + (x.w - 140), 0);
    if (ruang > 0) lebar.forEach((x) => {
      const potong = Math.min(x.w - 140, Math.ceil(((x.w - 140) / ruang) * kurang));
      colWidths[x.j] -= potong;
    });
  }
  for (const [k, w] of Object.entries(customW)) {
    const idx = Number(k);
    if (idx >= 0 && idx < colWidths.length) colWidths[idx] = w;
  }
  const total = Math.max(colWidths.reduce((s, w) => s + w, 0), vw);

  const first = Math.max(0, Math.floor(top / rowH) - 4);
  const last = Math.min(displayRows.length, Math.ceil((top + vh) / rowH) + 4);
  const selIdx = selected == null ? -1 : displayRows.findIndex((r) => rowKey(r) === selected);

  const move = (i: number) => {
    const n = Math.max(0, Math.min(displayRows.length - 1, i));
    if (!displayRows.length) return;
    onSelect(rowKey(displayRows[n]));
    const el = ref.current;
    if (!el) return;
    const y = n * rowH;
    const view = el.clientHeight - headH;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + rowH > el.scrollTop + view) el.scrollTop = y + rowH - view;
  };

  const moveCol = (delta: number) => {
    const minCol = hasRowNo ? 1 : 0;
    if (cols.length <= minCol) return;
    const cur = selCol == null ? (delta > 0 ? minCol : cols.length - 1) : selCol + delta;
    const next = Math.max(minCol, Math.min(cols.length - 1, cur));
    setSelCol(next);
    const el = ref.current;
    if (!el) return;
    let left = 0;
    for (let j = 0; j < next; j++) left += colWidths[j];
    const right = left + colWidths[next];
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  };

  const copySelected = (fullRow: boolean) => {
    if (selIdx < 0) return;
    const r = displayRows[selIdx];
    const start = hasRowNo ? 1 : 0;
    const useSingleCell = !fullRow && selCol !== null && selCol >= 0 && selCol < cols.length;
    const text = useSingleCell
      ? (isiTeks(cols[selCol].render(r, selIdx)) ?? "")
      : cols.slice(start).map((c) => isiTeks(c.render(r, selIdx)) ?? "").join("\t");
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
      toast.success(useSingleCell ? "Isi sel disalin" : "Baris disalin (format Excel)", { duration: 1500 });
    }).catch(() => undefined);
  };

  const toggleSort = (colIdx: number) => {
    if (!sortable || (hasRowNo && colIdx === 0)) return;
    setSort((cur) => {
      if (!cur || cur.col !== colIdx) return { col: colIdx, dir: "asc" };
      if (cur.dir === "asc") return { col: colIdx, dir: "desc" };
      return null;
    });
  };

  const startResize = (e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colIdx];
    let latestW = startW;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      moved = true;
      latestW = Math.max(44, Math.round(startW + (ev.clientX - startX)));
      setCustomW((prev) => ({ ...prev, [colIdx]: latestW }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) {
        setCustomW((prev) => {
          const next = { ...prev, [colIdx]: latestW };
          saveStoredWidths(effectiveStorageKey, next);
          return next;
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const autoFitCol = (colIdx: number) => {
    const col = cols[colIdx];
    if (!col) return;
    const headFont = "600 12px Inter, system-ui, -apple-system, sans-serif";
    const cellFont = "400 13px Inter, system-ui, -apple-system, sans-serif";
    let maxW = measureTextPx(col.title, headFont) + (sortable ? 14 : 0);
    const limit = Math.min(displayRows.length, 200);
    for (let idx = 0; idx < limit; idx++) {
      const txt = isiTeks(col.render(displayRows[idx], idx));
      if (txt) {
        const w = measureTextPx(txt, cellFont);
        if (w > maxW) maxW = w;
      }
    }
    const fitted = Math.max(48, Math.min(520, Math.ceil(maxW + 24)));
    setCustomW((prev) => {
      const next = { ...prev, [colIdx]: fitted };
      saveStoredWidths(effectiveStorageKey, next);
      return next;
    });
  };

  const colSummary = useMemo(() => {
    if (!showStatus || selCol === null || selCol < 0 || selCol >= cols.length) return null;
    const col = cols[selCol];
    if (!col || col.align !== "right") return null;
    let sum = 0;
    let count = 0;
    let hasDecimal = false;
    for (let idx = 0; idx < displayRows.length; idx++) {
      const txt = isiTeks(col.render(displayRows[idx], idx));
      if (!txt) continue;
      const num = parseStatusNumber(txt);
      if (num !== null) {
        sum += num;
        count += 1;
        if (!Number.isInteger(num)) hasDecimal = true;
      }
    }
    if (count < 2) return null;
    const formatted = sum.toLocaleString("id-ID", {
      maximumFractionDigits: hasDecimal ? 2 : 0,
    });
    return { title: col.title, formatted };
  }, [showStatus, selCol, cols, displayRows]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (!window.getSelection()?.toString() && selIdx >= 0) {
        e.preventDefault();
        copySelected(e.shiftKey || selCol === null);
      }
      return;
    }
    const page = Math.max(1, Math.floor((vh - headH) / rowH) - 1);
    if (e.key === "ArrowDown") move(selIdx + 1);
    else if (e.key === "ArrowUp") move(selIdx < 0 ? 0 : selIdx - 1);
    else if (e.key === "ArrowRight") {
      if (selIdx < 0 && displayRows.length) move(0);
      moveCol(1);
    } else if (e.key === "ArrowLeft") {
      if (selIdx < 0 && displayRows.length) move(0);
      moveCol(-1);
    } else if (e.key === "Tab") {
      if (selIdx < 0 && displayRows.length) move(0);
      moveCol(e.shiftKey ? -1 : 1);
    } else if (e.key === "PageDown") move(selIdx + page);
    else if (e.key === "PageUp") move(selIdx - page);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(displayRows.length - 1);
    else if ((e.key === "Enter" || e.key === "F2") && selIdx >= 0) onOpen?.(displayRows[selIdx]);
    else if (e.key === "Delete" && selIdx >= 0 && onDelete) onDelete(displayRows[selIdx]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card font-sans text-[13px] text-foreground">
      <div
        data-slot="vbg"
        ref={ref}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        onKeyDown={onKey}
        className="vbg tp-scroll-always relative min-h-0 flex-1 overflow-auto outline-none"
      >
        <div
          className="sticky top-0 z-20 flex min-w-full bg-muted text-xs select-none"
          style={{ width: total, height: headH }}
        >
          {cols.map((c, i) => {
            const canSort = sortable && !(hasRowNo && i === 0);
            const isSorted = sort?.col === i;
            const isActiveCol = selIdx >= 0 && selCol === i;
            return (
              <div
                key={i}
                className={cn(
                  "relative flex flex-none items-center overflow-hidden border-r border-foreground/20 px-2 font-semibold tracking-tight text-foreground last:border-r-0",
                  canSort && "cursor-pointer hover:bg-foreground/6",
                  isSorted && "bg-primary/10 text-foreground",
                  isActiveCol ? "bg-primary/15 border-b-2 border-b-primary" : "border-b border-b-foreground/25",
                  c.align === "right" && "justify-end text-right",
                  c.align === "center" && "justify-center text-center",
                )}
                style={{ width: colWidths[i] }}
                title={canSort ? `${c.title} (klik untuk urutkan, tarik batas untuk ubah lebar)` : c.title}
                data-c={i}
                onClick={() => toggleSort(i)}
              >
                <span className="truncate whitespace-nowrap">{c.title}</span>
                {isSorted && (
                  sort.dir === "asc"
                    ? <ArrowUpIcon className="ml-1 size-3 flex-none text-primary" />
                    : <ArrowDownIcon className="ml-1 size-3 flex-none text-primary" />
                )}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="Tarik untuk ubah lebar, klik ganda untuk pas otomatis"
                  className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50"
                  onMouseDown={(e) => startResize(e, i)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    autoFitCol(i);
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="relative min-w-full" style={{ width: total, height: displayRows.length * rowH }}>
          {displayRows.slice(first, last).map((r, k) => {
            const i = first + k;
            const key = rowKey(r);
            const isSel = key === selected;
            return (
              <div
                key={key}
                data-state={isSel ? "selected" : undefined}
                className={cn(
                  "absolute right-0 left-0 flex cursor-default border-b border-foreground/15 text-foreground transition-colors",
                  isSel
                    ? focused
                      ? "z-[5] bg-[color-mix(in_oklab,var(--primary)_20%,var(--card))]"
                      : "z-[5] bg-[color-mix(in_oklab,var(--primary)_12%,var(--card))]"
                    : i % 2 === 1
                      ? "bg-muted/25 hover:bg-muted/60"
                      : "hover:bg-muted/60",
                )}
                style={{ top: i * rowH, height: rowH }}
                onDoubleClick={() => onOpen?.(r)}
              >
                {cols.map((c, j) => {
                  const isRowNo = hasRowNo && j === 0;
                  const isActiveCell = isSel && selCol === j;
                  return (
                    <div
                      key={j}
                      className={cn(
                        "flex flex-none items-center border-r border-foreground/15 px-2 tabular-nums last:border-r-0",
                        isActiveCell ? "overflow-visible" : "overflow-hidden",
                        isRowNo && !isSel && "bg-muted text-xs font-semibold text-foreground/85",
                        isRowNo && isSel && "bg-primary text-xs font-semibold text-primary-foreground",
                        isActiveCell && cn(
                          "relative z-10 bg-card! text-foreground before:pointer-events-none before:absolute before:-inset-px before:z-10 before:border-2 before:border-ring after:pointer-events-none after:absolute after:-bottom-0.75 after:z-20 after:size-1.5 after:border after:border-card after:bg-ring",
                          j === cols.length - 1 ? "before:right-0 after:-right-px" : "after:-right-0.75",
                        ),
                        c.align === "right" && "justify-end text-right",
                        c.align === "center" && "justify-center text-center",
                      )}
                      style={{ width: colWidths[j] }}
                      data-c={j}
                      title={isiTeks(c.render(r, i))}
                      onMouseDown={() => {
                        onSelect(key);
                        setSelCol(isRowNo ? null : j);
                      }}
                    >
                      <span className="max-w-full truncate whitespace-nowrap">{c.render(r, i)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {showStatus && (
        <div className="flex h-6 flex-none items-center justify-between gap-2 border-t border-border bg-muted/70 px-2.5 text-[11px] text-muted-foreground tabular-nums select-none">
          <div className="flex items-center gap-2 truncate">
            <span>
              {selIdx >= 0
                ? `Baris ${(selIdx + 1).toLocaleString("id-ID")} / ${displayRows.length.toLocaleString("id-ID")}`
                : `${displayRows.length.toLocaleString("id-ID")} baris`}
            </span>
            {copied && (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Tersalin
              </span>
            )}
          </div>
          {colSummary && (
            <div className="truncate font-medium text-foreground/80">
              Jumlah {colSummary.title}: {colSummary.formatted}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Bilah alat (Toolbar): tombol tegas dengan pemisah ---- */
export interface ToolItem { caption: string; onClick: () => void; sepBefore?: boolean }

export function VbToolbar({ items }: { items: ToolItem[] }) {
  return (
    <div data-slot="vb-toolbar" className="flex w-full flex-wrap items-center gap-1 border-b border-border bg-muted px-2.5 py-1.5">
      {items.map((b) => {
        const isPrimary = b.caption === "Baru";
        const isDanger = b.caption === "Hapus";
        const isClose = b.caption === "Tutup";
        return (
          <span key={b.caption} className={cn("flex items-center", isClose && "ml-auto")}>
            {b.sepBefore && !isClose && <span className="ml-0.5 mr-1.5 h-5 w-px bg-foreground/20" />}
            <Button
              type="button"
              variant={isPrimary ? "default" : "outline"}
              size="sm"
              onClick={b.onClick}
              className={cn(
                "h-8 px-2.5 text-xs font-medium",
                !isPrimary && "border-foreground/20 bg-background text-foreground hover:bg-accent hover:text-foreground",
                isDanger && "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
              )}
            >
              {b.caption}
              {isClose && <Kbd className="h-4 min-w-0 border border-border bg-muted px-0.5 text-[0.5625rem] text-foreground">Esc</Kbd>}
            </Button>
          </span>
        );
      })}
    </div>
  );
}

/* ---- Kotak pesan (MsgBox) ---- */
/** `bahaya`: tombol Ya menghapus sesuatu, jadi tombol Tidak yang terpilih lebih dulu (Enter tidak langsung menghapus). */
export interface MsgState { text: string; yes?: () => void; title?: string; no?: () => void; bahaya?: boolean | string }

/**
 * Kotak pesan (pengganti MsgBox VB).
 * `bahaya`: true atau label tombol (mis. "Ya, batalkan"). Untuk aksi yang menghapus atau membatalkan:
 * tombol Ya merah dan fokus awal di Tidak, supaya Enter yang tidak sengaja tidak menghapus apa pun.
 * Seperti MsgBox lama, tombol huruf Y = Ya dan T = Tidak.
 */
export function useMsgBox() {
  const [msg, setMsg] = useState<MsgState | null>(null);
  const alert = useCallback((text: string, title?: string) => setMsg({ text, title }), []);
  const confirm = useCallback((text: string, yes: () => void, title?: string, no?: () => void, bahaya?: boolean | string) => setMsg({ text, yes, title, no, bahaya }), []);
  const tidak = () => { const n = msg?.no; setMsg(null); n?.(); };
  const ya = () => { const y = msg?.yes; setMsg(null); y?.(); };
  const labelYa = typeof msg?.bahaya === "string" ? msg.bahaya : msg?.bahaya ? "Ya, hapus" : "Ya";
  const node = msg && (
    <ModalFrame title={msg.title ?? (msg.yes ? "Konfirmasi" : "Pemberitahuan")} onClose={() => setMsg(null)} width={400}>
      <div className="flex flex-col gap-4 p-4 text-sm"
        onKeyDown={(e) => {
          if (!msg.yes || e.altKey || e.ctrlKey || e.metaKey) return;
          const k = e.key.toLowerCase();
          if (k === "y") { e.preventDefault(); ya(); }
          else if (k === "t" || k === "n") { e.preventDefault(); tidak(); }
        }}>
        <p className="whitespace-pre-line">{msg.text}</p>
        <div className="flex justify-end gap-2">
          {msg.yes ? (
            <>
              <Button type="button" variant="outline" className="h-8 min-w-20 text-xs" autoFocus={!!msg.bahaya} onClick={tidak}><u>T</u>idak</Button>
              <Button type="button" variant={msg.bahaya ? "destructive" : "default"} className="h-8 min-w-20 text-xs" autoFocus={!msg.bahaya} onClick={ya}><u>Y</u>{labelYa.slice(1)}</Button>
            </>
          ) : (
            <Button type="button" className="h-8 min-w-20 text-xs" autoFocus onClick={() => setMsg(null)}>OK</Button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
  return { alert, confirm, node };
}

export const BELUM_ADA = "Fitur ini belum tersedia di versi ini.";

/* ---- Jendela modal ---- */
const stack: symbol[] = [];

export function useTopEscape(onClose?: () => void) {
  // onClose disimpan di ref supaya urutan tumpukan tidak berubah setiap kali komponen digambar ulang.
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    const id = Symbol();
    stack.push(id);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) { e.stopPropagation(); cb.current?.(); }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}

function ModalFrame(props: { title: string; onClose?: () => void; width: number; height?: number; footer?: ReactNode; children: ReactNode }) {
  useTopEscape(props.onClose);
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/45 p-2">
      <div role="dialog" aria-modal="true" aria-label={props.title} style={{ width: props.width, height: props.height }}
        className="vb-modern flex max-h-[94vh] max-w-[96vw] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="flex h-10 flex-none items-center gap-2 border-b border-border bg-muted/40 pr-1.5 pl-4 select-none">
          <span className="flex-1 truncate text-sm font-semibold">{props.title}</span>
          {props.onClose && <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onClose}><XIcon /></Button>}
        </div>
        <div className={cn("min-h-0 flex-1 overflow-auto", props.footer && "p-4")}>{props.children}</div>
        {props.footer && (
          <div className="flex flex-none items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-2.5">
            {props.footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Form VB sebagai jendela modal pada ukuran aslinya. Enter pindah ke kolom berikutnya. */
export function VbModal(props: { form: string; title?: string; bind?: Record<string, Bind>; hide?: string[]; onClose: () => void; children?: ReactNode }) {
  const { width, height } = formSize(props.form);
  useTopEscape(props.onClose);
  const ref = useEnterNav(props.form);
  const tinggiJudul = useTinggiJudul();
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-2">
      <div className="relative flex max-h-[98vh] max-w-[98vw] flex-col" style={{ width: width + 2, height: height + tinggiJudul }} ref={ref}>
        <VbWindow form={props.form} title={props.title} bind={props.bind} hide={props.hide} onClose={props.onClose} />
        {props.children}
      </div>
    </div>
  );
}

/** Enter berpindah ke kolom isian berikutnya menurut urutan TabIndex asli. */
export function useEnterNav(form: string) {
  const def = useVbForm(form);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !def) return;
    const order = new Map<string, number>();
    const walk = (c: any) => { for (const k of c.children ?? []) { if (k.props["~TabIndex"] != null) order.set(k.name, k.props["~TabIndex"]); walk(k); } };
    walk(def);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "Enter" || !(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
      if (t instanceof HTMLInputElement && (t.type === "checkbox" || t.type === "radio")) return;
      const list = [...el.querySelectorAll<HTMLElement>(".vb-c[data-vb] input, .vb-c[data-vb] select")]
        .filter((x) => !(x as HTMLInputElement).disabled && !(x as HTMLInputElement).readOnly)
        .map((x, i) => ({ x, o: order.get(x.closest<HTMLElement>(".vb-c[data-vb]")?.dataset.vb ?? "") ?? 1e6 + i }))
        .sort((a, b) => a.o - b.o);
      const at = list.findIndex((l) => l.x === t);
      const nx = list[at + 1];
      if (at >= 0 && nx) { e.preventDefault(); nx.x.focus(); if (nx.x instanceof HTMLInputElement) nx.x.select(); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [def]);
  return ref;
}

export { ModalFrame };
