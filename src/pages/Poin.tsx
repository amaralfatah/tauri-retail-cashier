import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { errText, Row } from "../api";
import { poinApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { rp, tglID } from "../format";
import { GridCol, ModalFrame, useMsgBox, useTopEscape, VbGrid } from "../vb/VbGrid";
import { Alert } from "../components/Modal";

const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;

/**
 * Transaksi Penukaran Poin. Dipakai sebagai halaman (kode pelanggan diketik) atau sebagai jendela
 * dari Cek Poin: beri `kode` dan `onClose`.
 */
export function PoinMember(props: { kode?: string; onClose?: () => void }) {
  const { go } = useApp();
  const msg = useMsgBox();
  const [kode, setKode] = useState(props.kode ?? "");
  const [member, setMember] = useState<{ kodepelanggan: string; namapelanggan: string; poin: number } | null>(null);
  const [tukar, setTukar] = useState("");
  const [catatan, setCatatan] = useState("");
  const [jml, setJml] = useState("20");
  const [hist, setHist] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [koreksi, setKoreksi] = useState(false);

  const muat = useCallback(async (k: string, n = jml) => {
    try {
      const m = await poinApi.member(k);
      if (!m) { setMember(null); setHist([]); return; }
      setMember(m);
      const h = await poinApi.histori(m.kodepelanggan, Math.max(1, Math.round(num(n)) || 20));
      setHist(Array.isArray(h) ? h : []);
    } catch (e) { setMember(null); setHist([]); msg.alert(errText(e)); }
  }, [jml]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.kode) void muat(props.kode); }, [props.kode]); // eslint-disable-line react-hooks/exhaustive-deps

  const poin = member?.poin ?? 0;
  const tukarN = num(tukar);
  const lebih = tukarN > poin;
  const tutup = props.onClose ?? (() => go("home"));
  const batal = () => { setTukar(""); setCatatan(""); };
  // Sebagai halaman, Esc menutup layar ini; sebagai jendela, ModalFrame yang mengurus Esc.
  useTopEscape(props.onClose ? undefined : tutup);

  const simpan = async () => {
    if (!member) return msg.alert("Isi dulu kode pelanggannya.");
    try {
      await poinApi.tukar(member.kodepelanggan, tukarN, catatan);
      batal();
      await muat(member.kodepelanggan);
      msg.alert("Data penukaran poin sudah tersimpan");
    } catch (e) { msg.alert(errText(e)); }
  };

  const cols: GridCol<Row>[] = [
    { title: "No", width: 42, align: "right", render: (_r, i) => i + 1 },
    { title: "No. Trans", width: 95, render: (r) => r.notukar },
    { title: "Tanggal", width: 85, render: (r) => tglID(r.tgltukar) },
    { title: "Petugas", width: 105, render: (r) => r.namakaryawan },
    { title: "Poin Awal", width: 75, align: "right", render: (r) => rp(r.poinawal) },
    { title: "Poin +", width: 70, align: "right", render: (r) => rp(r.poinmasuk) },
    { title: "Poin -", width: 70, align: "right", render: (r) => rp(r.poinkeluar) },
    { title: "Sisa Poin", width: 75, align: "right", render: (r) => rp(r.sisapoin) },
    { title: "Catatan", width: 200, render: (r) => r.ket1 },
  ];

  const peringatanLebih = tukarN > 0 && lebih && member && (
    <Alert>Jumlah penukaran melebihi sisa poin yang bisa ditukarkan.</Alert>
  );

  const isi = (
    <div className="vb-modern flex size-full min-h-0 flex-col bg-background font-sans text-xs text-foreground" data-form="FrmTransPoin">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="grid grid-cols-1 gap-2.5 rounded-md border border-border bg-card p-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1" data-vb="tPelangganKode">
          <Label className="text-xs font-medium text-foreground">Kode Pelanggan</Label>
          <Input
            value={kode}
            readOnly={!!props.kode}
            placeholder="Ketik kode lalu Enter..."
            onChange={(e) => setKode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !props.kode && kode.trim()) { e.preventDefault(); void muat(kode); } }}
            className={`h-8 text-xs ${props.kode ? "bg-muted" : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1" data-vb="tPelangganNama">
          <Label className="text-xs font-medium text-foreground">Nama Pelanggan</Label>
          <Input readOnly value={member?.namapelanggan ?? ""} className="h-8 bg-muted text-xs font-medium" />
        </div>
        <div className="flex flex-col gap-1" data-vb="tPoinJml">
          <Label className="text-xs font-medium text-foreground">Jumlah Poin Saat Ini</Label>
          <Input readOnly value={member ? rp(poin) : ""} className="h-8 bg-display text-right text-sm font-bold text-display-foreground tabular-nums" />
        </div>

        <div className="flex flex-col gap-1" data-vb="tPoinPenukaran">
          <Label className="text-xs font-medium text-foreground">Poin Ditukarkan</Label>
          <Input
            value={tukar}
            disabled={!member}
            onChange={(e) => setTukar(e.target.value)}
            placeholder="0"
            className="h-8 text-right text-xs font-semibold tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1" data-vb="tPoinCatatan">
          <Label className="text-xs font-medium text-foreground">Catatan Penukaran</Label>
          <Input
            value={catatan}
            disabled={!member}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Hadiah / potongan..."
            className="h-8 text-xs"
          />
        </div>
        <div className="flex flex-col gap-1" data-vb="tPoinSisa">
          <Label className="text-xs font-medium text-foreground">Sisa Poin</Label>
          <Input readOnly value={member ? rp(lebih ? poin : poin - tukarN) : ""} className="h-8 bg-muted text-right text-xs font-bold tabular-nums" />
        </div>
      </div>

      {peringatanLebih}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">Riwayat Poin Pelanggan</span>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Tampilkan</Label>
          <div data-vb="tJmlData">
            <Input value={jml} onChange={(e) => setJml(e.target.value)} className="h-8 w-16 text-right text-xs tabular-nums" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-vb="cRefresh"
            className="h-8 px-2.5 text-xs font-medium"
            onClick={() => (member ? void muat(member.kodepelanggan) : kode.trim() ? void muat(kode) : undefined)}
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1" data-vb="lsData">
        <VbGrid cols={cols} rows={hist} rowKey={(r) => r.notukar} selected={sel} onSelect={setSel} />
      </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cBatal" className="h-8 border-destructive/40 bg-background px-2.5 text-xs font-medium text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive" onClick={batal}>
            Batal
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cKoreksi" className="h-8 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={() => (member ? setKoreksi(true) : msg.alert("Isi dulu kode pelanggannya."))}>
            Koreksi Poin
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="cTutup" className="h-8 gap-1.5 border-foreground/20 bg-background px-2.5 text-xs font-medium text-foreground shadow-xs" onClick={tutup}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
          <Button type="button" variant="default" size="default" data-vb="cSimpan" disabled={!member} className="h-8 px-3.5 text-xs font-semibold shadow-xs" onClick={() => void simpan()}>
            Simpan
          </Button>
        </div>
      </div>

      {msg.node}
      {koreksi && member && (
        <KoreksiPoin kode={member.kodepelanggan} poin={poin} onClose={() => setKoreksi(false)}
          onSaved={() => { setKoreksi(false); void muat(member.kodepelanggan); }} />
      )}
    </div>
  );

  if (props.onClose) {
    return (
      <ModalFrame title="Transaksi Penukaran Poin" width={720} height={520} onClose={tutup}>
        {isi}
      </ModalFrame>
    );
  }
  return isi;
}

function KoreksiPoin(props: { kode: string; poin: number; onClose: () => void; onSaved: () => void }) {
  const msg = useMsgBox();
  const [baru, setBaru] = useState(String(props.poin));
  const simpan = async () => {
    try {
      await poinApi.koreksi(props.kode, num(baru));
      props.onSaved();
    } catch (e) { msg.alert(errText(e)); }
  };
  return (
    <ModalFrame title="Koreksi Poin Member" width={360} onClose={props.onClose}>
      <div className="flex flex-col gap-3.5 p-4 font-sans text-xs text-foreground" data-form="FrmTransPoinKoreksi">
        <div className="flex flex-col gap-1" data-vb="tPoinJml">
          <Label className="text-xs font-medium text-muted-foreground">Jumlah Poin Sekarang</Label>
          <Input readOnly value={rp(props.poin)} className="h-8 bg-muted text-right text-xs font-bold tabular-nums" />
        </div>
        <div className="flex flex-col gap-1" data-vb="tPoinPenukaran">
          <Label className="text-xs font-medium text-foreground">Jumlah Poin Baru</Label>
          <Input value={baru} onChange={(e) => setBaru(e.target.value)} className="h-8 text-right text-xs font-bold tabular-nums" />
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
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
    </ModalFrame>
  );
}

export const Poin = () => <PoinMember />;
