import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

/**
 * FrmZSplash: layar pembuka beberapa saat sebelum halaman masuk.
 */
export function Splash(props: { namaUsaha?: string }) {
  const [versi, setVersi] = useState("");
  useEffect(() => { getVersion().then(setVersi).catch(() => undefined); }, []);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-muted/60 font-sans text-foreground">
      <div className="flex w-96 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-6 shadow-2xl" data-form="FrmZSplash">
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold tracking-tight text-foreground">
            Kasir<span className="text-primary" data-vb="lblVer">Jet</span>
          </div>
          <span className="text-xs font-medium text-muted-foreground tabular-nums" data-vb="lblBuild">
            {versi ? `Versi ${versi}` : ""}
          </span>
        </div>
        {props.namaUsaha && (
          <div className="truncate text-sm font-medium text-foreground/90" data-vb="lblDemo">
            {props.namaUsaha}
          </div>
        )}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
        </div>
        <div className="text-[11px] text-muted-foreground">Menyiapkan KasirJet, sebentar...</div>
      </div>
    </div>
  );
}
