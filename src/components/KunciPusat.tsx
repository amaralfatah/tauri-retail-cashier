import { LockIcon } from "lucide-react";
import { useStatusPusat } from "../lib/statusPusat";

/** Di komputer kasir: menu khusus Pusat (backup, restore, impor Excel, alat SQL) terkunci dengan pesan ini (rancangan 7.3). */
export function useKunciPusat(): { terkunci: boolean; pesan: string } {
  const { komputer } = useStatusPusat();
  const nama = komputer?.kasir.namaPusat || komputer?.kasir.pusat || "";
  return {
    terkunci: komputer?.mode === "kasir",
    pesan: `Menu ini hanya bisa dibuka di komputer Pusat${nama ? ` (${nama})` : ""}.`,
  };
}

/** Pengganti isi layar atau tab yang hanya bisa dipakai di komputer Pusat. */
export function KunciPusat(props: { judul?: string }) {
  const { pesan } = useKunciPusat();
  return (
    <div role="status" className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <LockIcon aria-hidden className="size-6 text-muted-foreground" />
      <p className="text-sm font-semibold text-foreground">{props.judul ?? "Dikunci di komputer kasir"}</p>
      <p className="max-w-sm text-xs text-foreground/80">{pesan}</p>
    </div>
  );
}
