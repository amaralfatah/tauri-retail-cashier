import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, Row } from "../api";
import { dashApi } from "../api/dashboard";
import { orderApi } from "../api/order";
import { addDays, rp, today } from "../format";
import { useApp } from "../appContext";
import { getLocal } from "./localSettings";
import { Dashboard } from "./Dashboard";
import { PindahLama, pindahLamaDitutup, tutupPindahLama } from "./PindahLama";
import { lamaApi } from "../api/keuangan";

type Ringkasan = { jual: number | null; struk: number | null; pending: number | null; menipis: number | null; piutang: number | null };
const KOSONG: Ringkasan = { jual: null, struk: null, pending: null, menipis: null, piutang: null };
const ok = <T,>(p: Promise<T>) => p.then((v) => v, () => null);

/** Ringkasan hari ini untuk kartu di Beranda. Bagian yang gagal dimuat tetap null dan tampil "–". */
function useRingkasan(aktif: boolean) {
  const [r, setR] = useState<Ringkasan>(KOSONG);
  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    const hariIni = today();
    void Promise.all([
      ok(dashApi.data(hariIni)),
      ok(api.listTransaksi("TJ", hariIni, hariIni)),
      ok(orderApi.listPending(addDays(hariIni, -90), hariIni)),
      ok(api.masterList("mdbarang", { limit: 5000, onlyActive: true })),
      ok(dashApi.notifikasi(hariIni)),
    ]).then(([d, struk, pending, barang, notif]) => {
      if (batal) return;
      const brg: Row[] | null = Array.isArray(barang?.rows) ? barang.rows : null;
      setR({
        jual: d ? Number(d.hari_jual) || 0 : null,
        struk: Array.isArray(struk) ? struk.length : null,
        pending: Array.isArray(pending) ? pending.length : null,
        menipis: brg ? brg.filter((b) => Number(b.stokmin) > 0 && Number(b.stokakhir) <= Number(b.stokmin)).length : null,
        piutang: notif ? Number(notif.piutang_jatuh_tempo) || 0 : null,
      });
    });
    return () => { batal = true; };
  }, [aktif]);
  return r;
}

/**
 * Layar Beranda Toko Pro: kalau di Pengaturan Program pilihan Home = Dashboard, tampil Ringkasan Toko (Dashboard);
 * kalau Home = Home Background, tampil pusat operasional toko yang proporsional dan tegas.
 */
export function Home() {
  const [tutup, setTutup] = useState(false);
  const [bukaDash, setBukaDash] = useState(false);
  const { setting, user, go } = useApp();
  const [ajakPindah, setAjakPindah] = useState(false);
  const [bukaPindah, setBukaPindah] = useState(false);
  useEffect(() => {
    if (user.level !== "Manager" || pindahLamaDitutup()) return;
    lamaApi.cari().then((r) => { if (r.data_sekarang.barang === 0 && r.data_sekarang.transaksi === 0) setAjakPindah(true); }).catch(() => undefined);
  }, [user.level]);
  const ringkas = useRingkasan(!((getLocal("home") === "Dashboard" && !tutup) || bukaDash));

  if ((getLocal("home") === "Dashboard" && !tutup) || bukaDash) {
    return <Dashboard onTutup={() => { setTutup(true); setBukaDash(false); }} />;
  }

  const isKasir = user.level === "Kasir";
  type QuickItem = { title: string; meta: string; page: Parameters<typeof go>[0]; primary?: boolean; show: boolean };
  const groups: { title: string; items: QuickItem[] }[] = [
    {
      title: "Transaksi & Kasir",
      items: ([
        { title: "Transaksi Penjualan", meta: "Kasir POS · Scan Barcode", page: "jual", primary: true, show: true },
        { title: "Order Penjualan", meta: "Pesanan pelanggan & uang muka (DP)", page: "orderjual", show: !isKasir },
        { title: "Retur Penjualan", meta: "Pengembalian barang dari pelanggan", page: "returjual", show: !isKasir },
        { title: "Pelunasan Piutang", meta: "Pembayaran tagihan piutang pelanggan", page: "piutang", show: !isKasir },
      ] as QuickItem[]).filter((x) => x.show),
    },
    {
      title: "Inventori & Pembelian",
      items: ([
        { title: "Katalog & Cek Harga", meta: "Cek harga jual, rak, dan stok barang", page: "katalog", show: true },
        { title: "Data Barang", meta: "Master barang, barcode, dan multi satuan", page: "master", show: !isKasir },
        { title: "Transaksi Pembelian", meta: "Penerimaan stok masuk dari supplier", page: "beli", show: !isKasir },
        { title: "Stok Opname", meta: "Penyesuaian stok fisik dengan stok buku", page: "opname", show: !isKasir },
      ] as QuickItem[]).filter((x) => x.show),
    },
    {
      title: "Keuangan, Laporan & Sistem",
      items: ([
        { title: "Transaksi Kas", meta: "Pemasukan, pengeluaran operasional, & saldo", page: "keuangan", show: !isKasir },
        { title: "Laporan Toko", meta: "Penjualan, stok, piutang, dan laba rugi", page: "laporan", show: true },
        { title: "Cetak Barcode", meta: "Cetak label barcode barang", page: "barcode", show: !isKasir },
        { title: "Panduan Penggunaan", meta: "Petunjuk lengkap operasional program", page: "panduan", show: true },
      ] as QuickItem[]).filter((x) => x.show),
    },
  ].filter((g) => g.items.length > 0);

  const angka = (n: number | null) => (n === null ? "–" : rp(n));
  type Kartu = { judul: string; nilai: string; ket: string; page?: Parameters<typeof go>[0]; tegas?: boolean; show: boolean };
  const kartu: Kartu[] = ([
    { judul: "Penjualan hari ini", nilai: ringkas.jual === null ? "–" : `Rp ${rp(ringkas.jual)}`, ket: ringkas.struk === null ? "Jumlah struk belum bisa dimuat" : `${rp(ringkas.struk)} struk`, page: !isKasir ? "laporan" : undefined, show: true },
    { judul: "Transaksi pending", nilai: angka(ringkas.pending), ket: "Belanjaan yang belum dibayar. Buka di layar kasir.", page: "jual", show: true },
    { judul: "Stok menipis", nilai: angka(ringkas.menipis), ket: "Barang yang stoknya sudah di batas minimum", page: "master", tegas: (ringkas.menipis ?? 0) > 0, show: !isKasir },
    { judul: "Piutang jatuh tempo", nilai: angka(ringkas.piutang), ket: "Transaksi yang belum dilunasi pelanggan", page: "piutang", tegas: (ringkas.piutang ?? 0) > 0, show: !isKasir },
  ] as Kartu[]).filter((k) => k.show);

  return (
    <div className="tp-scroll-always flex h-full min-h-0 flex-col justify-between gap-4 bg-background p-4 font-sans text-foreground" data-form="FrmZHome">
      <div className="flex w-full flex-col gap-4">
        {ajakPindah && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3" data-slot="ajak-pindah">
            <p className="text-sm font-medium text-foreground">Anda sebelumnya memakai Toko Pro versi lama? Pindahkan data Anda ke sini.</p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="default" className="h-8 bg-background px-3 text-xs font-medium" onClick={() => { tutupPindahLama(); setAjakPindah(false); }}>Nanti saja</Button>
              <Button type="button" variant="default" size="default" className="h-8 px-3.5 text-xs font-semibold" onClick={() => setBukaPindah(true)}>Pindahkan Data</Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <h1 className="text-base font-bold tracking-tight text-foreground">{setting.namausaha || "Toko Pro"}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[setting.bidangusaha, setting.alamat, setting.kota, setting.tlp && `Telp. ${setting.tlp}`].filter(Boolean).join(" · ") || "Sistem Kasir & Inventori Toko Retail"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isKasir && (
              <Button type="button" variant="outline" size="default" className="h-8 bg-background px-3 text-xs font-medium" onClick={() => setBukaDash(true)}>
                Ringkasan Toko
              </Button>
            )}
            <Button type="button" variant="default" size="default" className="h-8 px-3.5 text-xs font-semibold" onClick={() => go("jual")}>
              Buka Kasir Penjualan
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {groups.map((g) => (
            <div key={g.title} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5">
              <div className="border-b border-border pb-2 text-xs font-semibold text-foreground">
                {g.title}
              </div>
              <div className="flex flex-col gap-2">
                {g.items.map((c) => (
                  <button
                    data-slot="home-menu"
                    key={c.title}
                    type="button"
                    onClick={() => go(c.page)}
                    className={`flex items-center justify-between rounded-md border px-3.5 py-2.5 text-left transition-colors ${
                      c.primary
                        ? "border-primary bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                        : "border-border bg-background text-foreground hover:border-foreground/30 hover:bg-muted/50"
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold">{c.title}</div>
                      <div className={`mt-0.5 text-[11px] ${c.primary ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{c.meta}</div>
                    </div>
                    <span className={`text-xs ${c.primary ? "text-primary-foreground" : "text-muted-foreground"}`}>→</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-foreground">Hari ini di toko Anda</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kartu.map((k) => (
              <Card key={k.judul} size="sm" className="gap-1 px-3.5">
                <button data-slot="home-kartu" type="button" disabled={!k.page} onClick={() => k.page && go(k.page)}
                  className="flex flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:cursor-pointer">
                  <span className="text-xs font-semibold text-foreground">{k.judul}</span>
                  <span className={`text-2xl font-bold tracking-tight tabular-nums ${k.tegas ? "text-destructive" : "text-foreground"}`}>{k.nilai}</span>
                  <span className="text-[11px] text-muted-foreground">{k.ket}</span>
                </button>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-4 border-t border-border pt-2.5 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-semibold text-foreground">Pintas di layar kasir:</span>
          <span className="flex items-center gap-1.5">
            <Kbd className="border border-border bg-card text-foreground">F1</Kbd>
            <span>Scan Barcode</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className="border border-border bg-card text-foreground">F10</Kbd>
            <span>Cari Barang</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className="border border-border bg-card text-foreground">F4</Kbd>
            <span>Bayar</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className="border border-border bg-card text-foreground">Esc</Kbd>
            <span>Tutup Layar</span>
          </span>
        </div>
        <span>Operator aktif: <strong className="font-semibold text-foreground">{user.namakaryawan || user.iduser}</strong> ({user.level})</span>
      </div>
      {bukaPindah && <PindahLama onClose={() => setBukaPindah(false)} />}
    </div>
  );
}
