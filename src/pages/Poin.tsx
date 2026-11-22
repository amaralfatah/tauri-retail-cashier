import { useCallback, useEffect, useState } from "react";
import { errText, Row } from "../api";
import { poinApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { rp, tglID } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { txt } from "./keuanganLib";

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
      setMember(m);
      setHist(await poinApi.histori(m.kodepelanggan, Math.max(1, Math.round(num(n)) || 20)));
    } catch (e) { setMember(null); setHist([]); msg.alert(errText(e)); }
  }, [jml]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.kode) void muat(props.kode); }, [props.kode]); // eslint-disable-line react-hooks/exhaustive-deps

  const poin = member?.poin ?? 0;
  const tukarN = num(tukar);
  const lebih = tukarN > poin;
  const tutup = props.onClose ?? (() => go("home"));
  const batal = () => { setTukar(""); setCatatan(""); };

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
    { title: "No.Trans", width: 90, render: (r) => r.notukar },
    { title: "Tanggal", width: 75, render: (r) => tglID(r.tgltukar) },
    { title: "Petugas", width: 100, render: (r) => r.namakaryawan },
    { title: "Poin Awal", width: 65, align: "right", render: (r) => rp(r.poinawal) },
    { title: "Poin +", width: 60, align: "right", render: (r) => rp(r.poinmasuk) },
    { title: "Poin -", width: 60, align: "right", render: (r) => rp(r.poinkeluar) },
    { title: "Sisa Poin", width: 65, align: "right", render: (r) => rp(r.sisapoin) },
    { title: "Catatan", width: 200, render: (r) => r.ket1 },
  ];
  const bind: Record<string, Bind> = {
    tPelangganKode: props.kode
      ? txt(kode, undefined, true)
      : { value: kode, onChange: setKode },
    tPelangganNama: txt(member?.namapelanggan, undefined, true),
    tPoinJml: txt(member ? rp(poin) : "", undefined, true),
    tPoinPenukaran: txt(tukar, setTukar, !member),
    tPoinCatatan: txt(catatan, setCatatan, !member),
    tPoinSisa: txt(member ? rp(lebih ? poin : poin - tukarN) : "", undefined, true),
    tJmlData: txt(jml, setJml),
    cRefresh: { onClick: () => (member ? void muat(member.kodepelanggan) : kode.trim() ? void muat(kode) : undefined) },
    lsData: () => <VbGrid cols={cols} rows={hist} rowKey={(r) => r.notukar} selected={sel} onSelect={setSel} />,
    cSimpan: { onClick: () => void simpan(), disabled: !member },
    cKoreksi: { onClick: () => (member ? setKoreksi(true) : msg.alert("Isi dulu kode pelanggannya.")) },
    cBatal: { onClick: batal },
    cTutup: { onClick: tutup },
  };
  // Enter di kolom kode memuat pelanggan.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !props.kode && (e.target as HTMLElement).closest('[data-vb="tPelangganKode"]') && kode.trim()) void muat(kode);
  };
  const isi = (
    <div onKeyDown={onKey}>
      <VbForm form="FrmTransPoin" bind={bind} />
      {tukarN > 0 && lebih && member && <div className="vbm-msg" style={{ color: "#a00" }}>Jumlah penukaran melebihi sisa poin yang bisa ditukarkan.</div>}
      {msg.node}
      {koreksi && member && (
        <KoreksiPoin kode={member.kodepelanggan} poin={poin} onClose={() => setKoreksi(false)}
          onSaved={() => { setKoreksi(false); void muat(member.kodepelanggan); }} />
      )}
    </div>
  );
  if (props.onClose) return <VbModal form="FrmTransPoin" bind={bind} onClose={tutup}>{tukarN > 0 && lebih && <div className="vbm-msg" style={{ color: "#a00" }}>Jumlah penukaran melebihi sisa poin yang bisa ditukarkan.</div>}{msg.node}{koreksi && member && <KoreksiPoin kode={member.kodepelanggan} poin={poin} onClose={() => setKoreksi(false)} onSaved={() => { setKoreksi(false); void muat(member.kodepelanggan); }} />}</VbModal>;
  return <div className="vbm-area">{isi}</div>;
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
  const bind: Record<string, Bind> = {
    tPoinJml: txt(rp(props.poin), undefined, true),
    tPoinPenukaran: txt(baru, setBaru),
    cSimpan: { onClick: () => void simpan() },
    cTutup: { onClick: props.onClose },
  };
  return <VbModal form="FrmTransPoinKoreksi" bind={bind} onClose={props.onClose}>{msg.node}</VbModal>;
}

export const Poin = () => <PoinMember />;
