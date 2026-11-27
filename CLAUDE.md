# Toko Pro (Tauri 2 + Rust + React)

Aplikasi kasir dan stok toko. Ini versi baru dari aplikasi VB6 milik pemilik proyek sendiri (lihat README.md),
jadi nama, ikon, dan tata letak layar lama boleh dipakai.

## Perintah

- `npm run tauri dev`: jalankan aplikasi lengkap (Rust + tampilan). Port Vite 1420.
- `npx tsc --noEmit -p .`: cek tipe. Wajib bersih sebelum selesai.
- `npm run build`: build tampilan. Wajib berhasil sebelum selesai.
- `cargo test` di `src-tauri/`: tes backend, termasuk tes E2E siklus toko (`src-tauri/src/tests_e2e.rs`).
- Lihat tampilan tanpa Tauri: buka `http://localhost:1420` di browser biasa saat `npm run dev` atau `tauri dev` berjalan.
  `src/dev/tauriMock.ts` meniru backend dengan data contoh, hanya saat pengembangan dan hanya di luar jendela Tauri.
  Perintah yang belum ditiru mengembalikan `null` dan tercatat di console sebagai `[tauriMock]`. Tambahkan ke switch-nya kalau perlu.

## Tampilan: sudah pindah penuh ke shadcn (`modern`)

Semua layar dibangun dari form VB6 asli (`src/vb/forms.json`) oleh `VbForm`. Posisi dan ukuran setiap kontrol
berasal dari koordinat VB (twips), dan **tidak boleh diubah**. Kontrol digambar menggunakan komponen shadcn
dengan token tema dari `src/index.css`.

Bawaan konteks di `src/vb/skin.tsx` adalah `"modern"`. Seluruh `VbForm`, `VbWindow`, `VbModal`, `VbGrid`, `VbToolbar`,
`useMsgBox`, `Modal`, `Alert`, dan semua halaman serta dialog aplikasi memakai komponen shadcn dan mendukung mode terang/gelap.

Layar kasir penjualan dan dialog Pembayaran (`BayarDialog`) sengaja menyusun ulang tata letak untuk alur scan, bayar,
lalu kembalian; kontrak `data-f` (mis. `tJmlBayar`, `tDP`, `cmbJenis`) tetap dipakai untuk fokus dan urutan Enter.
Perilakunya tetap mengikuti aplikasi lama: kursor awal di Diskon %, Enter pindah sesuai TabIndex form VB, dan di penjualan
Enter di Jml Bayar baru menyimpan kalau uangnya sudah cukup.

### Peta file

| File | Isi |
|---|---|
| `src/index.css` | Tailwind, token tema (warna, radius, `--font-app`), mode gelap, aturan dasar desktop |
| `src/components/ui/*` | Komponen shadcn (preset `b1ZzrZbr6`, gaya base-mira, Base UI, ikon Lucide) |
| `src/components/app/providers.tsx` | TooltipProvider dan Toaster, dipasang di `main.tsx` |
| `src/lib/theme.ts` | Tema terang/gelap/sistem (pengganti `next-themes`) |
| `src/vb/skin.tsx` | Konteks skin: `VbSkinProvider`, `useModern()` |
| `src/vb/modern.tsx` | Perender kontrol VB versi shadcn (`renderModern`) dan terjemahan warna VB (`permukaan`) |
| `src/vb/modern.css` | Gaya modern untuk bagian yang digambar halaman sendiri: `.tj-grid`, `.vbg`, `.tp-face`, `.cari-data` |
| `src/vb/VbForm.tsx` | `VbForm`, `VbWindow`, `useTinggiJudul()`. Memilih `renderModern` atau `renderDefault` sesuai skin |
| `src/vb/VbGrid.tsx` | `VbGrid`, `VbModal`, `useMsgBox`, `ModalFrame` (sudah sadar skin) |
| `src/components/Modal.tsx` | `Modal` dan `Alert` (sudah sadar skin) |

### Resep memindahkan satu layar ke skin modern

Contoh lengkap: `src/pages/Transaksi.tsx` (cari `TransaksiForm`, `TransaksiIsi`, `BayarDialog`).

1. Pisahkan komponen layar jadi pembungkus dan isi. Pembungkus memasang provider; semua hook (termasuk `useMsgBox`)
   ada di komponen isi, supaya hook itu membaca skin yang benar:
   ```tsx
   export function NamaLayar(props: P) {
     return <VbSkinProvider value="modern"><NamaLayarIsi {...props} /></VbSkinProvider>;
   }
   function NamaLayarIsi(props: P) { const modern = useModern(); /* ... */ }
   ```
2. Buka layarnya di browser (lihat bagian Perintah) dan bandingkan dengan tampilan lama. Kontrol VB biasa sudah otomatis berubah.
3. Atur penekanan lewat bind, bukan lewat CSS:
   - Tombol aksi utama: `cSimpan: { onClick, variant: "default" }`. Tombol lain dibiarkan (bawaan `outline`).
   - Panel atau label yang warnanya perlu khusus: `namaKontrol: { className: "bg-foreground text-background" }`.
   - Kalau objek bind tidak bertipe `Record<string, Bind>`, tulis `variant: "default" as const`.
4. Ganti elemen buatan tangan di halaman:
   - `<button className="btn ...">` → `<Button>` atau `<Button variant="outline">` dari `@/components/ui/button`.
   - `<input>` buatan sendiri → `<Input>` dari `@/components/ui/input`.
   - Warna VB yang ditulis di kode halaman (`style={{ color: vbColor(...) }}`) jangan dipakai saat `modern`.
5. Dialog yang menghitung tinggi jendela sendiri: pakai `formSize(form).height + useTinggiJudul()`, jangan angka 22.
   Latar dialog modern: tambahkan `bg-black/40!` pada `.modal-backdrop`.
6. Tabel atau daftar yang digambar halaman sendiri: tambah gayanya di `src/vb/modern.css` di bawah `.vb-modern`,
   hanya dengan variabel tema.
7. Cek: `npx tsc --noEmit -p .`, `npm run build`, lalu coba alur kerjanya di browser dengan keyboard
   (Enter pindah kolom, F-key, Esc menutup dialog teratas). Cek juga mode gelap lewat tombol tema
   (ikon bulan/matahari) di header. Jangan hanya menambah kelas `dark` di console: `src/lib/theme.ts` juga mengatur
   `color-scheme`, dan tanpa itu tombol tampil putih serta menu header sulit dibaca.

### Arah desain: modern tapi tegas

Pemilik toko membandingkan langsung dengan layar VB lama, dan gaya shadcn bawaan yang pucat terasa lebih buruk untuk kasir.
Ambil bentuk shadcn (sudut membulat, Inter, garis rapi), tetapi pertahankan kekuatan layar lama:

- Kontras tinggi. Label form dan kepala tabel berwarna teks utama (hitam), bukan `text-muted-foreground`.
  Abu-abu hanya untuk teks yang memang sekunder (keterangan di panel gelap, status bar).
- Setiap bagian layar punya penanda warna: panel angka besar `bg-display text-display-foreground` (selalu gelap,
  juga di mode gelap), judul bonus `bg-success text-success-foreground`, kepala tabel, toolbar, header, dan footer berlatar `bg-muted` (abu netral).
- Netral seperti aplikasi Apple: semua warna netral di `index.css` abu-abu murni (chroma 0), dan biru (`--primary`,
  biru sistem Apple) hanya untuk tombol aksi utama, tautan, baris terpilih, dan cincin fokus. Jangan pakai
  latar biru tipis (`bg-primary/6`, `color-mix(... var(--primary) ...)`) untuk permukaan; pakai `bg-muted` atau `bg-accent`.
- Kepala tabel lebih tegas dari isinya (tebal, hitam). Isi tabel 14px.
- Ikon header navigasi memakai Lucide (didaftarkan di `TOOLBAR`, `src/vb/shell.ts`), berwarna `text-primary`;
  menu aktif berlatar `bg-primary`. Jangan kembali ke ikon PNG lama: sulit dirawat dan tidak ikut mode gelap.
  Tombol header memakai `onMouseDown` preventDefault supaya klik tidak mengambil fokus dari kolom scan kasir.
- Fokus keyboard selalu terlihat: `--ring` berwarna biru tema, dan kotak yang hanya bisa dibaca tetap menampilkan cincin fokus.
  Teks kecil (mis. label pintas F4 di tombol) tetap minimal 4,5:1 terhadap latarnya.

### Aturan

- **Ukuran tampilan hanya lewat satu pengaturan global** (Pengaturan → Info Usaha → Ukuran tampilan, per komputer:
  100/115/125%), diterapkan dengan zoom webview Tauri di `src/lib/ukuranTampilan.ts`. Jangan membuat pengaturan
  ukuran huruf per layar. Karena lebar efektif bisa turun sampai ±1093px, pakai tinggi relatif (`h-full`, `max-h-full`)
  alih-alih `vh` untuk kerangka, dan header memakai container query `@min-[1300px]/nav:` untuk versi ringkasnya.

- **Jangan ubah posisi atau ukuran kontrol.** Kalau teks tidak muat, perkecil isinya (padding, ukuran label pintas), bukan kotaknya.
- **Kontrak DOM `VbForm` wajib tetap.** Banyak kode halaman mencari `[data-vb="nama"] input`, `input[data-act]`,
  `[data-f="..."]`. Kotak isian modern harus tetap berisi `<input>`, `<textarea>`, atau `<select>` asli.
  `onChange` bind dipanggil dengan `(nilai string, event)`; CheckBox/OptionButton mengirim `"1"`/`"0"`.
- **Warna hanya dari token tema.** Di TSX pakai kelas Tailwind (`bg-primary`, `text-muted-foreground`, `bg-success/12`).
  Di CSS pakai `var(--primary)`, `var(--border)`, dan seterusnya. Jangan menulis `#hex` atau `rgb()`.
  Catatan: token di `@theme inline` (mis. `--color-primary`) tidak ada sebagai variabel CSS. Pakai nama di `:root` (`--primary`).
- **Campuran warna di CSS pakai `color-mix(in oklab, ...)`, jangan `in oklch`.** Warna netral tema ditulis `oklch(L 0 0)`
  (sudut warna 0° = merah), jadi mencampur biru dengan putih/abu-abu di oklch menghasilkan merah muda.
- Tabel detail transaksi meniru Excel (`.tj-grid` di `modern.css`): garis sel tegas dan kolom No sebagai kepala baris.
  Sel aktif = `input[data-act]`; kalau tidak ada, kotak isian baris kosong untuk barang baru. Hanya sel aktif yang ditandai:
  bingkai 2px di `td::before` (1px keluar, menutupi garis grid) dan pegangan kotak di `td::after`. Seperti Excel, barisnya
  tidak diwarnai; hanya kepala kolom dan nomor baris sel aktif yang diberi abu sedikit lebih gelap (teksnya tidak diwarnai aksen, permintaan pemilik toko),
  dan garis 1px di sisi yang menempel ke sel aktif ikut berwarna `--ring`. Jangan tambah garis aksen terpisah: kepala kolom `sticky` menutupi 1px atas bingkai, jadi garis tambahan selalu tampak terpisah; dengan garis 1px biru, bingkai tampil satu dan sama tebal di keempat sisi (permintaan pemilik toko, 27-11-2026). Satu sel aktif saja: sel kosong tanpa kotak isian tidak ikut ditandai.
  Kotak isian lain tampil tanpa bingkai.
- **Perilaku sel seperti Excel ada di `EntryGrid`** (dipakai semua tabel isian: transaksi, retur, opname, stok awal, promo, cetak label),
  jadi jangan menulisnya ulang per layar. Masuk ke sel = seluruh isi terpilih dan panah kiri/kanan pindah sel. Mengetik, Backspace/Delete,
  F2, atau klik pada sel yang sudah aktif masuk mode edit (`data-edit="1"`, cek dengan `sedangDiedit`); baru di mode itu panah menggeser kursor teks.
- **Elemen HTML bawaan yang Anda buat di skin modern wajib punya `data-slot`** (komponen shadcn sudah punya).
  `App.css` lama masih punya aturan global `input`, `select`, `label`, `kbd`, `button` yang hanya berlaku untuk elemen tanpa `data-slot`.
- CSS lama (`App.css`, `vb.css`, `transaksi.css`, `master.css`) tidak memakai `@layer`, jadi selalu menang atas kelas Tailwind
  pada elemen yang memakai kelas lama. Untuk menimpanya pakai `!` di akhir kelas (`bg-background!`) atau selektor `.vb-modern` di `modern.css`.
- Huruf: Inter untuk semua teks. Huruf VB monospace (Courier dan sejenisnya) tetap monospace, karena teks seperti struk
  diratakan dengan spasi. Angka di tabel pakai `tabular-nums` (`font-variant-numeric: tabular-nums`).
- Jangan menjalankan `npx shadcn add ... --overwrite` untuk komponen yang sudah ada tanpa cek diff.
  Dua file hasil CLI sudah diubah: `ui/sonner.tsx` (memakai `@/lib/theme`, bukan `next-themes`) dan `ui/scroll-area.tsx` (import React yang tidak terpakai dihapus).
- Jangan menghapus cabang `classic` sebelum semua layar pindah.

### Setelah semua layar pindah

1. Ganti bawaan konteks di `src/vb/skin.tsx` ke `"modern"`, lalu hapus `VbSkinProvider` per layar.
2. Hapus `renderDefault`, cabang classic di `VbWindow`, `ModalFrame`, `Modal`, `Alert`, dan `useMsgBox`.
3. Hapus CSS lama yang tidak terpakai (`vb.css`, sebagian `App.css`, `master.css`, `transaksi.css`), dan pindahkan isi `modern.css` yang masih perlu.

### Konsistensi antar layar (untuk pengguna lama VB)

- **Shortcut lama tidak diubah** (memori otot kasir). Contoh: Batal = F6 di layar jual, F1 di order/pembelian/retur/opname.
  Setiap tombol yang punya shortcut menampilkan chip-nya (`"Bayar [F4]"` lewat bind, atau `<Kbd>` di halaman sendiri).
- **Bilah tombol bawah**: kiri Batal/Hapus (outline, teks merah) lalu aksi sekunder; kanan `Tutup` + chip `Esc`, lalu aksi utama biru
  paling kanan. Tombol tutup selalu bernama "Tutup" dan Esc benar-benar menutup (`useTopEscape`).
- **Konfirmasi yang menghapus atau membatalkan**: `msg.confirm(teks, ya, judul, tidak, bahaya)`, dengan `bahaya` = `true` atau label
  ("Ya, batalkan"). Tombol Ya jadi merah, fokus awal di Tidak, dan huruf Y/T menjawab seperti MsgBox lama.
  Pengecualian: Batal di layar transaksi (tombol Batal dan F6/F1) langsung mengosongkan tanpa bertanya, seperti aplikasi lama.
- **Perilaku layar transaksi mengikuti aplikasi lama.** Sebelum mengubah alur kasir, cek kode dekompilasi di
  `../analisis/dekompilasi/kode/*.c` dan form di `../analisis/ui/frm/*.frm` (TabIndex, KeyPress, Form_KeyDown), jangan menebak.
- **Kotak isian**: yang bisa diisi berlatar putih (`bg-card`), yang hanya bisa dibaca abu (`readOnly`). Jangan beri `bg-muted` pada kotak yang bisa diisi.
- **`VbGrid`** menyesuaikan lebar kolom dengan isinya. Yang mengalah hanya kolom teks lebar, jadi kode, nomor, tanggal, dan uang tidak terpotong.
- **Nama layar** tampil di kiri status bar (`child.caption`), pengganti `[Nama Layar]` di judul jendela VB.
- Setting per komputer dari VB tetap dihormati, mis. `autoLoad` (cari sambil mengetik di Cari Barang dan Data Barang).

## Mengubah susunan database

Versi susunan disimpan di `PRAGMA user_version`; daftar langkahnya ada di `src-tauri/src/migrasi.rs` (`MIGRASI`).
Versi N berarti database sudah menjalani langkah 1 sampai N. `schema.sql` selalu berisi susunan terbaru yang lengkap.

Untuk mengubah tabel, kolom, indeks, atau trigger:

1. Ubah `schema.sql` supaya instalasi baru langsung mendapat susunan terbaru.
2. Tambahkan langkah baru di akhir `MIGRASI` dengan nomor berikutnya (SQL, atau fungsi Rust untuk yang rumit). Pakai pembantu yang aman diulang, mis. `tambah_kolom`.
3. Jangan pernah mengubah atau menghapus langkah yang sudah dirilis. Salah di langkah lama dibetulkan lewat langkah baru.
4. Langkah harus jalan di atas data toko yang sudah ada (isi tabel tidak boleh hilang) dan aman kalau terpanggil dua kali. Trigger yang berubah harus `DROP TRIGGER IF EXISTS` lalu dibuat ulang, karena `CREATE ... IF NOT EXISTS` tidak menimpa yang lama.
5. Tambahkan tes di `src-tauri/src/tests_migrasi.rs`: database di versi sebelumnya berisi data naik ke versi baru, datanya utuh.

Cara database dari berbagai asal sampai ke versi terbaru:

| Asal | Perlakuan |
|---|---|
| Instalasi baru (file belum punya tabel) | `schema.sql` dijalankan, versi langsung diset ke terbaru. Langkah tidak dijalankan, karena `schema.sql` sudah terbaru. |
| Database toko yang ada (versi 0 sebelum fitur ini, atau lebih rendah dari terbaru) | Cadangan `sebelum-update-*.db` dibuat di folder backup bila ada datanya. Langkah yang belum jalan dijalankan berurutan, tiap langkah satu transaksi bersama kenaikan versi. Setelah itu `schema.sql` dijalankan sebagai pelengkap (hanya `IF NOT EXISTS`). |
| Restore backup lama | `pulihkan` memanggil `db::open`, jadi diperlakukan sebagai database yang ada. |
| Restore backup yang lebih baru dari aplikasi | Ditolak di `cek_file_backup`, sebelum file diganti. |
| Impor dari aplikasi lama (`pindah_lama.rs`) | Dibangun dari `schema.sql` lalu langsung ditandai versi terbaru (`migrasi::tandai_terbaru`), jadi tidak ada langkah yang jalan. |
| Database dengan versi lebih tinggi dari aplikasi | `db::open` menolak dengan pesan "Data ini dibuat oleh Toko Pro versi yang lebih baru". |

Karena `schema.sql` dijalankan setelah langkah pada database yang ada, indeks atau trigger di `schema.sql` boleh memakai kolom baru.
Langkah 1 adalah titik awal: ia hanya menyusul `migrasi_pending` (pending lama dipindah ke transaksi).

## Teks untuk pengguna

Teks yang dilihat kasir dan pemilik toko memakai sapaan "Anda", kalimat aktif, dan kata sehari-hari di toko
(barang, pelanggan, bayar, struk), bukan istilah teknis. Pesan error menyebut apa yang terjadi dan apa yang bisa dilakukan.
Istilah baku: "Supplier" (bukan Pemasok), "Pengguna" untuk akun (layar Login tetap "Nama User"). Label kolom kepala transaksi
mengikuti caption form VB-nya (Kasir/Petugas). Uang ditulis `Rp 4.500` (tanpa titik setelah Rp, tanpa ",-").

## Komputer Pusat (jaringan toko)

Mode Tunggal (bawaan), Pusat, dan Kasir, diatur di `pusat.json`. Rancangan, keputusan, dan catatan "Sudah dikerjakan (Tahap N)" ada di
`docs/rancangan-komputer-pusat.md`; baca di sana sebelum mengubah bagian ini. Panduan pengguna ada di `src/pages/Panduan.tsx` (bab "Komputer Pusat dan komputer kasir") dan README.

| File | Isi |
|---|---|
| `src-tauri/src/jaringan/` | `kendali.rs` (mode, server, status), `server.rs` (axum: `/halo`, `/sambung`, `/jalankan`), `klien.rs` (komputer Kasir), `golongan.rs`, `perangkat.rs`, `batas.rs`, `firewall.rs` |
| `src-tauri/src/jaringan/firewall.rs` | Aturan firewall Windows "Toko Pro Pusat" lewat `netsh` dengan UAC. Di luar Windows tidak melakukan apa-apa |
| `src-tauri/windows/hooks.nsh` | Hook NSIS (`NSIS_HOOK_POSTUNINSTALL`) yang menghapus aturan firewall saat uninstall |
| `src-tauri/src/pindah_otomatis.rs` | Pindah otomatis dari Toko Pro lama saat dibuka pertama kali |
| `src/pages/KomputerPusat.tsx`, `PilihanAwal.tsx`, `src/components/StatusPusat.tsx` | Layar Komputer Pusat, layar pilihan awal, ikon status |
| `src/api/pusat.ts`, `src/lib/panggil.ts`, `src/lib/statusPusat.ts` | Pembungkus perintah, peralihan lokal/jaringan, status |

Aturan:

- **Setiap perintah yang dipanggil tampilan masuk satu golongan** di `golongan.rs`: Lokal (dikerjakan di komputer ini), Data (dikirim ke Pusat), Khusus Pusat
  (ditolak di Kasir), atau Campuran. Perintah baru yang tidak didaftarkan ditolak di Kasir, dan tes `tests_dispatch.rs`/`tests_tahap6.rs` gagal.
  Perintah Data yang menerima alamat file atau folder harus ditinjau (lihat Tahap 6 di dokumen rancangan).
- Perintah simpan memakai `idPermintaan` (daftar `perintah_simpan` di Rust dan `SIMPAN_SAMA`/`SIMPAN_AWALAN` di `src/lib/perintahSimpan.ts` harus sama; `npm run tes:simpan` memeriksanya). Semua perintah yang bukan simpan dianggap baca (`perintah_baca`).
  ID dibuat baru setiap panggilan dan hanya dipakai ulang oleh dialog Coba Lagi; jangan mengingat ID berdasarkan isi perintah.
- Tanggal di tampilan: `today()` dan `sekarang()` memakai selisih jam **dinding** Pusat (`terapkanJamPusat`, `src/format.ts`), bukan selisih epoch. Tes: `npm run tes:jam`.
- Server Pusat memeriksa token dari header sebelum membaca badan, mereservasi percobaan login (`Pembatas::coba`) per perangkat dan per IP, dan membatasi masa terima otomatis (10 perangkat, satu per IP). Di tes, header `x-uji-ip` meniru alamat pengirim.
- Kasir tidak membuka database. Jangan memakai `Db` untuk data toko dari perintah Lokal di komputer Kasir.
- Kode Windows memakai `#[cfg(windows)]`. Di macOS tidak bisa dijalankan, tetapi bisa dicek: `rustup target add x86_64-pc-windows-msvc`, lalu
  `cargo check --target x86_64-pc-windows-msvc` (di macOS gagal di C dependensi `ring`; CI Windows di `.github/workflows/release.yml` yang menguji penuh).
- Lihat tampilan Pusat/Kasir di browser dev lewat `?simulasiPusat=` (daftar nilainya di komentar `src/dev/tauriMock.ts`); kalau port 1420 sedang dipakai, jalankan `npx vite --port 1430`.
- Teks untuk pengguna ikut aturan "Teks untuk pengguna" di atas: tidak ada keterangan jenis jaringan di layar (penjelasan alamat `169.254.x.x` hanya di panduan).

## Pembaruan otomatis

Plugin updater Tauri (`src/lib/pembaruan.ts`, dialog `src/components/PembaruanDialog.tsx`). Cek diam-diam 8 detik setelah dibuka,
hanya di aplikasi terpasang (bukan `tauri dev`); gagal hanya dicatat di console. Indikator di header, pemberitahuan di Home, tombol Cek Update di Panduan.
Hanya Manager yang bisa memasang. Di browser dev, buka `http://localhost:1420/?simulasiUpdate=1` (atau `=gagal`) untuk melihat tampilannya.
Kunci penanda tangan ada di `~/.tauri/` (di luar repo); cara setup secret dan rilis ada di README, bagian Rilis. Jangan ganti `pubkey` tanpa memahami akibatnya: instalasi lama tidak bisa menerima pembaruan lagi.
