import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { errText, Row } from "../api";
import { useApp } from "../appContext";
import { dashApi } from "../api/dashboard";
import { Alert } from "../components/Modal";
import { rp, today } from "../format";

type Jenis = "Batang" | "Garis" | "Area";
const JENIS: Jenis[] = ["Batang", "Area", "Garis"];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const uang = (n: unknown) => `Rp ${rp(n)}`;
const num = (x: unknown) => Number(x) || 0;
const WARNA_BARIS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

interface Titik { label: string; value: number }

/** Grafik responsif SVG pengganti MSChart: batang, garis, atau area. */
function Grafik(props: { jenis: Jenis; data: Titik[]; warna: string }) {
  const { jenis, data, warna } = props;
  const w = 440, h = 155;
  const kiri = 54, bawah = 20, atas = 10, kanan = 12;
  const pw = Math.max(10, w - kiri - kanan), ph = Math.max(10, h - atas - bawah);
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  const x = (i: number) => kiri + (jenis === "Batang" ? (i + 0.5) * (pw / n) : n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const y = (v: number) => atas + ph - (v / max) * ph;
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 38))));
  const garis = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const ringkas = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".", ",")} jt` : v >= 1e3 ? `${Math.round(v / 1e3)} rb` : String(Math.round(v)));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="dash-chart block h-40 w-full font-sans text-[10px] text-muted-foreground" role="img" aria-label="Grafik">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={kiri} x2={w - kanan} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray={f < 1 ? "2 2" : undefined} />
          <text x={kiri - 6} y={y(max * f) + 3} textAnchor="end" fill="currentColor">{ringkas(max * f)}</text>
        </g>
      ))}
      {jenis === "Batang" && data.map((d, i) => (
        <rect key={i} x={x(i) - Math.max(2, (pw / n) * 0.3)} width={Math.max(4, (pw / n) * 0.6)} y={y(d.value)} height={Math.max(0, atas + ph - y(d.value))} fill={warna} rx={2}>
          <title>{`${d.label}: ${uang(d.value)}`}</title>
        </rect>
      ))}
      {jenis === "Area" && data.length > 0 && <polygon points={`${x(0)},${atas + ph} ${garis} ${x(data.length - 1)},${atas + ph}`} fill={warna} fillOpacity={0.22} />}
      {jenis !== "Batang" && <polyline points={garis} fill="none" stroke={warna} strokeWidth={2.2} />}
      {jenis !== "Batang" && data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={3} fill={warna}><title>{`${d.label}: ${uang(d.value)}`}</title></circle>)}
      {data.map((d, i) => i % step === 0 && <text key={i} x={x(i)} y={h - 4} textAnchor="middle" fill="currentColor">{d.label}</text>)}
    </svg>
  );
}

/** Ringkasan Toko (FrmZDashboard): ringkasan penjualan, laba, grafik, pelanggan terbanyak, dan piutang. */
export function Dashboard(props: { onTutup: () => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  const [jenis, setJenis] = useState<Jenis[]>(["Batang", "Batang", "Area", "Area"]);
  const { go } = useApp();

  const muat = useCallback(() => {
    setErr("");
    dashApi.data(today()).then(setD).catch((e) => setErr(errText(e)));
  }, []);
  useEffect(muat, [muat]);

  // Esc menutup Ringkasan Toko.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); props.onTutup(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const t15: Titik[] = (Array.isArray(d?.penjualan15) ? d.penjualan15 : []).map((r: Row) => ({ label: `${String(r.tgl).slice(8, 10)}/${String(r.tgl).slice(5, 7)}`, value: num(r.total) }));
  const tHari: Titik[] = (Array.isArray(d?.per_hari) ? d.per_hari : []).map((r: Row) => ({ label: HARI[num(r.hari)] ?? "", value: num(r.total) }));
  const tLaba: Titik[] = (Array.isArray(d?.laba30) ? d.laba30 : []).map((r: Row) => ({ label: `${String(r.tgl).slice(8, 10)}/${String(r.tgl).slice(5, 7)}`, value: num(r.total) }));
  const tBulan: Titik[] = (Array.isArray(d?.laba_bulan) ? d.laba_bulan : []).map((r: Row) => ({ label: `${BLN[num(String(r.bulan).slice(5, 7)) - 1] ?? ""} ${String(r.bulan).slice(2, 4)}`, value: num(r.total) }));
  const pelanggan: Row[] = Array.isArray(d?.pelanggan) ? d.pelanggan : [];
  const piutang: Row[] = Array.isArray(d?.piutang) ? d.piutang : [];
  const maks = Math.max(1, ...pelanggan.map((p) => num(p.total)));

  const setChartType = (idx: number, val: Jenis) => setJenis((o) => o.map((x, k) => (k === idx ? val : x)));

  const kpis = [
    { id: "lblRata2Penjualan", label: "Rata-Rata Penjualan", value: uang(d?.rata_jual) },
    { id: "lblRata2Profit", label: "Rata-Rata Profit", value: uang(d?.rata_laba) },
    { id: "lblPenjualanHariIni", label: "Penjualan Hari Ini", value: uang(d?.hari_jual), highlight: true },
    { id: "lblProfitHariIni", label: "Profit Hari Ini", value: uang(d?.hari_laba) },
  ];

  const charts = [
    { id: "MSChart1", selectId: "cType1", title: "Penjualan 15 Hari Terakhir", data: t15, warna: "var(--chart-2)", idx: 0 },
    { id: "MSChart2", selectId: "cType2", title: "Penjualan Per Hari", data: tHari, warna: "var(--success)", idx: 1 },
    { id: "MSChart3", selectId: "cType3", title: "Laba Kotor 30 Hari Terakhir", data: tLaba, warna: "var(--warning)", idx: 2 },
    { id: "MSChart4", selectId: "cType4", title: "Laba Kotor Per Bulan", data: tBulan, warna: "var(--destructive)", idx: 3 },
  ];

  return (
    <div className="dash tp-scroll-always flex h-full min-h-0 flex-col gap-3 bg-muted/25 p-3 font-sans text-foreground" data-form="FrmZDashboard">
      {err && <Alert>{err}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <h1 className="text-sm font-bold text-foreground">Ringkasan Toko</h1>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="default" data-vb="vkCommand1" className="h-8 bg-background px-2.5 text-xs font-medium" onClick={() => window.dispatchEvent(new Event("tokopro:notifikasi"))}>
            Notifikasi
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cRefresh" className="h-8 bg-background px-2.5 text-xs font-medium" onClick={muat}>
            Refresh
          </Button>
          <Button type="button" variant="outline" size="default" data-vb="cClose" className="h-8 bg-background px-2.5 text-xs font-medium" onClick={props.onTutup}>
            <span>Tutup</span>
            <Kbd className="border border-border bg-muted text-foreground">Esc</Kbd>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.id}
            className={`flex flex-col justify-between rounded-md border px-3.5 py-2.5 ${
              k.highlight ? "border-transparent bg-display text-display-foreground" : "border-border bg-card text-foreground"
            }`}
          >
            <div className={`text-xs font-medium ${k.highlight ? "text-display-foreground/75" : "text-muted-foreground"}`}>{k.label}</div>
            <div className="mt-1 truncate text-xl font-bold tabular-nums" data-vb={k.id}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {charts.map((c) => (
          <div key={c.id} className="flex flex-col rounded-md border border-border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-foreground">{c.title}</h2>
              <div data-vb={c.selectId}>
                <NativeSelect size="sm" value={jenis[c.idx]} onChange={(e) => setChartType(c.idx, e.target.value as Jenis)} className="w-24">
                  {JENIS.map((j) => <NativeSelectOption key={j} value={j}>{j}</NativeSelectOption>)}
                </NativeSelect>
              </div>
            </div>
            <div className="min-h-0 flex-1" data-vb={c.id}>
              <Grafik jenis={jenis[c.idx]} data={c.data} warna={c.warna} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <div className="flex flex-col rounded-md border border-border bg-card p-3">
          <h2 className="mb-2.5 text-xs font-semibold text-foreground">5 Pelanggan Terbanyak</h2>
          <div className="flex flex-col gap-2">
            {pelanggan.slice(0, 5).map((p, i) => {
              const pct = Math.max(8, Math.round((num(p.total) / maks) * 100));
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 font-medium text-foreground" data-vb={`lblPelanggan(${i})`}>
                      <span className="inline-block size-2 rounded-full" style={{ background: WARNA_BARIS[i % WARNA_BARIS.length] }} />
                      <span>{p.nama}</span>
                    </span>
                    <span className="font-semibold text-foreground tabular-nums" data-vb={`lblTransPelanggan(${i})`}>{uang(p.total)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: WARNA_BARIS[i % WARNA_BARIS.length] }} />
                  </div>
                </div>
              );
            })}
            {pelanggan.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">Belum ada data transaksi pelanggan.</div>
            )}
          </div>
        </div>

        <div className="flex flex-col rounded-md border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground">Daftar Piutang Pelanggan</h2>
            <span className="text-[11px] text-muted-foreground">Klik ganda untuk pelunasan</span>
          </div>
          <div className="tp-scroll-always max-h-48 min-h-36 flex-1 rounded-md border border-border bg-card text-[13px]" data-vb="lstPiutang">
            <table className="w-full border-collapse">
              <thead>
                <tr className="sticky top-0 h-8 border-b border-foreground/25 bg-muted text-left text-xs font-semibold tracking-tight text-foreground">
                  <th className="border-r border-foreground/20 px-2">Pelanggan</th>
                  <th className="px-2 text-right">Piutang</th>
                </tr>
              </thead>
              <tbody>
                {piutang.map((p, i) => (
                  <tr
                    key={i}
                    title="Klik dua kali untuk membuka Pelunasan Piutang"
                    className="h-7 cursor-pointer border-b border-foreground/15 odd:bg-card even:bg-muted/25 hover:bg-[color-mix(in_oklab,var(--primary)_12%,var(--card))]"
                    onDoubleClick={() => go("piutang", p.kode ? { kode: String(p.kode), nama: String(p.nama || p.kode) } : undefined)}
                  >
                    <td className="border-r border-foreground/15 px-2 font-medium">{p.nama}</td>
                    <td className="px-2 text-right font-semibold text-destructive tabular-nums">{uang(p.piutang)}</td>
                  </tr>
                ))}
                {d && piutang.length === 0 && <tr><td colSpan={2} className="px-2.5 py-6 text-center text-xs text-muted-foreground">Tidak ada piutang yang belum lunas.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
