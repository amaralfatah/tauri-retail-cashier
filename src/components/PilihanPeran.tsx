import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "cn";
import { kasir, pusat, type ModePusat, type StatusKomputer } from "@/api/pusat";
import { muatStatusPusat } from "@/lib/statusPusat";

const PILIHAN: { nilai: ModePusat; judul: string; isi: string }[] = [
  { nilai: "tunggal", judul: "Hanya di komputer ini", isi: "Pilih ini kalau toko Anda hanya punya satu komputer kasir." },
  { nilai: "pusat", judul: "Jadikan komputer ini Pusat", isi: "Data toko disimpan di sini, dan komputer kasir lain tersambung ke komputer ini." },
  { nilai: "kasir", judul: "Sambungkan ke Pusat", isi: "Pilih ini kalau di toko Anda sudah ada komputer Pusat." },
];

export interface IsianPeran { mode: ModePusat; nama: string; kode: string }

/** Pilihan peran komputer ini: dipakai layar pilihan awal dan layar Komputer Pusat. Enter dikirim ke `onEnter`. */
export function PilihanPeran(props: {
  nilai: IsianPeran;
  onUbah: (n: IsianPeran) => void;
  /** Nama Pusat terisi dari Toko Pro lama di komputer ini. */
  dariLama?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const { nilai, onUbah } = props;
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); props.onEnter?.(); }
  };
  return (
    <RadioGroup
      value={nilai.mode}
      onValueChange={(v) => onUbah({ ...nilai, mode: v as ModePusat })}
      disabled={props.disabled}
      onKeyDown={enter}
      aria-label="Cara memakai Kasir Jet"
      className="gap-2"
    >
      {PILIHAN.map((p) => {
        const aktif = nilai.mode === p.nilai;
        return (
          <div key={p.nilai} className={cn("rounded-lg border bg-card transition-colors", aktif ? "border-primary ring-1 ring-primary" : "border-border")}>
            <label className="flex cursor-pointer items-start gap-3 p-3">
              <RadioGroupItem value={p.nilai} className="mt-0.5" autoFocus={props.autoFocus && aktif} />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground">{p.judul}</span>
                <span className="text-xs text-muted-foreground">{p.isi}</span>
              </span>
            </label>
            {aktif && p.nilai === "pusat" && (
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2 text-xs text-foreground">
                <p>Biarkan komputer ini menyala dan Kasir Jet tetap terbuka selama toko buka, supaya komputer kasir bisa menyimpan transaksi.</p>
                <p>Windows akan meminta izin supaya komputer kasir bisa tersambung. Pilih <strong>Ya</strong> saat ditanya.</p>
              </div>
            )}
            {aktif && p.nilai === "kasir" && (
              <div className="flex flex-col gap-3 border-t border-border p-3" onKeyDown={enter}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pusat-nama" className="text-xs font-medium text-foreground">Nama komputer Pusat</Label>
                  <Input id="pusat-nama" value={nilai.nama} disabled={props.disabled} placeholder="Nama komputer atau alamatnya"
                    onChange={(e) => onUbah({ ...nilai, nama: e.target.value })} className="h-8 border-foreground/25 bg-background text-xs" />
                  <p className="text-xs text-muted-foreground">
                    Ketik nama komputer Pusat atau alamatnya, sama seperti di Toko Pro lama.
                    {props.dariLama && nilai.nama ? " Diisi dari pengaturan Toko Pro lama di komputer ini." : ""}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pusat-kode" className="text-xs font-medium text-foreground">Kode sambung</Label>
                  <Input id="pusat-kode" value={nilai.kode} disabled={props.disabled} placeholder="6 angka" inputMode="numeric" maxLength={8} autoComplete="off"
                    onChange={(e) => onUbah({ ...nilai, kode: e.target.value })} className="h-8 w-40 border-foreground/25 bg-background text-xs tabular-nums" />
                  <p className="text-xs text-muted-foreground">Kode sambung tampil di layar Komputer Pusat.</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </RadioGroup>
  );
}

/**
 * Terapkan pilihan peran. `awal` = layar pilihan awal (sebelum ada yang masuk), selain itu Manager yang mengubahnya.
 * Untuk Kasir: nama Pusat disimpan lalu langsung disambungkan dengan kode.
 */
export async function terapkanPeran(n: IsianPeran, awal: boolean): Promise<StatusKomputer | null> {
  if (n.mode === "kasir") {
    const nama = n.nama.trim();
    if (!nama) throw new Error("Nama komputer Pusat belum diisi. Ketik nama atau alamat komputer Pusat.");
    if (awal) await pusat.awalPilih("kasir", nama); else await kasir.atur(nama);
    await kasir.sambung(n.kode.replace(/\D/g, "") || undefined);
  } else {
    const s = awal ? await pusat.awalPilih(n.mode) : await pusat.aturMode(n.mode);
    // Windows bertanya izin di sini. Kalau ditolak, komputer tetap jadi Pusat dan layar Komputer Pusat menyediakan tombol Beri izin.
    if (n.mode === "pusat" && (s.izinFirewall === "belum" || s.izinFirewall === "berbeda")) await pusat.beriIzin().catch(() => undefined);
  }
  return muatStatusPusat();
}
