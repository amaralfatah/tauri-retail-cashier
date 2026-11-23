import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "./ui/table";

export interface EntryGridCol {
  label: string;
  width: number;
  align?: "left" | "center" | "right";
}

export const GRID_TH =
  "sticky top-0 z-20 h-8! truncate border-r border-b border-foreground/20 bg-muted px-2! py-0! text-[13px] font-semibold tracking-tight text-foreground select-none last:border-r-0";

/** Tombol ikon kaca pembesar di dalam sel tabel (untuk membuka dialog cari barang/satuan). */
export function GridSearchButton({ onClick, title }: { onClick?: () => void; title: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      tabIndex={-1}
      aria-label={title}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="absolute top-1/2 right-0.5 size-4 -translate-y-1/2 rounded-xs text-ring hover:bg-accent hover:text-ring"
    >
      <SearchIcon className="size-3" />
    </Button>
  );
}

export interface GridKodeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputRef?: React.Ref<HTMLInputElement>;
  onSearch?: () => void;
  searchTitle?: string;
  showSearch?: boolean;
}

/** Input kode/barcode di dalam sel tabel, dilengkapi ikon pencarian (F10) yang seragam di semua layar. */
export function GridKodeInput({
  inputRef,
  onSearch,
  searchTitle = "Cari barang [F10]",
  showSearch = true,
  className,
  onKeyDown,
  ...rest
}: GridKodeInputProps) {
  const tampilCari = !!onSearch && showSearch;
  return (
    <div className="kd-edit relative h-full w-full">
      <input
        ref={inputRef}
        data-slot="grid-input"
        autoComplete="off"
        {...rest}
        className={cn(
          "h-full w-full border-0 bg-transparent px-1.5 py-0 text-sm text-foreground outline-none",
          tampilCari && "pr-6!",
          className,
        )}
        onKeyDown={(e) => {
          if (e.key === "F10" && onSearch) {
            e.preventDefault();
            onSearch();
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {tampilCari && <GridSearchButton title={searchTitle} onClick={onSearch} />}
    </div>
  );
}

export interface EntryGridProps {
  cols: EntryGridCol[];
  /** Ubah nilai ini saat susunan kolom berubah (mis. mode jual vs beli) agar lebar kolom direset. */
  colKey?: string;
  /** Kunci penyimpanan lebar kolom di localStorage. Jika kosong, diturunkan dari colKey/cols. */
  storageKey?: string;
  children: ReactNode;
  gridRef?: React.RefObject<HTMLDivElement | null>;
  tabIndex?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onKeyDownCapture?: React.KeyboardEventHandler<HTMLDivElement>;
  /** Aktifkan gaya sel `.tj-grid` untuk halaman yang memakai `<tr>`/`<td>` standar. */
  cellStyles?: boolean;
  className?: string;
}

function loadColWidths(key: string, expectedLen: number): number[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === expectedLen &&
      parsed.every((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    ) {
      return parsed;
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia atau korup.
  }
  return null;
}

function saveColWidths(key: string, widths: number[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Abaikan galat penyimpanan.
  }
}

function clearColWidths(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Abaikan galat penyimpanan.
  }
}

function safeSelect(input: HTMLInputElement) {
  if (input.type === "checkbox" || input.type === "radio") return;
  try {
    input.select();
  } catch {
    // Beberapa tipe input (mis. date) tidak mendukung select().
  }
}

/**
 * Tabel input transaksi bersama: header lengket, seret-ubah lebar kolom (klik ganda untuk auto-fit / reset),
 * sorot kolom aktif ala Excel, navigasi papan ketik 4 arah, dan bilah gulir konsisten untuk semua layar input.
 */
export function EntryGrid({
  cols,
  colKey,
  storageKey,
  children,
  gridRef,
  tabIndex = 0,
  onKeyDown,
  onKeyDownCapture,
  cellStyles = true,
  className,
}: EntryGridProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (gridRef) (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [gridRef],
  );

  const resetKey = colKey ?? cols.map((c) => `${c.label}:${c.width}`).join("|");
  const persistKey = storageKey ?? `tp:entrygrid:${resetKey}`;
  const [colWidths, setColWidths] = useState<number[]>(
    () => loadColWidths(persistKey, cols.length) ?? cols.map((c) => c.width),
  );
  const [activeCol, setActiveCol] = useState<number | null>(null);
  const activeTdRef = useRef<HTMLTableCellElement | null>(null);
  const initialValRef = useRef<{ el: HTMLInputElement; val: string } | null>(null);

  const markActiveTd = useCallback(
    (td: HTMLTableCellElement | null) => {
      if (activeTdRef.current && activeTdRef.current !== td) {
        activeTdRef.current.removeAttribute("data-active-cell");
      }
      if (td && cellStyles && !td.classList.contains("no")) {
        td.setAttribute("data-active-cell", "1");
        activeTdRef.current = td;
      } else {
        activeTdRef.current = null;
      }
      setActiveCol(td ? td.cellIndex : null);
    },
    [cellStyles],
  );

  useEffect(() => {
    setColWidths(loadColWidths(persistKey, cols.length) ?? cols.map((c) => c.width));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey, resetKey]);

  const startResize = (ci: number) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const totalW = localRef.current?.clientWidth || 800;
    const startX = ev.clientX;
    const startW = [...colWidths];
    let latest = startW;
    const minPct = Math.max(3, (36 / totalW) * 100);
    const onMove = (m: MouseEvent) => {
      const dxPct = ((m.clientX - startX) / totalW) * 100;
      const pair = startW[ci] + startW[ci + 1];
      const nextA = Math.min(pair - minPct, Math.max(minPct, startW[ci] + dxPct));
      const next = [...startW];
      next[ci] = nextA;
      next[ci + 1] = pair - nextA;
      latest = next;
      setColWidths(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (latest !== startW) {
        saveColWidths(persistKey, latest);
      }
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const autoFitCol = (ci: number) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const container = localRef.current;
    if (!container) return;
    const totalW = container.clientWidth || 800;
    const minPct = Math.max(3, (36 / totalW) * 100);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const measure = (text: string, font: string) => {
      if (!text) return 0;
      if (!ctx) return text.length * 8;
      ctx.font = font;
      return ctx.measureText(text).width;
    };

    const th = container.querySelector<HTMLTableCellElement>(`thead th:nth-child(${ci + 1})`);
    const thStyle = th ? window.getComputedStyle(th) : null;
    const headerFont = thStyle
      ? `${thStyle.fontWeight} ${thStyle.fontSize} ${thStyle.fontFamily}`
      : "600 13px sans-serif";
    let maxPx = measure(cols[ci]?.label ?? "", headerFont) + 22;

    const cells = container.querySelectorAll<HTMLTableCellElement>(`tbody tr td:nth-child(${ci + 1})`);
    let bodyFont: string | null = null;
    for (const td of cells) {
      if (!bodyFont) {
        const s = window.getComputedStyle(td);
        bodyFont = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      }
      const inp = td.querySelector<HTMLInputElement>("input");
      const text = (inp ? inp.value : td.textContent ?? "").trim();
      if (!text) continue;
      const extraPad = td.querySelector("button") ? 42 : 22;
      const px = measure(text, bodyFont) + extraPad;
      if (px > maxPx) maxPx = px;
    }

    const pair = colWidths[ci] + colWidths[ci + 1];
    const targetPct = Math.min(pair - minPct, Math.max(minPct, (maxPx / totalW) * 100));

    if (Math.abs(colWidths[ci] - targetPct) <= 0.5) {
      const defaults = cols.map((c) => c.width);
      setColWidths(defaults);
      clearColWidths(persistKey);
      return;
    }

    const next = [...colWidths];
    next[ci] = targetPct;
    next[ci + 1] = pair - targetPct;
    setColWidths(next);
    saveColWidths(persistKey, next);
  };

  const handleFocusCapture: React.FocusEventHandler<HTMLDivElement> = (e) => {
    const target = e.target as HTMLElement | null;
    const td = target?.closest?.("td");
    if (td && e.currentTarget.contains(td)) {
      markActiveTd(td);
    }
    if (cellStyles && target instanceof HTMLInputElement) {
      initialValRef.current = { el: target, val: target.value };
    }
  };

  const handleMouseDownCapture: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const target = e.target as HTMLElement | null;
    const td = target?.closest?.("td");
    if (td && e.currentTarget.contains(td)) {
      markActiveTd(td);
    }
  };

  const handleBlurCapture: React.FocusEventHandler<HTMLDivElement> = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      markActiveTd(null);
    }
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    const target = e.target as HTMLElement | null;

    // Salin isi sel aktif (Ctrl/Cmd+C) saat tidak ada teks yang diblok
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "c") {
      const hasInputSelection =
        (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        target.selectionStart !== target.selectionEnd;
      const hasWindowSelection = !!window.getSelection()?.toString();
      if (!hasInputSelection && !hasWindowSelection) {
        const td = (target?.closest?.("td") ?? activeTdRef.current) as HTMLTableCellElement | null;
        if (td && e.currentTarget.contains(td)) {
          const inp = td.querySelector<HTMLInputElement>("input");
          const text = (inp ? inp.value : td.textContent ?? "").trim();
          if (text) {
            e.preventDefault();
            void navigator.clipboard?.writeText(text);
          }
        }
      }
      return;
    }

    // Navigasi 4 arah & Esc revert khusus grid dengan cellStyles aktif
    if (!cellStyles) return;

    if (target instanceof HTMLInputElement && e.key === "Escape") {
      const remembered = initialValRef.current;
      if (remembered && remembered.el === target && target.value !== remembered.val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(target, remembered.val);
        target.dispatchEvent(new Event("input", { bubbles: true }));
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    const curTd = (target?.closest?.("td") ?? activeTdRef.current) as HTMLTableCellElement | null;
    if (!curTd || !e.currentTarget.contains(curTd)) return;

    const focusCell = (nextTd: HTMLTableCellElement) => {
      markActiveTd(nextTd);
      const nextInput = nextTd.querySelector<HTMLInputElement>('input:not(:disabled):not([type="hidden"])');
      if (nextInput) {
        nextInput.focus();
        safeSelect(nextInput);
      } else {
        localRef.current?.focus();
      }
    };

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const tr = curTd.closest("tr");
      if (!tr) return;
      const colIdx = curTd.cellIndex;
      const sibling = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
      if (sibling instanceof HTMLTableRowElement) {
        const nextTd = sibling.cells[colIdx];
        if (nextTd) {
          e.preventDefault();
          focusCell(nextTd);
        }
      }
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (target instanceof HTMLInputElement) {
        const atEdge =
          e.key === "ArrowLeft"
            ? target.selectionStart === 0 && target.selectionEnd === 0
            : target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
        if (!atEdge) return;
      }
      const tr = curTd.closest("tr");
      if (!tr) return;
      const nextCol = curTd.cellIndex + (e.key === "ArrowLeft" ? -1 : 1);
      const minCol = tr.cells[0]?.classList.contains("no") ? 1 : 0;
      if (nextCol >= minCol && nextCol < tr.cells.length) {
        e.preventDefault();
        focusCell(tr.cells[nextCol]);
      }
    }
  };

  return (
    <div
      tabIndex={tabIndex}
      ref={setRef}
      onKeyDown={handleKeyDown}
      onKeyDownCapture={onKeyDownCapture}
      onFocusCapture={handleFocusCapture}
      onMouseDownCapture={handleMouseDownCapture}
      onBlurCapture={handleBlurCapture}
      className={cn(
        "tp-scroll-always relative size-full rounded-md border border-border bg-card font-sans text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&>[data-slot=table-container]]:overflow-visible [&_td]:py-0! [&_th]:py-0!",
        cellStyles && "tj-grid vb-modern",
        className,
      )}
    >
      <Table className="table-fixed border-separate border-spacing-0">
        <colgroup>
          {colWidths.map((c, i) => (
            <col key={i} style={{ width: `${c}%` }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {cols.map((h, i) => (
              <TableHead
                key={i}
                className={cn(
                  GRID_TH,
                  h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left",
                  activeCol === i && "bg-primary/12! border-b-primary! text-foreground",
                )}
              >
                {h.label}
                {i < cols.length - 1 && (
                  <span
                    onMouseDown={startResize(i)}
                    onDoubleClick={autoFitCol(i)}
                    title="Seret untuk ubah lebar kolom (klik ganda: pas isi / reset)"
                    className="absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                  />
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}
