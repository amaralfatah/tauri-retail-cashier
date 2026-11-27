import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { kasir, pusat, type PerangkatKasir, type StatusKomputer } from "@/api/pusat";
import { errText } from "../api";
import { useApp } from "../appContext";
import { Alert } from "../components/Modal";
import { PilihanPeran, terapkanPeran, type IsianPeran } from "../components/PilihanPeran";
import { ringkasStatus, teksJamBeda, WARNA_NADA } from "../components/StatusPusat";
import { bacaVersi, bukaPembaruan, cekPembaruan, usePembaruan } from "../lib/pembaruan";
import { bandingVersi, muatStatusPusat, useStatusPusat } from "../lib/statusPusat";
import { useMsgBox } from "../vb/VbGrid";

/** Tombol salin: menyalin teks ke papan klip, lalu sebentar menampilkan "Tersalin". */
function Salin(props: { teks: string; label: string }) {
  const [ok, setOk] = useState(false);
  const salin = async () => {
    try { await navigator.clipboard.writeText(props.teks); } catch { return; }
    setOk(true);
    window.setTimeout(() => setOk(false), 1500);
  };
  return (
    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs font-medium" aria-label={props.label} onClick={() => void salin()}>
      {ok ? <CheckIcon className="text-success" /> : <CopyIcon />}
      <span>{ok ? "Tersalin" : "Salin"}</span>
    </Button>
  );
}

const rapikKode = (k: string) => (k.length === 6 ? `${k.slice(0, 3)} ${k.slice(3)}` : k);
const waktuLalu = (detik: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - detik);
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} menit lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hari lalu`;
};

function Bagian(props: { judul: string; children: React.ReactNode; aksi?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{props.judul}</h3>
        {props.aksi}
      </div>
      {props.children}
    </section>
  );
}

/** Di komputer Pusat: nama dan alamat untuk diketik di komputer kasir, kode sambung, dan daftar komputer kasir. */
function IsiPusat(props: { k: StatusKomputer; manager: boolean }) {
  const { k, manager } = props;
  const msg = useMsgBox();
  const [kode, setKode] = useState<{ kode: string; habis: number } | null>(
    k.kodeSambung ? { kode: k.kodeSambung, habis: Date.now() + (k.kodeSisaDetik ?? 0) * 1000 } : null,
  );
  const [sisa, setSisa] = useState(0);
  const [daftar, setDaftar] = useState<PerangkatKasir[] | null>(null);
  const [err, setErr] = useState("");
  const [izinSibuk, setIzinSibuk] = useState(false);

  const beriIzin = async () => {
    if (izinSibuk) return;
    setIzinSibuk(true);
    setErr("");
    try { await pusat.beriIzin(); } catch (e) { setErr(errText(e)); } finally { setIzinSibuk(false); void muatStatusPusat(); }
  };
  const muatDaftar = useCallback(() => {
    if (!manager) return;
    pusat.perangkat().then(setDaftar).catch((e) => setErr(errText(e)));
  }, [manager]);
  useEffect(() => {
    muatDaftar();
    const t = window.setInterval(muatDaftar, 5000);
    return () => window.clearInterval(t);
  }, [muatDaftar]);
  useEffect(() => {
    if (!kode) return;
    const hitung = () => { const s = Math.max(0, Math.round((kode.habis - Date.now()) / 1000)); setSisa(s); if (!s) setKode(null); };
    hitung();
    const t = window.setInterval(hitung, 1000);
    return () => window.clearInterval(t);
  }, [kode]);

  const buatKode = async () => {
    setErr("");
    try { const r = await pusat.kodeBaru(); setKode({ kode: r.kode, habis: Date.now() + r.berlakuDetik * 1000 }); }
    catch (e) { setErr(errText(e)); }
  };
  const selesaiMenyambungkan = async () => {
    setErr("");
    try { await pusat.tutupTerimaOtomatis(); } catch (e) { setErr(errText(e)); } finally { void muatStatusPusat(); muatDaftar(); }
  };
  const putuskan = (p: PerangkatKasir) => msg.confirm(
    `Putuskan ${p.namaKomputer} dari Pusat? Komputer itu perlu kode sambung baru untuk tersambung lagi.`,
    async () => { try { await pusat.putuskan(p.id); muatDaftar(); void muatStatusPusat(); } catch (e) { setErr(errText(e)); } },
    "Putuskan Komputer Kasir", undefined, "Ya, putuskan",
  );

  return (
    <div className="flex flex-col gap-3">
      {k.perluMulaiUlang && <Alert kind="info">Tutup lalu buka lagi Kasir Jet supaya komputer ini mulai menjadi Pusat.</Alert>}
      {k.galat && <Alert>{k.galat}</Alert>}
      {err && <Alert>{err}</Alert>}
      {(k.izinFirewall === "belum" || k.izinFirewall === "berbeda") && (
        <div className="flex flex-col gap-2" data-slot="izin-windows">
          <Alert kind="info">
            {k.izinFirewall === "berbeda"
              ? "Kasir Jet sekarang ada di lokasi lain, jadi izin Windows yang lama tidak berlaku lagi. Komputer kasir belum bisa tersambung. Tekan Beri izin, lalu pilih Ya saat Windows bertanya."
              : "Komputer kasir belum bisa tersambung karena Windows di komputer ini belum mengizinkannya. Tekan Beri izin, lalu pilih Ya saat Windows bertanya."}
          </Alert>
          <div>
            <Button type="button" variant="default" size="sm" disabled={izinSibuk} className="h-8 px-4 text-xs font-semibold" onClick={() => void beriIzin()}>
              {izinSibuk ? "Menunggu Windows…" : "Beri izin"}
            </Button>
          </div>
        </div>
      )}

      <Bagian judul="Ketik ini di komputer kasir">
        <div className="flex flex-col gap-2 text-xs">
          <div className="text-muted-foreground">Di kolom &ldquo;Nama komputer Pusat&rdquo; pada komputer kasir:</div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-display px-3 py-2 text-display-foreground">
            <span className="font-mono text-base font-bold tracking-wide" data-slot="nama-pusat">{k.namaKomputer}</span>
            <Salin teks={k.namaKomputer} label="Salin nama komputer Pusat" />
          </div>
          {k.alamatIp.length > 0 && (
            <>
              <div className="text-muted-foreground">Kalau nama ini tidak ditemukan, ketik alamatnya:</div>
              {k.alamatIp.map((ip) => (
                <div key={ip} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-1.5">
                  <span className="font-mono text-sm font-semibold tabular-nums">{ip}</span>
                  <Salin teks={ip} label={`Salin alamat ${ip}`} />
                </div>
              ))}
            </>
          )}
        </div>
      </Bagian>

      {manager && k.terimaOtomatisSisaDetik != null && (
        <div className="flex flex-col gap-2" data-slot="terima-otomatis">
          <Alert kind="info">
            Komputer kasir yang baru dibuka sekarang tersambung sendiri, tanpa kode ({k.terimaOtomatisDiterima ?? 0} dari {k.terimaOtomatisMaks ?? 10}).
            Kalau semua komputer kasir Anda sudah tersambung, tekan Selesai menyambungkan.
          </Alert>
          <div>
            <Button type="button" variant="default" size="sm" className="h-8 px-4 text-xs font-semibold" onClick={() => void selesaiMenyambungkan()}>Selesai menyambungkan</Button>
          </div>
        </div>
      )}

      {manager && (
        <Bagian judul="Kode sambung" aksi={
          <Button type="button" variant="default" size="sm" className="h-7 px-3 text-xs font-semibold" onClick={() => void buatKode()}>Tambah komputer kasir</Button>
        }>
          {kode ? (
            <div className="flex flex-col gap-1 text-xs">
              <div className="rounded-md bg-display px-3 py-2 text-center font-mono text-2xl font-bold tracking-[0.2em] text-display-foreground tabular-nums" aria-live="polite">{rapikKode(kode.kode)}</div>
              <p>Ketik kode ini di komputer kasir dalam {Math.max(1, Math.ceil(sisa / 60))} menit. Kode hanya bisa dipakai sekali.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Tekan Tambah komputer kasir untuk membuat kode sambung.</p>
          )}
        </Bagian>
      )}

      <Bagian judul="Komputer kasir">
        {!manager ? (
          <p className="text-xs text-muted-foreground">Daftar komputer kasir hanya bisa dilihat oleh akun Manager.</p>
        ) : daftar && daftar.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada komputer kasir yang tersambung.</p>
        ) : (
          <>
          {(daftar ?? []).some((p) => p.otomatis) && (
            <Alert kind="info">
              Komputer bertanda &ldquo;Tanpa kode&rdquo; tersambung sendiri, tanpa Anda mengetik kode. Kalau ada yang bukan komputer toko Anda, tekan Putuskan.
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold text-foreground">Komputer</TableHead>
                <TableHead className="font-bold text-foreground">Pengguna</TableHead>
                <TableHead className="font-bold text-foreground">Terakhir terlihat</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(daftar ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.namaKomputer}
                    {p.otomatis && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-foreground" data-slot="tanpa-kode">Tanpa kode</span>}
                  </TableCell>
                  <TableCell>{p.pengguna ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{waktuLalu(p.terakhirTerlihat)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs font-medium text-destructive" onClick={() => putuskan(p)}>Putuskan</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </Bagian>
      {msg.node}
    </div>
  );
}

/** Di komputer kasir: keadaan sambungan, Pusat yang dituju, dan tombol sambung ulang. */
function IsiKasir(props: { k: StatusKomputer; manager: boolean }) {
  const { k, manager } = props;
  const { jam } = useStatusPusat();
  const { versi } = usePembaruan();
  const r = ringkasStatus(k);
  const [nama, setNama] = useState(k.kasir.pusat ?? "");
  const [kode, setKode] = useState("");
  const [err, setErr] = useState("");
  const [sibuk, setSibuk] = useState(false);
  useEffect(() => { void bacaVersi(); }, []);

  const sambung = async () => {
    if (sibuk) return;
    setSibuk(true);
    setErr("");
    try {
      if (!nama.trim()) throw new Error("Nama komputer Pusat belum diisi. Ketik nama atau alamat komputer Pusat.");
      await kasir.atur(nama.trim());
      await kasir.sambung(kode.replace(/\D/g, "") || undefined);
      setKode("");
      await muatStatusPusat();
    } catch (e) { setErr(errText(e)); void muatStatusPusat(); } finally { setSibuk(false); }
  };
  const pusatBaru = !!versi && !!k.kasir.versiPusat && bandingVersi(k.kasir.versiPusat, versi) > 0;
  const jamBeda = teksJamBeda(jam);
  const Ikon = r?.ikon;

  return (
    <div className="flex flex-col gap-3">
      <Bagian judul="Sambungan ke Pusat">
        {r && Ikon && (
          <div className="flex items-center gap-2 text-sm font-semibold" aria-live="polite">
            <Ikon className={cn("size-5", WARNA_NADA[r.nada].teks)} />
            <span>{r.teks}</span>
          </div>
        )}
        {k.kasir.pesan && k.kasir.status !== "tersambung" && <Alert kind={k.kasir.status === "terputus" || k.kasir.status === "ditolak" ? "error" : "info"}>{k.kasir.pesan}</Alert>}
        {pusatBaru && k.kasir.status === "versi-beda" && (
          <div><Button type="button" size="sm" className="h-8 px-3 text-xs font-semibold" onClick={() => { void cekPembaruan().then(() => bukaPembaruan()); }}>Perbarui Sekarang</Button></div>
        )}
        {jamBeda && <Alert kind="info">{jamBeda}. Transaksi tetap memakai jam Pusat, tetapi sebaiknya benarkan jam Windows di komputer ini.</Alert>}
        {k.kasir.alamat && <p className="text-xs text-muted-foreground">Alamat Pusat saat ini: <span className="font-mono tabular-nums">{k.kasir.alamat}</span></p>}
      </Bagian>

      {manager ? (
        <Bagian judul="Ubah Pusat yang dituju">
          <div className="flex flex-col gap-3 text-xs" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void sambung(); } }}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kp-nama" className="text-xs font-medium text-foreground">Nama komputer Pusat</Label>
              <Input id="kp-nama" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Nama komputer atau alamatnya"
                className="h-8 border-foreground/25 bg-background text-xs" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kp-kode" className="text-xs font-medium text-foreground">Kode sambung</Label>
              <Input id="kp-kode" value={kode} onChange={(e) => setKode(e.target.value)} placeholder="6 angka" inputMode="numeric" maxLength={8}
                className="h-8 w-40 border-foreground/25 bg-background text-xs tabular-nums" />
              <p className="text-muted-foreground">Kode sambung tampil di layar Komputer Pusat.</p>
            </div>
            {err && <Alert>{err}</Alert>}
            <div><Button type="button" variant="default" size="sm" disabled={sibuk} className="h-8 px-4 text-xs font-semibold" onClick={() => void sambung()}>Sambungkan</Button></div>
          </div>
        </Bagian>
      ) : (
        <p className="text-xs text-muted-foreground">Minta akun Manager untuk mengubah Pusat yang dituju.</p>
      )}
    </div>
  );
}

/**
 * Layar Komputer Pusat (rancangan 7.1): isinya mengikuti peran komputer ini. Manager bisa mengubah perannya lewat "Ubah cara pakai".
 * Dipakai sebagai dialog dari ikon status di bilah atas dan sebagai tab di Alat Bantu.
 */
export function KomputerPusat() {
  const { user } = useApp();
  const { komputer: k } = useStatusPusat();
  const msg = useMsgBox();
  const manager = user.level === "Manager";
  const [ubah, setUbah] = useState(false);
  const [n, setN] = useState<IsianPeran>({ mode: "tunggal", nama: "", kode: "" });
  const [err, setErr] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [info, setInfo] = useState("");
  useEffect(() => { void muatStatusPusat(); }, []);

  if (!k) return <div className="p-4 text-xs text-muted-foreground">Memuat…</div>;

  const bukaUbah = () => {
    setN({ mode: k.mode, nama: k.kasir.pusat ?? "", kode: "" });
    setErr(""); setInfo("");
    setUbah(true);
    if (!k.kasir.pusat) kasir.namaLama().then((l) => { if (l) setN((s) => (s.nama ? s : { ...s, nama: l })); }).catch(() => undefined);
  };
  const terapkan = async () => {
    if (sibuk) return;
    if (n.mode === k.mode && n.mode !== "kasir") { setUbah(false); return; }
    setSibuk(true); setErr("");
    try {
      const s = await terapkanPeran(n, false);
      setUbah(false);
      if (s?.perluMulaiUlang) setInfo("Tutup lalu buka lagi Kasir Jet supaya pilihan ini berlaku.");
      else if (s?.cadangan) setInfo(`Data toko di komputer ini sudah disalin ke ${s.cadangan}.`);
    } catch (e) { setErr(errText(e)); } finally { setSibuk(false); }
  };
  const mintaTerapkan = () => {
    if (k.mode === "pusat" && n.mode !== "pusat" && (k.kasirTersambung ?? 0) > 0) {
      msg.confirm(`Masih ada ${k.kasirTersambung} komputer kasir yang tersambung. Kalau komputer ini tidak lagi menjadi Pusat, kasir tidak bisa menyimpan transaksi. Tetap ubah?`,
        () => void terapkan(), "Ubah Cara Pakai", undefined, "Ya, ubah");
    } else void terapkan();
  };

  return (
    <div className="flex flex-col gap-3 text-xs" data-form="KomputerPusat">
      {info && <Alert kind="ok">{info}</Alert>}
      {ubah ? (
        <div className="flex flex-col gap-3" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setUbah(false); } }}>
          <h3 className="text-sm font-semibold">Bagaimana Kasir Jet dipakai di toko Anda?</h3>
          <PilihanPeran nilai={n} onUbah={setN} disabled={sibuk} onEnter={mintaTerapkan} autoFocus />
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs font-medium" onClick={() => setUbah(false)}>Batal</Button>
            <Button type="button" variant="default" size="sm" disabled={sibuk} className="h-8 px-4 text-xs font-semibold" onClick={mintaTerapkan}>Terapkan</Button>
          </div>
        </div>
      ) : (
        <>
          {k.mode === "tunggal" && (
            <Bagian judul="Komputer ini berdiri sendiri">
              <p>Kasir Jet dipakai hanya di komputer ini. Kalau toko Anda punya lebih dari satu komputer kasir, jadikan salah satunya Pusat.</p>
            </Bagian>
          )}
          {k.mode === "pusat" && <IsiPusat k={k} manager={manager} />}
          {k.mode === "kasir" && <IsiKasir k={k} manager={manager} />}
          {manager ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs font-medium" onClick={bukaUbah}>Ubah cara pakai</Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Minta akun Manager untuk mengubah cara Kasir Jet dipakai di komputer ini.</p>
          )}
        </>
      )}
      {msg.node}
    </div>
  );
}
