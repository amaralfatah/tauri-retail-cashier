# Rancangan Branding KasirJet

Status: nama sudah diputuskan (27 November 2026). Logo, warna, dan langkah penggantian nama di aplikasi masih usulan.

## Ringkasan

- **Nama merek: KasirJet.** Ditulis satu kata, dengan K dan J besar. Versi berbayar ditulis "KasirJet Pro": Pro terpisah, karena itu nama versinya, bukan bagian dari merek.
- **Di dalam aplikasi tertulis "KasirJet".** Jangan disingkat jadi "Kasir": di versi PC kata itu sudah berarti komputer kasir (lawan dari komputer Pusat), jadi kalimat seperti "Tutup lalu buka lagi Kasir" membingungkan.
- **Sararia hanya di belakang layar:** nama penerbit di Play Store dan installer, serta "oleh Sararia" di Pengaturan → Tentang. Sararia tidak muncul di nama, ikon, atau materi promosi.
- **Satu nama untuk dua aplikasi yang datanya terpisah.** Ini harus dikatakan terang-terangan (lihat bagian 3).
- **Semua fitur gratis saat rilis.** Versi berbayar nanti bernama "KasirJet Pro".

## 1. Dua aplikasi di bawah satu nama

| Folder | Nama sekarang | Nama baru | Cara kerja |
|---|---|---|---|
| `flutter_sararia_cashier` + `laravel-sararia-cashier` | Sararia Kasir (`kasir.sararia.com`) | **KasirJet** | HP dan tablet, data dikirim ke server, pemilik mengelola toko dari web |
| `tokopro-app` | Toko Pro | **KasirJet untuk PC** | Komputer Windows, data di komputer toko, beberapa komputer kasir tersambung lewat jaringan toko, tanpa akun dan tanpa internet |

Kata "untuk PC" hanya dipakai di halaman unduh, nama file installer, dan judul toko aplikasi. Di dalam aplikasi cukup "KasirJet".

## 2. Aturan penulisan nama

| Tempat | Tulisan |
|---|---|
| Judul jendela PC, layar login, pesan, dan panduan di dalam aplikasi | KasirJet |
| Label ikon di HP | KasirJet |
| Play Store (HP dan tablet) | KasirJet: Kasir Gratis (22 huruf, batas Play Store 30) |
| Halaman unduh dan installer versi komputer | KasirJet untuk PC |
| Versi berbayar nanti | KasirJet Pro |
| Pengaturan → Tentang | KasirJet, versi, lalu "oleh Sararia" |

Jangan tulis "Kasir Jet", "Kasirjet", "KASIRJET" (kecuali di struk yang memang huruf besar semua), "KasirJetPro", "KasirJet by Sararia", atau "Sararia KasirJet".

Kata "POS" tidak dipakai sebagai nama, tetapi boleh muncul di judul atau deskripsi toko aplikasi sebagai kata kunci tambahan, seperti yang dilakukan pesaing ("Kasir Pintar® - POS").

## 3. Data terpisah, dikatakan terang-terangan

Kedua aplikasi memakai nama yang sama, jadi pembeli bisa mengira datanya menyatu. Tulis sekali di halaman unduh dan di layar pertama KasirJet untuk PC:

> Data tersimpan di komputer ini, terpisah dari KasirJet di HP.

Bantu pembeli memilih dengan satu pertanyaan di halaman unduh:

> **Kasir Anda pakai HP atau komputer?**
> HP atau tablet: KasirJet. Komputer dengan scanner: KasirJet untuk PC.

## 4. Posisi

| | KasirJet | KasirJet untuk PC |
|---|---|---|
| Perangkat kasir | HP Android dan tablet | Komputer Windows dengan scanner dan printer struk |
| Internet | Perlu sesekali, untuk mengirim data ke server | Tidak perlu (hanya untuk pembaruan aplikasi) |
| Pemilik memantau | Dari mana saja, lewat web | Di toko |
| Cocok untuk | Warung, toko kecil, pemilik yang sering tidak di toko | Semua toko yang berjualan dengan komputer: kasir bekerja dengan scan dan ketik, tanpa gambar barang |

Kalimat utama (usulan):

| Untuk | Kalimat |
|---|---|
| KasirJet | "Kasir jalan di HP, toko Anda kelola dari laptop." (sudah dipakai di `welcome.tsx`) |
| KasirJet untuk PC | "Aplikasi kasir PC gratis. Scan, ketik, bayar, secepat kasir minimarket." |

Jangan memakai klaim yang belum ada di aplikasi, misalnya laporan versi PC di HP atau sinkron antara kedua aplikasi.

## 5. Dasar keputusan

Data yang dipakai saat memilih nama (dicek 24 sampai 27 November 2026):

- **Google Trends, Indonesia, 5 tahun.** Orang mencari "aplikasi kasir" (rata-rata 55), bukan "software pos" (4). "Aplikasi pos" (47) bercampur dengan pencarian Pos Indonesia. Kata tambahan yang paling sering dicari adalah "gratis" (35). Untuk komputer, orang menulis "pc" (19), bukan "komputer" (4) atau "laptop" (1).
- **Play Store.** Aplikasi kasir yang dikenal memakai pola "Kasir + satu kata" (Kasir Pintar, KasirGo, Bisakasir). Nama umum bisa dipakai lebih dari satu penerbit: "Kasir Warung" dipakai dua penerbit. Belum ada aplikasi bernama "Kasir Jet". Ada "JET Merchant" dan "JET Courier", tetapi keduanya bukan aplikasi kasir.
- **PDKI (pangkalan merek DJKI).** Tidak ada data untuk "kasir jet" maupun "kasirjet". Permohonan merek "KASIRKU" di kelas 9 (perangkat lunak) ditolak. Artinya nama berpola "kasir + kata" bisa dianggap terlalu umum kalau didaftarkan sebagai tulisan saja.
- **Domain.** `kasirjet.com`, `kasirjet.id`, dan `kasirjet.co.id` belum terdaftar per 27 November 2026.

## 6. Identitas visual

### Ikon

Diputuskan 27 November 2026: **barcode yang miring ke depan.** Barcode ini asli (Code 128) dan terbaca sebagai teks `kasirjet` kalau di-scan. Garis mendatar di tengahnya adalah sinar scanner. Satu ikon dipakai di kedua aplikasi.

File dan pembuatnya ada di `branding/kasir-jet/` (`node branding/kasir-jet/generate.mjs`):

| File | Dipakai untuk |
|---|---|
| `icon.svg` | Ikon utama di layar: batang putih di biru, bentuk squircle (web, promosi, macOS) |
| `icon-square.svg` | Sama, tapi persegi penuh: sumber `npx tauri icon` dan ikon Android |
| `icon-dark.svg` | Latar tinta `#1d1d1f` |
| `icon-small.svg` | Versi kecil, 48 px ke bawah (taskbar, favicon): lima batang tebal, tidak bisa di-scan |
| `cetak.svg` | Untuk cetak yang ingin bisa di-scan (stiker, spanduk): batang tinta di latar putih |
| `png/*-1024.png` | Hasil ekspor 1024 px dari setiap file di atas |

Yang sudah diuji, dengan pembaca barcode bawaan Chrome pada gambar digital: `icon`, `icon-dark`, `icon-square`, dan `cetak` terbaca `kasirjet` di ukuran 192 px ke atas. Di 160 px ke bawah tidak terbaca, karena 34 batang tipisnya menyatu. Jadi ikon di HP dan di taskbar tidak bisa di-scan. Itu sebabnya ada `icon-small`.

Yang belum diuji: scanner kasir sungguhan, kamera HP, dan hasil cetak. Banyak scanner kasir tidak membaca barcode terbalik (batang terang di latar gelap), jadi untuk materi cetak pakai `cetak.svg`. Sebelum mencetak banyak, cetak satu contoh lalu coba scan.

### Warna

Biru tombol di situs Apple, `#0071e3`, untuk warna merek dan tombol utama di kedua aplikasi. Teks putih di atasnya mencapai kontras 4,7 : 1 dan lolos batas 4,5. Untuk tautan pakai `#0066cc`, dan untuk mode gelap `#2997ff`.

| Aplikasi | Biru sekarang |
|---|---|
| KasirJet (Flutter `brandBlue`, Laravel `--primary`) | `#0066cc`, gelap `#2997ff` |
| KasirJet untuk PC (`src/index.css` `--primary`) | `oklch(0.576 0.196 253)` ≈ `#0077e8` (kontras 4,4 : 1, belum lolos) |

## 7. Urutan kerja

### Tahap 1: amankan nama

- Daftarkan `kasirjet.com` dan `kasirjet.id`.
- Konsultasikan pendaftaran merek "KasirJet" bersama logonya ke konsultan KI, di kelas 9 dan 42 (dan 35 kalau perlu).

### Tahap 2: logo dan warna

- Pasang ikon dari `branding/kasir-jet/` di ketiga tempat:
  - KasirJet untuk PC: **sudah dipasang** (27 November 2026). `src-tauri/icons/` dibuat dengan `npx tauri icon branding/kasir-jet/png/icon-1024.png` (squircle bersudut transparan, cocok untuk taskbar Windows). Lalu ukuran 16, 24, 32, dan 48 px di `icon.ico`, serta `32x32.png`, `Square30x30Logo.png`, `Square44x44Logo.png`, dan `StoreLogo.png`, diganti dengan hasil dari `icon-small-1024.png`. `icon.icns` (macOS) dibuat terpisah dari `png/icon-mac-1024.png`, yang punya jarak tepi grid Apple (badan ikon 824 dari 1024 px), supaya ukurannya sama dengan ikon lain di Dock. Kalau ikon dibuat ulang, ulangi ketiga langkah ini. Saat `npm run tauri dev` berjalan, ikon baru baru terlihat setelah Rust di-compile ulang (misalnya dengan menyimpan ulang `src-tauri/src/lib.rs`), karena Cargo tidak memantau file ikon.
  - Flutter: ikon launcher Android dan iOS.
  - Laravel: `favicon.svg`, `favicon.ico`, dan `apple-touch-icon.png` (sekarang masih logo bawaan Laravel).
- Samakan warna biru (bagian 6).

### Tahap 3: ganti nama di aplikasi

- **KasirJet untuk PC (`tokopro-app`):** **sudah dikerjakan** (27 November 2026). `productName`, judul jendela, dan `<title>` menjadi "KasirJet"; identifier menjadi `com.kasirjet.pc`; aturan firewall menjadi "KasirJet Pusat"; semua teks "Toko Pro" yang berarti aplikasi ini menjadi "KasirJet". "Toko Pro lama" tetap dipakai untuk aplikasi VB6, karena di sana namanya memang Toko Pro. Nama internal tetap: paket `tokopro-app`, file `tokopro.db`, kunci `localStorage` `tokopro.*`, variabel `TOKOPRO_*`. Karena identifier berganti, folder data juga pindah (di macOS `~/Library/Application Support/com.kasirjet.pc/`) dan pengaturan per komputer kembali ke bawaan; instalasi uji di VM perlu dipasang ulang.
- **KasirJet (Flutter):** ganti label di `AndroidManifest.xml` (sekarang `flutter_sararia_cashier`) dan nama tampilan iOS menjadi "KasirJet".
- **Web:** ganti `APP_NAME` dan judul halaman. Putuskan apakah web pindah ke `kasirjet.com` atau tetap di `kasir.sararia.com`.

### Tahap 4: menjangkau pembeli

- Tanda tangan kode (code signing) untuk installer Windows, supaya SmartScreen tidak memperingatkan pembeli.
- Penjual alat kasir di Tokopedia dan Shopee sering memberi software sebagai bonus paket laci, printer, dan scanner. Mereka calon mitra untuk aplikasi gratis.

## 8. Keputusan yang masih terbuka

Urut dari yang paling memengaruhi pekerjaan berikutnya:

1. **Alamat web:** pindah ke `kasirjet.com` atau tetap `kasir.sararia.com`.
2. **Membekukan Flutter untuk Windows dan macOS**, karena versi komputer sudah ditangani `tokopro-app`.
3. **Satu istilah untuk barang dagangan:** "barang" (dipakai versi PC) atau "produk" (dipakai web).
