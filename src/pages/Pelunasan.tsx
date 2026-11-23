import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errText, Row } from "../api";
import { pelunasanApi } from "../api/retur";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { GridCol, useMsgBox, VbGrid } from "../vb/VbGrid";
import { CariMaster } from "./keuanganLib";

export type PelunasanJenis = "Piutang" | "Hutang";

const FORM: Record<PelunasanJenis, string> = { Piutang: "FrmTransJualPiutang", Hutang: "FrmTransBeliHutang" };
const MODE = ["Sesuai Nominal Bayar", "Per Transaksi"];

interface Kontak { kode: string; nama: string }

const angka = (t: string) => Number(t.replace(/\D/g, "")) || 0;
const n = (v: unknown) => Number(v) || 0;

/** Pelunasan piutang pelanggan atau hutang ke supplier, sebagai dialog di atas halaman yang sedang terbuka. */
/** `jatuhTempo`: dibuka dari pemberitahuan piutang jatuh tempo. */
export function Pelunasan({ jenis, jatuhTempo }: { jenis: PelunasanJenis; jatuhTempo?: boolean }) {
  const { user, go } = useApp();
  const msg = useMsgBox();
  const piutang = jenis === "Piutang";
  const [tgl, setTgl] = useState(today());
  const [kontak, setKontak] = useState<Kontak | null>(null);
  const [kartu, setKartu] = useState<Row[]>([]);
  const [mode, setMode] = useState(MODE[0]);
  const [nominal, setNominal] = useState(0);
  const [cek, setCek] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [cari, setCari] = useState(false);
  const [cariJth, setCariJth] = useState(false);
  const [kasir, setKasir] = useState<Kontak>({ kode: user.kodekaryawan, nama: user.namakaryawan });
  const [cariKasir, setCariKasir] = useState(false);

  const perTrans = mode === MODE[1];
  const total = kartu.reduce((s, k) => s + n(k.kekurangan), 0);

  // Mode "Sesuai Nominal Bayar": nominal dibagi ke kartu menurut urutan daftar (nomor kartu).
  const alokasi = useMemo(() => {
    let sisa = nominal;
    return kartu.map((k) => {
      const kurang = n(k.jmlpiutang) - n(k.jmlterbayar);
      if (sisa <= 0) return 0;
      const a = sisa > kurang ? kurang : sisa;
      sisa -= a;
      return Math.max(a, 0);
    });
  }, [kartu, nominal]);

  // Mode "Per Transaksi": kartu yang dicentang dilunasi seluruh sisanya.
  const dicek = kartu.reduce((s, k) => s + (cek.has(String(k.nopiutang)) ? n(k.kekurangan) : 0), 0);

  const muat = useCallback(async (k: Kontak | null) => {
    setNominal(0);
    setCek(new Set());
    if (!k) { setKartu([]); return; }
    try {
      const res = await pelunasanApi.kartu(jenis, k.kode);
      setKartu(Array.isArray(res) ? res : []);
    } catch (e) { msg.alert(errText(e)); }
  }, [jenis]); // eslint-disable-line react-hooks/exhaustive-deps

  const pilih = (r: Row) => {
    const k = piutang ? { kode: String(r.kodepelanggan), nama: String(r.namapelanggan) } : { kode: String(r.kodepemasok), nama: String(r.namapemasok) };
    setKontak(k);
    setCari(false);
    setCariJth(false);
    void muat(k);
  };

  // Dibuka dari pemberitahuan: satu pelanggan langsung ditampilkan piutangnya; lebih dari satu, pilih dari daftar jatuh tempo.
  useEffect(() => {
    if (!jatuhTempo || !piutang) return;
    api.pelangganJatuhTempo("").then((r) => {
      if (r.length === 1) pilih(r[0]);
      else if (r.length > 1) setCariJth(true);
      else msg.alert("Saat ini tidak ada piutang yang jatuh tempo.");
    }).catch((e) => msg.alert(errText(e)));
  }, [jatuhTempo]); // eslint-disable-line react-hooks/exhaustive-deps

  const simpanBusy = useRef(false);
  const simpan = useCallback(async () => {
    if (simpanBusy.current) return;
    if ((perTrans ? dicek : nominal) <= 0) return msg.alert("Jumlah pelunasan masih kosong");
    if (!kontak) return msg.alert(`Silakan pilih ${piutang ? "pelanggan" : "supplier"} dulu.`);
    simpanBusy.current = true;
    try {
      await pelunasanApi.simpan({
        jenis, kode: kontak.kode, tgl, kodekaryawan: kasir.kode,
        mode: perTrans ? "transaksi" : "nominal", nominal, kartu: perTrans ? [...cek] : [],
      });
      msg.alert("Data pelunasan sudah tersimpan.");
      await muat(kontak);
    } catch (e) {
      msg.alert(errText(e));
    } finally {
      simpanBusy.current = false;
    }
  }, [kontak, perTrans, dicek, nominal, cek, kasir, jenis, tgl, piutang, msg, muat]);

  const batal = useCallback(() => {
    setKartu([]); setNominal(0); setCek(new Set()); setSel(null); setTgl(today()); setMode(MODE[0]);
    setKasir({ kode: user.kodekaryawan, nama: user.namakaryawan });
  }, [user]);

  const toggleCek = useCallback((no: string) => {
    setCek((s) => {
      const t = new Set(s);
      if (t.has(no)) t.delete(no);
      else t.add(no);
      return t;
    });
  }, []);

  const nomor: GridCol<Row> = { title: "No.", width: 48, align: "right", render: (_r, i) => i + 1 };
  const kolom = (terbayar: (r: Row, i: number) => number): GridCol<Row>[] => [
    { title: piutang ? "No. Piutang" : "No. Hutang", width: 110, render: (r) => r.nopiutang },
    { title: "No. Trans", width: 110, render: (r) => r.noreftrans },
    { title: "Jth. Tempo", width: 85, render: (r) => tglID(r.jthtempo) },
    { title: piutang ? "Piutang" : "Hutang", width: 100, align: "right", render: (r) => rp(r.jmlpiutang) },
    { title: "Terbayar", width: 100, align: "right", render: (r, i) => rp(n(r.jmlterbayar) + terbayar(r, i)) },
    { title: "Kekurangan", width: 100, align: "right", render: (r) => rp(r.kekurangan) },
  ];
  const kolomNominal = [nomor, ...kolom((_r, i) => alokasi[i] ?? 0)];
  const kolomCek: GridCol<Row>[] = [
    {
      title: "", width: 42, align: "center",
      render: (r) => {
        const no = String(r.nopiutang);
        return (
          <Checkbox
            checked={cek.has(no)}
            onCheckedChange={(v) => setCek((s) => { const t = new Set(s); if (v) t.add(no); else t.delete(no); return t; })}
          />
        );
      },
    },
    ...kolom((r) => (cek.has(String(r.nopiutang)) ? n(r.kekurangan) : 0)),
  ];

  const terbuka = cari || cariKasir || !!msg.node;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (terbuka) return;
      if (e.key === "Escape") { e.preventDefault(); go("home"); }
      else if (e.key === "F4" || (e.altKey && e.code === "KeyS")) { e.preventDefault(); void simpan(); }
      else if (e.key === "F1" || (e.altKey && e.code === "KeyB")) { e.preventDefault(); batal(); }
      else if (e.altKey && e.code === "Digit1") { e.preventDefault(); document.querySelector<HTMLElement>('[data-vb="dtTglTrans"] input')?.focus(); }
      else if (e.altKey && e.code === "Digit2") { e.preventDefault(); if (user.level.toUpperCase() !== "KASIR") setCariKasir(true); }
      else if (e.altKey && e.code === "Digit3") { e.preventDefault(); setCari(true); }
      else if (e.altKey && e.code === "KeyT") { e.preventDefault(); document.querySelector<HTMLElement>(".vbg")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isKasir = user.level.toUpperCase() === "KASIR";
  const jumlahBayar = perTrans ? dicek : nominal;

  return (
    <div className="vb-modern flex size-full min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground" data-form={FORM[jenis]}>
      <div className="grid grid-cols-2 items-end gap-3 border-b bg-background px-3 py-1.5 sm:grid-cols-4">
        <div className="flex flex-col gap-1" data-vb="dtTglTrans">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Tgl. Transaksi</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+1</span>
          </Label>
          <Input type="date" value={tgl} onChange={(e) => e.target.value && setTgl(e.target.value)} className="border-foreground/20 bg-background pr-1.5 text-foreground tabular-nums" />
        </div>
        <div className="flex flex-col gap-1" data-vb="tKasirNama">
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>Kasir</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+2</span>
          </Label>
          <InputGroup className={isKasir ? "border-transparent bg-muted" : "border-foreground/20 bg-background"}>
            <InputGroupInput readOnly value={kasir.nama} className="cursor-default font-medium text-foreground" />
            {!isKasir && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Pilih kasir" data-vb="cCariKasir" className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setCariKasir(true)}>
                  <SearchIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb={piutang ? "tPelangganNama" : "tPemasokNama"}>
          <Label className="flex items-center justify-between text-xs font-medium text-foreground">
            <span>{piutang ? "Pelanggan" : "Supplier"}</span>
            <span className="text-[11px] font-normal text-muted-foreground">Alt+3</span>
          </Label>
          <InputGroup className="border-foreground/20 bg-background">
            <InputGroupInput readOnly value={kontak?.nama ?? ""} placeholder={piutang ? "Pilih pelanggan..." : "Pilih supplier..."} className="cursor-default font-medium text-foreground" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Pilih kontak" data-vb={piutang ? "cCariPelanggan" : "cCariPemasok"} className="text-foreground/70 hover:bg-accent hover:text-primary" onClick={() => setCari(true)}>
                <SearchIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1" data-vb="cModeBayar">
          <Label className="text-xs font-medium text-foreground">Mode Pembayaran</Label>
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)} className="w-full">
            {MODE.map((m) => <NativeSelectOption key={m} value={m}>{m}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-display px-4 py-2 text-display-foreground">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">
              {perTrans ? "Dipilih / Total" : "Jml. Kartu"}
            </span>
            <span className="text-2xl leading-none font-bold tabular-nums">
              {perTrans ? `${cek.size} / ${kartu.length}` : kartu.length}
            </span>
          </div>
          <div className="h-8 w-px bg-display-foreground/15" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium tracking-wider text-display-foreground/65 uppercase">
              {piutang ? "Piutang Pelanggan" : "Hutang Supplier"}
            </span>
            <span className="text-sm font-semibold text-display-foreground/90">
              {kontak
                ? `${kontak.nama} · ${perTrans ? "Centang transaksi yang dilunasi (Enter/klik ganda)" : "Isi nominal pelunasan di bawah"} · Alt+T ke tabel`
                : `Tekan Alt+3 untuk memilih ${piutang ? "pelanggan" : "supplier"}`}
            </span>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-display-foreground/70 lg:text-base">Rp</span>
          <span className="text-3xl leading-none font-bold tracking-tight tabular-nums lg:text-[2.5rem]">{rp(jumlahBayar > 0 ? jumlahBayar : total)}</span>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-muted/20 p-2.5" data-vb={perTrans ? "lsData" : "tdDetail"}>
        {perTrans ? (
          <VbGrid
            cols={kolomCek}
            rows={kartu}
            rowKey={(r) => String(r.nopiutang)}
            selected={sel}
            onSelect={setSel}
            onOpen={(r) => toggleCek(String(r.nopiutang))}
          />
        ) : (
          <VbGrid
            cols={kolomNominal}
            rows={kartu}
            rowKey={(r) => String(r.nopiutang)}
            selected={sel}
            onSelect={setSel}
          />
        )}
        {kartu.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 px-6 text-center text-sm text-muted-foreground">
            {kontak
              ? (piutang ? "Pelanggan ini tidak punya piutang yang belum lunas." : "Anda tidak punya hutang yang belum lunas ke supplier ini.")
              : (piutang ? "Pilih pelanggan dulu untuk melihat piutangnya." : "Pilih supplier dulu untuk melihat hutangnya.")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 border-t border-border bg-card px-3 py-2 sm:grid-cols-3">
        <div className="flex flex-col gap-1" data-vb={perTrans ? "tTotal" : "tTotalPiutang"}>
          <Label className="text-xs font-medium text-muted-foreground">Total {jenis}</Label>
          <Input readOnly value={rp(perTrans ? dicek : total)} className="h-8 bg-muted text-right text-sm font-bold tabular-nums" />
        </div>
        <div className="flex flex-col gap-1" data-vb={perTrans ? "tJmlBayar" : "tPelunasan"}>
          <Label className="text-xs font-medium text-foreground">Jml. Pelunasan</Label>
          {perTrans ? (
            <Input readOnly value={rp(dicek)} className="h-8 bg-muted text-right text-sm font-bold tabular-nums" />
          ) : (
            <Input
              value={rp(nominal)}
              onChange={(e) => setNominal(angka(e.target.value))}
              className="h-8 border-foreground/25 bg-background text-right text-sm font-bold tabular-nums"
            />
          )}
        </div>
        <div className="flex flex-col gap-1" data-vb={perTrans ? "tJmlSisa" : "tSisa"}>
          <Label className="text-xs font-medium text-muted-foreground">Kekurangan / Sisa</Label>
          <Input readOnly value={perTrans ? "0" : rp(nominal - total)} className="h-8 bg-muted text-right text-sm font-bold tabular-nums" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive" onClick={batal}>
            <span>Batal</span>
            <Kbd className="border border-destructive/35 bg-destructive/10 text-destructive">F1</Kbd>
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => go("home")}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" className="h-8 gap-1.5 px-3.5 text-xs font-semibold shadow-xs" onClick={() => void simpan()}>
            <span>Simpan</span>
            <Kbd className="border border-primary-foreground/30 bg-primary-foreground/20 text-primary-foreground">F4</Kbd>
          </Button>
        </div>
      </div>

      {msg.node}
      {(cari || cariJth) && <CariMaster table={piutang ? "mdpelanggan" : "mdpemasok"} jthTempo={piutang} awalJthTempo={cariJth} onPick={pilih} onClose={() => { setCari(false); setCariJth(false); }} />}
      {cariKasir && (
        <CariMaster table="mdkaryawan" onClose={() => setCariKasir(false)}
          onPick={(r) => { setKasir({ kode: String(r.kodekaryawan), nama: String(r.namakaryawan) }); setCariKasir(false); }} />
      )}
    </div>
  );
}
