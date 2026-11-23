import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Kbd } from "@/components/ui/kbd";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errText } from "../api";
import { autoBackup } from "../api/cadangan";
import { dbApi, folderBackup } from "../api/keuangan";
import { useApp } from "../appContext";
import { useMsgBox } from "../vb/VbGrid";
import { KunciPusat, useKunciPusat } from "../components/KunciPusat";

/** Pengaturan Database (FrmZDatabase): lokasi file SQLite, folder backup, dan auto-backup saat keluar. */
export function Database() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [lokasi, setLokasi] = useState("");
  const [backup, setBackup] = useState("");
  const [otomatis, setOtomatis] = useState(autoBackup.get());
  const kunci = useKunciPusat();

  const muat = () => dbApi.info().then((i) => {
    setLokasi(i?.path ?? "");
    setBackup(folderBackup.get() || i?.folder_backup || "");
    setOtomatis(autoBackup.get());
  }).catch((e) => msg.alert(errText(e)));
  useEffect(() => { void muat(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc menutup layar ini. Dialog yang sedang terbuka menangkap Esc lebih dulu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); go("home"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const tesKoneksi = async () => {
    try {
      const r = await dbApi.cek(false);
      msg.alert(r.ok ? "Koneksi ke database berhasil." : `Database bermasalah: ${(r.masalah ?? []).slice(0, 3).join("; ")}. Coba menu Alat Bantu Program untuk memeriksa dan memperbaikinya.`);
    } catch (e) { msg.alert(errText(e)); }
  };

  const simpan = () => msg.confirm("Simpan pengaturan database ini?", () => {
    folderBackup.set(backup);
    autoBackup.set(otomatis);
    msg.alert("Pengaturan database sudah disimpan.");
  });

  if (kunci.terkunci) {
    return (
      <div className="vb-modern flex h-full flex-col justify-between gap-4 bg-background p-4 font-sans text-xs text-foreground" data-form="FrmZDatabase">
        <KunciPusat />
        <div className="flex justify-end border-t border-border pt-3">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="vb-modern flex h-full flex-col justify-between gap-4 bg-background p-4 font-sans text-xs text-foreground" data-form="FrmZDatabase">
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3.5">
        <div className="flex flex-col gap-1.5" data-vb="tLokasiData">
          <Label className="text-xs font-medium text-foreground">Lokasi File Data</Label>
          <Input readOnly value={lokasi} className="h-7 border-border bg-muted/70 font-mono text-xs text-foreground/85" />
        </div>

        <div className="flex flex-col gap-1.5" data-vb="tLokasiBackup">
          <Label className="text-xs font-medium text-foreground">Lokasi Folder Backup</Label>
          <div className="flex items-center gap-1.5">
            <Input
              value={backup}
              onChange={(e) => setBackup(e.target.value)}
              placeholder="Folder tempat menyimpan cadangan database"
              className="h-7 flex-1 border-foreground/25 bg-background font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-vb="cOpenFolderBackup"
              className="h-7 px-2.5 text-xs"
              title="Ubah lokasi folder backup"
              onClick={() => document.querySelector<HTMLElement>('[data-vb="tLokasiBackup"] input')?.focus()}
            >
              ...
            </Button>
          </div>
        </div>

        <div className="pt-1" data-vb="chkAutoBackup">
          <Label className="flex cursor-pointer items-center gap-2 text-xs font-normal text-foreground">
            <Checkbox checked={otomatis} onCheckedChange={(v) => setOtomatis(!!v)} />
            <span>Auto Backup saat keluar aplikasi</span>
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive" onClick={() => void muat()}>
            Batal
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cTes" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => void tesKoneksi()}>
            Tes Koneksi
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 px-3.5 text-xs font-semibold shadow-xs" onClick={simpan}>
            Simpan
          </Button>
        </div>
      </div>
      {msg.node}
    </div>
  );
}
