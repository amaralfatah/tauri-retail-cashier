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
| Pengaturan | Pengaturan program (termasuk cetak struk langsung RAW/ESC-POS & pembuka laci kasir), database, alat bantu (backup, restore, cek, perbaikan, hapus data), impor Excel/CSV, jenis non tunai, pengguna dengan hak akses per menu, Verifikasi Admin, panduan, dashboard, notifikasi jatuh tempo. |

Belum ada: registrasi/aktivasi (sengaja tidak ditiru) dan tukar poin sebagai pembayaran di layar kasir (tidak ditemukan di aplikasi lama; penukaran dan koreksi poin tersedia di layar Poin Member). Dialog pilih file/folder bawaan sistem sudah dipakai di semua pengaturan file (impor Excel, foto barang, folder foto, logo/latar, folder backup, pilih file backup, dan ekspor laporan).

## Aturan yang ditiru dari aplikasi lama

- Nomor transaksi: `KODE + yymm + "-" + 5 digit`, misalnya `TJ2611-00001`. Kas `KS…`, piutang `PS…`, hutang `HP…`.
- Stok diubah oleh trigger SQLite `transaksidetil_insert`, port langsung dari trigger Firebird `TRANSAKSIDETIL_INSERT`.
  `STOKAKHIR = STOKAWAL + STOKMASUK - STOKKELUAR + STOKOPNAME`, hanya untuk jenis `Barang`.
- `TRANSAKSIDETIL.JML` = jumlah dalam satuan dasar, `JMLJUAL` = jumlah dalam satuan transaksi, `HRGTERJUAL` = harga per satuan transaksi.
- Pelanggan/pemasok umum memakai kode `Tunai`.

Yang merupakan keputusan desain baru (tidak terbukti dari aplikasi lama): kategori kas pembelian
"Harga pokok penjualan", pembayaran non tunai dicatat sebagai kas masuk (bila pengaturan Hubungkan Kas aktif), dan `SUBTOTAL` sekarang diisi (data lama menyimpan 0,
jadi laporan menghitung `JMLJUAL × HRGTERJUAL`).

## Menjalankan

```bash
npm install
npm run tauri dev
```

Database ada di `~/Library/Application Support/com.tokopro.app/tokopro.db` (macOS). Variabel `TOKOPRO_DB` bisa menunjuk ke file lain.

## Memindahkan data lama

Cara utama ada di dalam aplikasi, khusus Windows dan akun Manager: Pengaturan, Alat Bantu, Restore Data, lalu "Ambil dari Toko Pro lama".
Aplikasi mencari `DATAPOS.FDB` (lewat `Settings.ini` Toko Pro lama) dan file backup `.fdk`, lalu membacanya memakai Firebird bawaan Toko Pro lama
(`C:\Program Files\Firebird\Firebird_2_5\bin`, atau folder di `TOKOPRO_FB_BIN`). Toko Pro lama harus ditutup dulu. File asli tidak diubah:
aplikasi bekerja pada salinan, lalu membuat cadangan "sebelum-restore" sebelum mengganti data sekarang. Kodenya ada di `src-tauri/src/pindah_lama.rs`.
Untuk menjalankan tesnya terhadap Firebird di Docker: `TOKOPRO_FB_DOCKER=tokopro-fb cargo test pindah_lama`.

Cara cadangan untuk pengembang (skrip, tanpa aplikasi):

Butuh container Firebird 2.5 yang membuka `datapos.fdb` (lihat `../analisis/README.md`), lalu:

```bash
python3 -I tools/import_firebird.py --container tokopro-fb --fdb /data/DATAPOS.FDB \
  --out "$HOME/Library/Application Support/com.tokopro.app/tokopro.db"
```

Skrip menolak menimpa file yang sudah ada kecuali diberi `--force`. Password user lama tidak bisa dibaca (dienkripsi `ModEncrypt`),
jadi semua user hasil impor masuk dengan password sementara `admin` lalu membuat password baru.

## Mode Komputer Pusat

Toko dengan lebih dari satu komputer kasir bisa menjadikan satu komputer sebagai Pusat. Pusat menyimpan semua data toko, dan komputer kasir lain tersambung ke Pusat lewat jaringan, jadi stok dan nomor transaksi selalu sama. Komputer yang tidak memilih apa pun tetap berdiri sendiri seperti biasa. Rancangan lengkapnya ada di `docs/rancangan-komputer-pusat.md`.

**Menjadikan komputer sebagai Pusat.** Manager membuka Pengaturan, Alat Bantu, tab Komputer Pusat, lalu memilih "Jadikan komputer ini Pusat". Windows meminta izin administrator (UAC) untuk satu aturan firewall bernama "Toko Pro Pusat". Aturan itu hanya membuka port 47210 (TCP) untuk Toko Pro, hanya bagi komputer di subnet yang sama, di profil Private, Public, dan Domain. Kalau izin ditolak, tombol "Beri izin" tersedia di tab yang sama. Aturan dibuat ulang bila lokasi program berubah, dan dihapus saat Toko Pro di-uninstall.

**Menyambungkan komputer kasir.** Di Pusat, klik "Tambah komputer kasir" untuk mendapat kode sambung 6 angka (berlaku 10 menit, sekali pakai). Di komputer kasir, pilih "Sambungkan ke Pusat", ketik nama komputer Pusat (atau alamat IP-nya), lalu kodenya. Pusat menampilkan nama dan alamat IP-nya dengan tombol Salin.

**Jaringan.** Kabel RJ45 langsung tanpa router, switch, router, dan Wi-Fi sama-sama bisa dipakai. Pada kabel langsung, Windows memberi alamat `169.254.x.x` yang bisa berubah setelah komputer dinyalakan ulang. Pakai nama komputer, atau pasang IP tetap. Wi-Fi tamu dan isolasi klien di router memblokir sambungan antarkomputer. Port bisa diubah lewat `TOKOPRO_PORT` saat pengembangan.

**Bila Pusat mati.** Komputer kasir menampilkan status Terputus, isian transaksi tetap ada, dan tombol Coba Lagi menyimpan ulang setelah Pusat menyala, dan Pusat memeriksa dulu apakah transaksinya sudah tersimpan. Tidak ada antrean simpan di komputer kasir.

Panduan untuk pengguna toko ada di aplikasi: Bantuan, Panduan Penggunaan, bab "Komputer Pusat dan komputer kasir".

Dua proses di satu komputer untuk pengembangan (lihat bagian 10.2 rancangan), dan uji aturan firewall hanya bisa di Windows. CI rilis (`.github/workflows/release.yml`) mengompilasi kode Windows dan menjalankan `cargo test`.

## Tes

```bash
cd src-tauri && cargo test
```

## Rilis

Installer Windows (64-bit dan 32-bit) dan macOS (Apple Silicon dan Intel) dibuat oleh GitHub Actions
(`.github/workflows/release.yml`) setiap kali tag `v*` di-push.

```bash
npm run versi 1.2.3
git commit -am "Rilis v1.2.3"
git tag v1.2.3
git push origin main v1.2.3
```

`npm run versi` menyamakan versi di `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, dan `Cargo.lock`.
Workflow menolak tag yang versinya berbeda, lalu menjalankan build tampilan dan `cargo test` di Windows sebelum membuat installer.
Hasilnya berupa draft release, jadi periksa dulu lalu terbitkan dari halaman Releases.

### Pembaruan otomatis (sekali setup)

Aplikasi yang sudah terpasang memeriksa versi baru sendiri (ikon panah di bilah atas dan pemberitahuan di layar utama,
tombol Cek Update di Bantuan, Panduan Penggunaan). Pembaruan memakai file `latest.json` di release terbaru dan harus ditandatangani.

1. Kunci penanda tangan sudah dibuat di komputer pengembang: `~/.tauri/tokopro-updater.key` (privat) dan `.key.pub` (publik, sudah ada di `src-tauri/tauri.conf.json`). Kunci privat tidak boleh masuk repo.
2. Di GitHub: Settings, Secrets and variables, Actions, New repository secret. Buat dua secret:
   - `TAURI_SIGNING_PRIVATE_KEY`: tempel seluruh isi file `~/.tauri/tokopro-updater.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: tidak perlu dibuat. Kunci ini dibuat tanpa kata sandi (GitHub tidak menerima secret kosong), dan secret yang tidak ada dibaca workflow sebagai kosong. Buat secret ini hanya kalau suatu hari Anda membuat kunci baru dengan kata sandi.
3. Simpan cadangan file kunci privat di tempat aman (mis. pengelola kata sandi). **Kalau kunci hilang atau diganti, aplikasi yang sudah terpasang tidak bisa menerima pembaruan lagi**, dan pelanggan harus memasang ulang installer secara manual.
4. Pembaruan baru sampai ke pelanggan setelah draft release **diterbitkan (Publish release)**. Selama masih draft, `releases/latest` belum menunjuk ke versi itu.
5. Repo GitHub harus **publik**, karena aplikasi mengunduh `https://github.com/amaralfatah/tauri-retail-cashier/releases/latest/download/latest.json` tanpa login. Kalau repo privat, pembaruan tidak akan ditemukan. Cek status repo di Settings.

Catatan rilis di dialog pembaruan diambil dari bagian "Yang baru" pada `releaseBody` di `release.yml`. Ubah kalimatnya sebelum membuat tag.
Setelah build selesai, job "Cek latest.json" memastikan keempat platform (macOS Apple Silicon dan Intel, Windows 64-bit dan 32-bit) ada di `latest.json`; kalau gagal, jalankan ulang job build yang bermasalah.
Pembaruan Windows memakai installer `-setup.exe` (NSIS) dengan mode `passive` (ada bilah kemajuan, tanpa pertanyaan). Saat pembaruan terpasang, database lama otomatis naik versi dan dicadangkan lebih dulu (`sebelum-update`).
Versi pertama yang membawa fitur ini harus dipasang manual; pembaruan otomatis baru berlaku dari versi berikutnya.

Installer belum ditandatangani, jadi Windows menampilkan peringatan SmartScreen dan macOS bisa menolak membuka `.dmg`.
Aplikasi butuh Windows 10 atau lebih baru (WebView2).
