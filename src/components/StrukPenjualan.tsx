import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { errText, Row } from "../api";
import { ModalFrame } from "../vb/VbGrid";
import { Struk, cetakStruk, strukTeks } from "./Struk";

/**
 * Jendela "Struk Penjualan" (FrmTransJualBayarCetak) yang muncul setelah penjualan tersimpan
 * kalau kotak "Preview Struk" dicentang. Cetak mencetak struk lalu menutup jendela; Tutup menutup tanpa mencetak.
 */
export function StrukPenjualan(props: { trans: { header: Row; detail: Row[] }; setting: Row; onSelesai: () => void }) {
  // Dibuat sekali supaya isi yang dicetak sama dengan yang tampil (tanggal dan jam saat struk dibuat).
  const teks = useMemo(() => strukTeks(props.trans, props.setting), [props.trans, props.setting]);
  const cetak = () => {
    cetakStruk(teks)
      .catch((e) => toast.error(errText(e)))
      .finally(props.onSelesai);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onSelesai(); return; }
      if (ev.altKey && ev.code === "KeyC") { ev.preventDefault(); ev.stopPropagation(); cetak(); }
      if (ev.altKey && (ev.code === "KeyT" || ev.code === "KeyB")) { ev.preventDefault(); ev.stopPropagation(); props.onSelesai(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { document.querySelector<HTMLElement>('[data-vb="cCetak"]')?.focus(); }, []);

  return (
    <>
      <ModalFrame title="Struk Penjualan — sudah tersimpan" width={420} height={540} onClose={props.onSelesai}>
        <div className="flex size-full min-h-0 flex-col justify-between gap-3 p-3 font-sans text-xs text-foreground" data-form="FrmTransJualBayarCetak">
          <pre
            data-vb="tStruk"
            className="tp-scroll-always m-0 min-h-0 flex-1 rounded-md border border-border bg-card p-3 font-mono text-[12px] leading-snug whitespace-pre-wrap text-foreground select-text"
          >
            {teks}
          </pre>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-2.5">
            <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={props.onSelesai}>
              <span>Tutup</span>
              <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            <Button type="button" variant="default" size="default" data-vb="cCetak" className="h-8 gap-1.5 px-4 text-xs font-semibold" onClick={cetak}>
              <span>Cetak Struk</span>
              <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">Alt+C</Kbd>
            </Button>
          </div>
        </div>
      </ModalFrame>
      <Struk trans={props.trans} setting={props.setting} teks={teks} />
    </>
  );
}
