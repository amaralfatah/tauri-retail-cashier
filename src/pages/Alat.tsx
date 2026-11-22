import { useEffect, useMemo, useState } from "react";
import { errText, Row } from "../api";
import { alatApi, dbApi, FileBackup, folderBackup, HasilSql, imporApi } from "../api/keuangan";
import { useApp } from "../appContext";
import { rp, tglID, today } from "../format";
import { Bind, VbForm } from "../vb/VbForm";
import { GridCol, ModalFrame, useMsgBox, VbGrid, VbModal } from "../vb/VbGrid";
import { ImporExcel } from "./ImporExcel";
import { Checklist, opsi, txt } from "./keuanganLib";
import "./alat.css";

const TABS = ["Backup Data", "Restore Data", "Hapus Data", "Import Data", "SQL Editor", "Repair Data", "Hapus Transaksi"];
const BERDASAR_TANGGAL = new Set(["jual", "beli", "opname", "stokawal", "piutang", "hutang", "kas"]);
const JENIS_TRANS = ["Penjualan", "Retur Penjualan", "Pelunasan Piutang Customer", "Pembelian", "Retur Pembelian", "Pelunasan Hutang Supplier"];
const kunciTrans = (r: Row) => String(r.kunci ?? r.notrans);
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("id-ID")} KB`;

export function Alat() {
  const { go } = useApp();
  const msg = useMsgBox();
  const [tab, setTab] = useState(0);
  const [lokasi, setLokasi] = useState("");
  const [folder, setFolder] = useState("");
  const [fileRestore, setFileRestore] = useState("");
  const [daftarBackup, setDaftarBackup] = useState<FileBackup[] | null>(null);
  const [itemHapus, setItemHapus] = useState<{ kunci: string; nama: string }[]>([]);
  const [hapusPick, setHapusPick] = useState<Set<string>>(new Set());
  const [semuaHapus, setSemuaHapus] = useState(false);
  const [periode, setPeriode] = useState<{ dari: string; sampai: string } | null>(null);
  const [jenisImpor, setJenisImpor] = useState<{ kunci: string; nama: string }[]>([]);
  const [imporPick, setImporPick] = useState<string>("");
  const [impor, setImpor] = useState(false);
  const [sql, setSql] = useState("");
  const [hasilSql, setHasilSql] = useState<HasilSql | null>(null);
  const [jenisTrans, setJenisTrans] = useState("Penjualan");
  const [noTrans, setNoTrans] = useState("");
  const [tgl1, setTgl1] = useState(today());
  const [tgl2, setTgl2] = useState(today());
  const [trans, setTrans] = useState<Row[]>([]);
  const [transPick, setTransPick] = useState<Set<string>>(new Set());
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    dbApi.info().then((i) => { setLokasi(i.path); setFolder(folderBackup.get() || i.folder_backup); }).catch((e) => msg.alert(errText(e)));
    alatApi.itemHapus().then(setItemHapus).catch(() => undefined);
    imporApi.jenis().then((j) => { setJenisImpor(j); setImporPick(j[0]?.kunci ?? ""); }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Jalankan tindakan dan tampilkan hasilnya; kesalahan jadi pesan biasa. */
  const jalan = async (f: () => Promise<string>) => {
    setSibuk(true);
    try { msg.alert(await f()); } catch (e) { msg.alert(errText(e)); } finally { setSibuk(false); }
  };
  const fld = folder.trim() || undefined;

  /* ---- Backup ---- */
  const backup = () => jalan(async () => {
    const r = await dbApi.backup(fld);
    folderBackup.set(folder);
    return `Backup berhasil. File tersimpan di ${r.path} (${kb(r.ukuran)}).`;
  });
  const cekCorrupt = () => jalan(async () => {
    const r = await dbApi.cek(true);
    return r.ok ? "Data Anda dalam keadaan baik. Tidak ada data yang rusak." : `Ditemukan masalah di data: ${r.masalah.slice(0, 3).join("; ")}. Klik Repair Data untuk memperbaikinya.`;
  });
  const repair = () => msg.confirm("Program akan membuat cadangan dulu, lalu merapikan dan memperbaiki indeks data. Lanjutkan?", () => void jalan(async () => {
    const r = await dbApi.perbaiki(fld);
    return `Perbaikan selesai. Cadangan sebelum perbaikan ada di ${r.cadangan}.`;
  }));

  /* ---- Restore ---- */
  const bukaDaftar = async () => {
    try { setDaftarBackup(await dbApi.daftarBackup(fld)); } catch (e) { msg.alert(errText(e)); }
  };
  const restore = () => {
    if (!fileRestore.trim()) return msg.alert("Data file yang akan di restore belum dipilih!");
    msg.confirm("Data Anda saat ini akan diganti dengan isi file backup ini. Program membuat cadangan dulu dari data sekarang. Lanjutkan?", () => void jalan(async () => {
      const r = await dbApi.restore(fileRestore.trim(), fld);
      setTimeout(() => window.location.reload(), 2500);
      return `Data sudah dipulihkan. Data Anda yang sebelumnya disimpan di ${r.cadangan}. Program akan dimuat ulang, silakan masuk lagi.`;
    }));
  };

  /* ---- Hapus data ---- */
  const toggleHapus = (k: string) => setHapusPick((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const hapusData = (rentang: { dari: string; sampai: string } | null) => {
    const pilih = itemHapus.filter((i) => hapusPick.has(i.kunci));
    const ada = pilih.some((i) => i.kunci === "jual" || i.kunci === "beli" || i.kunci === "opname" || i.kunci === "stokawal");
    msg.confirm(
      `Data yang akan dihapus: ${pilih.map((i) => i.nama).join(", ")}.${rentang ? ` Periode ${tglID(rentang.dari)} sampai ${tglID(rentang.sampai)}.` : ""} ` +
      `${ada ? "Stok barang dihitung ulang dari transaksi yang masih ada. " : ""}Data yang dihapus tidak bisa dikembalikan, tetapi program membuat cadangan dulu. Lanjutkan?`,
      () => void jalan(async () => {
        const r = await alatApi.hapusData([...hapusPick], rentang?.dari ?? "", rentang?.sampai ?? "", fld);
        setHapusPick(new Set());
        setSemuaHapus(false);
        return `Proses hapus data sudah berhasil di proses. Cadangan sebelum menghapus ada di ${r.cadangan}.`;
      }),
    );
  };
  const klikHapus = () => {
    if (!hapusPick.size) return msg.alert("Data yang akan dihapus belum dipilih.");
    if ([...hapusPick].some((k) => BERDASAR_TANGGAL.has(k))) setPeriode({ dari: today(), sampai: today() });
    else hapusData(null);
  };

  /* ---- SQL ---- */
  const prosesSql = () => {
    const q = sql.trim();
    if (!q) return msg.alert("Perintah SQL belum diisi.");
    const jalanSql = () => void jalan(async () => {
      const r = await alatApi.sql(q, fld);
      if (r.kolom.length) { setHasilSql(r); return `Perintah sudah dijalankan.. ${r.baris.length} baris${r.terpotong ? " (hanya 500 baris pertama)" : ""}.`; }
      return "Perintah sudah dijalankan..";
    });
    if (/^\s*(select|with|explain|pragma)/i.test(q)) jalanSql();
    else msg.confirm("Perintah ini akan mengubah data. Program membuat cadangan dulu. Lanjutkan?", jalanSql);
  };

  /* ---- Repair ---- */
  const hitungStok = () => msg.confirm("Apakah akan dilakukan perhitungan ulang stok akhir?", () => void jalan(async () => {
    const r = await alatApi.hitungStok();
    return `Proses hitung ulang stok akhir selesai dilakukan. ${r.berubah} barang stoknya berubah.`;
  }));
  const sinkronHarga = () => msg.confirm("Apakah akan dilakukan proses sinkronisasi harga beli pada transaksi?", () => void jalan(async () => {
    const r = await alatApi.sinkronHargaBeli(fld);
    return `Proses sinkronisasi selesai. ${r.berubah} baris transaksi diperbarui.`;
  }));
  const sinkronJual = () => msg.confirm("Apakah proses akan dilanjutkan? Program membuat cadangan dulu.", () => void jalan(async () => {
    const r = await alatApi.sinkronJual(fld);
    return `Proses sinkronisasi selesai. ${r.dihapus} transaksi penjualan tanpa barang dibersihkan.`;
  }));

  /* ---- Hapus transaksi ---- */
  const tampil = async () => {
    try { setTrans(await alatApi.daftarTransaksi(jenisTrans, noTrans, tgl1, tgl2)); setTransPick(new Set()); } catch (e) { msg.alert(errText(e)); }
  };
  const hapusTrans = () => {
    if (!transPick.size) return msg.alert("Pilih dulu transaksi yang akan dihapus.");
    const retur = jenisTrans.startsWith("Retur");
    const lunas = jenisTrans.startsWith("Pelunasan");
    const akibat = retur
      ? "Stok barang dikembalikan, jumlah retur di transaksi asalnya dikurangi, dan piutang atau hutang yang tadinya dipotong kembali terbuka. Uang retur di kas ikut dihapus."
      : lunas
        ? "Tagihan yang tadinya lunas kembali terbuka sebesar pembayaran itu, dan uang pelunasan di kas ikut dihapus."
        : "Proses ini akan menghapus semua transaksi yang terkait seperti kartu piutang, stok dan keuangan.";
    msg.confirm(`Apakah ${lunas ? "data pelunasan" : "data transaksi"} akan dihapus? ${akibat} ${transPick.size} ${lunas ? "pembayaran" : "transaksi"} dipilih. Data yang dihapus tidak bisa dikembalikan, tetapi program membuat cadangan dulu.`, () => void jalan(async () => {
      const r = await alatApi.hapusTransaksi([...transPick], fld);
      await tampil();
      return `Data transaksi berhasil dihapus (${r.dihapus} transaksi). Cadangan sebelum menghapus ada di ${r.cadangan}.`;
    }));
  };
  const kolTrans: GridCol<Row>[] = useMemo(() => [
    { title: "", width: 24, render: (r) => <input type="checkbox" checked={transPick.has(kunciTrans(r))} onChange={() => setTransPick((p) => { const n = new Set(p); const k = kunciTrans(r); n.has(k) ? n.delete(k) : n.add(k); return n; })} /> },
    { title: jenisTrans.startsWith("Pelunasan") ? "No. Kartu" : "No Transaksi", width: 110, render: (r) => r.notrans },
    { title: "Tanggal", width: 80, render: (r) => tglID(r.tgltrans) },
    { title: "No.Ref", width: 90, render: (r) => r.noref },
    { title: "Nama", width: 200, render: (r) => r.namakontak ?? r.kodekontak },
    { title: jenisTrans.startsWith("Pelunasan") ? "Jml. Bayar" : "Total Trans", width: 100, align: "right", render: (r) => rp(r.totaltrans) },
  ], [transPick, jenisTrans]);

  const bind: Record<string, Bind> = {
    xTab: () => (
      <div className="alat-tabs">
        <div className="alat-tabs-head">
          {TABS.map((t, i) => <button key={t} type="button" className={i === tab ? "on" : ""} onClick={() => setTab(i)}>{t}</button>)}
        </div>
      </div>
    ),
    cKeluar: { onClick: () => go("home"), disabled: sibuk },
    // 0 Backup
    tLokasiData: txt(lokasi, undefined, true),
    tLokasiBackup: txt(folder, setFolder),
    cOpenFolderBackup: { onClick: () => document.querySelector<HTMLElement>('[data-vb="tLokasiBackup"] input')?.focus() },
    cBackup: { onClick: () => void backup() },
    cCekCorrupt: { onClick: () => void cekCorrupt() },
    cRepair: { onClick: repair },
    // 1 Restore
    tLokasiDataRestore: txt(lokasi, undefined, true),
    tFileBackup: txt(fileRestore, setFileRestore),
    cOpenBackup: { onClick: () => void bukaDaftar() },
    cRestore: { onClick: restore },
    // 2 Hapus data
    lsHapus: () => <Checklist items={itemHapus} picked={hapusPick} onToggle={toggleHapus} />,
    cPilihSemua: {
      value: semuaHapus ? "1" : "0",
      onChange: (v) => { setSemuaHapus(v === "1"); setHapusPick(v === "1" ? new Set(itemHapus.map((i) => i.kunci)) : new Set()); },
    },
    cHapus: { onClick: klikHapus },
    // 3 Import
    lsImport: () => <Checklist radio items={jenisImpor} picked={new Set([imporPick])} onToggle={setImporPick} />,
    cImport: { onClick: () => (imporPick ? setImpor(true) : msg.alert("Pilih dulu data yang akan diimpor.")) },
    // 4 SQL
    tSQL: { value: sql, onChange: setSql, style: { fontFamily: "Consolas, monospace" } },
    cProsesSQL: { onClick: prosesSql },
    // 5 Repair
    cRepairLaba: { onClick: sinkronHarga },
    cHitungUlangStok: { onClick: hitungStok },
    cSinkronJual: { onClick: sinkronJual },
    // 6 Hapus transaksi
    tNoTrans: txt(noTrans, setNoTrans),
    dtTgl1: { value: tgl1, onChange: (v) => v && setTgl1(v) },
    dtTgl2: { value: tgl2, onChange: (v) => v && setTgl2(v) },
    cmbJenisTrans: { value: jenisTrans, onChange: (v: string) => { setJenisTrans(v); setTrans([]); setTransPick(new Set()); }, children: opsi(JENIS_TRANS) },
    cTampil: { onClick: () => void tampil() },
    lsData: () => <VbGrid cols={kolTrans} rows={trans} rowKey={kunciTrans} selected={null} onSelect={() => undefined} />,
    chkPilih: {
      value: trans.length > 0 && transPick.size === trans.length ? "1" : "0",
      onChange: (v) => setTransPick(v === "1" ? new Set(trans.map(kunciTrans)) : new Set()),
    },
    cHapusTrans: { onClick: hapusTrans },
  };
  const hide = [0, 1, 2, 3, 4, 5, 6].filter((i) => i !== tab).map((i) => `picTab(${i})`);
  // Saldo kas selalu dihitung ulang setelah transaksi dihapus, jadi pilihannya tidak ditampilkan.
  hide.push("chkHitungKas");
  const jenisNama = jenisImpor.find((j) => j.kunci === imporPick)?.nama ?? "";

  return (
    <div className="vbm-area">
      <VbForm form="FrmZAlat" bind={bind} hide={hide} />
      {msg.node}
      {periode && (
        <VbModal form="FrmZAlatTgl" onClose={() => setPeriode(null)}
          bind={{
            dtTgl1: { value: periode.dari, onChange: (v) => v && setPeriode((p) => p && { ...p, dari: v }) },
            dtTgl2: { value: periode.sampai, onChange: (v) => v && setPeriode((p) => p && { ...p, sampai: v }) },
            cOK: { onClick: () => { const p = periode; setPeriode(null); hapusData(p); } },
          }} />
      )}
      {daftarBackup && (
        <ModalFrame title="File Backup" width={560} height={320} onClose={() => setDaftarBackup(null)}>
          <div style={{ height: 280 }}>
            {daftarBackup.length === 0
              ? <p style={{ padding: 12 }}>Belum ada file backup di folder ini. Anda juga bisa mengetik lokasi file backup langsung.</p>
              : <VbGrid cols={[
                { title: "Nama File", width: 260, render: (r: FileBackup) => r.nama },
                { title: "Waktu", width: 120, render: (r: FileBackup) => r.waktu },
                { title: "Ukuran", width: 80, align: "right", render: (r: FileBackup) => kb(r.ukuran) },
              ]} rows={daftarBackup} rowKey={(r) => r.path} selected={null} onSelect={() => undefined}
                onOpen={(r) => { setFileRestore(r.path); setDaftarBackup(null); }} />}
          </div>
        </ModalFrame>
      )}
      {impor && <ImporExcel jenis={imporPick} nama={jenisNama} onClose={() => setImpor(false)} />}
      {hasilSql && (
        <ModalFrame title="SQL Editor" width={640} onClose={() => setHasilSql(null)}>
          <div className="alat-hasil">
            <table>
              <thead><tr>{hasilSql.kolom.map((k) => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>{hasilSql.baris.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c == null ? "" : String(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
