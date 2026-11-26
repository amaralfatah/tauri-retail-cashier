import { ChevronDownIcon, ChevronRightIcon, CircleHelpIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errText, Row } from "../api";
import { useApp } from "../appContext";
import { Modal } from "../components/Modal";
import { berkasApi } from "../api/berkas";
import { formCaption } from "../vb/VbForm";
import { allowedFor, MENU, MenuNode } from "../vb/shell";
import { GridCol, ToolItem, useMsgBox, useTopEscape, VbGrid, VbToolbar } from "../vb/VbGrid";
import { useDaftarFile } from "./daftarFile";

/** Isi combo Level di FrmZPengguna aslinya, dengan urutan yang sama. */
const LEVELS = ["Kasir", "Supervisor", "Manager", "Direktur", "Lainnya"];
const ACTIONS = ["Baru", "Hapus", "Filter", "Refresh", "Export", "Cetak", "Tutup"];

const status = (r: Row) => (Number(r.aktif ?? 1) === 0 ? "Nonaktif" : Number(r.belum_ada_password) === 1 ? "Belum ada kata sandi" : "Aktif");

const COLS: GridCol<Row>[] = [
  { title: "No", width: 42, align: "right", render: (_, i) => i + 1 },
  { title: "Nama Pengguna", width: 130, render: (r) => r.iduser },
  { title: "Level", width: 95, render: (r) => r.level },
  { title: "Karyawan", width: 160, render: (r) => r.namakaryawan ?? "" },
  { title: "Status", width: 135, render: status },
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
      <div className="hk-baris flex h-5 items-center">
        {anak.length ? (
          <button
            type="button"
            data-slot="tree-toggle"
            className="hk-panah flex w-4 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
            aria-label={`${buka.has(node.id) ? "Tutup" : "Buka"} ${node.caption}`}
            aria-expanded={buka.has(node.id)}
            onClick={() => props.lipat(node.id)}
          >
            {buka.has(node.id) ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
          </button>
        ) : <span className="hk-panah w-4" />}
        <label data-slot="tree-label" className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
          <input
            data-slot="tree-check"
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={penuh}
            disabled={disabled}
            ref={(el) => { if (el) el.indeterminate = sebagian; }}
            onChange={(e) => props.ubah(ids, e.target.checked)}
          />
          <span>{node.caption}</span>
        </label>
      </div>
      {anak.length > 0 && buka.has(node.id) && (
        <ul className="m-0 list-none pl-4">{anak.map((c) => <Cabang key={c.id} {...props} node={c} />)}</ul>
      )}
    </li>
  );
}

interface Isian { iduser: string; level: string; kodekaryawan: string; namakaryawan: string; password: string }
const KOSONG: Isian = { iduser: "", level: "", kodekaryawan: "", namakaryawan: "", password: "" };

/** FrmZPengguna (Daftar Pengguna): daftar user di kiri, isian user di kanan. */
export function Pengguna() {
  const { user, go } = useApp();
  useTopEscape(() => go("home"));
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
    api.listUsers().then((r) => setRows(Array.isArray(r) ? r : [])).catch((e) => msg.alert(errText(e)));
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
      .then((l) => setAkses(new Set((Array.isArray(l) ? l : []).filter((m) => Number(m.akses) > 0 && SEMUA_DAUN.some((d) => d.id === m.idmenu)).map((m) => m.idmenu))))
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
    msg.confirm(`Anda akan menghapus pengguna ${sel}. Pengguna yang dihapus tidak bisa dikembalikan.`, async () => {
      try {
        await api.deleteUser(sel);
        tambah();
        muat();
      } catch (e) {
        msg.alert(errText(e));
      }
    }, undefined, undefined, true);
  };

  const handlers: Record<string, () => void> = {
    Baru: tambah, Hapus: hapus, Filter: () => setShowFilter(true),
    Refresh: () => { setFilter({ cari: "", level: "", status: "" }); muat(); },
    Export: () => void file.ekspor(), Cetak: () => void file.cetak(), Tutup: () => go("home"),
  };
  const sepBefore = new Set(["Filter", "Export", "Tutup"]);
  const sendiri = !baru && f.iduser === user.iduser;
  const toolItems: ToolItem[] = ACTIONS.map((c) => ({ caption: c, onClick: handlers[c] ?? (() => undefined), sepBefore: sepBefore.has(c) }));

  return (
    <div className="vb-modern flex h-full min-h-0 flex-col bg-background font-sans text-foreground" data-form="FrmZPengguna">
      <div data-vb="tbMenu">
        <VbToolbar items={toolItems} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(360px,1fr)_420px]">
        <div className="min-h-0 flex-1" data-vb="lsData">
          <VbGrid cols={COLS} rows={tampil} rowKey={(r) => r.iduser} selected={sel} onSelect={pilih} />
        </div>

        <div className="flex min-h-0 flex-col gap-3 rounded-md border border-border bg-card p-3.5 text-xs" data-vb="picRight">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-xs font-semibold text-foreground">{baru ? "Pengguna Baru" : `Pengguna: ${f.iduser}`}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => setPilihKar(true)}
            >
              {f.namakaryawan
                ? <><span data-vb="lblNama">{f.namakaryawan}</span><span data-vb="lblKode" className="text-muted-foreground">({f.kodekaryawan})</span></>
                : <span data-vb="lblNama">Pilih Karyawan</span>}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1" data-vb="cLevel">
              <Label className="text-xs font-medium text-foreground">Level</Label>
              <NativeSelect
                value={f.level}
                disabled={sendiri}
                onChange={(e) => {
                  const x = e.target.value;
                  setF((o) => ({ ...o, level: x }));
                  if (baru) setAkses(bawaan(x));
                }}
                className="w-full"
              >
                <NativeSelectOption value="">— Pilih Level —</NativeSelectOption>
                {LEVELS.map((x) => <NativeSelectOption key={x} value={x}>{x}</NativeSelectOption>)}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1" data-vb="tNamaUser">
              <Label className="text-xs font-medium text-foreground">Nama Pengguna</Label>
              <Input
                value={f.iduser}
                disabled={!baru}
                onChange={(e) => setF((o) => ({ ...o, iduser: e.target.value }))}
                placeholder="Nama untuk masuk"
                className="h-8 border-foreground/25 bg-background text-xs"
              />
            </div>

            <div className="flex flex-col gap-1" data-vb="tSandi">
              <Label className="text-xs font-medium text-foreground">Kata Sandi</Label>
              <div className="flex items-center gap-1">
                <Input
                  type="password"
                  value={f.password}
                  disabled={sendiri}
                  autoComplete="new-password"
                  placeholder={baru ? "Sandi baru" : "(Tetap)"}
                  onChange={(e) => setF((o) => ({ ...o, password: e.target.value }))}
                  className="h-8 flex-1 border-foreground/25 bg-background text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-vb="cCek"
                  className="h-8 px-2.5 text-xs"
                  title="Kenapa kata sandi tidak terlihat?"
                  aria-label="Kenapa kata sandi tidak terlihat?"
                  onClick={() => msg.alert("Kata sandi disimpan dalam bentuk terenkripsi, jadi tidak bisa ditampilkan. Kalau pengguna lupa, isi kata sandi baru lalu klik Simpan.")}
                >
                  <CircleHelpIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-semibold text-foreground">Hak Akses Menu</span>
            <div data-vb="chkMenu">
              <Label className="flex cursor-pointer items-center gap-1.5 text-xs font-normal text-foreground">
                <Checkbox
                  checked={bukaSemua}
                  onCheckedChange={(v) => {
                    const on = !!v;
                    setBukaSemua(on);
                    setBuka(on ? semuaInduk() : new Set());
                  }}
                />
                <span>Buka semua item menu</span>
              </Label>
            </div>
          </div>

          <div className="min-h-0 flex-1" data-vb="xMenu">
            <div className="hk-pohon tp-scroll-always size-full rounded-md border border-border bg-background p-2 font-sans text-xs text-foreground">
              <ul className="m-0 list-none p-0">
                {MENU.map((m) => <Cabang key={m.id} node={m} akses={akses} buka={buka} disabled={f.level === "Manager"} ubah={ubahAkses} lipat={lipat} />)}
              </ul>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" variant="default" size="sm" data-vb="cSimpan" className="h-8 px-4 font-semibold" onClick={() => void simpan()}>
              Simpan
            </Button>
          </div>
        </div>
      </div>

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
      <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-auto">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => props.onPick({ kodekaryawan: "-", namakaryawan: "" })}>Tanpa karyawan</Button>
        {semua.map((k) => <Button key={k.kodekaryawan} variant="ghost" className="w-full justify-start" onClick={() => props.onPick(k as any)}>{k.kodekaryawan} - {k.namakaryawan}</Button>)}
      </div>
    </Modal>
  );
}

function FilterPengguna(props: { value: { cari: string; level: string; status: string }; onApply: (v: { cari: string; level: string; status: string }) => void; onClose: () => void }) {
  const [v, setV] = useState(props.value);
  return (
    <Modal title="Filter Pengguna" onClose={props.onClose}
      footer={<><Button variant="outline" onClick={() => props.onApply({ cari: "", level: "", status: "" })}>Hapus Filter</Button><Button onClick={() => props.onApply(v)}>Tampilkan</Button></>}>
      <div className="flex min-w-70 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-foreground">Nama pengguna atau karyawan</Label>
          <Input value={v.cari} onChange={(e) => setV({ ...v, cari: e.target.value })} autoFocus />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-foreground">Level</Label>
          <NativeSelect className="w-full" value={v.level} onChange={(e) => setV({ ...v, level: e.target.value })}>
            <option value="">Semua</option>{LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-foreground">Status</Label>
          <NativeSelect className="w-full" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="">Semua</option>{["Aktif", "Nonaktif", "Belum ada kata sandi"].map((x) => <option key={x} value={x}>{x}</option>)}
          </NativeSelect>
        </div>
      </div>
    </Modal>
  );
}
