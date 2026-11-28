# Panduan Reset Password Manager

Pemilik toko yang lupa password Manager bisa meresetnya sendiri tanpa internet. Yang dibutuhkan hanya kode balasan dari Anda (pengembang) lewat WA.

Dokumen ini untuk pengembang dan siapa pun yang melayani permintaan reset.

---

## 1. Alurnya singkat

1. Di layar Login, pemilik toko klik **Lupa kata sandi?**, lalu memilih akun Manager. Kalau hanya ada satu Manager, akun itu langsung terpilih.
2. KasirJet menampilkan **kode permintaan** 8 karakter, misalnya `7KQ2-M9XA`. Pemilik mengirim kode ini ke Anda lewat WA.
3. Anda menghitung **kode reset** 12 karakter dengan `node tools/kode_reset.mjs 7KQ2-M9XA`, lalu membalasnya, misalnya `31RV-9R1H-EZQY`.
4. Pemilik mengetik kode reset dan password baru dua kali. Kalau kodenya cocok, password baru langsung tersimpan dan pemilik langsung masuk sebagai Manager itu.

Fitur ini hanya ada di versi yang sudah memuatnya. Toko yang masih memakai versi lama perlu memperbarui KasirJet dulu. Datanya tetap aman.

## 2. Kenapa bisa cocok padahal offline

KasirJet di toko dan alat di laptop Anda menyimpan **kunci rahasia yang sama**. Kunci ini 32 byte dan ditanam ke aplikasi saat build release.

- Kode permintaan dibuat acak oleh KasirJet, lalu disimpan di database toko.
- Kode reset dihitung dari kode permintaan dan kunci: `HMAC-SHA256(kunci, kode permintaan)`. Hasilnya diambil 60 bit pertama, lalu ditulis dalam Base32 Crockford.
- KasirJet menghitung rumus yang sama dengan kode permintaan yang ia simpan, lalu membandingkannya dengan kode yang diketik pemilik.

Tanpa kunci, tidak ada yang bisa menebak kode reset dari kode permintaan. Karena itu tidak perlu server atau internet.

Huruf yang mudah tertukar sudah ditangani. Huruf besar atau kecil, spasi, dan tanda `-` tidak berpengaruh. `O` dibaca `0`, sedangkan `I` dan `L` dibaca `1`.

## 3. Aturan yang berlaku

| Aturan | Rinciannya |
|---|---|
| Hanya akun Manager | Akun Supervisor dan Kasir tidak muncul di pilihan. |
| Hanya Manager yang aktif | Akun yang dinonaktifkan tidak bisa direset. |
| Hanya di komputer Pusat | Di komputer kasir, dialog hanya menampilkan "Silakan lakukan dari komputer Pusat." |
| Berlaku 24 jam | Setelah 24 jam, pemilik harus meminta kode permintaan baru. |
| Paling banyak 5 kali salah | Pada salah yang kelima, permintaan dibatalkan dan pemilik harus meminta kode baru. Sebelum itu, KasirJet menampilkan sisa kesempatan. |
| Kode permintaan tidak berubah | Kalau pemilik menutup lalu membuka dialog lagi dalam 24 jam, kode permintaannya tetap sama. Kode reset yang sudah Anda kirim tetap bisa dipakai. |
| Sekali pakai | Setelah reset berhasil, permintaan itu dihapus. |
| Tercatat | Setiap reset yang berhasil masuk ke log aplikasi: "Password Manager {iduser} direset dengan kode dari pengembang". |

Nama akun dicocokkan persis, termasuk huruf besar dan kecilnya. Database hasil migrasi bisa punya `ADMIN` (Manager) dan `Admin` (Supervisor) sekaligus. Yang direset hanya akun yang dipilih di dialog.

## 4. Melayani permintaan reset

1. Pastikan yang meminta memang pemilik toko itu. Siapa pun yang mendapat kode reset bisa mengambil alih akun Manager.
2. Jalankan perintah ini dari folder `tokopro-app`, dengan kode yang dikirim pemilik:

   ```bash
   node tools/kode_reset.mjs 7KQ2-M9XA
   ```

3. Balas dengan kode reset yang tercetak. Contoh balasan:

   > Ini kode reset Anda: **31RV-9R1H-EZQY**. Ketik kode ini di kolom kode reset, lalu buat password baru. Kode berlaku sampai 24 jam sejak Anda membuka Lupa kata sandi.

Alat ini membaca kunci dari env `KASIRJET_KUNCI_RESET`. Kalau env itu kosong, alat membaca file `~/.kasirjet/kunci-reset`.

## 5. Menyiapkan kunci (sekali saja)

Build release **sengaja gagal** kalau kunci belum ada, supaya aplikasi tidak pernah dirilis dengan kunci uji.

1. Buat kunci di laptop pengembang:

   ```bash
   node tools/kode_reset.mjs --buat-kunci
   ```

   Kunci tersimpan di `~/.kasirjet/kunci-reset`, di luar repo. Isinya 64 karakter heksa.

2. Pasang secret GitHub. Buka Settings, Secrets and variables, Actions, lalu buat secret `KASIRJET_KUNCI_RESET` berisi seluruh isi file itu. Di macOS, salin isinya dengan:

   ```bash
   pbcopy < ~/.kasirjet/kunci-reset
   ```

3. Simpan cadangan kunci di tempat aman, misalnya password manager.

**Jangan mengganti atau menghilangkan kunci.** Setiap versi KasirJet hanya menerima kode reset dari kunci yang ditanam saat versi itu dibuild. Kalau kunci hilang, Anda tidak bisa lagi membuat kode reset untuk toko yang memakai versi itu. Kalau kunci diganti, toko yang belum memperbarui tetap butuh kunci lama.

## 6. Build debug dan pengujian

| Kondisi | Kunci yang dipakai |
|---|---|
| `cargo test` | Selalu kunci uji: 32 byte `0x00..0x1f` |
| `tauri dev` tanpa env dan tanpa file kunci | Kunci uji |
| `tauri dev` dengan env atau file `~/.kasirjet/kunci-reset` | Kunci asli |
| Build release tanpa env dan tanpa file kunci | Build gagal |

Untuk menghitung kode reset di build debug yang memakai kunci uji:

```bash
node tools/kode_reset.mjs --uji 7KQ2-M9XA
```

Setelah file kunci asli ada di laptop Anda, `tauri dev` ikut memakai kunci asli. Pakai perintah tanpa `--uji`.

Contoh hitungan dengan kunci uji, dipakai di tes Rust dan JS:

| Kode permintaan | Kode reset |
|---|---|
| `7KQ2-M9XA` | `31RV-9R1H-EZQY` |
| `01234567` | `2J84-SSFY-P5RE` |
| `ZZZZZZZZ` | `KXGV-1V5H-8YSK` |

Jalankan tesnya dengan:

```bash
npm run tes:reset
```

```bash
cd src-tauri && cargo test reset
```

## 7. Pesan yang mungkin dilihat pemilik toko

| Pesan | Artinya dan yang perlu dilakukan |
|---|---|
| Kode reset belum cocok. Periksa lagi kodenya. Sisa kesempatan: N. | Ada salah ketik, atau kode reset dibuat dari kode permintaan lain. Minta pemilik mengirim ulang kode permintaan yang tampil sekarang. |
| Kode reset salah 5 kali, jadi permintaan ini dibatalkan. | Pemilik membuka Lupa kata sandi lagi untuk mendapat kode permintaan baru, lalu mengirimnya ke Anda. |
| Kode permintaan sudah lewat 24 jam. | Sama seperti di atas. |
| Kode reset terdiri dari 12 huruf dan angka, mis. XXXX-XXXX-XXXX. | Panjang kode yang diketik salah. |
| Akun ini sedang dinonaktifkan, jadi passwordnya tidak bisa direset. | Akun Manager itu tidak aktif. Minta pemilik memilih Manager lain. |
| Belum ada akun Manager yang aktif di komputer ini. | Tidak ada Manager yang bisa direset. Perlu bantuan langsung dari Anda. |
| Silakan lakukan dari komputer Pusat. | Pemilik membuka dialog di komputer kasir. Minta pemilik pindah ke komputer Pusat. |

Kalau kode reset tetap ditolak padahal kode permintaannya benar, kemungkinan toko memakai versi yang dibuild dengan kunci lain. Periksa versi KasirJet di toko itu.

## 8. Letak kodenya

| File | Isi |
|---|---|
| `src-tauri/src/reset_manager.rs` | Pembuatan kode permintaan, pemeriksaan kode reset, batas 24 jam dan 5 kali salah, penyimpanan password baru |
| `src-tauri/build.rs` | Membaca kunci saat build, menyamarkannya, dan menggagalkan build release tanpa kunci |
| `src-tauri/src/schema.sql`, `migrasi.rs` (langkah 5) | Tabel `reset_manager` (`iduser`, `kode`, `dibuat`, `salah`) |
| `src-tauri/src/jaringan/golongan.rs` | Ketiga perintah reset masuk golongan khusus Pusat |
| `src/components/LupaPasswordDialog.tsx` | Dialog Lupa kata sandi |
| `tools/kode_reset.mjs` | Alat pengembang untuk menghitung kode reset dan membuat kunci |
| `src-tauri/src/tests_reset_manager.rs`, `tools/kode-reset.test.mjs` | Tes |

Rumus di `reset_manager.rs` dan `tools/kode_reset.mjs` harus selalu sama. Kalau salah satunya diubah, ubah juga yang lain dan perbarui contoh hitungan di tes.

## 9. Batas keamanan

- Kunci di dalam aplikasi disamarkan, tetapi tidak benar-benar tersembunyi. Orang yang membongkar file aplikasi bisa menemukannya. Fitur ini melindungi dari pengguna biasa, bukan dari orang yang sengaja membongkar aplikasi.
- Batas 5 kali salah membuat kode reset tidak bisa ditebak dengan mencoba-coba di layar.
- Siapa pun yang memegang file kunci bisa mereset Manager di semua toko yang memakai kunci itu. Jangan simpan kunci di repo, chat, atau tempat yang dibagikan.
