# Rancangan Branding dan Posisi Kasir Sararia

Status: usulan, belum diputuskan. Rancangan ini mencakup dua aplikasi kasir milik Anda:

| Folder | Nama sekarang | Cara kerja |
|---|---|---|
| `tokopro-app` | Toko Pro | Aplikasi Windows dan macOS (Tauri), data di komputer toko, beberapa komputer kasir tersambung lewat jaringan toko, tanpa akun dan tanpa internet |
| `flutter_sararia_cashier` + `laravel-sararia-cashier` | Sararia Kasir (`kasir.sararia.com`) | Aplikasi HP dan tablet (Flutter), data dikirim ke server, pemilik mengelola toko dari web dengan akun yang sama |

Anggapan: belum ada pengguna lama. Nama "Toko Pro" tidak punya nilai yang perlu dijaga.

## Ringkasan usulan

1. **Satu merek kasir: Sararia Kasir.** Ada dua edisi, dibedakan menurut perangkatnya:
   - **Sararia Kasir** untuk HP dan tablet, dengan web toko (yang sudah ada di `kasir.sararia.com`).
   - **Sararia Kasir Desktop** untuk komputer Windows (sekarang bernama Toko Pro).
2. **Edisi Desktop dibangun dari Toko Pro, bukan dari Flutter.** Toko Pro sudah terasa seperti aplikasi komputer: keyboard, Enter pindah kolom, F-key, tabel padat. Kerja Flutter untuk Windows dan macOS bisa dibekukan.
3. **Data kedua edisi terpisah, dan ini dikatakan terang-terangan.** Pembeli memilih satu edisi sesuai cara tokonya. Pola ini sudah dikenal pemilik usaha di Indonesia, misalnya Accurate dan Zahir yang punya edisi desktop dan online dengan data terpisah.
4. **Satu ikon, satu warna, satu nada untuk kedua edisi.** Ikon keduanya sekarang masih bawaan framework: logo Tauri di Toko Pro, logo Laravel di `kasir.sararia.com`.

## 1. Kenapa satu merek, bukan dua

Pilihan yang ditimbang:

| Pilihan | Untung | Rugi |
|---|---|---|
| **A. Satu merek, dua edisi: Sararia Kasir dan Sararia Kasir Desktop (usulan)** | Satu nama untuk dipasarkan, satu domain, satu ikon. Pembeli yang mencari "aplikasi kasir" menemukan keduanya di satu tempat. Sesuai keinginan awal Anda: Sararia Kasir juga ada di komputer. | Pembeli bisa mengira datanya menyatu. Harus dijelaskan di halaman unduh dan di dalam aplikasi. |
| B. Dua produk: Sararia Kasir dan Sararia Toko (atau Sararia POS) | Jelas bahwa keduanya aplikasi berbeda | Dua nama yang artinya mirip membingungkan. "Toko" bisa dikira pembuat toko online. Biaya promosi dua kali. |
| C. Dua merek: Sararia Kasir dan Toko Pro berdiri sendiri | Toko Pro bebas dari aturan keluarga Sararia | "Toko Pro" nama umum yang sulit didaftarkan sebagai merek dan sulit dicari. Tanpa pengguna lama, tidak ada alasan menyimpannya. |

Usulan: **pilihan A.** Kalau suatu hari edisi Desktop bisa mengirim data ke akun `kasir.sararia.com` (misalnya komputer Pusat menyalin penjualan ke server), dua edisi ini menjadi satu produk sungguhan tanpa ganti nama.

### Soal bahasa nama

`FAMILY.md` bagian 2 meminta nama produk berbahasa Inggris (Tasks, Prayer, Portfolio). "Sararia Kasir" melanggar aturan itu, tetapi tetap disarankan dipakai. Pembelinya pemilik toko di Indonesia, yang mencari "aplikasi kasir", bukan "cashier app". Usulan: tambahkan pengecualian di `FAMILY.md` untuk produk usaha yang pembelinya berbahasa Indonesia. Kalau Anda ingin tetap patuh aturan lama, padanannya "Sararia POS", tetapi kata itu kurang akrab bagi toko kecil.

## 2. Posisi

### Pembagian edisi

| | Sararia Kasir | Sararia Kasir Desktop |
|---|---|---|
| Perangkat kasir | HP Android dan tablet | Komputer Windows dengan scanner dan printer struk |
| Internet | Perlu sesekali, untuk mengirim data ke server | Tidak perlu (hanya untuk pembaruan aplikasi) |
| Data | Di server, bisa dibuka dari web | Di komputer toko |
| Banyak kasir | Banyak HP, satu akun toko | Beberapa komputer, satu komputer Pusat, lewat kabel atau Wi-Fi toko |
| Pemilik memantau | Dari mana saja, lewat web | Di toko |
| Cocok untuk | Warung, toko kecil, usaha yang baru mulai, pemilik yang sering tidak di toko | Toko grosir, sembako, bangunan, onderdil, swalayan kecil: barang ribuan, multi satuan, harga level, jual dan beli tempo |
| Tidak cocok untuk | Toko yang internetnya sering mati, kasir yang mengetik cepat di keyboard | Pemilik yang ingin melihat laporan dari HP, usaha banyak cabang |

Kolom "Cocok untuk" adalah dugaan dari fitur kedua aplikasi. Cocokkan dengan calon pembeli nyata.

### Satu pertanyaan untuk memilih edisi

Di halaman unduh, bantu pembeli memilih dengan satu pertanyaan:

> **Kasir Anda pakai HP atau komputer?**
> HP atau tablet: Sararia Kasir. Komputer dengan scanner: Sararia Kasir Desktop.

### Pernyataan posisi (untuk pegangan internal)

> Sararia Kasir adalah aplikasi kasir dan stok untuk toko di Indonesia, di HP maupun di komputer. Edisi HP untuk pemilik yang ingin memantau toko dari mana saja. Edisi Desktop untuk toko ramai yang tidak boleh berhenti berjualan saat internet mati.

### Peta pesaing

Bagian ini dugaan dari pengetahuan umum, belum diperiksa ulang. Cek harga dan fitur terbaru sebelum dipakai di materi promosi.

| Edisi | Pesaing | Cara menang |
|---|---|---|
| Sararia Kasir | Kasir Pintar, Majoo, Moka, Qasir, Pawoon | Teks dan tampilan yang lebih jelas, web toko yang lengkap, harga (perlu diputuskan) |
| Sararia Kasir Desktop | iPOS dan aplikasi kasir Windows lain | Tampilan modern, pembaruan otomatis, banyak kasir tanpa server, tanpa biaya bulanan (kalau model harga mendukung) |

### Soal Flutter di komputer

Commit terakhir `flutter_sararia_cashier` menunjukkan Anda sudah membuat tata letak desktop, mode Tabel, dan dukungan Windows. Usulannya:

- Bekukan target Windows dan macOS di Flutter, dan jangan dipasarkan. Pembeli yang memakai komputer diarahkan ke edisi Desktop.
- Tablet tetap didukung, karena tata letak lebar yang sudah dibuat berguna di sana.
- Pemilik yang membuka laptop memakai web toko di `kasir.sararia.com`. Kebutuhan "Sararia Kasir di komputer" bagi pemilik sudah terjawab oleh web itu.

## 3. Aturan penulisan nama

- Tulis "Sararia Kasir" dan "Sararia Kasir Desktop". Setelah penyebutan pertama boleh "Kasir" dan "Kasir Desktop".
- Jangan "SarariaKasir", "Sararia-Kasir", "Kasir by Sararia", atau "Sararia Kasir PC".
- Di aplikasi HP: nama penuh di label launcher dan Play Store ("Sararia Kasir"). Sekarang labelnya masih `flutter_sararia_cashier` di `AndroidManifest.xml`.
- Di aplikasi Desktop: "Sararia Kasir" di judul jendela dan layar login. Kata "Desktop" cukup di installer, nama file unduhan, dan halaman unduh, karena di dalam aplikasi pengguna sudah tahu sedang di komputer.
- Di web toko: judul halaman memakai nama toko pengguna atau "Sararia Kasir". Tanda keluarga "Sararia" di footer (`FAMILY.md` bagian 7).

## 4. Identitas visual

### Ikon

Satu ikon untuk kedua edisi, seperti aplikasi Apple yang ikonnya sama di iPhone dan Mac. Syaratnya:

- Ikut `FAMILY.md` bagian 4 sampai 6: satu benda nyata, siluet padat, detail dari garis negatif, tanpa huruf.
- Terbaca di 16 px untuk taskbar Windows dan di ikon launcher Android.
- Siluetnya berbeda dari ikon Sararia lain (centang, kawung, pohon, rosette, sajadah, pie).

Tiga konsep:

| Konsep | Gambaran | Catatan |
|---|---|---|
| **Etalase toko (usulan)** | Bangunan toko tampak depan dengan tenda bergigi, belang tenda dibuat dari garis negatif | Langsung terbaca "toko". Bentuk lebar (70 × 52) belum dipakai ikon Sararia lain. Tenda jadi bagian aksen. |
| Struk | Kertas struk tegak dengan tepi bawah bergerigi | Mudah tertukar dengan ikon dokumen, Sararia Certificates, dan Sararia Prayer |
| Mesin kasir | Mesin kasir dengan laci | Detailnya banyak, sulit terbaca di 16 px |

Warna: pola **tinta + satu aksen**. Etalase putih di atas tinta `#1d1d1f`, tenda biru. Latar biru penuh tidak disarankan karena Sararia Tasks sudah memakai latar biru `#1868db`.

### Satu biru untuk kedua edisi

| Aplikasi | Biru utama sekarang |
|---|---|
| Sararia Kasir (Flutter `brandBlue`, Laravel `--primary`) | `#0066cc`, gelap `#2997ff` |
| Toko Pro (`src/index.css` `--primary`) | `oklch(0.576 0.196 253)` ≈ `#0077e8`, gelap ≈ `#0486f4` |

Usulan: samakan Toko Pro ke `#0066cc` dan `#2997ff`, ditulis dalam oklch supaya tetap cocok dengan token lain di `index.css`. Cek ulang kontras teks putih di tombol setelah diganti.

### Huruf dan tampilan

Keduanya sudah memakai gaya yang sejalan: netral, biru hanya untuk aksi utama, shadcn di web dan desktop. Lockup produk: glyph etalase + "Sararia Kasir" dalam Inter SemiBold (`FAMILY.md` bagian 3), dipakai di layar login kedua edisi, header web toko, dan halaman unduh.

## 5. Suara dan pesan

### Nada

Sama di kedua edisi: sapaan "Anda", kata sehari-hari di toko (barang, pelanggan, bayar, struk), kalimat pendek. Aturan lengkapnya sudah ada di `CLAUDE.md` Toko Pro bagian "Teks untuk pengguna". Samakan juga istilahnya. Contoh yang perlu dicek: web toko memakai "produk", Toko Pro memakai "barang". Pilih satu, lalu pakai di kedua edisi.

### Kalimat utama

| Untuk | Usulan |
|---|---|
| Merek | "Kasir dan stok toko, di HP atau di komputer." |
| Sararia Kasir | "Kasir jalan di HP, toko Anda kelola dari laptop." (sudah dipakai di `welcome.tsx`, pertahankan) |
| Sararia Kasir Desktop | "Kasir komputer yang tetap jalan tanpa internet." |

### Pesan pendukung edisi Desktop

1. **Tanpa internet.** Listrik menyala, kasir jalan.
2. **Banyak kasir, satu stok.** Sambungkan komputer kasir lewat kabel atau Wi-Fi toko.
3. **Data di komputer Anda.** Tanpa akun dan tanpa server. Cadangkan sendiri ke flashdisk atau folder lain.

Jangan memakai klaim yang belum ada di aplikasi. Contohnya laporan Desktop di HP, data Desktop di web toko, dan sinkron antarcabang.

## 6. Urutan kerja

### Tahap 1: identitas dasar

- Buat glyph etalase di `sararia-logo/generate-apps.mjs`, ekspor PNG, lalu pasang di ketiga tempat:
  - Toko Pro: `npx tauri icon`. Windows butuh `icon.ico` 16, 24, 32, 48, dan 256 px. Pakai varian kecil untuk 16 sampai 32 px.
  - Flutter: ikon launcher Android dan iOS, plus label "Sararia Kasir".
  - Laravel: `favicon.svg`, `favicon.ico`, dan `apple-touch-icon.png`.
- Toko Pro: ganti `productName` jadi "Sararia Kasir", judul jendela, `<title>`, dan teks "Toko Pro" di layar. **Jangan ganti `identifier` (`com.tokopro.app`)**: folder data dan pembaruan otomatis bergantung padanya. Uji dulu apakah perubahan `productName` memindahkan folder pemasangan di Windows, dan apakah pembaruan otomatis dari versi sebelumnya masih jalan.
- Samakan warna biru (bagian 4).

### Tahap 2: satu tempat unduh

- `kasir.sararia.com` menjadi rumah kedua edisi: halaman utama untuk HP dan web, lalu halaman unduh Desktop dengan pertanyaan "Kasir Anda pakai HP atau komputer?".
- Sararia Kasir masuk katalog `next-sararia` (`content/apps/<slug>/`), dengan platform Android, web, dan Windows.
- Kebijakan privasi per edisi. Isinya berbeda: edisi HP menyimpan data di server, edisi Desktop tidak mengirim data ke mana pun.

### Tahap 3: menjangkau pembeli

- Tanda tangan kode (code signing) untuk installer Windows, supaya SmartScreen tidak memperingatkan pembeli.
- Satu halaman perbandingan edisi untuk dibagikan lewat WhatsApp.
- Kelak: impor data dari Sararia Kasir ke edisi Desktop untuk toko yang tumbuh dan pindah ke komputer kasir. Edisi Desktop sudah punya impor Excel. Edisi HP perlu ekspor yang formatnya cocok.

## 7. Keputusan untuk Anda

Urut dari yang paling memengaruhi rancangan:

1. **Satu merek dengan dua edisi (A), dua produk (B), atau dua merek (C)?** Rancangan ini mengusulkan A.
2. **Model harga per edisi.** Edisi HP punya biaya server, jadi langganan masuk akal. Edisi Desktop tidak punya biaya server, jadi sekali bayar per komputer bisa jadi pembeda dari kasir HP berlangganan.
3. **Nama berbahasa Indonesia** sebagai pengecualian di `FAMILY.md`.
4. **Membekukan Flutter untuk Windows dan macOS.**
5. **Satu istilah untuk barang dagangan:** "barang" atau "produk".
6. **Konsep ikon:** etalase (usulan), struk, atau mesin kasir.
7. **Nama penerbit** di installer dan Play Store.
