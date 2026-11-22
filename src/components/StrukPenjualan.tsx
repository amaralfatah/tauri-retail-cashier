import { useEffect } from "react";
import { Row } from "../api";
import { VbWindow, formCaption, formSize } from "../vb/VbForm";
import { Struk, cetakStruk, strukTeks } from "./Struk";

const FORM = "FrmTransJualBayarCetak";

/**
 * Jendela "Struk Penjualan" (FrmTransJualBayarCetak) yang muncul setelah penjualan tersimpan
 * kalau kotak "Preview Struk" dicentang. Cetak mencetak struk lalu menutup jendela; Batal menutup tanpa mencetak.
 * Pencetakan memakai dialog cetak sistem, jadi printer dipilih di sana.
 */
export function StrukPenjualan(props: { trans: { header: Row; detail: Row[] }; setting: Row; onSelesai: () => void }) {
  const cetak = () => { cetakStruk().catch(() => undefined).finally(props.onSelesai); };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onSelesai(); return; }
      if (ev.altKey && ev.code === "KeyC") { ev.preventDefault(); ev.stopPropagation(); cetak(); }
      if (ev.altKey && ev.code === "KeyB") { ev.preventDefault(); ev.stopPropagation(); props.onSelesai(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { document.querySelector<HTMLElement>('[data-vb="cCetak"] button')?.focus(); }, []);

  const { width, height } = formSize(FORM);
  return (
    <div className="modal-backdrop no-print">
      <div style={{ width: width + 2, height: `min(${height + 22}px, 96vh)`, maxWidth: "96vw", display: "flex", flexDirection: "column" }}>
        <VbWindow form={FORM} title={formCaption(FORM)} onClose={props.onSelesai} bind={{
          tStruk: { value: strukTeks(props.trans, props.setting) },
          cCetak: { onClick: cetak },
          cBatal: { onClick: props.onSelesai },
        }} />
      </div>
      <Struk trans={props.trans} setting={props.setting} />
    </div>
  );
}
