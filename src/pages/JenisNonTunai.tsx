import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { errText, Row } from "../api";
import { ntApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { rp } from "../format";
import { GridCol, ModalFrame, ToolItem, useMsgBox, useTopEscape, VbGrid, VbToolbar } from "../vb/VbGrid";
import { useDaftarFile } from "./daftarFile";
import { GridKosong, HAPUS_MERAH, kodeUrut } from "./masterLib";
import { s } from "./keuanganLib";

const kunci = (r: Row) => `${r.kode}|${r.namaitem}`;

/** Data Jenis & Item Pembayaran Non Tunai (misalnya Kartu Debit → BCA, E-Wallet → QRIS). */
export function JenisNonTunai() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [jenis, setJenis] = useState<Row[]>([]);
  const [item, setItem] = useState<Row[]>([]);
  const [filterJenis, setFilterJenis] = useState("");
  const [cari, setCari] = useState("");
  const [cariTunda, setCariTunda] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ kode: string; nama: string; isNew: boolean } | null>(null);
  const [kelolaJenis, setKelolaJenis] = useState(false);
  const cariRef = useRef<HTMLInputElement>(null);

  const muat = useCallback(() => ntApi.list().then((d) => {
    setJenis(Array.isArray(d?.jenis) ? d.jenis : []);
    setItem(Array.isArray(d?.item) ? d.item : []);
  }).catch((e) => msg.alert(errText(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void muat(); }, [muat]);

  useEffect(() => {
    const id = window.setTimeout(() => setCariTunda(cari.trim().toLowerCase()), 200);
    return () => window.clearTimeout(id);
  }, [cari]);

  const rows = useMemo(() => item.filter((r) => {
    if (filterJenis && String(r.kode).toUpperCase() !== filterJenis.toUpperCase()) return false;
    if (!cariTunda) return true;
    return [r.kode, r.namajenis, r.namaitem].some((v) => String(v ?? "").toLowerCase().includes(cariTunda));
  }), [item, filterJenis, cariTunda]);

  const current = rows.find((r) => kunci(r) === sel);
  useTopEscape(() => { if (cari) { setCari(""); setCariTunda(""); } else go("home"); });

  const openNew = useCallback(() => {
    const defaultKode = filterJenis || String(jenis[0]?.kode ?? "");
    setEdit({ kode: defaultKode, nama: "", isNew: true });
  }, [filterJenis, jenis]);

  const openEdit = (r?: Row) => {
    if (!r) return;
    setEdit({ kode: String(r.kode ?? ""), nama: String(r.namaitem ?? ""), isNew: false });
  };

  const hapusRow = (target?: Row) => {
    const row = target ?? current;
    if (!row) return;
    const nm = String(row.namaitem ?? "");
    msg.confirm(`Hapus item ${nm}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await ntApi.hapusItem(String(row.kode ?? ""), nm);
        setSel(null);
        await muat();
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Hapus item pembayaran", undefined, true);
  };

  const modalOpen = !!(edit || kelolaJenis);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        cariRef.current?.focus();
        cariRef.current?.select();
      } else if (!modalOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openNew();
      } else if (!modalOpen && e.key === "F5") {
        e.preventDefault();
        void muat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, openNew, muat]);

  const cols = useMemo<GridCol<Row>[]>(() => [
    { title: "No", width: 48, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode Jenis", width: 95, render: (r) => r.kode },
    { title: "Jenis Pembayaran", width: 200, render: (r) => r.namajenis },
    { title: "Nama Item Pembayaran", width: 360, render: (r) => r.namaitem },
  ], []);

  const file = useDaftarFile("Data Jenis Non Tunai", cols, rows, msg, "Jenis Non Tunai");

  const toolItems: ToolItem[] = [
    { caption: "Baru", onClick: openNew },
    { caption: "Edit", onClick: () => openEdit(current) },
    { caption: "Hapus", onClick: () => hapusRow(current) },
    { caption: "Refresh", onClick: () => void muat(), sepBefore: true },
    { caption: "Export", onClick: () => void file.ekspor(), sepBefore: true },
    { caption: "Cetak", onClick: () => void file.cetak() },
    { caption: "Kelola Jenis", onClick: () => setKelolaJenis(true), sepBefore: true },
    { caption: "Tutup", onClick: () => go("home"), sepBefore: true },
  ];

  const isFiltered = Boolean(cariTunda || filterJenis);
  const kosongTeks = isFiltered
    ? "Tidak ada item pembayaran yang cocok. Ubah kata kunci atau filternya."
    : "Belum ada item pembayaran non tunai. Klik Baru untuk menambah.";

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col bg-background font-sans text-foreground" data-form="FrmDataJenisNonTunaiItem">
      <div data-vb="tbMenu">
        <VbToolbar items={toolItems} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2" data-vb="cJenisNama">
          <Label className="text-xs font-semibold text-foreground">Jenis Pembayaran</Label>
          <NativeSelect value={filterJenis} onChange={(e) => setFilterJenis(e.target.value)} className="w-56">
            <NativeSelectOption value="">Semua Jenis</NativeSelectOption>
            {jenis.map((j) => (
              <NativeSelectOption key={j.kode} value={j.kode}>
                {j.namajenis} ({j.kode})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="ml-auto flex items-center gap-2" data-vb="tCari">
          <Input
            ref={cariRef}
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari nama item atau jenis…"
            aria-label="Cari item non tunai"
            className="h-8 w-72"
          />
          <Kbd className="border border-border bg-card text-foreground">Ctrl+F</Kbd>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-2.5" data-vb="lsData">
        <GridKosong kosong={rows.length === 0} teks={kosongTeks}>
          <VbGrid
            cols={cols}
            rows={rows}
            rowKey={kunci}
            selected={sel}
            onSelect={setSel}
            onOpen={openEdit}
            onDelete={hapusRow}
          />
        </GridKosong>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground" data-vb="lblTotal">
        <span className="tabular-nums">
          Jumlah Data : {rp(rows.length)}
          {isFiltered && rows.length !== item.length && (
            <span className="ml-1 font-normal text-muted-foreground">dari {rp(item.length)}</span>
          )}
        </span>
        {current ? (
          <span className="truncate text-muted-foreground">
            Terpilih: <strong className="text-foreground">{current.namajenis} — {current.namaitem}</strong>
          </span>
        ) : (
          <span className="truncate font-normal text-muted-foreground">
            ↑↓←→ Navigasi · Enter/F2 Ubah · Del Hapus · Ctrl+C Salin
          </span>
        )}
      </div>

      {msg.node}
      {file.node}
      {edit && (
        <ItemNonTunaiEdit
          jenis={jenis}
          kodeAwal={edit.kode}
          namaAwal={edit.nama}
          isNew={edit.isNew}
          onReload={() => void muat()}
          onClose={() => setEdit(null)}
          onChanged={(k) => { setSel(k); void muat(); }}
        />
      )}
      {kelolaJenis && <JenisForm onClose={() => { setKelolaJenis(false); void muat(); }} />}
    </div>
  );
}

/** Modal tambah / edit item pembayaran non tunai (konsisten dengan SimpleEdit / PartyEdit). */
function ItemNonTunaiEdit(props: {
  jenis: Row[];
  kodeAwal: string;
  namaAwal: string;
  isNew: boolean;
  onReload: () => void;
  onClose: () => void;
  onChanged: (key: string | null) => void;
}) {
  const [kode, setKode] = useState(props.kodeAwal);
  const [nama, setNama] = useState(props.namaAwal);
  const [asli, setAsli] = useState<string | null>(props.isNew ? null : props.namaAwal);
  const [tambahJenis, setTambahJenis] = useState(false);
  const msg = useMsgBox();

  useEffect(() => {
    if (!kode && props.jenis.length > 0) setKode(String(props.jenis[0].kode ?? ""));
  }, [kode, props.jenis]);

  const simpan = async () => {
    if (!kode.trim()) return msg.alert("Jenis pembayaran belum dipilih.", "Informasi");
    if (!nama.trim()) return msg.alert("Nama item pembayaran belum diisi.", "Informasi");
    try {
      await ntApi.simpanItem(kode, nama.trim(), asli);
      props.onChanged(`${kode}|${nama.trim()}`);
      setAsli(null);
      setNama("");
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const hapus = () => {
    if (!asli) return;
    msg.confirm(`Hapus item ${asli}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await ntApi.hapusItem(kode, asli);
        setAsli(null);
        setNama("");
        props.onChanged(null);
        msg.alert("Data sudah dihapus.", "Informasi");
      } catch (e) {
        msg.alert(errText(e));
      }
    }, "Hapus item pembayaran", undefined, true);
  };

  return (
    <ModalFrame
      title={asli ? `Edit Item Pembayaran — ${asli}` : "Tambah Item Pembayaran Non Tunai"}
      width={480}
      onClose={props.onClose}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5">
            <Button type="button" variant="outline" className={`h-8 text-xs ${HAPUS_MERAH}`} data-vb="cHapus" disabled={!asli} onClick={hapus}>
              Hapus
            </Button>
            <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cBaru" onClick={() => { setAsli(null); setNama(""); }}>
              Baru
            </Button>
          </div>
          <Button type="button" variant="outline" className="h-8 text-xs" data-vb="cTutup" onClick={props.onClose}>
            Tutup <Kbd>Esc</Kbd>
          </Button>
          <Button type="button" className="h-8 px-4 text-xs font-semibold" data-vb="cSimpan" disabled={props.jenis.length === 0} onClick={() => void simpan()}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1" data-vb="cJenisNama">
          <Label htmlFor="nt-jenis" className="text-xs text-muted-foreground">
            Jenis Pembayaran <span className="text-destructive">*</span>
          </Label>
          <div className="flex gap-1.5">
            <NativeSelect
              id="nt-jenis"
              size="sm"
              className="min-w-0 flex-1"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
            >
              <NativeSelectOption value="">— Pilih Jenis —</NativeSelectOption>
              {props.jenis.map((j) => (
                <NativeSelectOption key={j.kode} value={j.kode}>
                  {j.namajenis} ({j.kode})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs font-semibold" data-vb="cTambahJenis" onClick={() => setTambahJenis(true)}>
              +
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1" data-vb="tItemPembayaran">
          <Label htmlFor="nt-nama" className="text-xs text-muted-foreground">
            Nama Item Pembayaran (Bank / Kartu / QRIS) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="nt-nama"
            autoFocus
            value={nama}
            disabled={props.jenis.length === 0}
            onChange={(e) => setNama(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void simpan(); } }}
            placeholder="Contoh: BCA, Mandiri, QRIS…"
            className="h-8 text-xs"
          />
        </div>
      </div>
      {msg.node}
      {tambahJenis && <JenisForm onClose={() => { setTambahJenis(false); props.onReload(); }} />}
    </ModalFrame>
  );
}

/** Modal kelola Jenis Pembayaran Non Tunai (misalnya Kartu Debit, E-Wallet). */
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
      msg.alert("Data sudah tersimpan.", "Informasi");
    } catch (e) { msg.alert(errText(e)); }
  };
  const hapus = () => {
    if (!asli) return;
    msg.confirm(`Hapus jenis pembayaran ${nama.trim() || asli}? Data yang sudah dihapus tidak bisa dikembalikan.`, async () => {
      try { await ntApi.hapusJenis(asli); baru(); await muat(); msg.alert("Data sudah dihapus.", "Informasi"); } catch (e) { msg.alert(errText(e)); }
    }, "Hapus jenis pembayaran", undefined, true);
  };
  const cols: GridCol<Row>[] = [
    { title: "No", width: 48, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 95, render: (r) => r.kode },
    { title: "Nama Jenis", width: 340, render: (r) => r.namajenis },
  ];

  return (
    <ModalFrame title="Kelola Jenis Pembayaran Non Tunai" width={540} height={420} onClose={props.onClose}>
      <div className="vb-modern flex size-full min-h-0 flex-col justify-between gap-3 bg-background p-3 font-sans text-xs text-foreground" data-form="FrmDataJenisNonTunai">
        <div className="grid grid-cols-1 items-end gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[150px_1fr]">
          <div className="flex flex-col gap-1" data-vb="tKodeJenis">
            <Label className="text-xs text-muted-foreground">Kode Jenis <span className="text-destructive">*</span></Label>
            <InputGroup className="h-8">
              <InputGroupInput value={kode} onChange={(e) => setKode(e.target.value)} className="font-mono text-xs" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton data-vb="cAuto" onClick={() => setKode(kodeUrut(rows.map((r) => s(r.kode)), "", 2))}>
                  Auto
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="flex flex-col gap-1" data-vb="tNamaJenis">
            <Label className="text-xs text-muted-foreground">Nama Jenis Pembayaran <span className="text-destructive">*</span></Label>
            <Input
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void simpan(); } }}
              className="h-8 text-xs"
            />
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
            <Button type="button" variant="outline" size="default" data-vb="cHapus" className={`h-8 bg-background px-3 text-xs font-medium ${HAPUS_MERAH}`} disabled={!asli} onClick={hapus}>
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
