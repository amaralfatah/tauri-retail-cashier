import { CSSProperties, ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Kbd } from "@/components/ui/kbd";
import { capt, vbColor, type BindObj, type Geom, type VbCtrl } from "./VbForm";
import "./modern.css";

/*
 * Perender kontrol VB untuk skin "modern" (lihat ./skin.tsx).
 *
 * Kontrak yang WAJIB sama dengan renderDefault di VbForm.tsx, karena kode halaman bergantung padanya:
 * - Kontrol mengisi penuh kotak .vb-c pembungkusnya (h-full w-full). Posisi dan ukuran tetap dari VbForm.
 * - TextBox, DTPicker, dan ComboBox berisi <input>/<textarea>/<select> asli, supaya
 *   `[data-vb="nama"] input` (fokus, Enter pindah kolom) tetap menemukan elemennya.
 * - onChange dipanggil dengan (nilai string, event). CheckBox/OptionButton mengirim "1" atau "0".
 * - Setiap elemen bawaan (label, input, select, fieldset) diberi data-slot supaya aturan CSS lama di App.css
 *   (yang hanya berlaku untuk elemen tanpa data-slot) tidak ikut mengubahnya.
 *
 * Warna VB tidak dipakai langsung. Warnanya diterjemahkan ke token tema (lihat `permukaan`),
 * dan halaman bisa menimpanya lewat `className` pada bind.
 */

/** Ubah warna CSS (#rgb, #rrggbb, rgb()) ke [r, g, b] 0-255. */
function rgbOf(css?: string): [number, number, number] | null {
  if (!css) return null;
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(css.replace(/\s/g, ""));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  let h = css.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Kecerahan 0 (hitam) sampai 1 (putih). */
function terang(css?: string): number | null {
  const c = rgbOf(css);
  return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : null;
}

/**
 * Terjemahan warna latar VB ke kelas tema:
 * - setipis garis (≤ 5px) → garis pemisah
 * - gelap → panel terbalik (latar teks, teks latar)
 * - putih → kartu
 * - abu-abu atau warna lain → muted
 */
export function permukaan(back: string | undefined, tinggi: number): string {
  const l = terang(back);
  if (l == null) return "";
  if (tinggi <= 5) return "bg-border";
  if (l < 0.35) return "bg-display text-display-foreground";
  if (l > 0.97) return "bg-card";
  return "bg-muted";
}

/** "Bayar [F4]" → "Bayar" + tombol pintas F4. */
function Caption({ text }: { text: ReactNode }) {
  if (typeof text !== "string") return <>{text}</>;
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1] && <span className="truncate">{m[1]}</span>}
      <Kbd className="h-4 min-w-0 shrink-0 bg-foreground/8 px-0.5 text-[0.5625rem] uppercase text-foreground/75 group-data-[variant=default]/button:bg-primary-foreground/20 group-data-[variant=default]/button:text-primary-foreground">{m[2]}</Kbd>
    </>
  );
}

/** Kotak isian, tombol, dan pilihan memakai ukuran huruf kotak .vb-c (dari font VB), bukan ukuran bawaan shadcn. */
const ISI = "h-full w-full rounded-sm px-1.5 py-0 leading-none [font-family:inherit] [font-size:inherit] [font-weight:inherit] md:leading-none md:[font-size:inherit]";

export function renderModern(c: VbCtrl, b: BindObj, g: Geom): ReactNode {
  const p = c.props;
  const extra: CSSProperties = { ...b.style };
  const cap = b.text !== undefined ? b.text : capt(p.Caption);
  const align = p.Alignment === 1 ? "right" : p.Alignment === 2 ? "center" : undefined;

  switch (c.type) {
    case "Label": {
      const s: CSSProperties = { ...extra };
      if (align) s.textAlign = align;
      const latar = p.BackStyle !== 0 && p["~BackColor"] != null ? vbColor(p["~BackColor"]) : undefined;
      const singleLine = g.height <= 28 && typeof cap === "string" && !cap.includes("\n");
      // Label memakai warna teks panelnya (hitam di form, terang di panel gelap). Kasir butuh kontras tinggi,
      // jadi label kolom tidak dibuat abu-abu.
      return (
        <div data-slot="vb-label" style={s} onClick={b.onClick}
          className={cn("h-full w-full whitespace-pre-wrap",
            singleLine && "flex items-center",
            singleLine && align === "right" && "justify-end",
            singleLine && align === "center" && "justify-center",
            latar && cn(permukaan(latar, g.height), "rounded-sm px-1.5"), p.BorderStyle === 1 && "rounded-sm border px-1", b.className)}>
          {cap}
        </div>
      );
    }
    case "CommandButton": {
      const variant = b.variant ?? "outline";
      return (
        <Button type="button" variant={variant} data-variant={variant} disabled={b.disabled} onClick={b.onClick} style={extra}
          className={cn(ISI, "gap-0.5 px-1", variant === "outline" && "bg-background shadow-xs", b.className)}>
          <Caption text={cap} />
          {b.children}
        </Button>
      );
    }
    case "TextBox": {
      const s: CSSProperties = { ...extra };
      if (align) s.textAlign = align;
      // forms.json tidak menyimpan MultiLine. Kotak dianggap multi-baris kalau tingginya lebih dari dua baris hurufnya,
      // jadi kotak angka besar (mis. total di dialog bayar) tetap <input>.
      const hurufPx = p.Font ? (p.Font.size * 96) / 72 : 11;
      const multi = g.height > Math.max(40, hurufPx * 2.2);
      const readOnly = b.value !== undefined && !b.onChange;
      const common = {
        style: s, disabled: b.disabled, maxLength: p["~MaxLength"] || undefined, readOnly,
        className: cn(ISI, readOnly ? "cursor-default border-border/80 bg-muted/70 text-foreground/85" : "bg-card", p.BorderStyle === 0 && "border-transparent bg-transparent", b.className),
        onChange: b.onChange ? (e: any) => b.onChange!(e.target.value, e) : undefined,
        onFocus: b.num || b.selectOnFocus || b.onFocus ? (e: any) => { if (b.num || b.selectOnFocus) e.target.select(); b.onFocus?.(e); } : undefined,
        onBlur: b.onBlur,
        onKeyDown: b.num || b.onKeyDown ? (e: any) => {
          if (b.num && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !/[0-9.,]/.test(e.key)) e.preventDefault();
          b.onKeyDown?.(e);
        } : undefined,
        ...(b.value !== undefined ? { value: b.value } : { defaultValue: p["~Text"] ?? "" }),
      };
      return multi
        ? <Textarea {...(common as any)} className={cn(common.className, "min-h-0 resize-none py-1")} />
        : <Input type={p["~PasswordChar"] ? "password" : "text"} {...(common as any)} />;
    }
    case "ComboBox": {
      const list: string[] = Array.isArray(p.List) ? p.List : [];
      return (
        <NativeSelect disabled={b.disabled} style={extra}
          className={cn("h-full w-full [&>select]:h-full [&>select]:rounded-sm [&>select]:[font-size:inherit]", b.className)}
          onChange={b.onChange ? (e) => b.onChange!(e.target.value, e) : undefined}
          {...(b.value !== undefined ? { value: String(b.value) } : {})}>
          {b.children ?? list.map((o, i) => <NativeSelectOption key={i} value={o}>{o}</NativeSelectOption>)}
        </NativeSelect>
      );
    }
    case "CheckBox": {
      const checked = b.value === undefined ? undefined : !!b.value && b.value !== "0";
      return (
        <Label style={extra} className={cn("h-full w-full gap-1.5 font-normal", b.className)}>
          <Checkbox
            disabled={b.disabled}
            checked={checked}
            onCheckedChange={(v) => b.onChange?.(v ? "1" : "0", v)}
            onClick={b.onClick}
          />
          <span className="truncate">{cap}</span>
        </Label>
      );
    }
    case "OptionButton": {
      const checked = b.value === undefined ? undefined : !!b.value && b.value !== "0";
      return (
        <Label style={extra} className={cn("h-full w-full gap-1.5 font-normal", b.className)}>
          <input data-slot="vb-check-input" type="radio" disabled={b.disabled}
            className="size-3.5 shrink-0 accent-primary" checked={checked}
            onChange={(e) => b.onChange?.(e.target.checked ? "1" : "0", e)} onClick={b.onClick} />
          <span className="truncate">{cap}</span>
        </Label>
      );
    }
    case "Frame":
      return (
        <fieldset data-slot="vb-frame" style={extra} className={cn("relative m-0 h-full w-full rounded-md border p-0", b.className)}>
          <legend className="ml-2 px-1 text-muted-foreground">{cap}</legend>
          {b.children}
        </fieldset>
      );
    case "PictureBox": {
      const latar = vbColor(p["~BackColor"]);
      const garis = p.BorderStyle !== 0 && p.Appearance !== 0;
      return (
        <div data-slot="vb-panel" style={extra} onClick={b.onClick}
          className={cn("relative h-full w-full", p["~BackColor"] != null && permukaan(latar, g.height), garis && "rounded-sm border", b.className)}>
          {b.children}
        </div>
      );
    }
    case "Image": {
      const pic = p.Picture;
      return typeof pic === "string" && pic.startsWith("data:")
        ? <img className="h-full w-full object-contain" src={pic} alt="" style={extra} />
        : <div className="h-full w-full" style={extra} />;
    }
    case "Shape":
      return <div className="h-full w-full rounded-sm border" style={extra} />;
    default:
      break;
  }

  const cls = c.class ?? "";
  const tx = c.texts ?? [];
  if (/Toolbar/.test(cls)) {
    return (
      <div style={extra} className={cn("flex h-full w-full items-center gap-1 border-b bg-muted/50 px-1", b.className)}>
        {tx.map((t, i) => <Button key={i} type="button" variant="ghost" size="sm" onClick={b.onClick}>{t}</Button>)}
      </div>
    );
  }
  if (/StatusBar/.test(cls)) {
    const panels = b.children ?? [...new Set(tx)].map((t, i) => <span key={i} className="truncate border-r px-2 last:border-r-0">{t}</span>);
    return <div style={extra} className={cn("flex h-full w-full items-center border-t bg-muted/50 text-muted-foreground", b.className)}>{panels}</div>;
  }
  if (/TabStrip/.test(cls)) {
    return (
      <div style={extra} className={cn("relative h-full w-full rounded-md border bg-card", b.className)}>
        <div className="flex gap-1 border-b px-1 pt-1">
          {tx.map((t, i) => <span key={i} className={cn("rounded-t-sm px-2 py-0.5", i === 0 ? "bg-muted font-medium" : "text-muted-foreground")}>{t}</span>)}
        </div>
        {b.children}
      </div>
    );
  }
  if (/DTPicker/.test(cls)) {
    return (
      <Input type="date" disabled={b.disabled} style={extra} className={cn(ISI, "pr-1", b.className)}
        onChange={b.onChange ? (e) => b.onChange!(e.target.value, e) : undefined}
        {...(b.value !== undefined ? { value: String(b.value) } : {})} />
    );
  }
  if (/ProgressBar/.test(cls)) return <div style={extra} className={cn("h-full w-full overflow-hidden rounded-full bg-muted", b.className)} />;
  // ListView / tabel / OCX lain: kotak penampung.
  return (
    <div style={extra} className={cn("relative h-full w-full overflow-auto rounded-md border bg-card", b.className)}>
      {b.children ?? <span className="absolute top-1 left-1.5 text-[10px] text-muted-foreground">{cls.split(".").pop()} · {c.name}</span>}
    </div>
  );
}
