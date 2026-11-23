import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { errText } from "../api";
import { pilihExcel } from "../api/dialog";
import { folderBackup, imporApi, PratinjauImpor } from "../api/keuangan";
import { GridCol, ModalFrame, useMsgBox, VbGrid } from "../vb/VbGrid";

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
    { title: "No.", width: 42, align: "right", render: (_, i) => i + 1 },
    ...(data?.kolom ?? []).map<GridCol<string[]>>((k, j) => ({ title: k, width: Math.max(90, k.length * 9), render: (r) => r[j] })),
  ];

  return (
    <ModalFrame
      title={ubah ? props.nama : `Impor ${props.nama}`}
      width={780}
      height={520}
      onClose={props.onClose}
      footer={
        <>
          <span className="mr-auto text-xs font-medium text-muted-foreground tabular-nums" data-vb="lblJml">
            Jumlah Data: {data?.jumlah ?? 0}
          </span>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cKeluar" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cProses" onClick={proses}>
            Proses Impor
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="impor-path" className="text-xs text-muted-foreground">File Excel / CSV (.xlsx, .xls, .csv)</Label>
          <InputGroup className="h-8">
            <InputGroupInput
              id="impor-path"
              data-vb="tCari"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="Pilih file atau masukkan lokasi file..."
              className="text-xs"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton data-vb="cCari" onClick={() => void cari()}>Cari File...</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        {!ubah && (
          <Label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-normal">
            <Checkbox data-vb="chkHapus" checked={hapusLama} onCheckedChange={(c) => setHapusLama(Boolean(c))} />
            <span>Hapus data lama sebelum mengimpor data baru</span>
          </Label>
        )}

        <div className="min-h-0 flex-1" data-vb="FG">
          <VbGrid cols={cols} rows={data?.baris ?? []} rowKey={(r) => String(data?.baris.indexOf(r))} selected={sel} onSelect={setSel} />
        </div>
      </div>
      {msg.node}
    </ModalFrame>
  );
}
