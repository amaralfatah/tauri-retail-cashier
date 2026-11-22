import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formSize, useVbForm, VbWindow, Bind } from "./VbForm";
import "./master.css";

/* ---- Tabel gaya ListView (report view): garis kisi, pilih satu baris penuh ---- */
export interface GridCol<T> {
  title: string;
  width: number;
  align?: "right" | "center";
  render: (row: T, index: number) => ReactNode;
}

const ROW_H = 18;
const HEAD_H = 20;

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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVh(el.clientHeight));
    ro.observe(el);
    setVh(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const total = cols.reduce((s, c) => s + c.width, 0);
  const first = Math.max(0, Math.floor(top / ROW_H) - 4);
  const last = Math.min(rows.length, Math.ceil((top + vh) / ROW_H) + 4);
  const selIdx = selected == null ? -1 : rows.findIndex((r) => rowKey(r) === selected);

  const move = (i: number) => {
    const n = Math.max(0, Math.min(rows.length - 1, i));
    if (!rows.length) return;
    onSelect(rowKey(rows[n]));
    const el = ref.current;
    if (!el) return;
    const y = n * ROW_H;
    const view = el.clientHeight - HEAD_H;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + view) el.scrollTop = y + ROW_H - view;
  };

  const onKey = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor((vh - HEAD_H) / ROW_H) - 1);
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
    <div className="vbg" ref={ref} tabIndex={0} onScroll={(e) => setTop(e.currentTarget.scrollTop)} onKeyDown={onKey}>
      <div className="vbg-head" style={{ width: total, height: HEAD_H }}>
        {cols.map((c, i) => (
          <div key={i} className="vbg-h" style={{ width: c.width, textAlign: c.align }}>{c.title}</div>
        ))}
      </div>
      <div className="vbg-body" style={{ width: total, height: rows.length * ROW_H }}>
        {rows.slice(first, last).map((r, k) => {
          const i = first + k;
          const key = rowKey(r);
          return (
            <div key={key} className={`vbg-row ${key === selected ? "sel" : ""}`} style={{ top: i * ROW_H, height: ROW_H }}
              onMouseDown={() => onSelect(key)} onDoubleClick={() => onOpen?.(r)}>
              {cols.map((c, j) => (
                <div key={j} className="vbg-c" style={{ width: c.width, textAlign: c.align }}>{c.render(r, i)}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Bilah alat (Toolbar): tombol datar dengan pemisah ---- */
export interface ToolItem { caption: string; onClick: () => void; sepBefore?: boolean }

export function VbToolbar({ items }: { items: ToolItem[] }) {
  return (
    <div className="vbm-toolbar">
      {items.map((b) => (
        <span key={b.caption} className="vbm-tb-item">
          {b.sepBefore && <span className="vbm-sep" />}
          <button type="button" className="vbm-tb" onClick={b.onClick}>{b.caption}</button>
        </span>
      ))}
    </div>
  );
}

/* ---- Kotak pesan (MsgBox) ---- */
export interface MsgState { text: string; yes?: () => void; title?: string; no?: () => void }

export function useMsgBox() {
  const [msg, setMsg] = useState<MsgState | null>(null);
  const alert = useCallback((text: string, title?: string) => setMsg({ text, title }), []);
  const confirm = useCallback((text: string, yes: () => void, title?: string, no?: () => void) => setMsg({ text, yes, title, no }), []);
  const node = msg && (
    <ModalFrame title={msg.title ?? "Software Toko Pro Unlimited"} onClose={() => setMsg(null)} width={360}>
      <div className="vbm-msg">
        <p style={{ whiteSpace: "pre-line" }}>{msg.text}</p>
        <div className="vbm-msg-btns">
          {msg.yes ? (
            <>
              <button type="button" className="vb-btn" autoFocus onClick={() => { const y = msg.yes!; setMsg(null); y(); }}>Ya</button>
              <button type="button" className="vb-btn" onClick={() => { const n = msg.no; setMsg(null); n?.(); }}>Tidak</button>
            </>
          ) : (
            <button type="button" className="vb-btn" autoFocus onClick={() => setMsg(null)}>OK</button>
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
    <div className="vbm-backdrop no-print">
      <div className="vb-window vbm-win" style={{ width: props.width, height: props.height }}>
        <div className="vb-window-title">
          <span className="vb-window-caption">{props.title}</span>
          {props.onClose && <button type="button" className="vb-window-x" aria-label="Tutup" onClick={props.onClose}>×</button>}
        </div>
        <div className="vb-window-body">{props.children}</div>
      </div>
    </div>
  );
}

/** Form VB sebagai jendela modal pada ukuran aslinya. Enter pindah ke kolom berikutnya. */
export function VbModal(props: { form: string; title?: string; bind?: Record<string, Bind>; hide?: string[]; onClose: () => void; children?: ReactNode }) {
  const { width, height } = formSize(props.form);
  useTopEscape(props.onClose);
  const ref = useEnterNav(props.form);
  return (
    <div className="vbm-backdrop no-print">
      <div className="vbm-win" style={{ width: width + 2, height: height + 22 }} ref={ref}>
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
