import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText, Row } from "../api";
import { useApp } from "../appContext";
import { Modal } from "../components/Modal";
import { berkasApi } from "../api/berkas";
import { Bind, formCaption, Geom, VbForm } from "../vb/VbForm";
import { allowedFor, MENU, MenuNode } from "../vb/shell";
import { GridCol, ToolItem, useMsgBox, VbGrid, VbToolbar } from "../vb/VbGrid";

import { useDaftarFile } from "./daftarFile";
import "./pengguna.css";

/** Isi combo Level di FrmZPengguna aslinya, dengan urutan yang sama. */
const LEVELS = ["Kasir", "Supervisor", "Manager", "Direktur", "Lainnya"];

const status = (r: Row) => (Number(r.aktif ?? 1) === 0 ? "Non Aktif" : Number(r.belum_ada_password) === 1 ? "Belum ada password" : "Aktif");

const COLS: GridCol<Row>[] = [
  { title: "No.", width: 40, align: "right", render: (_, i) => i + 1 },
  { title: "Nama User", width: 110, render: (r) => r.iduser },
  { title: "Level", width: 80, render: (r) => r.level },
  { title: "Karyawan", width: 130, render: (r) => r.namakaryawan ?? "" },
  { title: "Status", width: 110, render: status },
];

/* ---- Hak akses: pohon menu dengan kotak centang ---- */
const daun = (n: MenuNode): MenuNode[] => (n.children.length ? n.children.flatMap(daun) : [n]);
const SEMUA_DAUN = MENU.flatMap(daun);

/** Menu yang dicentang untuk pengguna baru: semua, atau hanya yang boleh dibuka kasir. */
const bawaan = (level: string) => new Set(SEMUA_DAUN.filter((n) => allowedFor(level === "Kasir", n)).map((n) => n.id));

function Cabang(props: { node: MenuNode; akses: Set<string>; buka: Set<string>; disabled: boolean; ubah: (ids: string[], on: boolean) => void; lipat: (id: string) => void }) {
  const { node, akses, buka, disabled } = props;
  const anak = node.children;
  const ids = daun(node).map((n) => n.id);
  const n = ids.filter((i) => akses.has(i)).length;
  const penuh = n === ids.length;
  const sebagian = n > 0 && !penuh;
  return (
    <li>
      <div className="hk-baris">
        {anak.length ? (
          <button type="button" className="hk-panah" aria-label={buka.has(node.id) ? "Tutup" : "Buka"} onClick={() => props.lipat(node.id)}>{buka.has(node.id) ? "▾" : "▸"}</button>
        ) : <span className="hk-panah" />}
        <label>
          <input type="checkbox" checked={penuh} disabled={disabled} ref={(el) => { if (el) el.indeterminate = sebagian; }}
            onChange={(e) => props.ubah(ids, e.target.checked)} />
          <span>{node.caption}</span>
        </label>
      </div>
      {anak.length > 0 && buka.has(node.id) && (
        <ul>{anak.map((c) => <Cabang key={c.id} {...props} node={c} />)}</ul>
      )}
    </li>
  );
}

interface Isian { iduser: string; level: string; kodekaryawan: string; namakaryawan: string; password: string }
const KOSONG: Isian = { iduser: "", level: "", kodekaryawan: "", namakaryawan: "", password: "" };

/** FrmZPengguna (Daftar Pengguna): daftar user di kiri, isian user di kanan. */
export function Pengguna() {
  const { user, go } = useApp();
  const msg = useMsgBox();
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState<Isian>(KOSONG);
  const [baru, setBaru] = useState(true);
  const [pilihKar, setPilihKar] = useState(false);
  const [akses, setAkses] = useState<Set<string>>(() => bawaan(""));
  const [buka, setBuka] = useState<Set<string>>(new Set());
  const [bukaSemua, setBukaSemua] = useState(false);
  const [filter, setFilter] = useState({ cari: "", level: "", status: "" });
  const [showFilter, setShowFilter] = useState(false);

  const muat = useCallback(() => {
    api.listUsers().then(setRows).catch((e) => msg.alert(errText(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(muat, [muat]);

  const tampil = useMemo(() => rows.filter((r) => {
    const c = filter.cari.trim().toLowerCase();
    if (c && !String(r.iduser).toLowerCase().includes(c) && !String(r.namakaryawan ?? "").toLowerCase().includes(c)) return false;
    if (filter.level && r.level !== filter.level) return false;
    return !filter.status || status(r) === filter.status;
  }), [rows, filter]);
  const file = useDaftarFile(formCaption("FrmZPengguna"), COLS, tampil, msg);

  if (user.level === "Kasir") return <div className="vbm-area" />;

  const muatAkses = (id: string) => {
    berkasApi.userAkses(id)
      .then((l) => setAkses(new Set(l.filter((m) => Number(m.akses) > 0 && SEMUA_DAUN.some((d) => d.id === m.idmenu)).map((m) => m.idmenu))))
      .catch((e) => msg.alert(errText(e)));
  };
  const ubahAkses = (ids: string[], on: boolean) => setAkses((o) => { const n = new Set(o); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const lipat = (id: string) => setBuka((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const semuaInduk = () => new Set(MENU.flatMap(function induk(n: MenuNode): string[] { return n.children.length ? [n.id, ...n.children.flatMap(induk)] : []; }));

  const pilih = (key: string | null) => {
    setSel(key);
    const r = rows.find((x) => x.iduser === key);
    if (!r) return;
    setBaru(false);
    setF({ iduser: r.iduser, level: r.level ?? "", kodekaryawan: r.kodekaryawan ?? "", namakaryawan: r.namakaryawan ?? "", password: "" });
    muatAkses(r.iduser);
  };
  const tambah = () => { setSel(null); setBaru(true); setF(KOSONG); setAkses(bawaan("")); };

  const simpan = async () => {
    try {
      await api.saveUser({ iduser: f.iduser, level: f.level, kodekaryawan: f.kodekaryawan, password: f.password }, baru);
      const id = f.iduser.trim();
      if (f.level !== "Manager") await berkasApi.saveUserAkses(id, [...akses]);
      const r = await api.listUsers();
      setRows(r);
      const hit = r.find((x) => x.iduser === id);
      if (hit) {
        setSel(id);
        setBaru(false);
        setF({ iduser: hit.iduser, level: hit.level ?? "", kodekaryawan: hit.kodekaryawan ?? "", namakaryawan: hit.namakaryawan ?? "", password: "" });
      }
      msg.alert("Data pengguna sudah tersimpan.");
    } catch (e) {
      msg.alert(errText(e));
    }
  };

  const hapus = () => {
    if (!sel) return msg.alert("Pilih dulu pengguna yang akan dihapus.");
    msg.confirm(`Hapus pengguna ${sel}? Data yang dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.deleteUser(sel);
        tambah();
        muat();
      } catch (e) {
        msg.alert(errText(e));
      }
    });
  };

  const handlers: Record<string, () => void> = {
    Baru: tambah, Hapus: hapus, Filter: () => setShowFilter(true),
    Refresh: () => { setFilter({ cari: "", level: "", status: "" }); muat(); },
    Export: () => void file.ekspor(), Cetak: () => void file.cetak(), Tutup: () => go("home"),
  };
  const sepBefore = new Set(["Filter", "Export", "Tutup"]);
  const sendiri = !baru && f.iduser === user.iduser;

  const bind: Record<string, Bind> = {
    tbMenu: (_g, ctrl) => (
      <VbToolbar items={(ctrl.texts ?? []).map<ToolItem>((c) => ({ caption: c, onClick: handlers[c] ?? (() => undefined), sepBefore: sepBefore.has(c) }))} />
    ),
    lsData: () => <VbGrid cols={COLS} rows={tampil} rowKey={(r) => r.iduser} selected={sel} onSelect={pilih} />,
    cLevel: { value: f.level, onChange: (x: string) => { setF((o) => ({ ...o, level: x })); if (baru) setAkses(bawaan(x)); }, disabled: sendiri,
      children: <><option value="" />{LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}</> },
    tNamaUser: { value: f.iduser, onChange: (x: string) => setF((o) => ({ ...o, iduser: x })), disabled: !baru },
    tSandi: (g: Geom) => (
      <input className="vb-txt" style={{ width: g.width, height: g.height }} type="password" value={f.password} disabled={sendiri}
        autoComplete="new-password" onChange={(e) => setF((o) => ({ ...o, password: e.target.value }))} />
    ),
    // Aslinya MsgBox berisi kata sandi. Di sini kata sandi disimpan terenkripsi, jadi tidak bisa ditampilkan.
    cCek: { onClick: () => msg.alert("Kata sandi disimpan dalam bentuk terenkripsi, jadi tidak bisa ditampilkan. Kalau pengguna lupa, isi kata sandi baru lalu klik Simpan.") },
    lblKode: { text: f.kodekaryawan || "-", onClick: () => setPilihKar(true), style: { cursor: "pointer" } },
    lblNama: { text: f.namakaryawan || "-", onClick: () => setPilihKar(true), style: { cursor: "pointer" } },
    cSimpan: { onClick: simpan },
    chkMenu: { value: bukaSemua ? "1" : "0", onChange: (x: string) => { setBukaSemua(x === "1"); setBuka(x === "1" ? semuaInduk() : new Set()); } },
    xMenu: () => (
      <div className="hk-pohon">
        <ul>
          {MENU.map((m) => <Cabang key={m.id} node={m} akses={akses} buka={buka} disabled={f.level === "Manager"} ubah={ubahAkses} lipat={lipat} />)}
        </ul>
      </div>
    ),
  };

  return (
    <div className="vbm-fill">
      <VbForm form="FrmZPengguna" bind={bind} hide={["TV", "lblTotal"]} fill
        anchor={{ picRight: { left: true, right: true, top: true, bottom: true }, lsData: { top: true, bottom: true } }}
        pos={{ lsData: { height: 5460 } }} />
      {msg.node}
      {file.node}
      {showFilter && <FilterPengguna value={filter} onClose={() => setShowFilter(false)} onApply={(v) => { setFilter(v); setShowFilter(false); }} />}
      {pilihKar && <PilihKaryawan onClose={() => setPilihKar(false)} onPick={(k) => { setF((o) => ({ ...o, kodekaryawan: k.kodekaryawan, namakaryawan: k.namakaryawan })); setPilihKar(false); }} />}
    </div>
  );
}

function PilihKaryawan(props: { onClose: () => void; onPick: (k: { kodekaryawan: string; namakaryawan: string }) => void }) {
  const [list, setList] = useState<Row[]>([]);
  useEffect(() => { api.masterList("mdkaryawan", { limit: 5000, sort: "kodekaryawan" }).then((r) => setList(r.rows)).catch(() => undefined); }, []);
  const semua = useMemo(() => list.filter((k) => Number(k.aktif ?? 1) !== 0), [list]);
  return (
    <Modal title="Pilih Karyawan" onClose={props.onClose}>
      <div className="tp-pilih">
        <button className="btn" onClick={() => props.onPick({ kodekaryawan: "-", namakaryawan: "" })}>Tanpa karyawan</button>
        {semua.map((k) => <button key={k.kodekaryawan} className="btn" onClick={() => props.onPick(k as any)}>{k.kodekaryawan} - {k.namakaryawan}</button>)}
      </div>
    </Modal>
  );
}

function FilterPengguna(props: { value: { cari: string; level: string; status: string }; onApply: (v: { cari: string; level: string; status: string }) => void; onClose: () => void }) {
  const [v, setV] = useState(props.value);
  return (
    <Modal title="Filter Pengguna" onClose={props.onClose}
      footer={<><button className="btn" onClick={() => props.onApply({ cari: "", level: "", status: "" })}>Hapus Filter</button><button className="btn primary" onClick={() => props.onApply(v)}>Tampilkan</button></>}>
      <div className="hk-filter">
        <label>Nama user atau karyawan<input className="input" value={v.cari} onChange={(e) => setV({ ...v, cari: e.target.value })} autoFocus /></label>
        <label>Level
          <select className="input" value={v.level} onChange={(e) => setV({ ...v, level: e.target.value })}>
            <option value="">{"{Semua}"}</option>{LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label>Status
          <select className="input" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="">{"{Semua}"}</option>{["Aktif", "Non Aktif", "Belum ada password"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}
