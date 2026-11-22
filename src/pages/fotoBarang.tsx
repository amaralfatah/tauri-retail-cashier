import { useCallback, useEffect, useRef, useState } from "react";
import { errText, Row } from "../api";
import { berkasApi } from "../api/berkas";
import { inventoriApi } from "../api/inventori";
import { pilihGambar } from "../api/dialog";
import { Modal } from "../components/Modal";
import { Bind, Geom } from "../vb/VbForm";
import { useMsgBox, VbModal } from "../vb/VbGrid";

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
  <div className="vb-pic" style={{ width: g.width, height: tinggi ?? g.height, background: "#fff", border: "1px solid #7a7a7a", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
    {src && <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
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
      footer={<><button className="btn" onClick={props.onClose}>Batal</button><button className="btn primary" onClick={ok} disabled={!path.trim()}>OK</button></>}>
      <p>Klik Cari untuk memilih gambar di komputer Anda, atau ketik alamat filenya.</p>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" style={{ flex: 1 }} autoFocus value={path} onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ok(); }} />
        <button className="btn" onClick={() => void cari()}>Cari...</button>
      </div>
      {pratinjau && <img src={pratinjau} alt="" style={{ display: "block", maxWidth: "100%", maxHeight: 180, margin: "8px auto 0", objectFit: "contain" }} />}
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

  const bind: Record<string, Bind> = {
    tCari: { value: cari, onChange: setCari, onKeyDown: (e) => { if (e.key === "Enter") void temukan(); } },
    cOK: { onClick: () => void temukan() },
    tKode: { value: String(b?.kodebarang ?? ""), disabled: true },
    tBarcode: { value: String(b?.barcode ?? ""), disabled: true },
    tNama: { value: String(b?.namabarang ?? ""), disabled: true },
    picFoto: kotakFoto(pratinjau ?? foto.src),
    // Pemilih drive, folder, dan file Windows diganti dialog pilih file; alamat tetap bisa diketik.
    File1: () => (
      <div style={{ font: "12px Tahoma, 'Segoe UI', sans-serif" }}>
        <div style={{ marginBottom: 4 }}>Alamat file gambar</div>
        <div style={{ display: "flex", gap: 4 }}>
          <input className="vb-txt" style={{ flex: 1, minWidth: 0 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="Klik Cari atau ketik alamat file" />
          <button type="button" onClick={() => void pilih()}>Cari...</button>
        </div>
        <div style={{ marginTop: 6, color: "#444" }}>Gambar disalin ke folder foto aplikasi, dengan nama sesuai kode barang.</div>
      </div>
    ),
    chkHapus: { value: hapus ? "1" : "0", onChange: (v) => setHapus(v === "1") },
    cSimpan: { onClick: () => void simpan() },
    cKeluar: { onClick: props.onClose },
  };
  return (
    <VbModal form="FrmZUploadFoto" title="Upload Foto/Gambar Barang" bind={bind} hide={["Drive1", "Dir1"]} onClose={props.onClose}>
      {msg.node}
    </VbModal>
  );
}
