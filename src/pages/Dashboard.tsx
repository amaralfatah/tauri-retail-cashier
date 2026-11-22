import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { errText, Row } from "../api";
import { useApp } from "../appContext";
import { dashApi } from "../api/dashboard";
import { rp, today } from "../format";
import { Bind, vbColor, VbCtrl, useVbForm, VbForm } from "../vb/VbForm";
import dash1 from "../vb/icons/dash1.png";
import dash2 from "../vb/icons/dash2.png";
import "./dashboard.css";

type Jenis = "Batang" | "Garis" | "Area";
const JENIS: Jenis[] = ["Batang", "Area", "Garis"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const uang = (n: unknown) => `Rp. ${rp(n)}`;
const num = (x: unknown) => Number(x) || 0;

/** Baris pelanggan terbanyak: nama kontrol per baris. */
const BARIS: { lbl: string[]; lingkaran: string; lintasan: string[] }[] = [
  { lbl: ["lblPelanggan(0)", "lblTransPelanggan(0)", "shpPelanggan(0)"], lingkaran: "Shape8", lintasan: ["shpMain"] },
  { lbl: ["lblPelanggan(1)", "lblTransPelanggan(1)", "shpPelanggan(1)"], lingkaran: "Shape11", lintasan: ["Shape12"] },
  { lbl: ["lblPelanggan(2)", "lblTransPelanggan(2)", "shpPelanggan(2)"], lingkaran: "Shape14", lintasan: ["Shape15"] },
  { lbl: ["lblPelanggan(3)", "lblTransPelanggan(3)", "shpPelanggan(3)"], lingkaran: "Shape22", lintasan: ["Shape21", "Shape24"] },
  { lbl: ["lblPelanggan(4)", "lblTransPelanggan(4)", "shpPelanggan(4)"], lingkaran: "Shape19", lintasan: ["Shape18"] },
];
const LEBAR_LINTASAN = 4515;

interface Titik { label: string; value: number }

/** Grafik sederhana pengganti MSChart: batang, garis, atau area. */
function Grafik(props: { w: number; h: number; jenis: Jenis; data: Titik[]; warna: string }) {
  const { w, h, jenis, data, warna } = props;
  const kiri = 52, bawah = 18, atas = 8, kanan = 8;
  const pw = Math.max(10, w - kiri - kanan), ph = Math.max(10, h - atas - bawah);
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const x = (i: number) => kiri + (jenis === "Batang" ? (i + 0.5) * (pw / n) : n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v: number) => atas + ph - (v / max) * ph;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 38))));
  const garis = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const ringkas = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".", ",")} jt` : v >= 1e3 ? `${Math.round(v / 1e3)} rb` : String(Math.round(v)));
  return (
    <svg width={w} height={h} className="dash-chart" role="img" aria-label="Grafik">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={kiri} x2={w - kanan} y1={y(max * f)} y2={y(max * f)} stroke="#e4e4e4" />
          <text x={kiri - 4} y={y(max * f) + 3} textAnchor="end">{ringkas(max * f)}</text>
        </g>
      ))}
      {jenis === "Batang" && data.map((d, i) => (
        <rect key={i} x={x(i) - Math.max(2, (pw / n) * 0.3)} width={Math.max(4, (pw / n) * 0.6)} y={y(d.value)} height={Math.max(0, atas + ph - y(d.value))} fill={warna}>
          <title>{`${d.label}: ${uang(d.value)}`}</title>
        </rect>
      ))}
      {jenis === "Area" && data.length > 0 && <polygon points={`${x(0)},${atas + ph} ${garis} ${x(data.length - 1)},${atas + ph}`} fill={warna} fillOpacity={0.25} />}
      {jenis !== "Batang" && <polyline points={garis} fill="none" stroke={warna} strokeWidth={2} />}
      {jenis !== "Batang" && data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={2.5} fill={warna}><title>{`${d.label}: ${uang(d.value)}`}</title></circle>)}
      {data.map((d, i) => i % step === 0 && <text key={i} x={x(i)} y={h - 4} textAnchor="middle">{d.label}</text>)}
    </svg>
  );
}

function walk(n: VbCtrl, out: VbCtrl[] = []): VbCtrl[] {
  n.children.forEach((c) => { out.push(c); walk(c, out); });
  return out;
}

/** Analytic Dashboard (FrmZDashboard): ringkasan penjualan, laba, grafik, pelanggan terbanyak, dan piutang. */
export function Dashboard(props: { onTutup: () => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  const [jenis, setJenis] = useState<Jenis[]>(["Batang", "Batang", "Area", "Area"]);
  const { go } = useApp();
  const def = useVbForm("FrmZDashboard");

  const muat = useCallback(() => {
    setErr("");
    dashApi.data(today()).then(setD).catch((e) => setErr(errText(e)));
  }, []);
  useEffect(muat, [muat]);

  const kontrol = useMemo(() => (def ? walk(def) : []), [def]);

  const t15: Titik[] = (d?.penjualan15 ?? []).map((r: Row) => ({ label: `${String(r.tgl).slice(8, 10)}/${String(r.tgl).slice(5, 7)}`, value: num(r.total) }));
  const tHari: Titik[] = (d?.per_hari ?? []).map((r: Row) => ({ label: HARI[num(r.hari)], value: num(r.total) }));
  const tLaba: Titik[] = (d?.laba30 ?? []).map((r: Row) => ({ label: `${String(r.tgl).slice(8, 10)}/${String(r.tgl).slice(5, 7)}`, value: num(r.total) }));
  const tBulan: Titik[] = (d?.laba_bulan ?? []).map((r: Row) => ({ label: `${BLN[num(String(r.bulan).slice(5, 7)) - 1]} ${String(r.bulan).slice(2, 4)}`, value: num(r.total) }));
  const pelanggan: Row[] = d?.pelanggan ?? [];
  const piutang: Row[] = d?.piutang ?? [];
  const maks = Math.max(1, ...pelanggan.map((p) => num(p.total)));

  const bind: Record<string, Bind> = {
    lblRata2Penjualan: { text: uang(d?.rata_jual) },
    lblRata2Profit: { text: uang(d?.rata_laba) },
    lblPenjualanHariIni: { text: uang(d?.hari_jual) },
    lblProfitHariIni: { text: uang(d?.hari_laba) },
    cClose: (_g, c) => <button type="button" className="vb-btn" onClick={props.onTutup}>{c.props.Caption ?? "Tutup"}</button>,
    cRefresh: (_g, c) => <button type="button" className="vb-btn" onClick={muat}>{c.props.Caption ?? "Reload"}</button>,
    vkCommand1: (_g, c) => <button type="button" className="vb-btn" onClick={() => window.dispatchEvent(new Event("tokopro:notifikasi"))}>{c.props.Caption ?? "Notification"}</button>,
    Image1: (_g) => <img className="vb-img" src={dash1} alt="" />,
    Image2: (_g) => <img className="vb-img" src={dash2} alt="" />,
    Image3: (_g) => <img className="vb-img" src={dash2} alt="" />,
    Image4: (_g) => <img className="vb-img" src={dash1} alt="" />,
    MSChart1: (g) => <Grafik w={g.width} h={g.height} jenis={jenis[0]} data={t15} warna="#2f7ed8" />,
    MSChart2: (g) => <Grafik w={g.width} h={g.height} jenis={jenis[1]} data={tHari} warna="#8bbc21" />,
    MSChart3: (g) => <Grafik w={g.width} h={g.height} jenis={jenis[2]} data={tLaba} warna="#f28f43" />,
    MSChart4: (g) => <Grafik w={g.width} h={g.height} jenis={jenis[3]} data={tBulan} warna="#910000" />,
    lstPiutang: () => (
      <div className="dash-list">
        <table>
          <thead><tr><th>Pelanggan</th><th className="r">Piutang</th></tr></thead>
          <tbody>
            {piutang.map((p, i) => <tr key={i} title="Klik dua kali untuk membuka Pelunasan Piutang" style={{ cursor: "pointer" }} onDoubleClick={() => go("piutang")}><td>{p.nama}</td><td className="r">{uang(p.piutang)}</td></tr>)}
            {d && piutang.length === 0 && <tr><td colSpan={2}>Tidak ada piutang.</td></tr>}
          </tbody>
        </table>
      </div>
    ),
  };
  [1, 2, 3, 4].forEach((n) => {
    const i = n - 1;
    const sama = n === 1 ? "cType1" : n === 2 ? "cType2" : n === 3 ? "cType3" : "cType4";
    bind[sama] = { value: jenis[i], onChange: (v) => setJenis((o) => o.map((x, k) => (k === i ? (v as Jenis) : x))), children: JENIS.map((j) => <option key={j} value={j}>{j}</option>) as ReactNode };
  });
  BARIS.forEach((b, i) => {
    const p = pelanggan[i];
    bind[b.lbl[0]] = { text: p?.nama ?? "" };
    bind[b.lbl[1]] = { text: p ? uang(p.total) : "" };
  });

  // Bentuk (kartu putih, lingkaran, batang) digambar dari properti aslinya.
  const warnaLingkaran = (nama: string) => vbColor(kontrol.find((c) => c.name === nama)?.props.P15) ?? "#888";
  kontrol.filter((c) => c.type === "Shape").forEach((c) => {
    const key = c.index != null ? `${c.name}(${c.index})` : c.name;
    const p = c.props;
    const baris = BARIS.findIndex((b) => b.lingkaran === c.name);
    const batang = c.name === "shpPelanggan" && c.index != null;
    const lintasan = BARIS.some((b) => b.lintasan.includes(c.name));
    let bg: string | undefined;
    let z = 0;
    if (batang) { bg = warnaLingkaran(BARIS[c.index!].lingkaran); z = 2; }
    else if (lintasan) { bg = "#ececec"; z = 1; }
    else if (baris >= 0) { bg = warnaLingkaran(c.name); z = 2; }
    else if (p.BackStyle === 1) bg = vbColor(p.P2) ?? "#fff";
    const bulat = p.Shape === 3 ? "50%" : p.Shape === 4 ? "6px" : undefined;
    bind[key] = () => <div className="dash-shape" style={{ background: bg, borderRadius: bulat, zIndex: z }} />;
  });

  const hide = [
    "Shape24",
    ...BARIS.flatMap((b, i) => (pelanggan[i] ? [] : [...b.lbl, b.lingkaran, ...b.lintasan])),
  ];
  const pos: Record<string, { width: number }> = {};
  pelanggan.forEach((p, i) => { pos[`shpPelanggan(${i})`] = { width: Math.max(75, Math.round((LEBAR_LINTASAN * num(p.total)) / maks)) }; });

  return (
    <div className="dash">
      {err && <div className="dash-err" role="alert">{err}</div>}
      <VbForm form="FrmZDashboard" className="dash-form" bind={bind} hide={hide} pos={pos} fill />
    </div>
  );
}
