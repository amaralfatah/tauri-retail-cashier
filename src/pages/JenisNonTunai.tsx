import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { errText, Row } from "../api";
import { ntApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { GridCol, ModalFrame, useMsgBox, useTopEscape, VbGrid } from "../vb/VbGrid";
import { GridKosong, HAPUS_MERAH, kodeUrut } from "./masterLib";
import { s } from "./keuanganLib";

/** Item Pembayaran Non Tunai (misalnya BCA, QRIS). Tombol "+" membuka daftar Jenis Pembayaran Non Tunai. */
export function JenisNonTunai() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [jenis, setJenis] = useState<Row[]>([]);
  const [item, setItem] = useState<Row[]>([]);
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [asli, setAsli] = useState<string | null>(null);
  const [tambah, setTambah] = useState(false);
  const [sorot, setSorot] = useState<string | null>(null);

  const muat = useCallback(() => ntApi.list().then((d) => {
    const jList = Array.isArray(d?.jenis) ? d.jenis : [];
    const iList = Array.isArray(d?.item) ? d.item : [];
    setJenis(jList);
    setItem(iList);
    setKode((k) => k || String(jList[0]?.kode ?? ""));
  }).catch((e) => msg.alert(errText(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void muat(); }, [muat]);

  useTopEscape(() => go("home"));
  const kunci = (r: Row) => `${r.kode}|${r.namaitem}`;
  const baru = () => { setAsli(null); setNama(""); };
  const simpan = async () => {
    try {
      await ntApi.simpanItem(kode, nama, asli);
      setAsli(nama.trim());
      await muat();
      msg.alert("Data sudah tersimpan", "Informasi");
    } catch (e) { msg.alert(errText(e)); }
  };
  const hapus = () => {
    if (!asli) return;
    msg.confirm(`Hapus item ${asli}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try { await ntApi.hapusItem(kode, asli); baru(); await muat(); msg.alert("Data sudah dihapus", "Informasi"); } catch (e) { msg.alert(errText(e)); }
    }, "Hapus item pembayaran", undefined, true);
  };
  const tampil = item.filter((r) => String(r.kode).toUpperCase() === kode.toUpperCase());
  const cols: GridCol<Row>[] = [
    { title: "No.", width: 45, align: "right", render: (_r, i) => i + 1 },
    { title: "Jenis Pembayaran", width: 200, render: (r) => r.namajenis },
    { title: "Nama Item Pembayaran", width: 360, render: (r) => r.namaitem },
  ];
  const pilihKode = (k: string) => { setKode(k); baru(); };

  return (
    <div className="vb-modern flex size-full min-h-0 flex-col justify-between gap-3 bg-background p-3 font-sans text-xs text-foreground" data-form="FrmDataJenisNonTunaiItem">
      <div className="grid grid-cols-1 items-end gap-2.5 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_110px_auto]">
        <div className="flex flex-col gap-1" data-vb="cJenisNama">
          <Label className="text-xs font-medium text-foreground">Jenis Pembayaran</Label>
          <NativeSelect value={kode} onChange={(e) => pilihKode(e.target.value)} className="w-full">
            <NativeSelectOption value="" />
            {jenis.map((j) => <NativeSelectOption key={j.kode} value={j.kode}>{j.namajenis}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1" data-vb="cJenisKode">
          <Label className="text-xs font-medium text-foreground">Kode Jenis</Label>
          <NativeSelect value={kode} onChange={(e) => pilihKode(e.target.value)} className="w-full">
            <NativeSelectOption value="" />
            {jenis.map((j) => <NativeSelectOption key={j.kode} value={j.kode}>{j.kode}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <Button type="button" variant="outline" size="default" data-vb="cTambahJenis" className="h-7 px-3 text-xs font-semibold" onClick={() => setTambah(true)}>
          + Jenis
        </Button>
        <div className="flex flex-col gap-1 sm:col-span-3" data-vb="tItemPembayaran">
          <Label className="text-xs font-medium text-foreground">Nama Item Pembayaran (Bank / Kartu / QRIS)</Label>
          <Input
            value={nama}
            disabled={jenis.length === 0}
            onChange={(e) => setNama(e.target.value)}
            placeholder="Contoh: BCA, Mandiri, QRIS..."
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1" data-vb="lsData">
        <GridKosong kosong={tampil.length === 0} teks="Belum ada item. Pilih jenis pembayaran, ketik nama item, lalu klik Simpan.">
        <VbGrid
          cols={cols}
          rows={tampil}
          rowKey={kunci}
          selected={sorot}
          onSelect={setSorot}
          onOpen={(r) => { setKode(r.kode); setNama(r.namaitem); setAsli(r.namaitem); setSorot(kunci(r)); }}
        />
        </GridKosong>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cHapus" className={`h-8 bg-background px-3 text-xs font-medium ${HAPUS_MERAH}`} onClick={hapus}>
            Hapus
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cBaru" className="h-8 px-3 text-xs font-medium" onClick={baru}>
            Baru
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 px-2.5 text-xs font-medium" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" disabled={jenis.length === 0} className="h-8 px-4 text-xs font-semibold" onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>

      {msg.node}
      {tambah && <JenisForm onClose={() => { setTambah(false); void muat(); }} />}
    </div>
  );
}

/** Jenis Pembayaran Non Tunai (misalnya Kartu Debit, E-Wallet). */
function JenisForm(props: { onClose: () => void }) {
  const msg = useMsgBox();
  const [rows, setRows] = useState<Row[]>([]);
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [asli, setAsli] = useState<string | null>(null);
  const [sorot, setSorot] = useState<string | null>(null);
  const muat = useCallback(() => ntApi.list().then((d) => setRows(Array.isArray(d?.jenis) ? d.jenis : [])).catch((e) => msg.alert(errText(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void muat(); }, [muat]);

  const baru = () => { setAsli(null); setKode(""); setNama(""); };
  const simpan = async () => {
    try {
      await ntApi.simpanJenis(kode, nama, asli);
      setAsli(kode.trim());
      await muat();
      msg.alert("Data sudah tersimpan", "Informasi");
    } catch (e) { msg.alert(errText(e)); }
  };
  const hapus = () => {
    if (!asli) return;
    msg.confirm(`Hapus jenis pembayaran ${nama.trim() || asli}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try { await ntApi.hapusJenis(asli); baru(); await muat(); msg.alert("Data sudah dihapus", "Informasi"); } catch (e) { msg.alert(errText(e)); }
    }, "Hapus jenis pembayaran", undefined, true);
  };
  const cols: GridCol<Row>[] = [
    { title: "No.", width: 45, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 95, render: (r) => r.kode },
    { title: "Nama Jenis", width: 340, render: (r) => r.namajenis },
  ];

  return (
    <ModalFrame title="Data Jenis Pembayaran Non Tunai" width={540} height={420} onClose={props.onClose}>
      <div className="vb-modern flex size-full min-h-0 flex-col justify-between gap-3 bg-background p-3 font-sans text-xs text-foreground" data-form="FrmDataJenisNonTunai">
        <div className="grid grid-cols-1 items-end gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[120px_auto_1fr]">
          <div className="flex flex-col gap-1" data-vb="tKodeJenis">
            <Label className="text-xs font-medium text-foreground">Kode Jenis</Label>
            <Input value={kode} readOnly={false} onChange={(e) => setKode(e.target.value)} className="h-7 bg-background text-xs" />
          </div>
          <Button type="button" variant="outline" size="sm" data-vb="cAuto" className="h-7 px-2.5 text-xs font-medium" onClick={() => setKode(kodeUrut(rows.map((r) => s(r.kode)), "", 2))}>
            Kode otomatis
          </Button>
          <div className="flex flex-col gap-1" data-vb="tNamaJenis">
            <Label className="text-xs font-medium text-foreground">Nama Jenis Pembayaran</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} className="h-7 text-xs" />
          </div>
        </div>

        <div className="min-h-0 flex-1" data-vb="lsData">
          <GridKosong kosong={rows.length === 0} teks="Belum ada jenis pembayaran. Isi kode dan nama, lalu klik Simpan.">
          <VbGrid
            cols={cols}
            rows={rows}
            rowKey={(r) => r.kode}
            selected={sorot}
            onSelect={setSorot}
            onOpen={(r) => { setKode(r.kode); setNama(r.namajenis); setAsli(r.kode); setSorot(r.kode); }}
          />
          </GridKosong>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-2">
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="default" data-vb="cHapus" className={`h-8 bg-background px-3 text-xs font-medium ${HAPUS_MERAH}`} onClick={hapus}>
              Hapus
            </Button>
            <Button type="button" variant="outline" size="default" data-vb="cBaru" className="h-8 px-3 text-xs font-medium" onClick={baru}>
              Baru
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 px-2.5 text-xs font-medium" onClick={props.onClose}>
              <span>Tutup</span>
              <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
            </Button>
            <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 px-4 text-xs font-semibold" onClick={() => void simpan()}>
              Simpan
            </Button>
          </div>
        </div>
        {msg.node}
      </div>
    </ModalFrame>
  );
}
