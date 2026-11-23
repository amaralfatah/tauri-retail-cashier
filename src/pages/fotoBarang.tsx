import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { errText, Row } from "../api";
import { berkasApi } from "../api/berkas";
import { inventoriApi } from "../api/inventori";
import { pilihGambar } from "../api/dialog";
import { Modal } from "../components/Modal";
import { Bind, Geom } from "../vb/VbForm";
import { ModalFrame, useMsgBox } from "../vb/VbGrid";

/** Foto barang yang tersimpan di folder foto aplikasi, dibaca sebagai gambar siap tampil. `muat` memuat ulang. */
export function useFotoBarang(kode: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  const seq = useRef(0);
  const muat = useCallback(() => {
    const n = ++seq.current;
    const k = (kode ?? "").trim();
    if (!k) { setSrc(null); return; }
    berkasApi.fotoBaca(k).then((d) => { if (n === seq.current) setSrc(d); }).catch(() => { if (n === seq.current) setSrc(null); });
  }, [kode]);
  useEffect(muat, [muat]);
  return { src, muat };
}

/** Isi kotak foto (picFoto): gambar mengikuti ukuran kotak, atau kotak kosong kalau barang belum punya foto. */
export const kotakFoto = (src: string | null, tinggi?: number): Bind => (g: Geom) => (
  <div
    data-slot="vb-panel"
    className="flex items-center justify-center overflow-hidden rounded-sm border border-border bg-card"
    style={{ width: g.width, height: tinggi ?? g.height }}
  >
    {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-xs text-muted-foreground">Belum ada foto</span>}
  </div>
);

/** Pratinjau gambar dari alamat file yang dipilih, sebelum disalin ke folder foto. */
export function usePratinjau(path: string) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const p = path.trim().replace(/^"|"$/g, "");
    if (!p) { setSrc(null); return; }
    let batal = false;
    const t = setTimeout(() => {
      berkasApi.bacaGambar(p).then((d) => { if (!batal) setSrc(d); }).catch(() => { if (!batal) setSrc(null); });
    }, 200);
    return () => { batal = true; clearTimeout(t); };
  }, [path]);
  return src;
}

/** Tanya file gambar: dipilih lewat dialog, atau alamatnya diketik. */
export function AlamatFoto(props: { onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState("");
  const pratinjau = usePratinjau(path);
  const cari = async () => { const p = await pilihGambar(); if (p) setPath(p); };
  const ok = () => path.trim() && props.onPick(path.trim().replace(/^"|"$/g, ""));
  return (
    <Modal title="Pilih Gambar/Foto Barang" onClose={props.onClose}
      footer={<><Button variant="outline" onClick={props.onClose}>Batal</Button><Button onClick={ok} disabled={!path.trim()}>OK</Button></>}>
      <p>Klik Cari untuk memilih gambar di komputer Anda, atau ketik alamat filenya.</p>
      <div className="flex gap-1.5">
        <Input className="flex-1" autoFocus value={path} onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ok(); }} />
        <Button type="button" variant="outline" onClick={() => void cari()}>Cari...</Button>
      </div>
      {pratinjau && <img src={pratinjau} alt="" className="mx-auto mt-2 block max-h-45 max-w-full object-contain" />}
    </Modal>
  );
}

/** Simpan foto untuk satu barang; mengembalikan true kalau berhasil. */
export async function simpanFoto(kode: string, path: string, alert: (t: string) => void, hapusAsal = false): Promise<boolean> {
  try {
    await berkasApi.fotoSimpan(kode, path, hapusAsal);
    return true;
  } catch (e) {
    alert(errText(e));
    return false;
  }
}

/** FrmZUploadFoto (Upload Foto/Gambar Barang), dibuka dari tombol Import Foto di Data Barang. */
export function ImportFoto(props: { barang?: Row; onClose: () => void; onSaved?: (kode: string) => void }) {
  const msg = useMsgBox();
  const [cari, setCari] = useState(String(props.barang?.kodebarang ?? ""));
  const [b, setB] = useState<Row | null>(props.barang ?? null);
  const [path, setPath] = useState("");
  const [hapus, setHapus] = useState(false);
  const foto = useFotoBarang(b?.kodebarang);
  const pratinjau = usePratinjau(path);
  const pilih = async () => { const p = await pilihGambar(); if (p) setPath(p); };

  const kosongkan = () => { setCari(""); setB(null); setPath(""); };
  // cOK_Click: cari persis pada kode atau barcode, tanpa melihat status aktif.
  const temukan = async () => {
    const k = cari.trim();
    if (!k) return;
    try {
      const hit = await inventoriApi.labelFind(k);
      if (!hit) { setB(null); return msg.alert("Data tidak ditemukan!"); }
      setB(hit);
    } catch (e) { msg.alert(errText(e)); }
  };
  const simpan = async () => {
    if (!b) return msg.alert("Pilih dulu barangnya. Isi kode atau barcode, lalu klik OK.");
    if (!path.trim()) return msg.alert("Isi dulu alamat file gambarnya.");
    if (await simpanFoto(b.kodebarang, path.trim().replace(/^"|"$/g, ""), msg.alert, hapus)) {
      props.onSaved?.(b.kodebarang);
      kosongkan();
      msg.alert("File sudah disimpan", "Informasi");
    }
  };

  const imgSrc = pratinjau ?? foto.src;
  return (
    <ModalFrame
      title="Upload Foto / Gambar Barang"
      width={600}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cKeluar" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 text-xs" data-vb="cSimpan" onClick={() => void simpan()}>
            Simpan Foto
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_180px] gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="uf-cari" className="text-xs text-muted-foreground">Cari Kode / Barcode Barang</Label>
            <InputGroup className="h-8">
              <InputGroupInput
                id="uf-cari"
                autoFocus
                data-vb="tCari"
                className="text-xs"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void temukan(); }}
                placeholder="Ketik kode atau barcode lalu Enter..."
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton data-vb="cOK" onClick={() => void temukan()}>OK</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Kode Barang</Label>
              <Input data-vb="tKode" disabled value={String(b?.kodebarang ?? "")} className="h-8 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Barcode</Label>
              <Input data-vb="tBarcode" disabled value={String(b?.barcode ?? "")} className="h-8 text-xs" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Nama Barang</Label>
            <Input data-vb="tNama" disabled value={String(b?.namabarang ?? "")} className="h-8 text-xs" />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="uf-path" className="text-xs text-muted-foreground">File Gambar</Label>
            <InputGroup className="h-8">
              <InputGroupInput
                id="uf-path"
                className="text-xs"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Klik Cari atau ketik alamat file..."
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={() => void pilih()}>Cari...</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <span className="text-[11px] text-muted-foreground">Gambar disalin ke folder foto aplikasi sesuai kode barang.</span>
          </div>

          <Label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-normal">
            <Checkbox data-vb="chkHapus" checked={hapus} onCheckedChange={(c) => setHapus(Boolean(c))} />
            <span>Hapus file sumber setelah disalin</span>
          </Label>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Pratinjau Foto</Label>
          <div className="flex h-52 items-center justify-center overflow-hidden rounded-md border border-border bg-card p-2">
            {imgSrc ? (
              <img src={imgSrc} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-2 text-center text-xs text-muted-foreground">Belum ada foto</span>
            )}
          </div>
        </div>
      </div>
      {msg.node}
    </ModalFrame>
  );
}
