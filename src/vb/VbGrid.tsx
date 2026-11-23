import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { formSize, useTinggiJudul, useVbForm, VbWindow, Bind } from "./VbForm";

/** Teks isi sel untuk tooltip (kalau tetap terpotong, arahkan mouse untuk melihat isi lengkapnya). */
function isiTeks(n: ReactNode): string | undefined {
  return typeof n === "string" || typeof n === "number" ? String(n) : undefined;
}

/* ---- Tabel gaya ListView (report view): garis kisi, pilih satu baris penuh ---- */
export interface GridCol<T> {
  title: string;
  width: number;
  align?: "right" | "center";
  render: (row: T, index: number) => ReactNode;
}

export function VbGrid<T>(props: {
  cols: GridCol<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onOpen?: (row: T) => void;
}) {
  const { cols, rows, rowKey, selected, onSelect, onOpen } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(300);
  const [vw, setVw] = useState(0);
  const [focused, setFocused] = useState(false);

  const rowH = 28;
  const headH = 30;

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
   * tidak terpotong "KS2611-000…". Lebar VB jadi batas bawah. Kalau tidak muat, yang mengalah hanya kolom
   * teks lebar (nama, alamat, keterangan); kolom pendek tetap utuh dan tabel bisa digeser ke samping.
   */
  const [fit, setFit] = useState<number[]>([]);
  const colsKey = cols.map((c) => c.title).join("|");
  useEffect(() => setFit([]), [colsKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const need = cols.map((_, j) => {
      let w = 0;
      el.querySelectorAll<HTMLElement>(`[data-c="${j}"] > span`).forEach((sp) => { w = Math.max(w, sp.scrollWidth); });
      return Math.min(w + 17, 420); // + padding kiri-kanan dan garis
    });
    setFit((old) => {
      const next = need.map((n, j) => Math.max(n, old[j] ?? 0));
      return next.length === old.length && next.every((n, j) => n === old[j]) ? old : next;
    });
  });
  const pakai = cols.map((c, j) => Math.max(fit[j] ?? 0, Math.min(c.width, 60)));
  const colWidths = [...pakai];
  const sumPakai = pakai.reduce((s, w) => s + w, 0) || 1;
  if (vw > 0 && sumPakai < vw) {
    // Ruang lebih dibagi menurut lebar asli VB, supaya proporsinya tetap seperti layar lama.
    const sisa = vw - sumPakai;
    const bobot = cols.reduce((s, c) => s + c.width, 0) || 1;
    cols.forEach((c, j) => { colWidths[j] += Math.floor((sisa * c.width) / bobot); });
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
  const total = Math.max(colWidths.reduce((s, w) => s + w, 0), vw);

  const first = Math.max(0, Math.floor(top / rowH) - 4);
  const last = Math.min(rows.length, Math.ceil((top + vh) / rowH) + 4);
  const selIdx = selected == null ? -1 : rows.findIndex((r) => rowKey(r) === selected);

  const move = (i: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, i));
    if (!rows.length) return;
    onSelect(rowKey(rows[n]));
    const el = ref.current;
    if (!el) return;
    const y = n * rowH;
    const view = el.clientHeight - headH;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + rowH > el.scrollTop + view) el.scrollTop = y + rowH - view;
  };

  const onKey = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor((vh - headH) / rowH) - 1);
    if (e.key === "ArrowDown") move(selIdx + 1);
    else if (e.key === "ArrowUp") move(selIdx < 0 ? 0 : selIdx - 1);
    else if (e.key === "PageDown") move(selIdx + page);
    else if (e.key === "PageUp") move(selIdx - page);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "Enter" && selIdx >= 0) onOpen?.(rows[selIdx]);
    else return;
    e.preventDefault();
  };

  return (
    <div
      data-slot="vbg"
      ref={ref}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onKeyDown={onKey}
      className="vbg tp-scroll-always relative size-full rounded-md border border-foreground/20 bg-card font-sans text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <div
        className="sticky top-0 z-10 flex min-w-full border-b border-foreground/25 bg-muted"
        style={{ width: total, height: headH }}
      >
        {cols.map((c, i) => (
          <div
            key={i}
            className={cn(
              "flex flex-none items-center overflow-hidden border-r border-foreground/15 px-2 font-semibold text-foreground last:border-r-0",
              c.align === "right" && "justify-end text-right",
              c.align === "center" && "justify-center text-center",
            )}
            style={{ width: colWidths[i] }}
            title={c.title}
            data-c={i}
          >
            <span className="truncate whitespace-nowrap">{c.title}</span>
          </div>
        ))}
      </div>
      <div className="relative min-w-full" style={{ width: total, height: rows.length * rowH }}>
        {rows.slice(first, last).map((r, k) => {
          const i = first + k;
          const key = rowKey(r);
          const isSel = key === selected;
          return (
            <div
              key={key}
              data-state={isSel ? "selected" : undefined}
              className={cn(
                "absolute right-0 left-0 flex cursor-default border-b border-foreground/12 transition-colors",
                isSel
                  ? focused
                    ? "border-transparent bg-primary font-medium text-primary-foreground"
                    : "border-transparent bg-foreground/10 font-medium text-foreground"
                  : i % 2 === 1
                    ? "bg-muted/25 hover:bg-muted/60"
                    : "hover:bg-muted/60",
              )}
              style={{ top: i * rowH, height: rowH }}
              onMouseDown={() => onSelect(key)}
              onDoubleClick={() => onOpen?.(r)}
            >
              {cols.map((c, j) => (
                <div
                  key={j}
                  className={cn(
                    "flex flex-none items-center overflow-hidden border-r border-foreground/10 px-2 tabular-nums last:border-r-0",
                    isSel && focused && "border-primary-foreground/20",
                    c.align === "right" && "justify-end text-right",
                    c.align === "center" && "justify-center text-center",
                  )}
                  style={{ width: colWidths[j] }}
                  data-c={j}
                  title={isiTeks(c.render(r, i))}
                >
                  <span className="truncate whitespace-nowrap">{c.render(r, i)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
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
            {b.sepBefore && !isClose && <span className="mx-1 h-4 w-px bg-border" />}
            <Button
              type="button"
              variant={isPrimary ? "default" : "outline"}
              size="sm"
              onClick={b.onClick}
              className={cn(
                "h-7 px-2.5 text-xs font-medium",
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
              <Button type="button" variant="outline" className="min-w-20" autoFocus={!!msg.bahaya} onClick={tidak}><u>T</u>idak</Button>
              <Button type="button" variant={msg.bahaya ? "destructive" : "default"} className="min-w-20" autoFocus={!msg.bahaya} onClick={ya}><u>Y</u>{labelYa.slice(1)}</Button>
            </>
          ) : (
            <Button type="button" className="min-w-20" autoFocus onClick={() => setMsg(null)}>OK</Button>
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

function ModalFrame(props: { title: string; onClose?: () => void; width: number; height?: number; children: ReactNode }) {
  useTopEscape(props.onClose);
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-2">
      <div role="dialog" aria-modal="true" aria-label={props.title} style={{ width: props.width, height: props.height }}
        className="vb-modern flex max-h-[98vh] max-w-[98vw] flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl">
        <div className="flex h-9 flex-none items-center gap-2 border-b bg-muted/40 pr-1.5 pl-3 select-none">
          <span className="flex-1 truncate text-sm font-medium">{props.title}</span>
          {props.onClose && <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onClose}><XIcon /></Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{props.children}</div>
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
