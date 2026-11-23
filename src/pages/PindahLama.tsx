import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errText } from "../api";
import { pilihDataLama } from "../api/dialog";
import { CariLama, HasilLama, KandidatLama, KemajuanLama, lamaApi } from "../api/keuangan";
import { cn } from "@/lib/utils";
import { rp } from "../format";
import { ModalFrame, useMsgBox } from "../vb/VbGrid";

const ukuranTeks = (n: number) => (n >= 1048576 ? `${(n / 1048576).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024)).toLocaleString("id-ID")} KB`);
const jenisTeks = (j: "fdb" | "fdk") => (j === "fdb" ? "Data Toko Pro lama" : "File backup Toko Pro lama");
const namaFile = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Kunci localStorage: pengingat di Beranda tidak muncul lagi di komputer ini setelah ditutup. */
const KUNCI_TUTUP = "tokopro.pindahLamaDitutup";
export const pindahLamaDitutup = () => { try { return localStorage.getItem(KUNCI_TUTUP) === "1"; } catch { return false; } };
export const tutupPindahLama = () => { try { localStorage.setItem(KUNCI_TUTUP, "1"); } catch { /* abaikan */ } };

export function PindahLama({ onClose }: { onClose: () => void }) {
  const msg = useMsgBox();
  const [info, setInfo] = useState<CariLama | null>(null);
  const [gagalCari, setGagalCari] = useState(false);
  const [pilih, setPilih] = useState("");
  const [manual, setManual] = useState<KandidatLama | null>(null);
  const [jalan, setJalan] = useState(false);
  const [kemajuan, setKemajuan] = useState<KemajuanLama | null>(null);
  const [hasil, setHasil] = useState<HasilLama | null>(null);
  const sedang = useRef(false);

  useEffect(() => {
    lamaApi.cari().then((r) => {
      setInfo(r);
      if (r.kandidat.length === 1) setPilih(r.kandidat[0].path);
    }).catch(() => { setGagalCari(true); });
  }, []);

  useEffect(() => {
    if (!jalan) return;
    let batal = false;
    let lepas: (() => void) | undefined;
    void listen<KemajuanLama>("pindah-lama", (e) => setKemajuan(e.payload)).then((f) => { if (batal) f(); else lepas = f; });
    return () => { batal = true; lepas?.(); };
  }, [jalan]);

  const daftar = [...(info?.kandidat ?? []), ...(manual && !info?.kandidat.some((k) => k.path === manual.path) ? [manual] : [])];
  const bukanFirebird = info ? !info.firebird.ada : false;
  const adaData = !!info && (info.data_sekarang.barang > 0 || info.data_sekarang.transaksi > 0);

  const pilihFile = async () => {
    const p = await pilihDataLama();
    if (!p) return;
    const jenis = /\.fdk$/i.test(p) ? "fdk" : "fdb";
    setManual({ path: p, jenis, ukuran: 0, waktu: "" });
    setPilih(p);
  };

  const mulai = async () => {
    if (sedang.current) return;
    sedang.current = true;
    setJalan(true);
    setKemajuan(null);
    try {
      setHasil(await lamaApi.pindahkan(pilih));
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      sedang.current = false;
      setJalan(false);
    }
  };

  const lanjut = () => {
    if (!pilih) return msg.alert("Pilih dulu data Toko Pro lama yang mau dipindahkan.");
    const teks = adaData
      ? `Data di aplikasi ini (${rp(info!.data_sekarang.barang)} barang, ${rp(info!.data_sekarang.transaksi)} transaksi) akan diganti dengan data Toko Pro lama. Program menyimpan salinannya dulu. Lanjutkan?`
      : "Data Toko Pro lama akan dipindahkan ke aplikasi ini. Pastikan Toko Pro lama sudah Anda tutup. Lanjutkan?";
    msg.confirm(teks, () => void mulai(), "Pindahkan Data", undefined, adaData ? "Ya, ganti data" : false);
  };

  const masukLagi = () => window.location.reload();

  /* ---- Selesai ---- */
  if (hasil) {
    return (
      <>
        <ModalFrame title="Pindahkan Data dari Toko Pro Lama" width={560} onClose={masukLagi}
          footer={<Button type="button" variant="default" size="default" autoFocus className="h-8 px-4 text-xs font-semibold" onClick={masukLagi}>Masuk Lagi</Button>}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="font-semibold">Data Toko Pro lama sudah pindah ke sini.</p>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader className="bg-muted">
                  <TableRow>
                    <TableHead className="font-bold text-foreground">Data</TableHead>
                    <TableHead className="text-right font-bold text-foreground">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hasil.hasil.map((h) => (
                    <TableRow key={h.tabel}>
                      <TableCell>{h.nama}</TableCell>
                      <TableCell className="text-right tabular-nums">{rp(h.jumlah)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {hasil.peringatan.length > 0 && (
              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">Ada yang perlu Anda ketahui</p>
                <ul className="list-disc space-y-0.5 pl-4">{hasil.peringatan.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Data Anda yang sebelumnya disimpan di <span className="font-mono break-all">{hasil.cadangan}</span>.</p>
            <p>Kata sandi lama tidak bisa ikut pindah. Semua pengguna masuk dengan kata sandi <b>admin</b>, lalu membuat kata sandi baru.</p>
          </div>
        </ModalFrame>
        {msg.node}
      </>
    );
  }

  /* ---- Sedang berjalan ---- */
  if (jalan) {
    const dari = kemajuan?.dari || 0;
    const persen = dari > 0 ? Math.min(100, Math.round(((kemajuan?.ke ?? 0) / dari) * 100)) : 0;
    const status = !kemajuan || kemajuan.tahap === "salin" ? "Menyalin data lama…" : kemajuan.tahap === "selesai" ? "Hampir selesai…" : `Memindahkan ${kemajuan.nama ?? kemajuan.tabel ?? "data"}`;
    return (
      <>
        <ModalFrame title="Pindahkan Data dari Toko Pro Lama" width={480}>
          <div className="flex flex-col gap-3 p-4 text-sm" aria-live="polite">
            <p className="font-semibold">{status}</p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={persen} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${persen}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{dari > 0 ? `${kemajuan?.ke ?? 0} dari ${dari}` : "Mohon tunggu"}</p>
            <p className="text-xs text-muted-foreground">Ini bisa makan beberapa menit kalau datanya banyak. Jangan tutup aplikasi.</p>
          </div>
        </ModalFrame>
        {msg.node}
      </>
    );
  }

  /* ---- Pilih data ---- */
  return (
    <>
      <ModalFrame title="Pindahkan Data dari Toko Pro Lama" width={620} onClose={onClose}
        footer={
          <>
            <Button type="button" variant="outline" size="default" className="h-8 gap-1.5 px-3 text-xs font-medium" onClick={onClose}>Tutup <Kbd>Esc</Kbd></Button>
            <Button type="button" variant="default" size="default" className="h-8 px-4 text-xs font-semibold" disabled={!pilih || bukanFirebird} onClick={lanjut}>Pindahkan Data</Button>
          </>
        }>
        <div className="flex flex-col gap-3 text-sm">
          <p>Barang, pelanggan, supplier, transaksi, stok, kas, dan pengguna dari Toko Pro lama akan pindah ke sini. Data di Toko Pro lama tidak diubah.</p>

          {bukanFirebird && (
            <div className="rounded-md bg-muted p-3 text-xs">
              <p className="font-semibold">Komputer ini belum bisa membaca data Toko Pro lama.</p>
              <p className="mt-1 text-muted-foreground">Jalankan layar ini di komputer yang dulu memakai Toko Pro lama.</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Rincian: pustaka Firebird tidak ditemukan.</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold">Data yang ditemukan</div>
            {!info && !gagalCari && <p className="text-xs text-muted-foreground">Mencari data Toko Pro lama…</p>}
            {gagalCari && <p className="text-xs text-muted-foreground">Pencarian data lama gagal. Anda masih bisa memilih file sendiri.</p>}
            {info && daftar.length === 0 && <p className="text-xs text-muted-foreground">Program tidak menemukan data Toko Pro lama di komputer ini. Anda bisa memilih file sendiri.</p>}
            {daftar.length > 0 && (
              <div role="radiogroup" aria-label="Data Toko Pro lama" className="flex flex-col gap-1.5">
                {daftar.map((k) => (
                  <button key={k.path} data-slot="pilih-lama" type="button" role="radio" aria-checked={pilih === k.path} onClick={() => setPilih(k.path)}
                    className={cn("flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      pilih === k.path ? "border-primary bg-accent" : "border-border bg-card hover:bg-muted/50")}>
                    <span className="text-xs font-semibold">{jenisTeks(k.jenis)} <span className="font-normal text-muted-foreground">({namaFile(k.path)})</span></span>
                    <span className="font-mono text-[11px] break-all text-muted-foreground">{k.path}</span>
                    {(k.ukuran > 0 || k.waktu) && <span className="text-[11px] text-muted-foreground tabular-nums">{[k.ukuran > 0 && ukuranTeks(k.ukuran), k.waktu].filter(Boolean).join(" · ")}</span>}
                  </button>
                ))}
              </div>
            )}
            <div><Button type="button" variant="outline" size="default" className="h-8 px-3 text-xs font-medium" onClick={() => void pilihFile()}>Pilih File Sendiri…</Button></div>
          </div>

          <p className="text-xs text-muted-foreground">Tutup dulu aplikasi Toko Pro lama sebelum memindahkan data.</p>
          {adaData && <p className="rounded-md bg-muted p-3 text-xs font-medium">Aplikasi ini sudah berisi data. Data itu akan diganti, dan program menyimpan salinannya dulu.</p>}
        </div>
      </ModalFrame>
      {msg.node}
    </>
  );
}
