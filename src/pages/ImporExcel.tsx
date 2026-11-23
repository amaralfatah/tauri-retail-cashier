import { useState } from "react";
import { errText } from "../api";
import { pilihExcel } from "../api/dialog";
import { folderBackup, imporApi, PratinjauImpor } from "../api/keuangan";
import { Bind } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { txt } from "./keuanganLib";

/** Impor Data Excel. File yang dibaca bisa berformat .xlsx, .xls, atau CSV. */
export function ImporExcel(props: { jenis: string; nama: string; onClose: () => void }) {
  const msg = useMsgBox();
  const [path, setPath] = useState("");
  const [data, setData] = useState<PratinjauImpor | null>(null);
  const [hapusLama, setHapusLama] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const cari = async () => {
    const dipilih = await pilihExcel();
    const alamat = dipilih ?? path;
    if (dipilih) setPath(dipilih);
    if (!alamat.trim()) return;
    try {
      const d = await imporApi.baca(props.jenis, alamat);
      setData(d);
      setSel(null);
      if (d.wajib_hilang.length) msg.alert(`Kolom ${d.wajib_hilang.join(", ")} tidak ada di file ini. Periksa judul kolom di baris pertama.`);
      else if (d.tidak_dikenal.length) msg.alert(`Kolom ${d.tidak_dikenal.join(", ")} tidak dikenali, jadi tidak ikut diimpor.`);
    } catch (e) { setData(null); msg.alert(errText(e)); }
  };
  const ubah = props.jenis === "updatebarang" || props.jenis === "stokbarang";
  const proses = () => {
    if (!data) return msg.alert("Pilih dulu file yang akan diimpor, lalu klik Cari.");
    const peringatan = hapusLama ? " Data lama akan dihapus lebih dulu." : "";
    msg.confirm(`Data dari file ini akan diimpor.${peringatan} Program membuat cadangan dulu sebelum mengimpor. Lanjutkan?`, async () => {
      try {
        const r = await imporApi.proses(props.jenis, path, hapusLama, folderBackup.get());
        msg.alert(props.jenis === "stokbarang"
          ? `Stok ${r.jumlah} barang sudah diperbarui lewat stok opname ${r.notrans}.`
          : ubah ? `Data ${r.jumlah} barang sudah diperbarui.` : `Impor data selesai. ${r.jumlah} data sudah masuk.`);
      } catch (e) { msg.alert(errText(e)); }
    }, undefined, undefined, hapusLama ? "Ya, hapus dan impor" : undefined);
  };

  const cols: GridCol<string[]>[] = [
    { title: "No.", width: 40, align: "right", render: (_, i) => i + 1 },
    ...(data?.kolom ?? []).map<GridCol<string[]>>((k, j) => ({ title: k, width: Math.max(80, k.length * 9), render: (r) => r[j] })),
  ];
  const bind: Record<string, Bind> = {
    lblImpor: { text: ubah ? `${props.nama} ...` : `Impor ${props.nama} ...` },
    tCari: txt(path, setPath),
    cCari: { onClick: () => void cari() },
    FG: () => <VbGrid cols={cols} rows={data?.baris ?? []} rowKey={(r) => String(data?.baris.indexOf(r))} selected={sel} onSelect={setSel} />,
    lblJml: { text: `Jumlah Data : ${data?.jumlah ?? 0}` },
    chkHapus: { value: hapusLama ? "1" : "0", onChange: (v) => setHapusLama(v === "1") },
    cProses: { onClick: proses, variant: "default" },
    cKeluar: { onClick: props.onClose, text: "Tutup [Esc]" },
  };
  return <VbModal form="FrmZImportExcel" bind={bind} hide={ubah ? ["pBar", "chkHapus"] : ["pBar"]} onClose={props.onClose}>{msg.node}</VbModal>;
}
