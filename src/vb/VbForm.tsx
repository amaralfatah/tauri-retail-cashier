import { CSSProperties, ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import formsData from "./forms.json";
import "./vb.css";

/* ---- Tipe ---- */
export interface VbFont { name: string; size: number; weight?: number; italic?: boolean; underline?: boolean }
export interface VbCtrl {
  type: string;
  name: string;
  class?: string;
  index?: number;
  caption?: string;
  texts?: string[];
  props: Record<string, any>;
  children: VbCtrl[];
}
export interface VbFormDef extends VbCtrl { gui_index?: number }
export interface Geom { left: number; top: number; width: number; height: number }

export interface BindObj {
  text?: ReactNode;
  value?: string | number;
  onChange?: (value: string, ev: any) => void;
  onClick?: (ev: any) => void;
  disabled?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  /** Kotak teks angka: hanya 0-9, koma, titik; seluruh teks terpilih saat fokus (FUN_006a44e0 dan FUN_006a4570 di EXE asli). */
  num?: boolean;
  /** Seluruh teks terpilih saat fokus. */
  selectOnFocus?: boolean;
  onFocus?: (ev: any) => void;
  onBlur?: (ev: any) => void;
  onKeyDown?: (ev: any) => void;
}
export type BindFn = (geom: Geom, ctrl: VbCtrl) => ReactNode;
export type Bind = BindFn | BindObj;

/* ---- Pembantu ---- */
const FORMS = formsData as unknown as VbFormDef[];
const BY_NAME = new Map(FORMS.map((f) => [f.name, f]));

/** Twips ke piksel (15 twips = 1 piksel). */
export const twips = (n: number) => n / 15;

export function useVbForm(name: string): VbFormDef | undefined {
  return useMemo(() => BY_NAME.get(name), [name]);
}

/** Hapus tanda akses (&) pada caption. */
export const capt = (s?: string) => (s ?? "").replace(/&(.)/g, "$1");

export function formCaption(name: string): string {
  return capt(BY_NAME.get(name)?.props.Caption) || name;
}

export function formSize(name: string): { width: number; height: number } {
  const cr = BY_NAME.get(name)?.props.ClientRect ?? [0, 0, 9000, 6000];
  return { width: twips(cr[2]), height: twips(cr[3]) };
}

const SYS: Record<number, string> = {
  0: "#c8c8c8", 1: "#3a6ea5", 2: "#99b4d1", 3: "#bfcddb", 4: "#f0f0f0", 5: "#ffffff", 6: "#646464", 7: "#000", 8: "#000",
  9: "#000", 10: "#b4b4b4", 11: "#f4f7fc", 12: "#ababab", 13: "#3399ff", 14: "#fff", 15: "#f0f0f0", 16: "#a0a0a0",
  17: "#6d6d6d", 18: "#000", 19: "#434e54", 20: "#fff", 21: "#696969", 22: "#e3e3e3", 23: "#000", 24: "#ffffe1",
};
export function vbColor(v: unknown): string | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) return undefined;
  if (n >= 0x80000000) return SYS[n & 0xff] ?? "#f0f0f0";
  return `rgb(${n & 255},${(n >> 8) & 255},${(n >> 16) & 255})`;
}

const INVIS_TYPES = new Set(["Timer", "Menu"]);
const INVIS_OCX = /ImageList|CommonDialog|SkinFramework/;
const isInvisible = (c: VbCtrl) => INVIS_TYPES.has(c.type) || (!!c.class && INVIS_OCX.test(c.class));

function fontStyle(f?: VbFont): CSSProperties {
  if (!f) return {};
  const s: CSSProperties = { fontFamily: `"${f.name}", Tahoma, "Segoe UI", sans-serif`, fontSize: `${(f.size * 96 / 72).toFixed(1)}px` };
  if ((f.weight ?? 0) >= 600) s.fontWeight = 700;
  if (f.italic) s.fontStyle = "italic";
  if (f.underline) s.textDecoration = "underline";
  return s;
}

/** Baca titik ujung kontrol Line dari data XY (hex little-endian). */
function lineBox(p: Record<string, any>): Geom | null {
  const h: string | undefined = p.XY;
  if (!h) return null;
  const rd = (o: number) => {
    const hex = (h.slice(o * 2, o * 2 + 8).match(/../g) ?? []).reverse().join("");
    return parseInt(hex, 16) | 0;
  };
  const x1 = rd(0), y1 = rd(5), x2 = rd(10), y2 = rd(15);
  return {
    left: twips(Math.min(x1, x2)), top: twips(Math.min(y1, y2)),
    width: Math.max(1, twips(Math.abs(x2 - x1))), height: Math.max(1, twips(Math.abs(y2 - y1))),
  };
}

/* ---- Render kontrol ---- */
function isBindFn(b: Bind | undefined): b is BindFn { return typeof b === "function"; }

function renderDefault(c: VbCtrl, b: BindObj, g: Geom): ReactNode {
  const p = c.props;
  const bc = vbColor(p["~BackColor"]);
  const fc = vbColor(p["~ForeColor"]);
  const extra: CSSProperties = { ...b.style };
  const cap = b.text !== undefined ? b.text : capt(p.Caption);
  const align = p.Alignment === 1 ? "right" : p.Alignment === 2 ? "center" : undefined;

  switch (c.type) {
    case "Label": {
      const s: CSSProperties = { ...extra };
      if (p.BackStyle !== 0 && bc && p["~BackColor"] != null) s.background = bc;
      if (align) s.textAlign = align;
      if (p.BorderStyle === 1) s.border = "1px solid #7a7a7a";
      if (fc) s.color = fc;
      return <div className="vb-label" style={s} onClick={b.onClick}>{cap}</div>;
    }
    case "CommandButton":
      return <button type="button" className="vb-btn" style={extra} disabled={b.disabled} onClick={b.onClick}>{cap}{b.children}</button>;
    case "TextBox": {
      const s: CSSProperties = { ...extra };
      if (bc) s.background = bc;
      if (align) s.textAlign = align;
      if (p.BorderStyle === 0) s.border = 0;
      const multi = g.height > 40;
      const common = {
        className: "vb-txt", style: s, disabled: b.disabled, maxLength: p["~MaxLength"] || undefined,
        onChange: b.onChange ? (e: any) => b.onChange!(e.target.value, e) : undefined,
        onFocus: b.num || b.selectOnFocus || b.onFocus ? (e: any) => { if (b.num || b.selectOnFocus) e.target.select(); b.onFocus?.(e); } : undefined,
        onBlur: b.onBlur,
        onKeyDown: b.num || b.onKeyDown ? (e: any) => {
          // Hanya angka, koma, titik; tombol kendali (Backspace, Enter, Esc, panah, Ctrl+...) tetap jalan.
          if (b.num && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !/[0-9.,]/.test(e.key)) e.preventDefault();
          b.onKeyDown?.(e);
        } : undefined,
        ...(b.value !== undefined ? { value: b.value } : { defaultValue: p["~Text"] ?? "" }),
      };
      if (b.value !== undefined && !b.onChange) (common as any).readOnly = true;
      return multi ? <textarea {...(common as any)} /> : <input type={p["~PasswordChar"] ? "password" : "text"} {...(common as any)} />;
    }
    case "ComboBox": {
      const list: string[] = Array.isArray(p.List) ? p.List : [];
      return (
        <select className="vb-cbo" style={extra} disabled={b.disabled}
          onChange={b.onChange ? (e) => b.onChange!(e.target.value, e) : undefined}
          {...(b.value !== undefined ? { value: b.value } : {})}>
          {b.children ?? list.map((o, i) => <option key={i} value={o}>{o}</option>)}
        </select>
      );
    }
    case "CheckBox":
    case "OptionButton": {
      const checked = b.value === undefined ? undefined : !!b.value && b.value !== "0";
      return (
        <label className="vb-chk" style={extra}>
          <input type={c.type === "CheckBox" ? "checkbox" : "radio"} disabled={b.disabled}
            checked={checked} onChange={(e) => b.onChange?.(e.target.checked ? "1" : "0", e)} onClick={b.onClick} />
          <span>{cap}</span>
        </label>
      );
    }
    case "Frame":
      return (
        <fieldset className="vb-frame" style={extra}>
          <legend>{cap}</legend>
          {b.children}
        </fieldset>
      );
    case "PictureBox": {
      const s: CSSProperties = { ...extra };
      if (bc) s.background = bc;
      if (p.BorderStyle !== 0 && p.Appearance !== 0) s.border = "1px solid #7a7a7a";
      return <div className="vb-pic" style={s} onClick={b.onClick}>{b.children}</div>;
    }
    case "Image": {
      const pic = p.Picture;
      return typeof pic === "string" && pic.startsWith("data:")
        ? <img className="vb-img" src={pic} alt="" style={extra} />
        : <div className="vb-img-empty" style={extra} />;
    }
    case "Shape":
      return <div className="vb-shape" style={extra} />;
    default:
      break;
  }

  const cls = c.class ?? "";
  const tx = c.texts ?? [];
  if (/Toolbar/.test(cls)) {
    return (
      <div className="vb-toolbar" style={extra}>
        {tx.map((t, i) => <button key={i} type="button" className="vb-tbtn" onClick={b.onClick}>{t}</button>)}
      </div>
    );
  }
  if (/StatusBar/.test(cls)) {
    const panels = b.children ?? [...new Set(tx)].map((t, i) => <span key={i} className="vb-panel">{t}</span>);
    return <div className="vb-status" style={extra}>{panels}</div>;
  }
  if (/TabStrip/.test(cls)) {
    return (
      <div className="vb-tabs" style={extra}>
        <div className="vb-tabs-head">{tx.map((t, i) => <span key={i} className={i === 0 ? "on" : ""}>{t}</span>)}</div>
        {b.children}
      </div>
    );
  }
  if (/DTPicker/.test(cls)) {
    return (
      <input type="date" className="vb-txt vb-date" style={extra} disabled={b.disabled}
        onChange={b.onChange ? (e) => b.onChange!(e.target.value, e) : undefined}
        {...(b.value !== undefined ? { value: String(b.value) } : {})} />
    );
  }
  if (/ProgressBar/.test(cls)) return <div className="vb-progress" style={extra} />;
  // ListView / grid / OCX lain: kotak penampung
  return (
    <div className="vb-ocx" style={extra}>
      {b.children ?? <span className="vb-tag">{cls.split(".").pop()} · {c.name}</span>}
    </div>
  );
}

/** Jangkar gaya VB: jarak ke tepi kontainer induk dipertahankan saat induk berubah ukuran. */
export interface VbAnchor { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }
/** Penggeser posisi rancangan (twips) sebelum jangkar dihitung. */
export interface VbPos { left?: number; top?: number; width?: number; height?: number }

interface Ctx { bind: Record<string, Bind>; hide: Set<string>; anchor: Record<string, VbAnchor>; pos: Record<string, VbPos> }

function keyOf(c: VbCtrl) { return c.index != null ? `${c.name}(${c.index})` : c.name; }

/**
 * dw/dh = ukuran rancangan kontainer, cw/ch = ukuran kontainer sekarang (twips).
 * Kalau keduanya sama, tata letaknya persis seperti rancangan.
 */
function Children(props: { node: VbCtrl; dw: number; dh: number; cw: number; ch: number; ctx: Ctx }) {
  const { node, dw, dh, cw, ch: chh, ctx } = props;
  return (
    <>
      {node.children.map((ch, i) => {
        if (isInvisible(ch) || ctx.hide.has(ch.name) || ctx.hide.has(keyOf(ch))) return null;
        const p = ch.props;
        if (ch.type === "Line") {
          const g = lineBox(p);
          if (!g) return null;
          return <div key={i} className="vb-line" style={{ left: g.left, top: g.top, width: g.width, height: g.height, background: vbColor(p.P2) ?? "#808080" }} />;
        }
        if (!p.POS) return null;
        let [l, t, w, h] = p.POS as number[];
        const ov = ctx.pos[keyOf(ch)] ?? ctx.pos[ch.name];
        if (ov) {
          l = ov.left ?? l; t = ov.top ?? t; w = ov.width ?? w; h = ov.height ?? h;
        }
        const w0 = w, h0 = h;
        const an = ctx.anchor[keyOf(ch)] ?? ctx.anchor[ch.name];
        if (p.Align === 1) { l = 0; w = cw; }
        else if (p.Align === 2) { l = 0; t = chh - h; w = cw; }
        else if (an) {
          const gapR = Math.max(0, dw - (l + w));
          const gapB = Math.max(0, dh - (t + h));
          if (an.left && an.right) w = Math.max(0, cw - l - gapR);
          else if (an.right) l += cw - dw;
          if (an.top && an.bottom) h = Math.max(0, chh - t - gapB);
          else if (an.bottom) t += chh - dh;
        }
        if (l >= cw || t >= chh || l + w <= 0 || t + h <= 0) return null;
        const g: Geom = { left: twips(l), top: twips(t), width: twips(w), height: twips(h) };
        const b = ctx.bind[keyOf(ch)] ?? ctx.bind[ch.name];
        const inner = isBindFn(b)
          ? b(g, ch)
          : renderDefault(ch, withChildren(ch, b ?? {}, ctx, w0, h0, w, h), g);
        const auto = ch.type === "Label" && ch.props["~AutoSize"];
        const style: CSSProperties = { left: g.left, top: g.top, width: auto ? "auto" : g.width, height: g.height, ...fontStyle(p.Font) };
        if (auto) { style.whiteSpace = "nowrap"; style.overflow = "visible"; style.minWidth = g.width; }
        return (
          <div key={i} className={`vb-c vb-t-${ch.type}`} style={style} data-vb={ch.name}>
            {inner}
          </div>
        );
      })}
    </>
  );
}

/** Kontainer (PictureBox, Frame, TabStrip) membawa anak kontrolnya. */
function withChildren(ch: VbCtrl, b: BindObj, ctx: Ctx, dw: number, dh: number, w: number, h: number): BindObj {
  if (!ch.children.length) return b;
  const kids = (
    <>
      <Children node={ch} dw={dw} dh={dh} cw={w} ch={h} ctx={ctx} />
      {b.children}
    </>
  );
  return { ...b, children: kids };
}

/* ---- Komponen publik ---- */
export interface VbFormProps {
  form: string;
  bind?: Record<string, Bind>;
  hide?: string[];
  className?: string;
  /** Form memenuhi ruang kontainernya (minimal sebesar rancangan), seperti Form_Resize di VB. */
  fill?: boolean;
  /** Jangkar per kontrol, relatif ke induknya. */
  anchor?: Record<string, VbAnchor>;
  /** Geser posisi atau ukuran rancangan kontrol (twips) sebelum jangkar dihitung. */
  pos?: Record<string, VbPos>;
}

const NO_ANCHOR: Record<string, VbAnchor> = {};
const NO_POS: Record<string, VbPos> = {};

export function VbForm({ form, bind = {}, hide = [], className, fill, anchor = NO_ANCHOR, pos = NO_POS }: VbFormProps) {
  const def = useVbForm(form);
  const hideSet = useMemo(() => new Set(hide), [hide.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!fill || !el) return;
    const measure = () => setBox((o) => (o && o.w === el.clientWidth && o.h === el.clientHeight ? o : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);
  if (!def) return <div className="vb-missing">Form {form} tidak ditemukan.</div>;
  const cr: number[] = def.props.ClientRect ?? [0, 0, 9000, 6000];
  const [, , dw, dh] = cr;
  const W = fill && box ? Math.max(dw, box.w * 15) : dw;
  const H = fill && box ? Math.max(dh, box.h * 15) : dh;
  const bg = vbColor(def.props["~BackColor"]) ?? "#f0f0f0";
  const inner = (
    <div className={`vb-form ${className ?? ""}`} style={{ width: twips(W), height: twips(H), background: bg }} data-form={form}>
      <Children node={def} dw={dw} dh={dh} cw={W} ch={H} ctx={{ bind, hide: hideSet, anchor, pos }} />
    </div>
  );
  return fill ? <div ref={wrap} className="vb-fill">{inner}</div> : inner;
}

/** Jendela anak MDI: bilah judul dengan caption dan tombol tutup, isinya sebuah VbForm. */
export function VbWindow(props: {
  form: string;
  title?: string;
  bind?: Record<string, Bind>;
  hide?: string[];
  onClose?: () => void;
}) {
  const title = props.title ?? formCaption(props.form);
  return (
    <div className="vb-window">
      <div className="vb-window-title">
        <span className="vb-window-caption">{title}</span>
        {props.onClose && <button type="button" className="vb-window-x" aria-label="Tutup" onClick={props.onClose}>×</button>}
      </div>
      <div className="vb-window-body">
        <VbForm form={props.form} bind={props.bind} hide={props.hide} />
      </div>
    </div>
  );
}
