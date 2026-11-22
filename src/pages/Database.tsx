import { useEffect, useState } from "react";
import { errText } from "../api";
import { autoBackup } from "../api/cadangan";
import { dbApi, folderBackup } from "../api/keuangan";
import { useApp } from "../appContext";
import { Bind, VbForm } from "../vb/VbForm";
import { useMsgBox } from "../vb/VbGrid";
import { txt } from "./keuanganLib";

/** Pengaturan Database. Opsi khusus Firebird (lokasi Firebird, nama komputer, lokasi report) disembunyikan. */
const HIDE = ["Label1", "tLokasiFirebird", "cOpenFirebird", "Label2", "tNamaKomputer", "cOpenData", "cOpenBackup", "Label5", "tLokasiReport", "cOpenReport"];

export function Database() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [lokasi, setLokasi] = useState("");
  const [backup, setBackup] = useState("");
  const [otomatis, setOtomatis] = useState(autoBackup.get());

  const muat = () => dbApi.info().then((i) => { setLokasi(i.path); setBackup(folderBackup.get() || i.folder_backup); setOtomatis(autoBackup.get()); }).catch((e) => msg.alert(errText(e)));
  useEffect(() => { void muat(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bind: Record<string, Bind> = {
    tLokasiData: txt(lokasi, undefined, true),
    tLokasiBackup: txt(backup, setBackup),
    cOpenFolderBackup: { onClick: () => document.querySelector<HTMLElement>('[data-vb="tLokasiBackup"] input')?.focus() },
    chkAutoBackup: { value: otomatis ? "1" : "0", onChange: (v) => setOtomatis(v === "1") },
    cSimpan: { onClick: () => msg.confirm("Apakah pengaturan database akan disimpan?", () => { folderBackup.set(backup); autoBackup.set(otomatis); msg.alert("Pengaturan database sudah disimpan."); }) },
    cBatal: { onClick: () => void muat() },
    cTes: {
      onClick: async () => {
        try {
          const r = await dbApi.cek(false);
          msg.alert(r.ok ? "Koneksi berhasil" : `Database bermasalah: ${r.masalah.slice(0, 3).join("; ")}. Coba menu Alat Bantu Program untuk memeriksa dan memperbaikinya.`);
        } catch (e) { msg.alert(errText(e)); }
      },
    },
    cKeluar: { onClick: () => go("home") },
  };
  return (
    <div className="vbm-area">
      <VbForm form="FrmZDatabase" bind={bind} hide={HIDE} />
      {msg.node}
    </div>
  );
}
