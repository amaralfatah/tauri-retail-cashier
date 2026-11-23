import { useEffect } from "react";
import { Row } from "../api";
import { VbWindow, formCaption, formSize, useTinggiJudul } from "../vb/VbForm";
import { Struk, cetakStruk, strukTeks } from "./Struk";

const FORM = "FrmTransJualBayarCetak";

/**
 * Jendela "Struk Penjualan" (FrmTransJualBayarCetak) yang muncul setelah penjualan tersimpan
 * kalau kotak "Preview Struk" dicentang. Cetak mencetak struk lalu menutup jendela; Tutup menutup tanpa mencetak (penjualan sudah tersimpan sebelum jendela ini muncul).
 * Pencetakan memakai dialog cetak sistem, jadi printer dipilih di sana.
 */
export function StrukPenjualan(props: { trans: { header: Row; detail: Row[] }; setting: Row; onSelesai: () => void }) {
  const cetak = () => { cetakStruk().catch(() => undefined).finally(props.onSelesai); };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.stopPropagation(); props.onSelesai(); return; }
      if (ev.altKey && ev.code === "KeyC") { ev.preventDefault(); ev.stopPropagation(); cetak(); }
      if (ev.altKey && (ev.code === "KeyT" || ev.code === "KeyB")) { ev.preventDefault(); ev.stopPropagation(); props.onSelesai(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { document.querySelector<HTMLElement>('[data-vb="cCetak"] button')?.focus(); }, []);

  const { width, height } = formSize(FORM);
  const tinggiJudul = useTinggiJudul();
  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-2">
      <div className="flex max-w-[96vw] flex-col" style={{ width: width + 2, height: `min(${height + tinggiJudul}px, 96vh)` }}>
        <VbWindow form={FORM} title={`${formCaption(FORM)} — sudah tersimpan`} onClose={props.onSelesai} bind={{
          tStruk: { value: strukTeks(props.trans, props.setting) },
          cCetak: { onClick: cetak, variant: "default" },
          cBatal: { onClick: props.onSelesai, text: "Tutup" },
        }} />
      </div>
      <Struk trans={props.trans} setting={props.setting} />
    </div>
  );
}
