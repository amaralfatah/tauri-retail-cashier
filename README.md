# Toko Pro (Tauri + Rust + React)

Ini versi baru Software Toko Pro Unlimited (VB6 + Firebird), dibangun ulang dari hasil analisis di `../analisis`.
Skema database, nomor transaksi, dan aturan stoknya sama dengan aplikasi lama, jadi data lama bisa dipindahkan.

## Isi

Semua layar dibangun dari layout form VB6 asli (`src/vb/forms.json`, diekspor oleh `tools/export_forms.py`) lewat `src/vb/VbForm.tsx`.
Jendela utama meniru FrmMain: toolbar 11 tombol, menu popup dari tabel `MDMENU`, jendela anak, dan statusbar.

| Menu | Isi |
|---|---|
| Master Data | Barang (multi satuan, harga level, harga tingkat, foto), kelompok, kategori, satuan, pelanggan (cek poin), supplier, karyawan. Export CSV dan cetak daftar. |
| Penjualan | Order penjualan (SO), transaksi penjualan (kasir, ambil order, pending, promo, bonus, PDP, poin, surat jalan, SPK gudang), retur penjualan, pelunasan piutang. |
| Pembelian | Order pembelian (PO), transaksi pembelian, retur per transaksi dan per barang, pelunasan hutang. |
| Inventori | Stok awal, stok opname, cetak barcode, cetak price tag, katalog, promo diskon, promo bonus, diskon PDP. |
| Laporan | Filter asli lalu preview cetak: penjualan, pembelian, order, retur, pelunasan, piutang, hutang, stok, terlaris, omset, opname, laba rugi, kas. |
| Keuangan | Transaksi kas masuk/keluar dengan saldo berjalan. |
| Pengaturan | Pengaturan program, database, alat bantu (backup, restore, cek, perbaikan, hapus data), impor Excel/CSV, jenis non tunai, pengguna dengan hak akses per menu, Verifikasi Admin, panduan, dashboard, notifikasi jatuh tempo. |

Belum ada: registrasi/aktivasi (sengaja tidak ditiru), laci uang (cash drawer), tukar poin sebagai pembayaran (tidak ditemukan di aplikasi lama). Dialog pilih file bawaan sistem sudah dipakai untuk impor Excel, foto barang, folder foto, dan ekspor laporan; lokasi folder backup masih diketik.

## Aturan yang ditiru dari aplikasi lama

- Nomor transaksi: `KODE + yymm + "-" + 5 digit`, misalnya `TJ2611-00001`. Kas `KS…`, piutang `PS…`, hutang `HS…`.
- Stok diubah oleh trigger SQLite `transaksidetil_insert`, port langsung dari trigger Firebird `TRANSAKSIDETIL_INSERT`.
  `STOKAKHIR = STOKAWAL + STOKMASUK - STOKKELUAR + STOKOPNAME`, hanya untuk jenis `Barang`.
- `TRANSAKSIDETIL.JML` = jumlah dalam satuan dasar, `JMLJUAL` = jumlah dalam satuan transaksi, `HRGTERJUAL` = harga per satuan transaksi.
- Pelanggan/pemasok umum memakai kode `Tunai`.

Yang merupakan keputusan desain baru (tidak terbukti dari aplikasi lama): kode `HS` untuk hutang pemasok, kategori kas pembelian
"Harga pokok penjualan", pembayaran non tunai dicatat sebagai kas masuk, dan `SUBTOTAL` sekarang diisi (data lama menyimpan 0,
jadi laporan menghitung `JMLJUAL × HRGTERJUAL`).

## Menjalankan

```bash
npm install
npm run tauri dev
```

Database ada di `~/Library/Application Support/com.tokopro.app/tokopro.db` (macOS). Variabel `TOKOPRO_DB` bisa menunjuk ke file lain.

## Memindahkan data lama

Butuh container Firebird 2.5 yang membuka `datapos.fdb` (lihat `../analisis/README.md`), lalu:

```bash
python3 -I tools/import_firebird.py --container tokopro-fb --fdb /data/DATAPOS.FDB \
  --out "$HOME/Library/Application Support/com.tokopro.app/tokopro.db"
```

Skrip menolak menimpa file yang sudah ada kecuali diberi `--force`. Password user lama tidak bisa dibaca (dienkripsi `ModEncrypt`),
jadi semua user hasil impor masuk dengan password sementara `admin` lalu membuat password baru.

## Tes

```bash
cd src-tauri && cargo test
```
