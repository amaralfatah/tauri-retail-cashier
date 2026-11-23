import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useCobaLagi } from "../lib/cobaLagi";
import { ModalFrame } from "../vb/VbGrid";

/**
 * Dialog Coba Lagi untuk simpan di komputer kasir yang gagal atau belum pasti hasilnya (rancangan 7.3).
 * Dipasang sekali di App. Esc menutup (isian di layar tetap ada); Enter menekan Coba Lagi.
 */
export function CobaLagiDialog() {
  const t = useCobaLagi();
  if (!t) return null;
  return (
    <ModalFrame
      title={t.pasti ? "Belum Tersimpan" : "Hasil Simpan Belum Pasti"}
      width={460}
      onClose={() => t.jawab(false)}
      footer={
        <>
          <Button type="button" variant="outline" size="default" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={() => t.jawab(false)}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" autoFocus className="h-8 gap-1.5 px-4 text-xs font-semibold" onClick={() => t.jawab(true)}>
            <RefreshCwIcon aria-hidden /> Coba Lagi
          </Button>
        </>
      }
    >
      <p role="alert" className="text-sm leading-relaxed">{t.pesan}</p>
    </ModalFrame>
  );
}
