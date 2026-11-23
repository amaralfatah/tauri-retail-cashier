import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { kasir, lama, pusat, type DeteksiLama, type RingkasanPindah } from "@/api/pusat";
import { errText } from "../api";
import { Alert } from "../components/Modal";
import { PilihanPeran, terapkanPeran, type IsianPeran } from "../components/PilihanPeran";
import { tandaiFotoLama } from "../lib/fotoLama";
import { muatStatusPusat, useStatusPusat } from "../lib/statusPusat";
import { lupakanPengaturanLama, pilihanDiganti, terapkanPengaturanLama } from "./localSettings";

/** Penanda: Toko Pro lama sudah dikonfirmasi sebagai komputer kasir dan sedang menunggu Pusat siap (rancangan 8.5). */
const KUNCI_MENUNGGU = "tokopro.menungguPusat";
const simpanTanda = (a: boolean) => { try { if (a) localStorage.setItem(KUNCI_MENUNGGU, "1"); else localStorage.removeItem(KUNCI_MENUNGGU); } catch { /* penyimpanan tidak tersedia */ } };
const adaTanda = () => { try { return localStorage.getItem(KUNCI_MENUNGGU) === "1"; } catch { return false; } };

const angka = (n: number) => n.toLocaleString("id-ID");

/** Berapa lama layar "menunggu Pusat" boleh diam sebelum menawarkan jalan lain (rancangan 8.1). */
const MASA_TUNGGU_PUSAT_MS = 45_000;
/** Cermin `MAKS_TERIMA_OTOMATIS` di Rust: komputer kasir yang diterima tanpa kode dalam satu masa terima. */
const MAKS_OTOMATIS = 10;

/** Nasib pengaturan Toko Pro lama: dipakai, sudah dipakai sebelumnya, atau tidak bisa dibaca. */
type NasibPengaturan = { status: "dipakai" | "sebelumnya" | "gagal"; diganti: string[] };

/** Baca pengaturan lama dan terapkan. Yang dilaporkan hanya yang benar-benar terjadi, termasuk pilihan yang diganti. */
async function pakaiPengaturanLama(peran: "pusat" | "kasir"): Promise<{ kv: Record<string, string>; fotoFolder: string | null; nasib: NasibPengaturan }> {
  let p: Awaited<ReturnType<typeof lama.pengaturan>> = { ada: false };
  try { p = await lama.pengaturan(); } catch { /* dilaporkan sebagai tidak bisa dibaca */ }
  if (!p.ada) return { kv: {}, fotoFolder: null, nasib: { status: "gagal", diganti: [] } };
  const kv = p.nilai ?? {};
  const diganti = pilihanDiganti(kv, peran).map((d) => `${d.nama} menjadi ${d.jadi} (dulu ${d.dulu || "kosong"})`);
  const terapan = terapkanPengaturanLama(kv, peran);
  return { kv, fotoFolder: p.fotoFolder ?? null, nasib: terapan ? { status: "dipakai", diganti } : { status: "sebelumnya", diganti: [] } };
}

/** Kalimat ringkasan yang jujur tentang pengaturan struk dan kasir dari Toko Pro lama. */
function kalimatPengaturan(n: NasibPengaturan): string {
  if (n.status === "gagal") return "Pengaturan struk dan kasir dari Toko Pro lama belum bisa dibaca, jadi komputer ini memakai pengaturan bawaan. Atur di menu Pengaturan.";
  if (n.status === "sebelumnya") return "Pengaturan struk dan kasir dari Toko Pro lama sudah dipindahkan sebelumnya.";
  return n.diganti.length > 0
    ? "Pengaturan struk dan kasir dari Toko Pro lama sudah dipakai di sini. Sebagian pilihan lama tidak ada lagi di Toko Pro baru, jadi diganti. Periksa di menu Pengaturan."
    : "Pengaturan struk dan kasir dari Toko Pro lama sudah dipakai di sini.";
}

type Layar =
  | { jenis: "memuat" }
  | { jenis: "pilihan" }
  | { jenis: "konfirmasi"; peran: "pusat" | "kasir"; pusat: string | null; folder: string }
  | { jenis: "tunggu-tutup"; folder: string }
  | { jenis: "pindah" }
  | { jenis: "ringkasan-pusat"; hasil: RingkasanPindah; pengaturan: NasibPengaturan; sisa: string[] }
  | { jenis: "menunggu-pusat"; pusat: string; perawatan: boolean }
  | { jenis: "ringkasan-kasir"; pusat: string; pengaturan: NasibPengaturan; sisa: string[] };

/** Kerangka satu kartu di tengah layar, sama untuk semua langkah. */
function Kartu(props: { judul: string; atas?: string; children: ReactNode; kaki?: ReactNode; label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-muted/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={props.label ?? props.judul}
        className="vb-modern flex max-h-full w-[520px] max-w-full flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="flex flex-col gap-1 border-b border-border px-5 pt-4 pb-3">
          <div className="text-xs font-medium text-muted-foreground">{props.atas || "Toko Pro"}</div>
          <h1 className="text-base font-bold">{props.judul}</h1>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto p-5 text-sm">{props.children}</div>
        {props.kaki && <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">{props.kaki}</div>}
      </div>
    </div>
  );
}

const Sedang = (props: { children: ReactNode }) => (
  <div className="flex items-start gap-3" role="status">
    <Loader2Icon className="mt-0.5 size-4 flex-none animate-spin text-primary" aria-hidden />
    <div className="flex flex-col gap-1">{props.children}</div>
  </div>
);

const Daftar = (props: { butir: string[] }) => (
  <ul className="flex list-disc flex-col gap-1.5 pl-5 text-xs text-foreground">{props.butir.map((b) => <li key={b}>{b}</li>)}</ul>
);

/** Yang tetap perlu dikerjakan pengguna setelah pindah (rancangan 8.7), hanya yang berlaku untuk komputer ini. */
function daftarSisa(kv: Record<string, string>, tidakCocok: number, gagal: number, pusatNyala: boolean, izinGagal = false, nasib?: NasibPengaturan): string[] {
  const s: string[] = [];
  for (const d of nasib?.diganti ?? []) s.push(`${d.charAt(0).toUpperCase()}${d.slice(1)}, karena pilihan lamanya tidak ada lagi di Toko Pro baru.`);
  if (izinGagal) s.push("Komputer kasir belum bisa tersambung karena Windows belum mengizinkannya. Buka Pengaturan, Alat Bantu, Komputer Pusat, tekan Beri izin, lalu pilih Ya. Kalau Windows meminta kata sandi administrator, minta bantuan orang yang memasang komputer ini.");
  if (tidakCocok > 0) s.push(`Ada ${angka(tidakCocok)} foto yang namanya tidak sama dengan kode barang mana pun, jadi tidak ikut pindah. Foto itu tetap ada di folder Toko Pro lama.`);
  if (gagal > 0) s.push(`${angka(gagal)} foto tidak bisa disalin karena rusak atau lebih dari 10 MB.`);
  s.push("Saat pertama mencetak struk, pilih printer struk Anda di jendela cetak. Windows akan mengingatnya untuk cetakan berikutnya.");
  if (["1", "-1", "true", "yes"].includes((kv.pakaidrawer ?? "").trim().toLowerCase())) s.push("Toko Pro baru belum bisa membuka laci kasir sendiri. Buka laci dengan kunci atau tombolnya dulu.");
  if ((kv.lokasireport ?? "").trim()) s.push("Laporan yang dibuat khusus di Toko Pro lama tidak ikut pindah. Semua laporan bawaan ada di menu Laporan.");
  if (pusatNyala) s.push("Biarkan komputer ini menyala dan Toko Pro tetap terbuka selama toko buka.");
  return s;
}

/** Layar pertama pada instalasi baru, sebelum layar login (rancangan 7.1 dan bab 8). Pilihan bawaannya Hanya di komputer ini. */
export function PilihanAwal(props: { namaUsaha?: string; onSelesai: () => void }) {
  const { komputer } = useStatusPusat();
  const [layar, setLayar] = useState<Layar>({ jenis: "memuat" });
  const [n, setN] = useState<IsianPeran>({ mode: "tunggal", nama: komputer?.kasir.pusat ?? "", kode: "" });
  const [dariLama, setDariLama] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [kemajuan, setKemajuan] = useState("");
  /** Layar "menunggu Pusat" sudah lama diam: tawarkan menjadikan komputer ini Pusat. */
  const [lamaMenunggu, setLamaMenunggu] = useState(false);
  const hidup = useRef(true);
  /** Naik setiap layar berganti atau ditinggalkan, supaya pengulangan di layar lama berhenti. */
  const giliran = useRef(0);

  useEffect(() => { hidup.current = true; return () => { hidup.current = false; giliran.current += 1; }; }, []);

  const keAturSendiri = useCallback((pusatLama?: string | null) => {
    giliran.current += 1;
    simpanTanda(false);
    if (pusatLama) { setN((s) => ({ ...s, nama: s.nama || pusatLama })); setDariLama(true); }
    setErr("");
    setLayar({ jenis: "pilihan" });
  }, []);

  // Cari Toko Pro lama di komputer ini. Kasir yang sudah dikonfirmasi tetapi Pusatnya belum siap langsung menunggu lagi.
  useEffect(() => {
    let batal = false;
    (async () => {
      const pusatSekarang = komputer?.mode === "kasir" ? komputer.kasir.pusat : null;
      if (pusatSekarang && adaTanda()) {
        setN((s) => ({ ...s, mode: "kasir", nama: pusatSekarang }));
        setLayar({ jenis: "menunggu-pusat", pusat: pusatSekarang, perawatan: false });
        return;
      }
      let d: DeteksiLama = { ada: false };
      try { d = await lama.deteksi(); } catch { /* tanpa Toko Pro lama: pilihan biasa */ }
      if (batal) return;
      if (d.ada && d.peran !== "tidakJelas") {
        setLayar({ jenis: "konfirmasi", peran: d.peran, pusat: d.pusat, folder: d.folder });
        return;
      }
      const nama = await kasir.namaLama().catch(() => null);
      if (batal) return;
      if (nama) { setN((s) => (s.nama ? s : { ...s, nama })); setDariLama(true); }
      setLayar({ jenis: "pilihan" });
    })();
    return () => { batal = true; };
    // Hanya saat layar ini dibuka.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLamaMenunggu(false);
    if (layar.jenis !== "menunggu-pusat" || layar.perawatan) return;
    const t = window.setTimeout(() => setLamaMenunggu(true), MASA_TUNGGU_PUSAT_MS);
    return () => window.clearTimeout(t);
  }, [layar]);

  // Kemajuan pengambilan data lama.
  useEffect(() => {
    if (layar.jenis !== "pindah") return;
    let lepas: (() => void) | null = null;
    let batal = false;
    void lama.pantauKemajuan((p) => setKemajuan(p.nama ? `${p.nama} (${p.ke} dari ${p.dari})` : "")).then((f) => { if (batal) f(); else lepas = f; }).catch(() => undefined);
    return () => { batal = true; lepas?.(); };
  }, [layar.jenis]);

  /** Pusat: tunggu Toko Pro lama ditutup, lalu ambil data (rancangan 8.2). */
  const mulaiPusat = useCallback(async (folder: string, paksa = false) => {
    const g = ++giliran.current;
    setErr("");
    for (;;) {
      let terbuka = false;
      try { terbuka = await lama.terbuka(folder); } catch { /* anggap sudah tertutup; Rust memeriksa lagi */ }
      if (g !== giliran.current) return;
      if (!terbuka) break;
      setLayar({ jenis: "tunggu-tutup", folder });
      await new Promise((r) => setTimeout(r, 2000));
      if (g !== giliran.current) return;
    }
    setKemajuan("");
    setLayar({ jenis: "pindah" });
    try {
      const hasil = await lama.pusatMulai(paksa);
      const { kv, nasib } = await pakaiPengaturanLama("pusat");
      await muatStatusPusat();
      if (g !== giliran.current) return;
      setLayar({ jenis: "ringkasan-pusat", hasil, pengaturan: nasib, sisa: daftarSisa(kv, hasil.foto.tidakCocok, hasil.foto.gagal, true, !!hasil.izinWindows, nasib) });
    } catch (e) {
      if (g !== giliran.current) return;
      setErr(errText(e));
      setLayar({ jenis: "konfirmasi", peran: "pusat", pusat: null, folder });
    }
  }, []);

  /** Kasir: simpan Pusat dan pengaturan lama, lalu menyambung sendiri tanpa kode sampai Pusat siap (rancangan 8.5). */
  const mulaiKasir = useCallback(async (namaPusat: string) => {
    const g = ++giliran.current;
    setErr("");
    setSibuk(true);
    let kv: Record<string, string> = {};
    let nasib: NasibPengaturan = { status: "gagal", diganti: [] };
    try {
      await pusat.awalPilih("kasir", namaPusat);
      simpanTanda(true);
      const baca = await pakaiPengaturanLama("kasir");
      kv = baca.kv;
      nasib = baca.nasib;
      if (baca.fotoFolder) tandaiFotoLama();
    } catch (e) {
      setSibuk(false);
      setErr(errText(e));
      return;
    }
    setSibuk(false);
    let perawatan = false;
    setLayar({ jenis: "menunggu-pusat", pusat: namaPusat, perawatan });
    for (;;) {
      let h: Awaited<ReturnType<typeof lama.tungguPusat>> = { status: "menunggu" };
      try { h = await lama.tungguPusat(); } catch { /* coba lagi */ }
      if (g !== giliran.current) return;
      if (h.status === "tersambung") {
        simpanTanda(false);
        await muatStatusPusat();
        if (g !== giliran.current) return;
        setLayar({ jenis: "ringkasan-kasir", pusat: namaPusat, pengaturan: nasib, sisa: daftarSisa(kv, 0, 0, false, false, nasib) });
        return;
      }
      if (h.status === "perlu-kode") {
        simpanTanda(false);
        setN({ mode: "kasir", nama: namaPusat, kode: "" });
        setDariLama(true);
        setInfo(`Komputer ${namaPusat} meminta kode sambung. Ketik kode yang tampil di layar komputer Pusat.`);
        setLayar({ jenis: "pilihan" });
        return;
      }
      if ((h.status === "perawatan") !== perawatan) {
        perawatan = h.status === "perawatan";
        setLayar({ jenis: "menunggu-pusat", pusat: namaPusat, perawatan });
      }
      await new Promise((r) => setTimeout(r, 5000));
      if (g !== giliran.current) return;
    }
  }, []);

  /** Komputer ini ternyata tempat data toko (mis. nama atau alamatnya berubah): jalankan alur Pusat walau dianggap kasir. */
  const jadikanPusat = async () => {
    if (sibuk) return;
    setErr("");
    let d: DeteksiLama = { ada: false };
    try { d = await lama.deteksi(); } catch { /* ditangani di bawah */ }
    if (!d.ada) {
      setErr("Toko Pro lama tidak ditemukan di komputer ini, jadi data toko tidak bisa diambil. Pilih Atur sendiri.");
      return;
    }
    simpanTanda(false);
    // Pengaturan lama tadi dipakai sebagai kasir; pakai lagi sebagai Pusat supaya pengaturan cadangan ikut.
    lupakanPengaturanLama();
    await mulaiPusat(d.folder, true);
  };

  const lanjut = async () => {
    if (sibuk) return;
    setSibuk(true);
    setErr("");
    setInfo("");
    try {
      await terapkanPeran(n, true);
      props.onSelesai();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSibuk(false);
    }
  };

  if (layar.jenis === "memuat") return null;

  if (layar.jenis === "konfirmasi") {
    const l = layar;
    if (l.peran === "pusat") {
      return (
        <Kartu judul="Kami menemukan Toko Pro lama di komputer ini." atas={props.namaUsaha} label="Pindah dari Toko Pro lama"
          kaki={<>
            <Button type="button" variant="outline" className="h-8 text-xs font-semibold" onClick={() => keAturSendiri()}>Atur sendiri</Button>
            <Button type="button" autoFocus className="h-8 min-w-28 text-xs font-semibold" onClick={() => void mulaiPusat(l.folder)}>
              <span>Mulai</span><Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            </Button>
          </>}>
          <p>Komputer ini adalah tempat data toko Anda. Toko Pro baru akan mengambil data barang, transaksi, pelanggan, dan pengguna dari Toko Pro lama, lalu menyiapkan komputer ini sebagai Pusat untuk komputer kasir lain.</p>
          <p><strong>Tutup dulu Toko Pro lama di semua komputer toko.</strong> Data di Toko Pro lama tidak diubah. Transaksi yang dibuat di Toko Pro lama setelah data diambil tidak ikut pindah.</p>
          <p>Setelah data pindah, Windows akan bertanya apakah Toko Pro boleh menerima komputer kasir. Pilih <strong>Ya</strong>.</p>
          {err && <Alert>{err}</Alert>}
        </Kartu>
      );
    }
    const namaPusat = l.pusat ?? "";
    return (
      <Kartu judul="Kami menemukan Toko Pro lama di komputer ini." atas={props.namaUsaha} label="Pindah dari Toko Pro lama"
        kaki={<>
          <Button type="button" variant="outline" className="h-8 text-xs font-semibold" disabled={sibuk} onClick={() => keAturSendiri(namaPusat)}>Atur sendiri</Button>
          <Button type="button" autoFocus className="h-8 min-w-28 text-xs font-semibold" disabled={sibuk} onClick={() => void mulaiKasir(namaPusat)}>
            <span>Sambungkan</span><Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
          </Button>
        </>}>
        <p>Komputer ini adalah komputer kasir yang tersambung ke <strong>{namaPusat}</strong>. Toko Pro baru akan tersambung ke komputer yang sama, dan memakai pengaturan struk dan kasir yang sama dengan Toko Pro lama.</p>
        {err && <Alert>{err}</Alert>}
      </Kartu>
    );
  }

  if (layar.jenis === "tunggu-tutup") {
    return (
      <Kartu judul="Menunggu Toko Pro lama ditutup" atas={props.namaUsaha}
        kaki={<Button type="button" variant="outline" className="h-8 text-xs font-semibold" onClick={() => keAturSendiri()}>Atur sendiri</Button>}>
        <Sedang>
          <p>Toko Pro lama masih terbuka di komputer ini. Tutup Toko Pro lama, lalu Toko Pro baru akan melanjutkan sendiri.</p>
        </Sedang>
      </Kartu>
    );
  }

  if (layar.jenis === "pindah") {
    return (
      <Kartu judul="Mengambil data dari Toko Pro lama" atas={props.namaUsaha}>
        <Sedang>
          <p>Tunggu sebentar dan jangan matikan komputer. Kalau datanya banyak, ini bisa makan beberapa menit.</p>
          {kemajuan && <p className="text-xs text-muted-foreground">{kemajuan}</p>}
        </Sedang>
      </Kartu>
    );
  }

  if (layar.jenis === "ringkasan-pusat") {
    const { hasil, sisa, pengaturan } = layar;
    return (
      <Kartu judul="Komputer ini sudah jadi Pusat." atas={props.namaUsaha}
        kaki={<Button type="button" autoFocus className="h-8 min-w-28 text-xs font-semibold" onClick={props.onSelesai}><span>Mulai pakai</span><Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd></Button>}>
        <p>
          Data dari Toko Pro lama sudah pindah: {angka(hasil.barang)} barang, {angka(hasil.transaksi)} transaksi, dan {angka(hasil.pelanggan)} pelanggan.
          {hasil.foto.tersalin > 0 ? ` ${angka(hasil.foto.tersalin)} foto barang ikut pindah.` : ""}
        </p>
        <p>{kalimatPengaturan(pengaturan)}</p>
        <p className="text-xs text-muted-foreground">Komputer kasir lain bisa tersambung sendiri, tanpa kode, sampai pukul 23.59 hari ini, atau sampai {MAKS_OTOMATIS} komputer sudah tersambung. Setelah itu, Manager membuat kode sambung di menu Komputer Pusat. Di menu itu, Manager juga bisa menutup masa ini lebih awal dan memutuskan komputer yang tidak dikenal.</p>
        {hasil.galatServer && <Alert>{hasil.galatServer}</Alert>}
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold">Yang perlu Anda tahu</h2>
          <Daftar butir={sisa} />
        </div>
      </Kartu>
    );
  }

  if (layar.jenis === "menunggu-pusat") {
    const l = layar;
    return (
      <Kartu judul={`Menunggu komputer Pusat (${l.pusat})…`} atas={props.namaUsaha}
        kaki={<>
          <Button type="button" variant="outline" className="h-8 text-xs font-semibold" onClick={() => keAturSendiri(l.pusat)}>Atur sendiri</Button>
          {lamaMenunggu && !l.perawatan && (
            <Button type="button" className="h-8 text-xs font-semibold" disabled={sibuk} onClick={() => void jadikanPusat()}>Jadikan komputer ini Pusat</Button>
          )}
        </>}>
        <Sedang>
          {l.perawatan ? (
            <p>Komputer {l.pusat} sedang mengambil data dari Toko Pro lama. Tunggu sebentar.</p>
          ) : (
            <>
              <p>Pasang Toko Pro baru di komputer {l.pusat}, lalu buka sekali. Komputer ini akan tersambung sendiri begitu {l.pusat} siap.</p>
              <p>Toko Pro lama di komputer {l.pusat} juga harus ditutup.</p>
            </>
          )}
        </Sedang>
        {lamaMenunggu && !l.perawatan && (
          <Alert kind="info">Komputer Pusat belum ditemukan. Kalau data toko ada di komputer ini, jadikan komputer ini Pusat.</Alert>
        )}
        {err && <Alert>{err}</Alert>}
      </Kartu>
    );
  }

  if (layar.jenis === "ringkasan-kasir") {
    const { pusat: namaPusat, sisa, pengaturan } = layar;
    return (
      <Kartu judul={`Komputer ini sudah tersambung ke ${namaPusat}.`} atas={props.namaUsaha}
        kaki={<Button type="button" autoFocus className="h-8 min-w-28 text-xs font-semibold" onClick={props.onSelesai}><span>Mulai pakai</span><Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd></Button>}>
        <p>{kalimatPengaturan(pengaturan)}</p>
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold">Yang perlu Anda tahu</h2>
          <Daftar butir={sisa} />
        </div>
      </Kartu>
    );
  }

  return (
    <Kartu judul="Bagaimana Toko Pro dipakai di toko Anda?" atas={props.namaUsaha} label="Cara memakai Toko Pro"
      kaki={
        <Button type="button" variant="default" size="default" disabled={sibuk} className="h-8 min-w-28 text-xs font-semibold" onClick={() => void lanjut()}>
          <span>{n.mode === "kasir" ? "Sambungkan" : "Lanjut"}</span>
          <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
        </Button>
      }>
      <PilihanPeran nilai={n} onUbah={setN} dariLama={dariLama} disabled={sibuk} onEnter={() => void lanjut()} autoFocus />
      {info && <Alert kind="info">{info}</Alert>}
      {err && <Alert>{err}</Alert>}
      {komputer?.perluMulaiUlang && <Alert kind="info">Tutup lalu buka lagi Toko Pro supaya pilihan ini berlaku.</Alert>}
    </Kartu>
  );
}
