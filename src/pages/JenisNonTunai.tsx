import { useCallback, useEffect, useState } from "react";
import { errText, Row } from "../api";
import { ntApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { Bind, VbForm } from "../vb/VbForm";
import { GridCol, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { kodeUrut } from "./masterLib";
import { s, txt } from "./keuanganLib";

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

  const muat = useCallback(() => ntApi.list().then((d) => { setJenis(d.jenis); setItem(d.item); setKode((k) => k || String(d.jenis[0]?.kode ?? "")); }).catch((e) => msg.alert(errText(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void muat(); }, [muat]);

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
    msg.confirm("Apakah data akan dihapus?", async () => {
      try { await ntApi.hapusItem(kode, asli); baru(); await muat(); msg.alert("Data sudah dihapus", "Informasi"); } catch (e) { msg.alert(errText(e)); }
    }, "Konfirmasi");
  };
  // Daftar hanya berisi item milik jenis terpilih.
  const tampil = item.filter((r) => String(r.kode).toUpperCase() === kode.toUpperCase());
  const cols: GridCol<Row>[] = [
    { title: "No.", width: 40, align: "right", render: (_r, i) => i + 1 },
    { title: "Jenis Pembayaran", width: 200, render: (r) => r.namajenis },
    { title: "Nama Item Pembayaran", width: 400, render: (r) => r.namaitem },
  ];
  const pilihKode = (k: string) => { setKode(k); baru(); };
  const bind: Record<string, Bind> = {
    cJenisNama: { value: kode, onChange: pilihKode, children: <><option value="" />{jenis.map((j) => <option key={j.kode} value={j.kode}>{j.namajenis}</option>)}</> },
    cJenisKode: { value: kode, onChange: pilihKode, children: <><option value="" />{jenis.map((j) => <option key={j.kode} value={j.kode}>{j.kode}</option>)}</> },
    cTambahJenis: { onClick: () => setTambah(true) },
    tItemPembayaran: txt(nama, setNama, jenis.length === 0),
    lsData: () => (
      <VbGrid cols={cols} rows={tampil} rowKey={kunci} selected={sorot}
        onSelect={setSorot} onOpen={(r) => { setKode(r.kode); setNama(r.namaitem); setAsli(r.namaitem); setSorot(kunci(r)); }} />
    ),
    cBaru: { onClick: baru },
    cSimpan: { onClick: () => void simpan(), disabled: jenis.length === 0 },
    cHapus: { onClick: hapus },
    cTutup: { onClick: () => go("home") },
  };
  return (
    <div className="vbm-area">
      <VbForm form="FrmDataJenisNonTunaiItem" bind={bind} hide={["tTmp"]} />
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
  const muat = useCallback(() => ntApi.list().then((d) => setRows(d.jenis)).catch((e) => msg.alert(errText(e))), []); // eslint-disable-line react-hooks/exhaustive-deps
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
    msg.confirm("Apakah data akan dihapus?", async () => {
      try { await ntApi.hapusJenis(asli); baru(); await muat(); msg.alert("Data sudah dihapus", "Informasi"); } catch (e) { msg.alert(errText(e)); }
    }, "Konfirmasi");
  };
  const cols: GridCol<Row>[] = [
    { title: "No.", width: 40, align: "right", render: (_r, i) => i + 1 },
    { title: "Kode", width: 90, render: (r) => r.kode },
    { title: "Nama Jenis", width: 380, render: (r) => r.namajenis },
  ];
  const bind: Record<string, Bind> = {
    tKodeJenis: txt(kode, setKode),
    tNamaJenis: txt(nama, setNama),
    cAuto: { onClick: () => setKode(kodeUrut(rows.map((r) => s(r.kode)), "", 2)) },
    lsData: () => (
      <VbGrid cols={cols} rows={rows} rowKey={(r) => r.kode} selected={sorot} onSelect={setSorot}
        onOpen={(r) => { setKode(r.kode); setNama(r.namajenis); setAsli(r.kode); setSorot(r.kode); }} />
    ),
    cBaru: { onClick: baru },
    cSimpan: { onClick: () => void simpan() },
    cHapus: { onClick: hapus },
    cTutup: { onClick: props.onClose },
  };
  return <VbModal form="FrmDataJenisNonTunai" bind={bind} onClose={props.onClose}>{msg.node}</VbModal>;
}
