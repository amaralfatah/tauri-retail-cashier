# Rancangan teknis: mode Komputer Pusat

Status: rancangan; Tahap 1 sampai 8 sudah dikerjakan (lihat "Sudah dikerjakan" di tiap bab). Ditulis 23 November 2026 berdasarkan kode di branch `fitur/pindah-data-lama`.

## Ringkasan

Satu komputer di toko dipilih sebagai **Pusat**. Toko Pro di komputer itu tetap memegang file `tokopro.db` seperti sekarang,
dan sekaligus membuka server HTTP kecil (axum) di jaringan toko. Komputer lain memasang installer yang sama, memilih mode
**Kasir**, lalu mengirim semua perintah data ke Pusat. Tidak ada database di komputer Kasir.

Inti rancangannya:

1. Semua perintah data lewat **satu dispatcher** (`jalankan(perintah, args)`). Dispatcher ini dipakai oleh jendela Toko Pro
   di Pusat (lewat `invoke`) dan oleh server HTTP (untuk Kasir). Isi perintah yang sekarang tidak ditulis ulang.
2. Peralihan lokal atau jaringan terjadi **di Rust**, bukan di `src/api`. Tampilan selalu memanggil `invoke`; proses Rust
   di komputer Kasir yang meneruskannya ke Pusat dengan `reqwest`.
3. Satu `Session` per komputer (bukan satu per proses), disimpan juga di database supaya Kasir tidak keluar sendiri saat Pusat dinyalakan ulang.
4. Penulisan tetap berurutan karena semua perintah memakai satu `Mutex<Connection>` di Pusat, ditambah kunci pengulangan
   (idempotensi) supaya transaksi tidak tersimpan dua kali saat jaringan putus.
5. Pengguna lama cukup memasang Toko Pro baru di setiap komputer. Peran setiap komputer (Pusat atau Kasir), data, foto, dan
   pengaturan per komputer diambil otomatis dari Toko Pro lama dengan satu layar konfirmasi (bagian 8).
6. Kasir menyambung persis seperti aplikasi lama: satu isian "Nama komputer Pusat" yang menerima nama komputer atau alamat IP
   (pengganti `NamaKomputer`), diisi otomatis dari `Settings.ini` Toko Pro lama, ditambah **kode sambung** sekali pakai.
   Tanpa pencarian otomatis dan tanpa pertanyaan soal jenis jaringan. Bila kabel langsung sudah berfungsi untuk aplikasi lama,
   nama yang sama akan ditemukan; bedanya hanya port (Firebird 3050, Pusat 47210 dengan aturan firewall otomatis) (5.1, 5.3).

Mode yang ada setelah fitur ini:

| Mode | Database | Server | Dipakai untuk |
|---|---|---|---|
| Tunggal (bawaan) | lokal | mati | toko dengan satu komputer; perilakunya sama persis dengan sekarang |
| Pusat | lokal | hidup | komputer yang memegang data toko |
| Kasir | tidak ada | mati | komputer lain di toko |

## 1. Keadaan kode sekarang (yang memengaruhi rancangan)

- `src-tauri/src/lib.rs` mendaftarkan 112 perintah lewat `generate_handler!`. State yang dipasang hanya `db::Db(Mutex<Connection>)`
  dan `auth::Session(Mutex<Option<User>>)`.
- Bentuk perintah seragam: `fn x(db: State<Db>, session: State<Session>, arg...) -> Res<T>`. Isinya hanya memakai `db.lock()`,
  `session.user()`, dan `*session.0.lock()`. Banyak logika sudah dipisah ke fungsi murni (`trans::penjualan(conn, user, input)`,
  `auth::simpan_user(conn, actor, ...)`), yang juga dipakai tes.
- Pengecualian yang memakai Tauri langsung:
  - `cetak` (`WebviewWindow::print`), `db_path`.
  - `berkas.rs`: `ekspor_nama`, `simpan_file`, `simpan_xlsx`, `foto_*` memakai `AppHandle` untuk folder; `baca_gambar` membaca file lokal.
  - `report::simpan_laporan` menulis file di komputer pengguna.
  - `pindah_lama::lama_cari` dan `lama_pindahkan` adalah `async`, memakai `AppHandle` dan `emit("pindah-lama", ...)`.
- Tampilan memanggil `invoke` dari `@tauri-apps/api/core` di 11 file: `src/api.ts`, `src/api/*.ts` (8 file),
  `src/pages/Transaksi.tsx` (`promo_keranjang`), dan `src/pages/laporan/Ekspor.tsx` (`simpan_laporan`).
- Nomor transaksi: `trans::next_number` membaca `MAX(notrans)` lalu menambah 1, di dalam transaksi SQLite. `next_id` juga `MAX+1`.
  Stok diperbarui oleh trigger `transaksidetil_insert` di dalam transaksi yang sama.
- `preview_notrans` hanya untuk tampilan. Struk dan pesan "sudah tersimpan" memakai `notrans` hasil simpan (`Transaksi.tsx`),
  jadi nomor yang tampil sebelum simpan boleh berbeda dengan hasil akhirnya.
- Tanggal transaksi (`input.tgl`) berasal dari jam komputer pengguna (`today()` di `src/format.ts`). Kolom `tglupload`/`jamupload`
  memakai `date('now','localtime')`, jadi sudah memakai jam komputer yang memegang database.
- Tanda izin Verifikasi Admin (`izin::brankas()`) disimpan di memori proses, dicocokkan dengan `iduser` pemohon.
- `auth::restore_session` memulihkan sesi tanpa kata sandi, hanya di build debug.
- Pengaturan per komputer ada di `localStorage` (`tokopro.autoBackup`, folder backup, ukuran tampilan, `autoLoad`, konfirmasi cetak).
- Dependensi `tokio`, `hyper` 1.x, dan `reqwest` 0.13 sudah ada di `Cargo.lock` (dibawa Tauri dan plugin updater).

## 2. Arsitektur

```
Komputer Kasir                                   Komputer Pusat
┌──────────────────────────┐                     ┌────────────────────────────────────┐
│ React (src/api/*.ts)      │                     │ React (src/api/*.ts)               │
│   invoke("jalankan", ...) │                     │   invoke("jalankan", ...)          │
│          │                │                     │          │                         │
│ Rust: jalankan()          │   HTTP POST         │ Rust: jalankan()                   │
│   perintah lokal? ── ya ─► jalan di sini        │          │                         │
│   tidak ─► reqwest ───────┼────────────────────►│ axum /api/v1/jalankan ──┐          │
│                           │  token perangkat    │                         ▼          │
│ (tanpa database)          │  + token sesi       │ dispatcher(Konteks, perintah, args)│
└──────────────────────────┘                     │          │                         │
                                                  │ Mutex<Connection> ── tokopro.db    │
                                                  └────────────────────────────────────┘
```

### 2.1 Keputusan: satu dispatcher, isi perintah tidak diubah

Setiap perintah data diubah dengan cara mekanis:

| Sekarang | Sesudah |
|---|---|
| `#[tauri::command]` | `#[perintah]` |
| `db: State<Db>` | `db: &Db` |
| `session: State<Session>` | `session: &Session` |
| `app: tauri::AppHandle` | `k: &Konteks` (menyediakan `folder_data()`, `folder_foto()`, dan `AppHandle` bila ada) |

Isi fungsinya tetap, karena `State<T>` dan `&T` sama-sama dibaca lewat `db.lock()` dan `session.user()`.

Macro atribut `#[perintah]` (crate proc-macro kecil di workspace, `src-tauri/perintah-macro`, memakai `syn` dan `quote`
yang sudah ada di `Cargo.lock`) membuat fungsi pembungkus:

```rust
// Dibuat otomatis untuk `fn save_penjualan(db: &Db, session: &Session, input: TransInput) -> Res<Value>`
fn __jalankan_save_penjualan(k: &Konteks, args: &serde_json::Map<String, Value>) -> Res<Value> {
    let input: TransInput = ambil(args, "input")?;          // nama argumen camelCase, sama dengan aturan Tauri
    serde_json::to_value(save_penjualan(&k.db, &k.sesi, input)?).map_err(e)
}
```

Daftar perintah ditulis sekali di `lib.rs`, menggantikan isi `generate_handler!`:

```rust
daftar_perintah![auth::login, auth::logout, trans::save_penjualan, /* ... */];
// menghasilkan: fn dispatch(k: &Konteks, nama: &str, args: &Map) -> Res<Value> { match nama { "login" => ..., } }
```

Nama argumen JSON mengikuti aturan Tauri (snake_case di Rust dibaca camelCase dari JS, mis. `hapus_asal` ← `hapusAsal`,
`table_name` ← `tableName`), jadi objek argumen di `src/api/*.ts` tidak berubah.

Tauri hanya mendaftarkan sedikit perintah:

- `jalankan(perintah, args)`: pintu untuk semua perintah data.
- Perintah baru untuk mode Pusat yang tidak lewat dispatcher (lihat 2.3).

`cetak`, `lama_cari`, dan `lama_pindahkan` **tetap masuk `daftar_perintah!`** (jadi bisa dipanggil lewat `jalankan` dan ikut tes
dispatcher), tetapi ketiganya bukan perintah data biasa. `cetak` mencetak di komputer yang sedang dipakai; `lama_cari` dan
`lama_pindahkan` membaca folder dan file di komputer Pusat. **Catatan untuk Tahap 3 dan 4:** golongan perintah (lokal, Pusat,
diteruskan ke Pusat) harus menandai `cetak` sebagai "khusus lokal" (selalu dijalankan di komputer ini, tidak pernah diteruskan
lewat jaringan), serta `lama_cari` dan `lama_pindahkan` sebagai "khusus Pusat" (hanya dijalankan di Pusat; Kasir tidak
meneruskannya dan tidak boleh menjalankannya sendiri).

**Alasan.** Perintah sudah seragam, jadi perubahan tanda tangan bisa dikerjakan dengan cari-ganti dan diperiksa compiler.
Tes yang sekarang memanggil fungsi murni tidak berubah. Pusat dan mode Tunggal memakai jalur yang sama persis dengan Kasir,
sehingga perilaku lokal dan jaringan tidak bisa menyimpang.

**Pilihan yang ditolak.**

- *Menulis handler axum satu per satu untuk ±110 perintah.* Dua tempat yang harus selalu sama; mudah lupa saat menambah perintah.
- *Meneruskan permintaan HTTP ke sistem IPC Tauri* (membuat `InvokeRequest` tiruan). Memakai API internal Tauri yang tidak stabil.
- *Tabel manual `"nama" => |args| ...` tanpa macro.* Bisa dipakai kalau macro ternyata merepotkan, tetapi argumen setiap perintah
  harus ditulis ulang dengan tangan. Ini rencana cadangan di Tahap 1.

### 2.2 Keputusan: peralihan lokal/jaringan di Rust, bukan di `src/api`

Tampilan tetap memanggil `invoke`. Yang berubah hanya baris import di 11 file:

```ts
// sebelum
import { invoke } from "@tauri-apps/api/core";
// sesudah
import { invoke } from "@/lib/panggil";   // invoke(cmd, args) = core.invoke("jalankan", { perintah: cmd, args })
```

`src/lib/panggil.ts` juga mengubah error khusus dari Rust menjadi kejadian tampilan (Pusat terputus, sesi berakhir, versi berbeda).
`src/dev/tauriMock.ts` membuka bungkus `jalankan` lalu memakai `switch` yang sudah ada.

Di Rust, `jalankan` memeriksa mode:

- Tunggal atau Pusat: panggil `dispatch` langsung.
- Kasir: perintah lokal dijalankan di sini; perintah khusus Pusat ditolak; sisanya dikirim ke Pusat dengan `reqwest`.

**Alasan.** Contoh di tugas (beralih antara `invoke` dan `fetch` di `src/api`) ditolak karena:

- `fetch` dari webview ke `http://nama-pusat:port` terkena aturan CORS dan *mixed content*. Asal halaman Tauri adalah
  `http://tauri.localhost` di Windows dan `tauri://localhost` di macOS, jadi perilakunya berbeda per sistem.
- Token perangkat harus tersimpan di JavaScript (bisa terbaca dari DevTools atau `localStorage`).
- TLS dengan sertifikat buatan sendiri (Tahap lanjutan) tidak bisa disematkan dari `fetch`, tetapi bisa dari `reqwest`.
- Status koneksi, percobaan ulang, dan pembagian perintah lokal/Pusat cukup ditulis sekali di Rust.

### 2.3 Pembagian perintah

| Golongan | Perintah | Di mode Kasir |
|---|---|---|
| Data | semua di `master`, `trans`, `order`, `retur`, `pelunasan`, `report` (kecuali `simpan_laporan`), `kas`, `poin`, `nontunai`, `inventori`, `promo`, `impor_jenis`, `alat` (kecuali `alat_sql`), `izin`, `auth` (kecuali `restore_session`), `foto_baca`, `foto_hapus`, `foto_simpan_data`, `db_path`, `db_info` | dikirim ke Pusat |
| Lokal | `cetak`, `ekspor_nama`, `simpan_file`, `simpan_xlsx`, `simpan_laporan`, `baca_gambar`, plugin dialog, updater, process | jalan di komputer Kasir |
| Diolah dulu di Kasir | `foto_simpan` (file gambar dibaca di Kasir, dikirim sebagai data ke perintah baru `foto_simpan_data` di Pusat; `hapus_asal` menghapus file di Kasir setelah berhasil) | campuran |
| Khusus Pusat | `db_daftar_backup`, `db_backup`, `db_cek`, `db_perbaiki`, `db_restore`, `backup_otomatis`, `lama_cari`, `lama_pindahkan`, `alat_sql`, `impor_baca`, `impor_proses` | ditolak dengan pesan "Menu ini hanya bisa dibuka di komputer Pusat" |
| Hanya pengembangan | `restore_session` | selalu ditolak lewat jaringan |

Perintah lokal yang memeriksa izin (`simpan_file`, `simpan_xlsx`, `simpan_laporan` memanggil `session.user()`) membaca salinan
`User` yang disimpan Rust Kasir setelah login berhasil di Pusat. Salinan ini hanya untuk pemeriksaan lokal, bukan sumber kebenaran.

Pembagian ini disimpan sebagai daftar konstan di `src-tauri/src/jaringan/golongan.rs`, dan satu tes memastikan setiap nama di
`daftar_perintah!` masuk tepat satu golongan.

### 2.4 Server di Pusat

- `axum` 0.8 (terbaru 0.8.9; dicek di crates.io dan dokumentasi Context7: `axum::serve(TcpListener, Router)`), berjalan di
  runtime tokio milik Tauri (`tauri::async_runtime::spawn`). Hanya menambah `axum` dan `tower` di atas `hyper` yang sudah ada.
- Rute (semua JSON, berawalan `/api/v1`):

| Rute | Butuh token perangkat | Isi |
|---|---|---|
| `GET /halo` | tidak | nama toko, nama komputer Pusat, versi aplikasi, `user_version`, jam Pusat, status (`siap`/`perawatan`) |
| `POST /sambung` | tidak (butuh kode sambung) | tukar kode sambung dengan token perangkat |
| `POST /jalankan` | ya | `{ perintah, args, sesi, idPermintaan? }` → `{ ok, hasil }` atau `{ ok: false, pesan, kode }` |
| `GET /foto/{kode}` | ya | gambar barang (pengganti data URI besar, Tahap lanjutan) |

- Setiap `/jalankan` dijalankan di `spawn_blocking`, karena dispatcher dan rusqlite bersifat sinkron.
- Error perintah tetap berupa teks (`Res<T> = Result<T, String>`), termasuk awalan `[izin] ` dan `[konfirmasi] ` yang sudah
  dikenali tampilan. Kasir meneruskan teks yang sama, jadi alur Verifikasi Admin dan konfirmasi batas kredit tidak berubah.
- Batas ukuran badan permintaan 20 MB (foto maksimal 10 MB dalam base64).

**Sudah dikerjakan (Tahap 3)**, kode di `src-tauri/src/jaringan/` (`mode.rs`, `server.rs`, `kendali.rs`, `perangkat.rs`, `batas.rs`, `golongan.rs`):

- Versi: `axum` 0.8.9 (fitur `http1`, `json`, `tokio` saja), `tokio` 1.54.1 (sama dengan Tauri), `if-addrs` 0.15 (alamat dan awalan kartu jaringan).
  `tower` tidak ditambah sebagai dependensi langsung: axum sudah membawanya (0.5.3). `reqwest` 0.13.5 hanya `dev-dependency` (tes) dengan `rustls` 0.23 `ring` untuk memasang
  penyedia kripto, karena `reqwest` di proyek ini berasal dari plugin updater dan dibangun tanpa penyedia. Klien Kasir (Tahap 4) memasang penyedia yang sama, lihat di bawah.
- Semua jawaban berbentuk `{ ok, hasil }` atau `{ ok: false, pesan, kode }`, termasuk `/halo`. Kesalahan dari perintah itu sendiri berstatus 200 dengan `kode: "perintah"`;
  401 untuk token perangkat atau sesi yang tidak sah, 403 untuk perintah yang tidak boleh lewat jaringan, 404 untuk perintah tidak dikenal, 429 untuk terkunci, 503 untuk perawatan.
- Hanya golongan Data yang dilayani server. `restore_session` ditolak 403 di server (selain pemeriksaan `Asal::Jaringan` di dalam perintahnya).
  Nama perintah yang tidak ada di `golongan.rs` ditolak; tes memaksa setiap perintah baru didaftarkan di tepat satu golongan.
- Perintah Tauri langsung (bukan lewat `jalankan`): `pusat_status`, `pusat_atur_mode`, `pusat_kode_baru`, `pusat_terima_otomatis`, `pusat_perangkat`, `pusat_putuskan`. Semuanya hanya untuk Manager yang masuk di jendela ini.
  Layar pertama kali (sebelum ada Manager yang masuk) dan pemberitahuan "komputer tersambung" menyusul di Tahap 7.
- `TOKOPRO_PORT` menimpa port di `pusat.json`. `GET /foto/{kode}` belum dibuat.
- Batas: kode sambung salah 5 kali berturut-turut dari satu IP mengunci `/sambung` 5 menit (percobaan tanpa kode tidak dihitung); kode dibatalkan setelah 20 tebakan salah dari alamat mana pun;
  login dan `verifikasi_admin` salah 5 kali berturut-turut mengunci dua perintah itu untuk perangkat tersebut 5 menit.
- Temuan keamanan: `impor_baca`, `impor_proses`, dan beberapa `alat_*` menerima `path` atau `folder` di komputer Pusat. Ditutup di Tahap 6 (lihat "Sudah dikerjakan (Tahap 6)" di bab 9).

**Pilihan yang ditolak.** WebSocket untuk semua perintah: belum ada fitur yang butuh kiriman dari Pusat ke Kasir, dan HTTP biasa
lebih mudah diuji serta dipulihkan setelah putus. Status koneksi cukup dengan `GET /halo` berkala. WebSocket baru dipertimbangkan
bila nanti ada kebutuhan seperti "daftar pending diperbarui di semua kasir".

## 3. Sesi dan login per komputer

### 3.1 Keputusan

- `Session` tetap bertipe `Session(Mutex<Option<User>>)`, tetapi tidak lagi satu untuk satu proses. Pusat memegang
  `DaftarSesi: Mutex<HashMap<String, Arc<Session>>>`, dengan kunci **token sesi**.
- Jendela Pusat memakai token tetap `"lokal"`. Setiap komputer Kasir memakai satu token sesi yang dibuat Pusat saat perangkat
  tersambung, dan Rust Kasir mengirimnya bersama setiap `/jalankan`.
- `Konteks` untuk satu permintaan berisi `&Db`, `Arc<Session>` milik pengirim, dan data perangkat. Karena `login` dan `logout`
  menulis ke `session` yang diberikan kepadanya, kode `auth.rs` tidak berubah.
- Sesi disimpan juga di tabel baru `sesi_perangkat (token_hash, idperangkat, iduser, mulai, terakhir)`. Saat Pusat menyala lagi,
  sesi dimuat ulang dan `User` dibaca ulang dari `mduser` (akun yang dinonaktifkan langsung keluar). Dengan begitu kasir tidak
  dipaksa masuk lagi di tengah antrean hanya karena Pusat dinyalakan ulang.
- Hak akses per menu (`require_menu`, `my_menus`, `menu_ditolak`) tetap dihitung di Pusat dari `User` milik sesi pengirim.
  Tidak ada pemeriksaan izin yang dipercayakan ke Kasir.
- Pengguna yang sama boleh masuk di dua komputer sekaligus, seperti aplikasi lama.
- Tanda izin Verifikasi Admin (`izin::brankas()`) tetap di memori Pusat. Tanda itu dicocokkan dengan `iduser` pemohon dan
  hanya diterima lewat sesi yang sedang masuk, jadi aman dipakai bersama.
- `restore_session` selalu ditolak bila permintaan datang lewat jaringan, juga di build debug.
- **Sudah dikerjakan (Tahap 2).** `src-tauri/src/sesi.rs`: `DaftarSesi` (berkunci sidik SHA-256 token; `"lokal"` berkunci apa adanya),
  `buat`, `cari`, `catat`, `cabut`, `bersihkan`, `muat`. `Konteks` punya `asal: Asal` (`Lokal` bawaan, `Jaringan` lewat
  `.dari_jaringan()`); server Pusat tinggal memanggilnya. `jalankan` mengambil sesi `"lokal"` dari `DaftarSesi`.
  Sesi `"lokal"` sengaja tidak disimpan di `sesi_perangkat` (mode Tunggal tetap seperti sebelumnya: buka aplikasi, masuk lagi).
  Sesi bertoken disimpan lewat `catat` setelah setiap perintah (`catat_setelah_perintah`), bukan di dalam `login`/`logout`, jadi `auth.rs` tidak berubah.
  Logout mengosongkan `iduser` tetapi barisnya tetap. `idperangkat` berupa teks bebas sampai tabel `perangkat` ada di Tahap 3.
  Migrasi langkah 2 membuat tabel `sesi_perangkat`.
- **Sudah dikerjakan (Tahap 3).** Tabel `perangkat` (migrasi langkah 3, kolom tambahan `otomatis` untuk tanda "diterima otomatis"), `idperangkat` di
  `sesi_perangkat` berisi id perangkat itu. `/sambung` mengembalikan token perangkat dan token sesi pertama; sesi harus milik perangkat pengirim
  (`DaftarSesi::pemilik`). Rute tambahan `POST /sesi` (butuh token perangkat) memberi sesi baru bila sesi lama sudah dihapus karena diam 12 jam.
- Sesi yang tidak dipakai 12 jam dihapus. Logout di Kasir menghapus `User` dari sesinya, tetapi token sesi tetap.

### 3.2 Pilihan yang ditolak

- *Mengirim `iduser` dari Kasir di setiap permintaan.* Kasir bisa mengaku sebagai siapa saja.
- *Token sesi berbentuk JWT.* Tidak perlu: Pusat selalu menjadi satu-satunya pemeriksa, dan tabel sesi memungkinkan pencabutan langsung.
- *Sesi hanya di memori.* Setiap kali Pusat dinyalakan ulang semua kasir keluar, padahal itu justru saat antrean bisa menumpuk.

## 4. Kebenaran data

### 4.1 Penulisan berurutan

Semua perintah di Pusat memakai `Db(Mutex<Connection>)` yang sama, dan setiap perintah tulis memegang kunci itu dari awal
sampai `commit`. Akibatnya:

- `next_number` (`TJ2611-00001`) dan `next_id` membaca `MAX` lalu menulis di dalam transaksi yang sama, saat tidak ada
  penulis lain. Dua kasir yang menyimpan bersamaan mendapat nomor berurutan, bukan nomor yang sama.
- Trigger `transaksidetil_insert` jalan di dalam transaksi itu, jadi `stokakhir` tidak bisa terlewat.
- Pemeriksaan stok minimal (`IZINSTOKMIN`) dan batas kredit dibaca dan ditulis di bawah kunci yang sama, jadi tidak bisa ditembus
  oleh dua penjualan yang bersamaan.

Pengaman tambahan (Tahap 5):

- Ganti `conn.transaction()` di perintah tulis dengan `transaction_with_behavior(TransactionBehavior::Immediate)`. Saat ini
  tidak berbeda karena hanya ada satu koneksi, tetapi menjadi wajib begitu ada koneksi baca terpisah (4.4).
- `transaksi.notrans` sudah `PRIMARY KEY`, jadi kalaupun ada kesalahan di masa depan, nomor ganda menjadi error, bukan data ganda.
- Audit perintah yang membaca di satu `db.lock()` lalu menulis di `db.lock()` berikutnya (mis. pola `izin_database_atau_alat(&*db.lock()?, ...)`
  lalu `let conn = db.lock()?`). Pemeriksaan izin di antara dua kunci itu aman; yang tidak boleh adalah membaca nilai bisnis
  (stok, saldo, nomor) di kunci pertama lalu menulis berdasarkan nilai itu di kunci kedua.

**Sudah dikerjakan (Tahap 5).**

- Semua perintah tulis memakai `conn.transaction_with_behavior(TransactionBehavior::Immediate)` (`alat`, `auth`, `impor`, `inventori`, `kas`, `master`, `order`, `pelunasan`, `poin`, `promo`, `retur`, `trans`).
  Yang tidak diubah: `migrasi.rs` (jalan saat membuka database, sebelum ada penulis lain) dan `pindah_lama.rs` (impor massal ke file baru, tanpa penulis lain).
- Penulisan yang berurutan dibuktikan oleh `tests_data::beban_*`: 4 kasir x 50 `save_penjualan` lewat HTTP ke satu Pusat menghasilkan `TJ2611-00001` sampai `TJ2611-00200` tanpa lompatan, `stokakhir` = awal - total jumlah,
  `SUM(masuk)` dan saldo kas terakhir sesuai; dan 4 kasir x 15 penjualan untuk stok 30 (`izinstokmin = 0`) menghasilkan tepat 30 berhasil dan stok 0.
- **Hasil audit pola dua kunci** (setiap fungsi `#[perintah]` di semua modul dihitung jumlah `db.lock()`-nya, lalu yang lebih dari satu dibaca):
  - Hanya tujuh fungsi yang memegang kunci lebih dari sekali: `db_info`, `db_daftar_backup`, `db_backup`, `db_cek`, `db_perbaiki` (`database.rs`), `master_save` (`master.rs`), dan `pindahkan` (`pindah_lama.rs`).
    Pada lima yang pertama dan `master_save`, kunci pertama hanya memeriksa izin (`izin_database_atau_alat`, `require_menu`), tidak membaca nilai bisnis. `pindahkan` khusus Pusat dan membangun database sendiri.
  - Perintah simpan lain (`save_penjualan`, `save_pembelian`, `save_opname*`, `save_order`, `save_pending`, retur, pelunasan, kas, poin, stok awal, impor, alat) mengambil satu kunci, memeriksa izin, lalu semua pembacaan nilai
    bisnis (stok, batas kredit, saldo kas, nomor, `MAX(tid)`) terjadi di dalam transaksi yang sama (`next_number`, `next_id`, `periksa_penjualan`, saldo di `insert_kas_paksa`). Tidak ada yang berisiko; tidak ada kode yang diubah untuk ini.
  - `kas_delete` memakai tanda izin sekali pakai (`izin::tanda_sah` lalu `habiskan` setelah menghapus). Itu bukan nilai bisnis, dan dua penghapusan berurutan tetap tidak bisa memakai tanda yang sama.
  - Satu hal yang sengaja dibiarkan: perintah baca dan tulis yang terpisah di tampilan (mis. `preview_notrans` lalu `save_penjualan`) memang bisa menampilkan nomor yang berbeda dari yang akhirnya tersimpan. Nomor resmi selalu
    dari `next_number` di dalam transaksi simpan, dan layar membaca nomor dari hasil simpan.

### 4.2 Simpan ganda saat jaringan putus

Masalahnya: Kasir mengirim `save_penjualan`, Pusat menyimpan, lalu jawaban hilang di jalan. Kalau kasir menekan simpan lagi,
penjualan tercatat dua kali dan stok berkurang dua kali.

Keputusan:

- Perintah simpan (`save_*`, `kas_save`, `pelunasan`, `poin_tukar`, `poin_koreksi`, `alat_hapus_*`, `impor_proses`) diberi
  `idPermintaan` (UUID) oleh `src/lib/panggil.ts`. ID dibuat sekali per tombol simpan dan dipakai ulang saat "Coba lagi".
- Pusat menyimpan hasilnya di tabel baru `permintaan_selesai (id, perintah, hasil_json, waktu)` **di dalam koneksi dan kunci
  yang sama, sebelum kunci dilepas**. Permintaan dengan `id` yang sudah ada langsung dijawab dengan hasil yang tersimpan.
- Baris yang lebih tua dari 7 hari dihapus saat Pusat menyala.
- Rust Kasir tidak pernah mengulang perintah simpan sendiri. Saat waktu habis, tampilan menampilkan dialog dengan tombol
  "Coba Lagi" yang mengirim `idPermintaan` yang sama.

Celahnya: Pusat mati tepat di antara `commit` transaksi dan penulisan `permintaan_selesai`. Untuk menutupnya, langkah kedua
(Tahap 5, opsional) menulis `permintaan_selesai` di dalam transaksi perintah itu sendiri lewat `Konteks::catat_selesai(&tx)`.
Ini butuh perubahan kecil di setiap perintah simpan, jadi dikerjakan setelah versi pertama berjalan.

**Sudah dikerjakan (Tahap 5)**, di `jaringan/server.rs` (`Pusat::sekali`), `jaringan/klien.rs`, `jaringan/golongan.rs` (`perintah_simpan`), migrasi langkah 4, dan `tests_data.rs`:

- Tabel `permintaan_selesai (id TEXT PRIMARY KEY, perintah, hasil_json, waktu)` (migrasi langkah 4 dan `schema.sql`). `waktu` dalam detik Unix. Baris lebih dari 7 hari dihapus saat server Pusat dimulai.
- Perintah ber-ID ditentukan `golongan::perintah_simpan`: `save_*`, `delete_*`, `master_save/delete`, `kas_save/delete`, `poin_tukar/koreksi`, `impor_proses`, `alat_hapus_*`/`alat_hitung_*`/`alat_sinkron_*`/`alat_item_hapus`,
  `nt_*_save/delete`, `promo_save/delete`, `pending_selesai`, `foto_hapus`. `login`, `logout`, dan `verifikasi_admin` tidak ber-ID.
- Pusat: permintaan ber-ID menunggu giliran pada satu kunci khusus (`kunci_simpan`), memeriksa tabel, menjalankan perintah bila belum ada, lalu menulis hasilnya sebelum menjawab. Dua permintaan ber-ID sama yang bersamaan
  menyimpan satu transaksi. Hanya hasil yang berhasil diingat; perintah yang ditolak boleh dicoba lagi dengan ID yang sama. ID yang sama untuk perintah lain ditolak.
- Kasir: `Klien::jalankan_id` menerima `idPermintaan` dari tampilan (`invoke(cmd, args, idPermintaan?)` di `src/lib/panggil.ts`, perintah Tauri `jalankan` menerima `idPermintaan`). Bila tidak ada, Rust membuat sendiri (32 karakter heksa acak),
  dan ID yang sama dipakai di semua percobaan satu permintaan.
- Penyimpangan dari rancangan: Kasir **sekarang boleh mengulang sendiri satu kali** bila jawaban hilang sebelum waktu habis (mis. sambungan diputus), karena ID yang sama membuatnya aman. Waktu habis (30 detik) tidak diulang otomatis.
- ~~Penyimpangan lain: Rust mengingat ID simpan yang hasilnya belum pasti berdasarkan isi perintah selama 10 menit.~~ **Dihapus (perbaikan D3).** Pengingatan berdasarkan isi membuat penjualan berikutnya yang isinya identik mendapat hasil lama,
  sehingga transaksi hilang tanpa tanda. Sekarang tidak ada lagi sidik isi, di Rust (`Klien`) maupun di tampilan (`src/lib/panggil.ts`). ID yang sama dipakai ulang hanya (a) oleh pengulangan otomatis satu kali di dalam satu panggilan, dan (b) oleh dialog Coba Lagi,
  yang berada di dalam satu panggilan `invoke` yang sama dan mengirim ID yang sama. Menekan Simpan lagi sesudah dialog ditutup adalah simpan baru dengan ID baru, jadi pesan di layar saat hasilnya belum pasti meminta pengguna melihat dulu daftar transaksi.
- Pesan 7.3 untuk "Pusat terputus" dan "hasil tidak pasti" sudah dipakai di Rust (`PESAN_BELUM_TERSIMPAN`, `PESAN_BELUM_PASTI`). Tombol "Coba Lagi" itu sendiri menunggu Tahap 7.
- Celah "Pusat mati di antara `commit` dan penulisan `permintaan_selesai`" **belum ditutup** (langkah opsional `Konteks::catat_selesai(&tx)`); tetap di daftar tahap lanjutan. Karena itu pesan 7.3 tidak lagi berjanji "tidak akan tercatat dua kali"
  (perbaikan D4): "Tekan Coba Lagi. Toko Pro akan memeriksa dulu apakah transaksi ini sudah tersimpan." Itu yang memang dikerjakan: Pusat memeriksa `permintaan_selesai` dengan ID yang sama. Bila Pusat mati tepat di celah itu, pemeriksaan tidak menemukan apa-apa dan transaksi bisa ganda; risikonya ada di bab 11.
- Perbaikan D5: jawaban Pusat yang bukan JSON (mis. halaman galat dari perantara) untuk perintah simpan diperlakukan sebagai hasil belum pasti (penanda yang sama dengan jawaban yang hilang), bukan sebagai gagal pasti.
- Perbaikan S6: batas waktu 10 detik berlaku untuk semua perintah yang bukan simpan. `perintah_baca` (`golongan.rs`) diturunkan dari `perintah_simpan`, jadi satu daftar saja. Dulu `master_list`, `kas_list`, `poin_member`, `katalog_barang`, `foto_baca`, dan lainnya
  salah dianggap simpan (batas 30 detik dan pesan "transaksi belum tersimpan" di layar yang hanya membaca).
- Tes: `simpan_diulang_dengan_id_sama_tidak_menggandakan_data`, `id_sama_bersamaan_hanya_satu_transaksi`, `jawaban_hilang_sesudah_tersimpan_lalu_ulang_dengan_id_sama_tidak_menggandakan_data` (hook tes di server: data tersimpan, jawabannya sengaja tidak dikirim, lalu permintaan diulang dengan ID yang sama),
  `d3_simpan_identik_berikutnya_tidak_memakai_id_lama`, `d5_jawaban_bukan_json_untuk_simpan_dianggap_belum_pasti`, `s6_*` (`tests_perbaikan.rs`), `npm run tes:simpan` (daftar perintah simpan di tampilan sama dengan di Rust),
  `simpan_yang_ditolak_tidak_diingat`, `hasil_simpan_lebih_dari_tujuh_hari_dibersihkan`, dan tes migrasi langkah 4 di `tests_migrasi.rs`.

### 4.3 Tanggal dan jam

Aplikasi lama memakai jam server (`GETSERVERDATE`). Di rancangan ini:

- `GET /halo` mengembalikan jam dinding Pusat (`jamDinding`, `YYYY-MM-DD HH:MM:SS`, tanpa zona). Rust Kasir menghitung selisih jam dinding lalu menyediakannya lewat perintah lokal `jam_pusat`.
  `today()` di `src/format.ts` memakai selisih ini di mode Kasir.
- Bila selisih lebih dari 2 menit, bilah atas menampilkan peringatan "Jam di komputer ini berbeda dengan Pusat".
- `tglupload`/`jamupload` sudah memakai jam Pusat (`date('now','localtime')` dijalankan di Pusat).
- Pusat tidak menolak `input.tgl` yang berbeda dengan tanggal Pusat, karena layar transaksi memang mengizinkan tanggal
  diubah oleh pengguna yang berhak. Aturan itu tetap seperti sekarang.

**Sudah dikerjakan (Tahap 5).**

- `Klien` menghitung selisih jam (jam Pusat dikurangi jam lokal, pada titik tengah perjalanan `/halo`) setiap `/halo` berhasil, bersama zona waktu Pusat. Perintah Tauri `jam_pusat` mengembalikan
  `{ tanggal, jam, selisihDetik, selisihMs, berbeda, dariPusat, offsetDetik }`. `berbeda` = selisih lebih dari 2 menit (bahan peringatan di bilah atas; tampilan peringatannya Tahap 7).
  Di mode Tunggal dan Pusat, atau sebelum ada `/halo`, jam komputer ini dipakai dan `dariPusat` = `false`.
- Tampilan: `today()` dan `sekarang()` di `src/format.ts` memakai `aturSelisihJam`; `sinkronJamPusat()` (`src/api/pusat.ts`) dipanggil saat aplikasi dibuka dan setiap event `status-pusat`. Jam di status bar (`App.tsx`) ikut jam Pusat.
- Karena tanggal transaksi (dan `KODE+yymm` di `next_number`) berasal dari `today()` atau dari tanggal yang dipilih pengguna, nomor transaksi di Kasir mengikuti bulan di Pusat. Server tetap tidak menolak `input.tgl` lain.
- ~~Batasan: kalender dihitung di zona waktu komputer Kasir.~~ **Diperbaiki (D1).** Zona waktu Windows di komputer kasir sering salah (bawaan Pacific, jam diatur manual supaya tampil WIB). Selisih epoch lalu dirender di zona Pacific membuat tanggal mundur sehari selama sekitar 15 jam per hari.
  Sekarang selisihnya dihitung sebagai **jam dinding**, tanpa zona: Pusat mengirim tanggal dan jam lokalnya sebagai teks; Rust menghitung `jamDindingPusat - jamDindingKasir` dan mengirim `dinding` (jam dinding Pusat saat ini) ke tampilan; tampilan menghitung
  `selisih = parseSebagaiLokalNaif(dinding) - Date.now()` (`terapkanJamPusat` di `src/format.ts`). `today()` dan `sekarang()` memformat `new Date(Date.now() + selisih)` dengan komponen lokal, jadi kalender kasir selalu sama dengan kalender Pusat, apa pun zonanya.
  `offsetDetik` dan selisih epoch dibuang. `berbeda` (peringatan jam) memakai selisih jam dinding, jadi komputer berzona salah tetapi berjam benar tidak diperingatkan. Semua tanggal yang dibuat di Pusat memakai `date('now','localtime')` Pusat, jadi sudah benar.
- Perbaikan D2: selisih dibuang (`selisih_jam = None`) saat mode berganti dari Kasir atau nama Pusat diganti; `jam_pusat` hanya mengembalikan `dariPusat: true` di mode Kasir; `sinkronJamPusat` mengembalikan selisih ke nol bila bukan `dariPusat`.
- Tes: `selisih_jam_dinding_dan_tanggal_pusat_lewat_tengah_malam`, `zona_waktu_kasir_salah_tidak_menggeser_tanggal`, `klien_menghitung_selisih_jam_dari_halo_pusat` (klien sungguhan ke server sungguhan), `d2_selisih_jam_dibuang_saat_mode_bukan_kasir`,
  dan `npm run tes:jam` (`tools/jam-pusat.test.mjs`, zona `America/Los_Angeles`, `Asia/Jakarta`, dan lainnya diganti lewat `process.env.TZ` di dalam tes).

### 4.4 Laporan berat tidak boleh menahan kasir

Satu `Mutex` berarti laporan setahun di komputer Manager membuat kasir menunggu. Langkahnya:

1. Ukur dulu (Tahap 10): waktu `laporan_penjualan` dan `dashboard_data` pada data toko terbesar dari aplikasi lama.
2. Bila lebih dari ±300 ms, tambah koneksi baca kedua (`Db { tulis: Mutex<Connection>, baca: Mutex<Connection> }`) untuk
   perintah `report::*` dan `master_list`. Mode WAL mengizinkan pembaca berjalan bersamaan dengan penulis.
   Perintah tulis tetap memakai koneksi tulis dengan `BEGIN IMMEDIATE`.

Ini sengaja tidak dikerjakan di awal, karena menambah satu jenis kesalahan baru (membaca dari koneksi baca lalu menulis).

**Keputusan (Tahap 5): tidak dikerjakan, menunggu ukuran dari Tahap 10.** Alasannya:

- Langkah 1 (mengukur) memang baru bisa dilakukan di Tahap 10, dengan data toko terbesar; tanpa angka itu koneksi kedua belum tentu perlu.
- Ini tidak sederhana: `Db(Mutex<Connection>)` dipakai di ±110 perintah dan semua tes membuat `Db(Mutex::new(conn))` langsung. Mengubahnya menjadi dua koneksi berarti memilah setiap perintah menjadi baca atau tulis, dan database
  uji di memori (`:memory:`) tidak bisa berbagi data antara dua koneksi tanpa mode cache bersama.
- Pengaman yang dibutuhkan nanti sudah siap: penulisan sudah `BEGIN IMMEDIATE` (4.1) dan WAL sudah aktif, jadi koneksi baca terpisah bisa ditambahkan tanpa mengubah perilaku penulisan.

## 5. Penemuan Pusat dan koneksi

### 5.1 Mengisi alamat Pusat: mengikuti `NamaKomputer` aplikasi lama

Cara aplikasi lama (dari `analisis/dekompilasi/ledger/sistem.md` SYS-90 dan SYS-95, serta `analisis/strings_main_utf16.txt`):
`Settings.ini` bagian `[Database]` menyimpan `NamaKomputer` (bawaan `localhost`) dan `LokasiData` (bawaan `\_data\DATAPOS.FDB`).
Di FrmZDatabase, pengguna mengetik nama komputer server atau alamat IP-nya di isian `tNamaKomputer`, lalu menekan Tes
(`DBNAME=<komputer>:<lokasi>`). Tidak ada pencarian otomatis. Di toko pengguna lama, komputer biasanya disambung langsung
dengan kabel RJ45 tanpa router.

Keputusan:

- Layar Sambungkan ke Pusat hanya punya **satu isian "Nama komputer Pusat"** yang menerima nama komputer atau alamat IP,
  persis seperti `tNamaKomputer`. Tidak ada tautan atau isian IP terpisah. Port tidak ditanyakan (bawaan 47210, lihat 5.2).
- Pengguna **tidak pernah ditanya jenis jaringannya** (kabel langsung, router, atau Wi-Fi). Aplikasi tidak perlu tahu.
- **Pencarian otomatis (mDNS) dihapus** dari rancangan. Aplikasi lama tidak punya fitur ini, pengguna lama tidak membutuhkannya,
  dan mDNS di jaringan tanpa router dengan profil Public sering tidak menjawab, sehingga hanya menambah satu jalur yang gagal
  tanpa menggantikan isian manual.

**Alasan utama.** Bila kabel langsung sudah berfungsi untuk aplikasi lama, nama yang sama juga akan ditemukan oleh aplikasi baru.
Aplikasi lama mengubah `NamaKomputer` menjadi alamat dengan resolver Windows yang sama (DNS, NetBIOS, atau LLMNR) yang dipakai
`reqwest`. Jadi nama komputer, kabel, dan alamat IP tidak berubah. **Yang berbeda hanya port**: aplikasi lama tersambung ke
Firebird di port 3050, sedangkan Pusat Toko Pro memakai port 47210 yang butuh aturan firewall sendiri. Aturan itu dibuat otomatis
saat komputer dijadikan Pusat (5.3), termasuk untuk profil Public yang biasanya dipakai Windows pada kabel langsung.

#### Isi otomatis dari `Settings.ini` lama

Saat Toko Pro baru dibuka pertama kali di komputer yang punya Toko Pro lama, aplikasi membaca `Settings.ini` lama. Pencarian
folder dan pembacaan file memakai fungsi yang sudah ada di `pindah_lama.rs` (`cari_di`, `periksa_folder`, `baca_ini`, kunci
`database.namakomputer`), dipisah menjadi fungsi kecil `nama_komputer_lama() -> Option<String>`.

Nilai `NamaKomputer` dibersihkan dulu: spasi dibuang, dan port Firebird bila ada (`SERVER/3050` atau `SERVER:3050`) dipotong.
Nilai **diabaikan** bila kosong, `localhost`, `127.0.0.1`, `::1`, atau sama dengan nama komputer ini sendiri. Pada nilai seperti
itu komputer ini adalah server lama, jadi calon Pusat.

Peran komputer (Pusat atau Kasir) dan seluruh alur pindah otomatis ditentukan dari nilai ini; lihat bagian 8. Bila pengguna
memilih "Atur sendiri", isian "Nama komputer Pusat" tetap sudah terisi nilai `NamaKomputer` dan bisa diubah.

#### Cara Kasir mencari Pusat

Setiap kali menyambung, Kasir mencoba berurutan:

1. Isian "Nama komputer Pusat" apa adanya. Bila berisi IP, langsung dipakai. Bila berisi nama, alamatnya dicari dengan resolver
   sistem operasi, dan semua hasilnya dicoba (IPv4 lebih dulu; IPv6 link-local `fe80::` hanya bila datang dengan scope id).
2. IP terakhir yang berhasil, disimpan di `pusat.json`. Ini menolong bila nama sesekali tidak ditemukan.

Alamat yang menjawab `GET /halo` dipakai bila nama komputer di jawabannya cocok dengan Pusat yang dipasangkan. Ini mencegah
Kasir tersambung ke komputer lain yang kebetulan memakai IP lama Pusat. Token perangkat tetap wajib (5.4).

Pusat mendengarkan di `0.0.0.0:47210`, jadi kabel, Wi-Fi, dan alamat `169.254.x.x` diterima tanpa pengaturan.

#### Jaringan yang didukung

Semua jaringan tempat aplikasi lama berjalan: kabel RJ45 langsung antarkomputer (kartu jaringan modern menyesuaikan sendiri, jadi
kabel biasa cukup), switch tanpa router, router dengan kabel, dan Wi-Fi. Pada kabel langsung tanpa router, Windows memakai
IP tetap yang dipasang toko, atau alamat otomatis `169.254.x.x`.

Layar Komputer Pusat menampilkan nama komputer Pusat dan alamat IP-nya (semua IPv4, dibaca dengan crate kecil seperti `if-addrs`,
dicek dulu di Tahap 0), dengan tombol Salin. IP itu bisa diketik di isian "Nama komputer Pusat" bila nama tidak ditemukan.
Tidak ada keterangan jenis jaringan dan tidak ada saran mengubah pengaturan jaringan Windows di layar.

Hal yang hanya dijelaskan di panduan (bukan di layar):

- Alamat `169.254.x.x` bisa berubah setelah komputer dinyalakan ulang. Pakai nama komputer, atau pasang IP tetap seperti yang
  mungkin sudah dipakai untuk aplikasi lama.
- Wi-Fi tamu dan fitur isolasi klien di router memblokir sambungan antarkomputer.

**Pilihan yang ditolak.**

- *Isian IP terpisah dari nama komputer.* Aplikasi lama memakai satu isian untuk keduanya; dua isian membuat pengguna bingung harus mengisi yang mana.
- *Menanyakan jenis jaringan.* Tidak mengubah apa pun yang dilakukan aplikasi, dan pengguna sering tidak tahu jawabannya.
- *Aplikasi mengatur IP tetap sendiri* (`netsh interface ip set address`). Butuh hak administrator, memilih kartu jaringan yang
  salah bisa memutus internet toko, dan sulit dikembalikan.
- *mDNS / pencarian otomatis.* Lihat alasan di atas.

### 5.2 Port

Port bawaan **47210** (TCP), bisa diubah di layar Komputer Pusat dan lewat `TOKOPRO_PORT` untuk pengembangan. Bila port
sudah dipakai, Pusat menampilkan pesan dan tidak membuka server, tetapi jendela Pusat tetap bisa dipakai seperti mode Tunggal.

### 5.3 Firewall

- **Windows.** Saat Manager memilih "Jadikan komputer ini Pusat", aplikasi menambah aturan firewall sekali dengan
  `netsh advfirewall firewall add rule name="Toko Pro Pusat" dir=in action=allow protocol=TCP localport=47210 profile=private,public,domain remoteip=localsubnet program="<lokasi tokopro-app.exe>"`
  yang dijalankan dengan izin administrator (dialog UAC Windows). Bila pengguna menolak, Windows tetap menampilkan dialog izinnya
  sendiri saat server pertama kali dibuka, dan dialog itu secara bawaan hanya mencentang Private.
- Aturannya berlaku untuk profil **Private, Public, dan Domain**. Jaringan tanpa router (kabel langsung, switch tanpa DHCP)
  hampir selalu dikenali Windows sebagai "Unidentified network" dengan profil **Public**, dan pemilik toko tidak boleh dipaksa
  mengubah profil jaringan. Pengamannya:
  - `remoteip=localsubnet`: hanya komputer di subnet yang sama dengan salah satu kartu jaringan Pusat. Kata kunci ini juga
    mencakup `169.254.0.0/16` bila Pusat memakai alamat link-local (diuji di Tahap 0).
  - `program=...`: hanya Toko Pro yang terbuka, bukan port itu untuk program lain. Aturan dibuat ulang setelah pembaruan
    bila lokasi program berubah.
  - Token perangkat tetap wajib untuk setiap perintah (5.4). Port yang terbuka tanpa token hanya menjawab `/halo` dan `/sambung`.
- Risiko profil Public: bila laptop Pusat dibawa ke Wi-Fi umum (kafe), port tetap terbuka bagi subnet Wi-Fi itu. Penanganan:
  server Pusat hanya hidup selama Toko Pro terbuka dalam mode Pusat, `/sambung` hanya menerima kode saat Manager sedang
  menampilkannya, dan panduan menyarankan Pusat berupa komputer meja yang tetap di toko.
- Penemuan nama (NetBIOS/LLMNR) diatur Windows, tidak bergantung pada port Toko Pro. Bila nama server lama ditemukan oleh
  aplikasi lama di jaringan yang sama, nama itu juga ditemukan oleh aplikasi baru. Tahap 0 tetap memastikannya pada kabel langsung
  dengan profil Public. Aplikasi tidak membuka port NetBIOS/LLMNR sendiri; bila nama tidak ditemukan, pengguna mengetik IP di isian yang sama.
- Aturan firewall Firebird lama (port 3050) tidak dipakai dan tidak diubah.
- Installer NSIS (`installMode: passive`, tanpa hak administrator) tidak menambah aturan, supaya installer tetap sama untuk semua komputer.
  Uninstaller menghapus aturan itu lewat hook NSIS bila ada.
- **macOS** menampilkan dialog "terima koneksi masuk" sendiri. Cukup dijelaskan di panduan.

### 5.4 Pengamanan: kode sambung dan token perangkat

- Manager di Pusat menekan "Tambah komputer kasir". Pusat menampilkan **kode sambung** 6 angka yang berlaku 10 menit dan
  hanya bisa dipakai sekali.
- Kasir mengirim nama komputernya dan kode itu ke `POST /sambung`. Pusat membalas token perangkat acak 32 byte.
- Pusat menyimpan hash token di tabel baru `perangkat (id, nama_komputer, token_hash, dibuat, terakhir_terlihat, aktif)`.
  Kasir menyimpan token di `app_data_dir/pusat.json`, tidak di `localStorage`.
- Setiap `/jalankan` wajib membawa `Authorization: Bearer <token>`. Token yang dicabut atau tidak dikenal dijawab 401.
- Lima kode salah berturut-turut dari satu IP mengunci `/sambung` selama 5 menit.
- Layar Komputer Pusat menampilkan daftar komputer tersambung, pengguna yang sedang masuk, dan tombol "Putuskan" untuk mencabut token.

**Perbaikan dari tinjauan (S1 sampai S5)**, di `jaringan/server.rs`, `jaringan/batas.rs`, `sesi.rs`, dan `tests_jaringan.rs`:

- **S1, masa terima otomatis dibatasi.** Selama masa terima otomatis (sesudah pindah dari Toko Pro lama; sampai 23.59), perangkat satu subnet bisa `/sambung` tanpa kode. Kalau login pengguna dimatikan (`tseting.aktiflogin = 0`), perangkat yang tersambung
  langsung menjadi Manager "Administrator" lewat `login_bawaan`, seperti aplikasi lama (login dimatikan = semua komputer langsung masuk). Perilaku itu dipertahankan; celahnya diperkecil:
  (a) paling banyak `MAKS_TERIMA_OTOMATIS` = 10 perangkat per masa terima, lalu masa terima ditutup sendiri (membuka masa terima lagi memulai hitungan dari nol);
  (b) layar Komputer Pusat menandai perangkat yang diterima otomatis ("Tanpa kode") dengan keterangan dan tombol Putuskan, dan menampilkan "x dari 10" selama masanya terbuka;
  (c) tombol "Selesai menyambungkan" (perintah `pusat_terima_otomatis` dengan `buka = false`) menutup masa terima lebih awal. Masa terima tetap berakhir pukul 23.59.
  Risiko yang tersisa ada di bab 11.
- **S2, batas login per alamat dan per perangkat.** Percobaan `login` dan `verifikasi_admin` dihitung per perangkat **dan** per alamat IP pengirim (`pembatas_login`, `pembatas_login_ip`); salah satunya terkunci berarti ditolak 429. Satu IP yang salah 5 kali terkunci walau memakai perangkat baru.
  `/sambung` tanpa kode: satu perangkat per IP per masa terima. Sambung kedua dari IP yang sama **mengganti** yang lama (yang lama dicabut, hitungan perangkat tidak bertambah), supaya komputer kasir yang kehilangan tokennya (mis. dipasang ulang) tetap bisa menyambung tanpa
  menambah jumlah perangkat dari alamat itu. Keputusan ini diambil sendiri; alternatifnya menolak, tetapi itu memaksa kode sambung untuk kasus yang wajar.
- **S3, reservasi percobaan.** `Pembatas::coba` memeriksa kunci dan mencatat percobaan dalam satu langkah **sebelum** perintah dijalankan; `berhasil` tidak menghapus kunci yang sedang berlaku. 30 permintaan `login` paralel menghasilkan paling banyak 5 yang diproses, sisanya 429.
- **S4, sesi diam.** `DaftarSesi::pemilik` menolak (dan mencabut) sesi yang `terakhir`-nya lewat 12 jam di setiap `/jalankan`, jadi Pusat yang menyala berhari-hari tidak mempertahankan sesi lama. Jawabannya sama dengan sesi tak dikenal (401, kode `sesi`); Kasir meminta sesi baru dan pengguna masuk lagi.
- **S5, token dulu, badan kemudian.** Handler memakai `Body` mentah, bukan `Json`: `/jalankan` memeriksa token (dan versi serta mode perawatan) dari header sebelum membaca badan; panjang yang diumumkan `Content-Length` diperiksa lebih dulu.
  Batas badan: 16 KB untuk `/sambung`, `/sesi` tidak membaca badan, dan 20 MB hanya untuk `/jalankan` yang sudah lolos token. Badan terlalu besar dijawab 413 (`terlalu-besar`).
- Tes: `s1_*`, `s2_*`, `s3_*`, `s4_*`, `s5_*`, `kode_masih_berlaku_setelah_sembilan_belas_tebakan_salah`, `kode_dibatalkan_setelah_dua_puluh_tebakan_salah_dari_alamat_mana_pun` (batas `MAKS_SALAH_PER_KODE`), dan `pembatas_coba_mereservasi_...`. Di tes, header `x-uji-ip` (hanya build tes)
  menggantikan alamat pengirim, supaya beberapa "komputer" bisa ditiru dari satu mesin.

Lalu lintas pada versi pertama **tidak terenkripsi** (HTTP biasa), sama seperti koneksi Firebird 2.5 di aplikasi lama. Kata
sandi saat login bisa disadap oleh perangkat lain di jaringan yang sama. Ini diterima untuk versi pertama karena jaringan toko
tertutup dan risikonya tidak lebih buruk dari aplikasi lama. Tahap lanjutan: TLS dengan sertifikat buatan Pusat (`rcgen` +
`rustls`), sidik sertifikat ikut dikirim saat kode sambung dipakai dan disematkan di `reqwest` Kasir. Ini bisa dilakukan karena
semua koneksi lewat Rust (lihat 2.2).

**Pilihan yang ditolak.** Kata sandi bersama untuk semua kasir: tidak bisa dicabut per komputer dan cenderung ditulis di kertas.
Tanpa pengamanan sama sekali: siapa pun di Wi-Fi toko (termasuk Wi-Fi tamu yang sering satu jaringan) bisa membaca data.

### 5.5 Pusat mati atau baru menyala

- Rust Kasir menjalankan pemeriksa latar: `GET /halo` setiap 15 detik saat tersambung, setiap 3 detik saat terputus (naik
  pelan-pelan sampai 10 detik). Statusnya dikirim ke tampilan lewat event `status-pusat`
  (`tersambung` / `menyambung` / `terputus` / `versi-beda` / `perawatan` / `ditolak`).
- Batas waktu permintaan: 10 detik untuk baca, 30 detik untuk simpan.
- Perintah yang gagal karena jaringan dijawab dengan awalan error baru `[pusat] `, yang dikenali `src/lib/panggil.ts`.
- Isi keranjang dan isian form ada di tampilan Kasir, jadi tidak hilang saat Pusat mati. Setelah Pusat menyala, kasir menekan
  "Coba Lagi" (simpan memakai `idPermintaan` yang sama, lihat 4.2).
- Sesi kasir bertahan saat Pusat dinyalakan ulang (lihat 3.1).
- Tidak ada antrean simpan luring di Kasir. Kalau ada, stok dan nomor transaksi bisa bentrok, dan itu yang ditolak sejak awal.

**Sudah dikerjakan (Tahap 4)**, kode di `src-tauri/src/jaringan/klien.rs` (`Klien`), `pindah_lama::nama_komputer_lama`, dan `src/api/pusat.ts`:

- `Klien` berbagi satu `Pengaturan` (`pusat.json`) dengan `Kendali`, jadi tidak ada yang saling menimpa. Bagian `kasir` berisi `pusat` (nama atau IP yang diketik), `namaPusat`
  (nama yang dijawab Pusat saat pertama tersambung), `ipTerakhir`, `token`, dan `sesi`. Port Pusat yang dituju memakai `port` dan `TOKOPRO_PORT`, seperti di Pusat.
- `reqwest` jadi dependensi langsung. Penyedia kripto **memang perlu** walau lalu lintasnya `http`: `Client::new()` panik tanpanya. `klien_http()` memasang `rustls` `ring` sekali per proses
  (efek sampingnya, klien updater di proses yang sama ikut mendapat penyedia).
- Urutan alamat: alamat yang terakhir menjawab (di memori), nama atau IP yang diketik (semua hasil resolver, IPv4 dulu), lalu `ipTerakhir`. Alamat dipakai bila `/halo` menjawab nama
  komputer yang sama dengan `namaPusat`. IPv6 link-local (`fe80::`) tidak dicoba.
- `Klien::jalankan` memakai `golongan.rs`: Lokal dikerjakan oleh penutup `lokal` yang diberikan `jalankan` Tauri (thread terpisah), Data dikirim ke Pusat, Khusus Pusat, `foto_simpan`
  (sampai Tahap 6), dan perintah tak dikenal ditolak di Kasir, `restore_session` dijawab kosong. Setelah `login`, `login_bawaan`, `current_user`, `logout`, dan `change_password` berhasil, salinan `User`
  di sesi `"lokal"` ikut diperbarui. Salinan dikosongkan bila Pusat menjawab sesi tidak dikenal (pengguna masuk lagi).
- Kasir tidak membuka database. Bila `pusat.json` berisi mode Kasir saat aplikasi dibuka, `lib.rs` tidak memanggil `db::open`; yang dipasang hanya `Db` kosong di memori (tanpa file) karena
  `Konteks` selalu membawa `&Db`, dan perintah lokal tidak menyentuhnya. Berpindah dari Kasir ke Tunggal atau Pusat baru bisa dipakai setelah aplikasi dibuka ulang
  (`pusat_status.perluMulaiUlang`; `jalankan` menolak dengan pesan yang jelas).
- Kesalahan yang berasal dari sambungan atau keadaan Pusat berawalan `[pusat] ` (Pusat tidak terjangkau, belum disambungkan, perangkat dicabut, perawatan, kode salah). Kesalahan dari perintah
  itu sendiri (`kode: "perintah"`) diteruskan apa adanya, jadi `[izin]`, `[konfirmasi]`, dan "kata sandi salah" tidak berubah. "Sesi Anda sudah berakhir" juga tanpa awalan.
- Gagal tersambung (permintaan belum terkirim) dicoba sekali lagi dengan mencari alamat ulang. Habis waktu tidak diulang; jawaban yang hilang sebelum waktu habis diulang sekali hanya untuk perintah simpan ber-ID (Tahap 5). Untuk perintah simpan pesannya "belum tahu apakah transaksi ini sudah tersimpan"
  (sejak Tahap 5 dengan janji "tidak akan tercatat dua kali", lihat 4.2). Batas waktu: 10 detik untuk perintah baca (`list_`, `get_`, `laporan_`, dan sejenisnya), 30 detik untuk yang lain.
- Pemeriksa `/halo` berjalan di latar hanya di mode Kasir yang sudah disambungkan: 15 detik saat tersambung, 3 detik saat terputus lalu naik pelan ke 10 detik. Status: `belum-sambung` (tambahan di luar
  daftar awal), `menyambung`, `tersambung`, `terputus`, `versi-beda`, `perawatan`, `ditolak`. Perubahan dikirim sebagai event `status-pusat`. `ditolak` bertahan sampai disambungkan ulang.
  `versi-beda` awalnya hanya melapor; sejak Tahap 6 perintah data diblokir (6.4).
- Perintah Tauri: `kasir_atur(pusat, port?)` (Manager yang masuk, atau komputer yang sudah Kasir), `kasir_sambung(kode?)`, `kasir_nama_lama()`, dan `pusat_status` kini memuat `kasir`.
  `pusat_atur_mode` menerima `kasir`, tetapi tidak mengisi nama Pusat. Pembungkusnya di `src/api/pusat.ts`; tampilannya Tahap 7.
- `TOKOPRO_DATA_DIR` (hanya build debug) sekarang dibaca: folder data aplikasi, tempat `pusat.json`, `foto/`, dan `tokopro.db` bila `TOKOPRO_DB` kosong.

## 6. Fitur yang perlu perlakuan khusus

### 6.1 Backup, restore, dan auto-backup saat keluar

- Backup, restore, cek, dan perbaiki database hanya dari komputer Pusat (golongan "Khusus Pusat"). Alasannya, argumen `folder`
  adalah folder di komputer yang memegang data, dan folder backup disimpan per komputer di `localStorage`.
- Auto-backup saat keluar (`cadanganSaatKeluar`) **tidak jalan** di mode Kasir (Rust Kasir menjawab `backup_otomatis` kosong tanpa mengirimnya, jadi tidak ada pesan error), karena data tidak ada di komputer itu.
  Di Pusat tetap seperti sekarang (10 file terakhir).
- Karena Pusat bisa menyala berhari-hari, Pusat juga membuat backup harian otomatis pada jam pertama setelah tengah malam
  (memakai `backup_otomatis` yang sama). Ini tahap lanjutan.
- Saat restore atau "Ambil dari Toko Pro Lama" berjalan, Pusat masuk **mode perawatan**: `/halo` melaporkan `perawatan`,
  `/jalankan` dijawab "Pusat sedang memulihkan data", dan setelah selesai semua sesi Kasir diakhiri (data pengguna bisa berubah).
  `database::pulihkan` sudah mengganti koneksi di bawah `Mutex`, jadi tidak ada perintah yang berjalan di tengah penggantian.

### 6.2 Migrasi skema (`migrasi.rs`)

- Hanya Pusat (dan Tunggal) yang membuka database, jadi migrasi tetap jalan di `db::open` seperti sekarang, termasuk cadangan `sebelum-update`.
- Kasir tidak membuka `tokopro.db` sama sekali. Bila file itu sudah berisi data saat komputer dijadikan Kasir, aplikasi
  membuat cadangan, lalu membiarkan filenya tanpa dipakai, dengan pesan yang menjelaskannya.
- Versi aplikasi Kasir dan Pusat harus sama (6.4). Karena itu `user_version` tidak perlu dicocokkan sendiri, tetapi tetap
  dilaporkan di `/halo` untuk pemeriksaan.
- Tabel baru (`perangkat`, `sesi_perangkat`, `permintaan_selesai`) ditambahkan lewat langkah baru di `MIGRASI` dan `schema.sql`,
  mengikuti aturan di `CLAUDE.md` (tes di `tests_migrasi.rs`).

### 6.3 "Ambil dari Toko Pro Lama" (`pindah_lama.rs`)

- Khusus Pusat. Sesuai rencana pindah serentak, perintah ini dijalankan di komputer server lama, yang kemudian dijadikan Pusat.
- Perintahnya tetap `async` dengan `emit("pindah-lama")` dan tidak masuk dispatcher.
- Urutan di hari pindah: pasang Toko Pro baru di komputer server lama → Ambil dari Toko Pro Lama → Jadikan komputer ini Pusat
  → pasang di komputer kasir → Sambungkan ke Pusat. Bila Kasir sudah tersambung saat data diambil, mode perawatan (6.1) berlaku.

### 6.4 Pembaruan otomatis

Keputusan: **versi aplikasi Kasir harus sama persis dengan Pusat.** Isi perintah dan argumennya bisa berubah di setiap rilis,
jadi kecocokan sebagian tidak bisa dijamin.

- `/halo` mengembalikan versi Pusat. Bila berbeda, Kasir berstatus `versi-beda` dan semua perintah data ditolak dengan pesan yang jelas.
- **Pusat lebih baru** (biasanya setelah Pusat diperbarui): Kasir menawarkan pembaruan **ke versi Pusat**, bukan ke versi
  terbaru. Rust Kasir memakai `updater_builder().endpoints(...)` dengan alamat
  `.../releases/download/v<versi-pusat>/latest.json` milik tag itu. (Cek dulu di dokumentasi tauri-plugin-updater 2.x sebelum
  mengerjakan Tahap 6, termasuk apakah `latest.json` ikut diunggah di setiap tag.)
- **Kasir lebih baru:** Kasir menolak tersambung dengan pesan "Perbarui Toko Pro di komputer Pusat dulu".
- Di mode Kasir, tombol Cek Update di Bantuan dan pemberitahuan di Home hanya menawarkan versi Pusat.
- Pemasangan pembaruan di Kasir tidak lagi dibatasi pada login Manager di Pusat, karena Kasir hanya bisa naik ke versi yang
  sudah dipilih Manager di Pusat. Pembaruan di Pusat tetap hanya untuk Manager.
- Saat Pusat memasang pembaruan, server berhenti; Kasir melihat status `terputus`, lalu `versi-beda` setelah Pusat menyala.

### 6.5 Foto barang

- Foto disimpan di Pusat (`app_data_dir/foto`), satu salinan untuk semua komputer.
- `foto_simpan` di Kasir membaca file gambar di komputer Kasir (aturan ekstensi dan 10 MB yang sama dengan `gambar_data`),
  lalu mengirim isinya ke perintah `foto_simpan_data(kode, data)` di Pusat. Izin (`izin_foto`) diperiksa di Pusat.
- Foto dari Toko Pro lama (`src/lib/fotoLama.ts`) dikirim dengan `hanyaBaru: true` (perbaikan D9). Pusat memeriksa "barang ini sudah punya foto?" di `berkas::foto_tulis_opsi` **di dalam kunci yang sama dengan penulisannya**
  (`KUNCI_FOTO`, satu kunci untuk semua penulisan foto), dan foto yang sudah ada tidak ditimpa; file asal di komputer kasir tidak dihapus. Daftar `foto_perlu_kirim` hanya penyaring awal. Foto yang dipilih pengguna sendiri di layar Data Barang tetap mengganti foto lama.
- `foto_baca` tetap mengembalikan data URI. Kalau ternyata lambat untuk daftar barang bergambar, tahap lanjutan menambah
  `GET /foto/{kode}` dengan cache di Kasir.

### 6.6 Cetak dan ekspor

- Struk dan laporan dicetak di komputer Kasir (`cetak` memanggil `window.print()` di jendela itu). Datanya diambil dari Pusat,
  lalu tampilan menyusun struk seperti sekarang.
- Pengaturan printer dan cetak yang tersimpan di `localStorage` tetap per komputer, sama seperti aplikasi lama.
- `simpan_file`, `simpan_xlsx`, `simpan_laporan`, dan `ekspor_nama` menulis ke folder di komputer pengguna.
- `master::hapus_barang` menulis catatan `del<yymmddhh>.txt` di samping file database, jadi catatan itu ada di Pusat. Ini benar.

## 7. Pengalaman pengguna

Pembaca: pemilik toko dan kasir, bukan orang IT. Sapaan "Anda", kalimat aktif, tanpa istilah seperti server, port, atau token.
Alamat IP hanya muncul di layar Komputer Pusat, sebagai cadangan yang bisa disalin. Jenis jaringan tidak pernah disebut.

Istilah baku:

| Istilah | Arti | Jangan pakai |
|---|---|---|
| Komputer Pusat (Pusat) | komputer yang memegang data toko | server, host |
| Komputer kasir | komputer lain yang tersambung ke Pusat | client, klien, terminal |
| Kode sambung | 6 angka sekali pakai dari Pusat | kode pairing, token |
| Tersambung / terputus | status koneksi | online/offline, connect |
| Nama komputer | nama komputer Windows | hostname |
| Alamat (IP) | hanya di layar Komputer Pusat, sebagai cadangan bila nama tidak ditemukan | IP address, host |

### 7.1 Pengaturan awal

- Instalasi yang sudah ada otomatis memakai mode Tunggal, tanpa pertanyaan. Perilakunya tidak berubah.
- Komputer yang punya Toko Pro lama dan perannya jelas tidak mendapat pertanyaan ini: ia memakai alur pindah otomatis (bagian 8)
  dengan satu layar konfirmasi.
- Pada instalasi baru lainnya (database kosong dan belum ada `pusat.json`), sebelum layar login muncul pertanyaan. Tidak ada
  pertanyaan soal jenis jaringan.

  > **Bagaimana Toko Pro dipakai di toko Anda?**
  > - **Hanya di komputer ini.** Pilih ini kalau toko Anda hanya punya satu komputer kasir.
  > - **Jadikan komputer ini Pusat.** Data toko disimpan di sini, dan komputer kasir lain tersambung ke komputer ini.
  > - **Sambungkan ke Pusat.** Pilih ini kalau di toko Anda sudah ada komputer Pusat.

- Pilihan yang sama ada di Pengaturan → Alat Bantu → **Komputer Pusat** (khusus Manager), untuk mengubah mode kapan saja.
- Syarat "database kosong" (perbaikan D7) dipakai bersama oleh layar pilihan awal (`perlu_pilihan`) dan cadangan sebelum jadi Kasir (`cadangan_sebelum_kasir`) lewat satu fungsi, `database::database_berisi(conn)`. Fungsi itu menghitung barang, transaksi (termasuk order),
  pelanggan, supplier, karyawan, kas, piutang, poin, penjualan tertunda, promo, kategori dan kelompok, pengguna selain akun `admin` bawaan (atau `admin` yang kata sandinya sudah diatur), serta jenis non tunai dan satuan yang berbeda dari data bawaan. Gagal memeriksa dianggap berisi.
- Ringkasan sesudah pindah dari Toko Pro lama (perbaikan D8) hanya berkata pengaturan lama sudah dipakai bila memang diterapkan. Bila `lama.pengaturan()` gagal, ringkasan menyebut pengaturan belum bisa dibaca; pilihan lama yang tidak ada lagi dan diganti `rapikan()` (mis. port COM menjadi USB)
  disebut satu per satu di daftar "Yang perlu Anda tahu" (`pilihanDiganti` di `src/pages/localSettings.ts`, dihitung sebelum pengaturan diterapkan).

Layar "Jadikan komputer ini Pusat":

> Komputer ini akan menyimpan data toko untuk semua komputer kasir. Biarkan komputer ini menyala dan Toko Pro tetap terbuka selama toko buka.
> Windows akan meminta izin supaya komputer kasir bisa tersambung. Pilih **Ya** saat ditanya.

Setelah aktif, layar itu menampilkan nama komputer Pusat dan alamat IP-nya (untuk diisi di kasir), tombol
**Tambah komputer kasir**, dan daftar komputer tersambung.

> **Ketik ini di kolom "Nama komputer Pusat" di komputer kasir**
> **TOKO-PC** [Salin]
> Kalau nama ini tidak ditemukan, ketik alamatnya: **192.168.10.1** [Salin]

> Kode sambung: **482 913**
> Ketik kode ini di komputer kasir dalam 10 menit.

Layar "Sambungkan ke Pusat" (di komputer kasir):

> Nama komputer Pusat: [ TOKO-PC ]
> Kode sambung: [ ______ ]
> Ketik nama komputer Pusat atau alamatnya, sama seperti di Toko Pro lama. Kode sambung tampil di layar Komputer Pusat.

Bila isian terisi dari `Settings.ini` lama, di bawahnya tampil: "Diisi dari pengaturan Toko Pro lama di komputer ini."
Nama Pusat bisa diubah lagi di Pengaturan → Alat Bantu → Komputer Pusat di komputer kasir.

### 7.2 Status di bilah atas

Satu ikon kecil di header (dekat indikator pembaruan), dengan teks lengkap di tooltip dan status bar:

| Keadaan | Tampilan | Teks |
|---|---|---|
| Pusat, ada kasir | titik hijau | "Pusat · 2 komputer kasir tersambung" |
| Kasir tersambung | titik hijau | "Tersambung ke TOKO-PC" |
| Kasir menyambung lagi | titik kuning berkedip | "Menyambung lagi ke TOKO-PC…" |
| Kasir terputus | titik merah | "Pusat tidak terjangkau" |
| Jam berbeda | ikon jam kuning | "Jam di komputer ini berbeda 5 menit dengan Pusat" |

Warna memakai token tema (`bg-success`, `bg-warning`, `bg-destructive`), mengikuti aturan warna di `CLAUDE.md`.
Mode Tunggal tidak menampilkan ikon.

### 7.3 Pesan

| Keadaan | Pesan |
|---|---|
| Pusat tidak terjangkau saat membuka data | Komputer Pusat (TOKO-PC) tidak bisa dihubungi. Pastikan komputer itu menyala dan Toko Pro terbuka di sana. |
| Simpan gagal karena Pusat terputus | Transaksi belum tersimpan karena Pusat tidak terjangkau. Isian Anda masih ada. Tekan **Coba Lagi** setelah Pusat menyala. |
| Hasil simpan tidak diketahui (waktu habis, jawaban hilang, atau jawaban bukan JSON) | Toko Pro belum tahu apakah transaksi ini sudah tersimpan. Tekan **Coba Lagi**. Toko Pro akan memeriksa dulu apakah transaksi ini sudah tersimpan. (Bila dialog ditutup: "...Lihat dulu daftar transaksi sebelum menyimpan lagi.") |
| Versi berbeda, Pusat lebih baru | Toko Pro di komputer ini (versi 1.3.0) lebih lama dari Pusat (versi 1.4.0). Perbarui sekarang supaya bisa tersambung lagi. |
| Versi berbeda, Kasir lebih baru | Toko Pro di komputer Pusat masih versi 1.3.0. Perbarui Toko Pro di komputer Pusat dulu, lalu buka lagi komputer ini. |
| Kode sambung salah | Kode sambung salah atau sudah tidak berlaku. Buat kode baru di komputer Pusat. |
| Perangkat dicabut | Komputer ini sudah diputus dari Pusat. Minta pemilik toko membuat kode sambung baru. |
| Menu khusus Pusat | Menu ini hanya bisa dibuka di komputer Pusat (TOKO-PC). |
| Pusat sedang perawatan | Pusat sedang memulihkan data. Tunggu sebentar, lalu masuk lagi. |
| Menutup Pusat saat ada kasir | Masih ada 2 komputer kasir yang tersambung. Kalau Anda menutup Toko Pro di sini, kasir tidak bisa menyimpan transaksi. Tetap tutup? |
| Port sudah dipakai | Toko Pro belum bisa menerima komputer kasir karena ada program lain yang memakai jalurnya. Tutup program itu atau ubah nomor jalur di Pengaturan lanjutan. |
| Izin Windows belum diberikan di Pusat | Komputer kasir belum bisa tersambung karena Windows di komputer ini belum mengizinkannya. Tekan **Beri izin**, lalu pilih **Ya** saat Windows bertanya. |
| Nama Pusat tidak ditemukan atau tidak menjawab | Komputer Pusat "TOKO-PC" tidak ditemukan. Periksa nama komputer Pusat dan kabelnya, atau ketik alamat yang tampil di layar Komputer Pusat. |
| Alamat menjawab tetapi bukan Pusat yang dipasangkan | Alamat ini sekarang dipakai komputer lain, bukan TOKO-PC. Ketik nama atau alamat terbaru dari layar Komputer Pusat. |

Teks akhir ditinjau dengan skill `writing-4c` saat Tahap 7.

## 8. Pindah otomatis dari Toko Pro lama (pembukaan pertama)

Tujuan dari pemilik: pengguna lama cukup memasang Toko Pro baru di setiap komputer. Setelah itu semuanya sama dengan aplikasi lama
tanpa pengaturan manual. Bagian ini menggantikan pertanyaan tiga pilihan di 7.1 **untuk komputer yang punya Toko Pro lama**.
Komputer tanpa Toko Pro lama tetap mendapat pertanyaan itu.

### 8.1 Deteksi saat pertama dibuka

Kapan berjalan: saat Toko Pro baru dibuka dan belum ada `pusat.json` serta database masih kosong (belum ada transaksi), hanya di Windows.
Instalasi baru yang sudah dipakai tidak pernah dipindai ulang.

1. **Cari instalasi lama.** Memakai `pindah_lama::cari()` yang sudah ada (memindai `C:\Program Files (x86)`, `C:\Program Files`,
   `C:\`, `D:\` sampai dua tingkat). Fungsi ini diperluas supaya juga mengembalikan folder instalasi tempat `Settings.ini` ditemukan
   dan isi lengkap `Settings.ini` (sudah dibaca oleh `baca_ini`). Bila ada lebih dari satu instalasi, dipakai yang `Settings.ini`-nya
   paling baru diubah.
2. **Tentukan peran** dari `[Database] NamaKomputer` (dibersihkan seperti di 5.1):

| `NamaKomputer` | `DATAPOS.FDB` di komputer ini | Peran |
|---|---|---|
| kosong, `localhost`, `127.0.0.1`, nama komputer ini, atau salah satu IP komputer ini | ada (`LokasiData` lama, atau `\_data\DATAPOS.FDB` di folder instalasi) | **Pusat** |
| nama atau IP komputer lain | tidak dipakai | **Kasir**, menyambung ke `NamaKomputer` |
| kosong/`localhost`/nama sendiri | tidak ada | tidak jelas: tampilkan pertanyaan tiga pilihan biasa (7.1) |

   "IP komputer ini" dibaca dari daftar alamat yang sama dengan layar Komputer Pusat (5.1). Perbandingan nama tidak membedakan huruf besar-kecil.
3. **Satu layar konfirmasi**, lalu tidak ada isian lain:

   Pusat:
   > **Kami menemukan Toko Pro lama di komputer ini.**
   > Komputer ini adalah tempat data toko Anda. Toko Pro baru akan mengambil data barang, transaksi, pelanggan, dan pengguna dari
   > Toko Pro lama, lalu menyiapkan komputer ini sebagai Pusat untuk komputer kasir lain.
   > Tutup dulu Toko Pro lama di **semua** komputer toko. Data lama tidak diubah.
   > [ Mulai ] [ Atur sendiri ]

   Kasir:
   > **Kami menemukan Toko Pro lama di komputer ini.**
   > Komputer ini adalah komputer kasir yang tersambung ke **SERVER**. Toko Pro baru akan tersambung ke komputer yang sama,
   > dan memakai pengaturan struk dan kasir yang sama dengan Toko Pro lama.
   > [ Sambungkan ] [ Atur sendiri ]

   "Atur sendiri" membuka pertanyaan tiga pilihan (7.1). Tidak ada pertanyaan soal jaringan, port, atau kode.

**Perbaikan D6: komputer data lama yang salah dianggap Kasir.** Bila IP komputer data berubah atau namanya diganti, `NamaKomputer` di `Settings.ini` tidak lagi dikenali sebagai komputer ini, jadi komputer itu dianggap Kasir dan menunggu Pusat yang tidak akan pernah ada.
Pemasang lama selalu menaruh `app\_data\datapos.fdb` kosong di semua komputer, jadi keberadaan file itu tidak menentukan peran dan tabel di atas tidak diubah. Gantinya, layar "menunggu Pusat" menampilkan petunjuk dan tombol sesudah 45 detik Pusat tidak ditemukan:
"Komputer Pusat belum ditemukan. Kalau data toko ada di komputer ini, jadikan komputer ini Pusat." Tombol "Jadikan komputer ini Pusat" menjalankan alur Pusat dengan `lama_pusat_mulai(paksa: true)` (`data_untuk_pusat` di `pindah_otomatis.rs`): peran dari `Settings.ini` diabaikan dan file data lama dicari
di komputer ini; bila tidak ada, pesannya meminta pengguna memilih "Atur sendiri". Cadangan tetap dibuat sebelum data diambil. Tes: `d6_*` di `tests_pindah_otomatis.rs`; tes penentuan peran tidak berubah.
Pengaturan dari `Settings.ini` sudah dipakai sebagai kasir saat layar menunggu dibuka, jadi tombol ini memanggil `lupakanPengaturanLama()` lebih dulu. Dengan begitu pengaturan itu dipakai lagi sebagai Pusat (`AktifBackup` dan `LokasiBackup` ikut terbawa), dan ringkasannya tidak salah menulis "sudah dipindahkan sebelumnya". Tes: `tes:pengaturan`. Sudah dilihat di browser dev lewat `?simulasiPusat=lama-kasir&pusatMati=1`.

**Alasan satu layar konfirmasi, bukan diam-diam.** Mengambil data membuat cadangan dan butuh Toko Pro lama ditutup; menjadikan
komputer Pusat memunculkan dialog izin Windows. Pengguna perlu tahu sebabnya sebelum dialog itu muncul.

### 8.2 Di komputer Pusat

Urutan setelah "Mulai":

1. **Periksa Toko Pro lama sudah ditutup.** Bila proses Toko Pro lama masih berjalan di komputer ini, tampilkan pesan dan tunggu
   (periksa ulang tiap 2 detik). Proses di komputer kasir tidak bisa diperiksa, jadi layar konfirmasi memintanya (lihat 8.6).
2. **Ambil data** dengan alur `lama_pindahkan` yang sudah ada, tanpa layar pilih file: file yang dipakai adalah `LokasiData`
   dari `Settings.ini` (kandidat pertama dari `cari()`). Kemajuan memakai event `pindah-lama` yang sudah ada. Cadangan
   "sebelum-restore" dan pemeriksaan Firebird tetap seperti sekarang. Bila Firebird lama tidak ditemukan, tampilkan pesan
   `PESAN_TIDAK_ADA` yang sudah ada dan berhenti di sini. Komputer ini tidak dijadikan Pusat dengan data kosong.
3. **Salin file di luar database** (8.3).
4. **Petakan `Settings.ini`** ke pengaturan per komputer (8.4).
5. **Jadikan Pusat**: tulis `pusat.json`, buat aturan firewall (dialog UAC, 5.3), buka server, buka **masa terima otomatis** (8.5).
6. Tampilkan ringkasan: jumlah barang dan transaksi yang diambil, jumlah foto, dan daftar sisa (8.7) yang berlaku untuk komputer ini.

### 8.3 Foto, logo, dan gambar

Fakta di kode (koreksi atas anggapan bahwa path foto disimpan di tabel barang):

- Aplikasi baru **tidak** menyimpan path foto di database. `berkas.rs` menyimpan foto sebagai `<kode>.<ekstensi>` di
  `app_data_dir/foto` (`foto_salin`, `foto_ada`, `nama_foto(kode)`), dan mencarinya dari kode barang.
- Aplikasi lama memakai aturan nama yang sama: `<kode>.jpg/.jpeg/.bmp/.gif` di folder `lokasiFoto` (bawaan `\_foto\`)
  (`analisis/dekompilasi/ledger/barang.md` BRG-26, BRG-85).

Jadi pemetaannya cukup menyalin file, tanpa mengubah database:

| Kunci lama | Isi | Perlakuan |
|---|---|---|
| `lokasiFoto` (bawaan `\_foto\`) | folder foto barang | Setiap file `<nama>.<jpg/jpeg/bmp/gif>` disalin dengan `foto_salin` bila `<nama>` sama (tanpa beda huruf besar-kecil) dengan `kodebarang` hasil pindah. File yang tidak cocok dengan kode mana pun dilewati dan dihitung di ringkasan. File asli tidak dihapus. |
| `LokasiLogo` (bawaan `\_image\logo.gif`) | logo toko | Disalin ke `app_data_dir/gambar/logo.<ext>`, lalu setelan lokal `logo` diisi path baru. Saat ini logo belum dipakai di struk atau login (SYS-52), tetapi file ikut dibawa supaya tidak hilang bila folder lama dihapus. |
| `LokasiBcGrnd` (bawaan `\_image\background.jpg`) | gambar latar Home | Sama dengan logo, ke `gambar/background.<ext>` dan setelan lokal `background`. |
| `LokasiGambar` (bawaan `\_image\`) | folder gambar aplikasi lama (latar, splash, iklan vendor) | Tidak disalin. Isinya gambar bawaan aplikasi lama, bukan data toko; logo dan latar sudah ditangani di atas. |
| `lokasiUpload` (bawaan `\_upload\`) | folder kerja upload lama | Tidak dipakai. |

Path relatif (diawali `\` tanpa huruf drive, seperti `\_foto\`) dianggap relatif terhadap folder instalasi lama. Path jaringan
(`\\SERVER\...`) dibaca bila bisa dijangkau, dan dilewati tanpa error bila tidak.

Foto di komputer kasir: di aplikasi lama `lokasiFoto` diatur per komputer, jadi komputer kasir bisa punya foto sendiri. Saat
Kasir pertama kali tersambung, ia mengirim fotonya ke Pusat lewat `foto_simpan_data` (6.5) **hanya untuk kode yang belum punya
foto di Pusat**. Foto Pusat tidak pernah ditimpa.

### 8.4 Pemetaan `Settings.ini` ke pengaturan per komputer

Pengaturan per komputer aplikasi baru ada di `localStorage` dengan awalan `tokopro.` (`src/pages/localSettings.ts`:
`LOCAL_DEFAULTS`, `loadLocal`, `saveLocal`), ditambah `tokopro.autoBackup` (`src/api/cadangan.ts`) dan `tokopro.folderBackup`
(`src/api/keuangan.ts`). Rust membaca `Settings.ini` (perintah baru `lama_pengaturan`, mengembalikan peta kunci huruf kecil),
lalu tampilan memetakan, menjalankan `rapikan()` dari `Pengaturan.tsx` (dipindah ke `localSettings.ts` supaya bisa dipakai di luar
layar Pengaturan), dan menyimpan dengan `saveLocal`. Penanda `tokopro.dariLama = "1"` mencegah pemetaan berjalan dua kali.

Aturan nilai:

- Kunci dicari tanpa membedakan huruf besar-kecil dan **tanpa melihat nama bagian**, karena bagian setiap kunci di `Settings.ini`
  lama belum dipastikan (yang pasti hanya `[Database]` untuk `NamaKomputer`, `LokasiData`, `LokasiBackup`, `FirebirdLocation`,
  dari `pindah_lama.rs`). Bila nama yang sama muncul di dua bagian, `[Database]` dipakai untuk kunci database dan `[Application]` untuk sisanya.
- Kotak centang: `1`, `-1`, `True`, `Yes` → `"1"`; selain itu `"0"`. VB6 menyimpan `True` sebagai `-1`.
- Kunci yang tidak ada di `Settings.ini` tidak diubah (memakai bawaan `LOCAL_DEFAULTS`).
- Pilihan yang tidak ada lagi diganti pilihan terdekat lewat `rapikan()` (mis. jenis port selain USB/LPT menjadi `USB`).

Catatan sumber: komentar di `localSettings.ts` menyebut aslinya di registry, dan ledger BRG-01 menyebut `AutoLoadData` "(registry)",
sedangkan daftar string (`strings_main_utf16.txt` baris 61-100) dan SYS-78 menunjukkan kunci-kunci ini dibaca dan ditulis di
`settings.ini`. Tahap 0 memastikannya di satu instalasi lama sungguhan. Bila sebagian ternyata di registry
(`HKCU\Software\VB and VBA Program Settings\...`), `lama_pengaturan` juga membacanya dengan `reg.exe query` (tanpa crate baru),
dan `Settings.ini` tetap didahulukan.

| Kunci lama | Setelan baru | Perlakuan | Berlaku di |
|---|---|---|---|
| `NamaKomputer` | peran dan alamat Pusat (`pusat.json`) | 8.1 dan 5.1 | semua |
| `LokasiData` | file sumber pindah data | 8.2 | Pusat |
| `FirebirdLocation` | folder Firebird untuk pindah data | sudah dipakai `pindah_lama.rs` | Pusat |
| `AktifBackup` | `tokopro.autoBackup` | `"1"` bila aktif | Pusat (diabaikan di Kasir, 6.1) |
| `LokasiBackup` (bawaan `\_file\`) | `tokopro.folderBackup` | Hanya bila berisi folder sendiri yang ada dan bisa ditulis (mis. `D:\Backup`). Nilai bawaan `\_file\` di folder lama tidak dipakai: cadangan baru berformat `.db`, dan folder lama bisa ikut terhapus saat Toko Pro lama dicopot. | Pusat |
| `UkuranKertas` | `ukuranKertas` | langsung, lalu `rapikan()` | semua |
| `JnsPrinter` | `jnsPrinter` | langsung, lalu `rapikan()`. `Direct`/`Direct-Custom` mencetak langsung ke printer mini (ESC/POS); `Custom` memakai dialog cetak sistem. | semua |
| `JnsPortPrinter` | `jnsPort` | langsung, lalu `rapikan()` (`USB`/`LPT`). Dipakai untuk cetak langsung dan buka laci (`peralatan.rs`). | semua |
| `PortPrinter` | `portPrinter` | langsung. Nama printer Windows (USB) atau port (`LPT1`/`COM1`). | semua |
| `PakaiDrawer` | `drawer` | kotak centang. Dipakai untuk membuka laci kasir otomatis saat penjualan tersimpan (`peralatan.rs`). | semua |
| `KodeDrawer` (bawaan `27,112,0,64,240`) | `kodeDrawer` | langsung. Dikirim sebagai byte ESC/POS ke laci kasir. | semua |
| `PortDrawer` | `portDrawer` | langsung. Bila kosong, mengikuti `portPrinter` (atau printer bawaan Windows di mode USB). | semua |
| `modeScan` | `modeScan` | indeks pilihan lama dipakai apa adanya (`0` = Grid, `1` = TextBox, sama dengan `MODE_SCAN`) | semua |
| `KonfirmasiCetakStrukJual` | `konfirmasiCetak` | kotak centang | semua |
| `FormatQtyStruk` | `formatQty` | langsung, lalu `rapikan()` | semua |
| `FormatHrgStruk` | `formatHrg` | langsung, lalu `rapikan()` | semua |
| `aktifFoto` | `aktifFoto` | kotak centang | semua |
| `lokasiFoto` | `lokasiFoto` dikosongkan | Isi foldernya disalin (8.3). Setelan dikosongkan karena aplikasi baru memakai folder fotonya sendiri; path lama tidak lagi dibaca. | semua |
| `AutoLoadData` | `autoLoad` | kotak centang | semua |
| `KursorKolomJml` | `kursor` | kotak centang | semua |
| `PilihanHome` | `home` | Indeks `cmbHome.ListIndex` (SYS-77): `0` → `Home`, `1` → `Dashboard`. Bila berisi teks, dicocokkan dengan `HOME`, lalu `rapikan()`. | semua |
| `DefaultJmlByr` | `defaultJmlByr` | kotak centang | semua |
| `AKTIFSKIN` | `aktifSkin` | kotak centang. Tersimpan, tidak berefek (skin Office2007 tidak ada, SYS-04). | semua |
| `LokasiLogo` | `logo` | 8.3 | semua |
| `LokasiBcGrnd` | `background` | 8.3 | semua |
| `LokasiGambar` | tidak dipakai | gambar bawaan aplikasi lama (8.3) | – |
| `LokasiReport` | tidak dipakai | Berisi file laporan `.rpx` aplikasi lama. Laporan aplikasi baru digambar di dalam aplikasi (SYS-94). | – |
| `lokasiUpload` | tidak dipakai | 8.3 | – |
| `FirstInstall` | tidak dipakai | penanda instalasi aplikasi lama | – |
| (tidak ada di lama) | `ukuranTampilan`, `updateHargaJual` | tetap bawaan | – |

Pengaturan toko yang ada di database (`tseting`: nama usaha, footer struk, izin harga, PPN, dan seterusnya) ikut terbawa oleh
pindah data, bukan oleh `Settings.ini`.

### 8.5 Urutan pasang dan kode sambung

**Kasir dipasang sebelum Pusat siap.** Kasir tetap memakai peran dan nama dari `Settings.ini`, menulis `pusat.json`, lalu menunggu:

> **Menunggu komputer Pusat (SERVER)…**
> Pasang Toko Pro baru di komputer SERVER lalu buka sekali. Komputer ini akan tersambung sendiri begitu SERVER siap.
> Toko Pro lama di komputer SERVER juga harus ditutup.
> [ Atur sendiri ]

Kasir mencoba `GET /halo` tiap 5 detik. Bila Pusat menjawab dengan status `perawatan` (sedang mengambil data), pesannya berganti
"Komputer SERVER sedang mengambil data dari Toko Pro lama. Tunggu sebentar." Setelah Pusat siap, Kasir tersambung sendiri dan
membuka layar login. Urutan pasang tidak penting: Pusat dulu atau Kasir dulu hasilnya sama.

**Keputusan: kode sambung dilewati selama masa terima otomatis.**

- Pusat yang baru disiapkan dari Toko Pro lama membuka **masa terima otomatis** sampai pukul 23.59 hari itu. Selama masa itu,
  `POST /sambung` tanpa kode diterima dari komputer yang alamatnya satu subnet dengan Pusat (termasuk `169.254.0.0/16`), dan
  Pusat langsung menerbitkan token perangkat.
- Kasir yang perannya diambil dari `Settings.ini` mencoba `/sambung` tanpa kode lebih dulu. Bila ditolak (masa sudah lewat),
  ia meminta kode sambung seperti biasa (5.4).
- Setiap komputer yang diterima otomatis muncul di daftar Komputer Pusat dengan tanda "diterima otomatis", dan Pusat menampilkan
  pemberitahuan "Komputer KASIR-2 tersambung ke Pusat". Manager bisa memutusnya kapan saja.
- Manager bisa menutup masa terima otomatis lebih awal dengan tombol "Selesai menyambungkan" di layar Komputer Pusat (S1). Masa itu juga tertutup sendiri setelah 10 perangkat diterima, dan satu alamat IP hanya mendapat satu perangkat per masa
  (yang kedua dari alamat yang sama menggantikan yang pertama, S2). Perintah `pusat_terima_otomatis` masih bisa membukanya lagi untuk 1 jam (belum ada tombolnya di layar).

Alasan: tujuan pemilik adalah pasang tanpa isian apa pun. Di kabel langsung tanpa router, satu-satunya perangkat lain di jaringan
adalah komputer kasir itu sendiri. Di jaringan dengan router, perangkat asing harus mencoba tepat pada hari pindah, dari jaringan
yang sama, dan tetap butuh login pengguna Toko Pro untuk membaca data.

Risiko yang diterima: selama masa itu, perangkat lain di jaringan toko (mis. ponsel di Wi-Fi yang sama) bisa mendapat token
perangkat. Token saja tidak membuka data karena setiap perintah tetap butuh login pengguna (3.1), tetapi perangkat itu bisa
mencoba menebak kata sandi. Penanganan: batas percobaan login per perangkat (5 kali salah → jeda 5 menit), daftar perangkat yang
terlihat, dan masa yang pendek. Sejak perbaikan S1 sampai S3: paling banyak 10 perangkat per masa, satu perangkat per alamat, batas login per perangkat **dan** per alamat dengan reservasi (30 percobaan paralel tetap paling banyak 5 yang diproses),
tombol "Selesai menyambungkan", dan perangkat otomatis diberi tanda "Tanpa kode" dengan tombol Putuskan di layar Komputer Pusat.

Pilihan yang ditolak: *tanpa kode selamanya* (perangkat asing bisa masuk kapan saja), dan *rahasia bersama dari data lama*
(komputer kasir tidak punya database, dan password Firebird lama adalah bawaan `masterkey` yang tidak rahasia).

### 8.6 Password pengguna

Keadaan sekarang: `pindah_lama.rs` membuang isi `pswduser` saat memindahkan `MDUSER` (`nilai[p] = None`), jadi semua pengguna
hasil pindah masuk dengan password sementara `admin` lalu membuat password baru (`auth::check`, `must_change`).

**Hasil pengecekan (23 November 2026): algoritma lama terbukti dan bisa dibalik.**

- Login lama (SYS-50, `FrmZLogin.cLogin_Click`) mengenkripsi password yang diketik dengan `FUN_0069e4e0`, lalu mencocokkannya
  langsung di SQL (`... and pswduser='<hasil>'`). Enkripsinya deterministik dan tanpa garam.
- Kuncinya teks tetap di dalam program: `K = "Program Encrypt dan Decrypt ini dibut oleh LuckMy"` (49 huruf, dari literal di exe).
- Algoritmanya, dengan `P` = password (byte ANSI) dan indeks mulai 0:

  ```
  F = P diulang 6 kali                  ' panjang hasil = 6 × panjang password
  hasil[n] = F[n] + K[n mod 49] - 30    ' per byte, Chr$(Asc(..) + Asc(..) - 30)
  ```

  Kebalikannya: `F[n] = hasil[n] - K[n mod 49] + 30`, lalu ambil seperenam pertama.
- Bukti dengan database bawaan installer resmi (`Setup Software Toko Pro Unlimited 32bit.exe`, `app/_data/datapos.fdb`), yang
  dibagikan ke semua pembeli dan memakai password bawaan dari panduan `BACA DULU!!.txt`:
  - `encrypt("admin")` sama persis byte per byte dengan `pswduser` pengguna `Admin` (30 byte).
  - `encrypt("kasir")` sama persis dengan `pswduser` pengguna `kasir` (30 byte).
  - `pswduser` pengguna `ADMIN` (36 byte) terbaca sebagai password bawaan 6 karakter, dan mengenkripsinya lagi memberi hasil yang
    sama persis. Nilainya sengaja tidak ditulis di dokumen ini (lihat risiko di bawah).
- Rekonstruksi pertama dari disassembly (memperpanjang password dengan potongan `Mid$`, panjang `11L − 5`) salah membaca jumlah
  dan bentuk pengulangan. Data installer membuktikan bentuk yang benar di atas.
- Database toko sungguhan tidak didekripsi, dan isi `pswduser`-nya tidak dicatat di mana pun.

Vektor tes Rust (data bawaan installer, publik):

| Password | `pswduser` (hex) |
|---|---|
| `admin` | `93b8beb2c2a4b36f90bea6b8c8bbc463aab0b97087abb2bdc9b3ba6fb4be` |
| `kasir` | `9db5c4b2c6aeb07590c2b0b5cebbc86da7b6b97491a8b8bdcdbdb775b4c2` |

**Keputusan: password lama dibaca saat pindah data, lalu langsung disimpan sebagai hash Argon2.**

1. Fungsi Rust murni `lama_buka_password(byte) -> Option<String>` di `pindah_lama.rs` membalik enkripsi, lalu **memeriksa
   hasilnya**: panjang kelipatan 6, keenam ulangan sama persis, dan semua karakter ASCII yang bisa dicetak (32–126). Bila satu
   syarat gagal, hasilnya `None`.
2. Hanya bila lolos validasi itu, `pswduser` baru diisi `auth::hash(password)` (Argon2, sama dengan password baru). Bila `None`,
   `pswduser` diisi `NULL`, sehingga akun itu memakai password sementara `admin` dan diminta membuat password baru
   (`must_change`), seperti sekarang. Dengan begitu salah baca tidak pernah membuat pengguna terkunci: hasil terburuknya sama
   dengan perilaku hari ini. Kode juga mengenkripsi ulang hasil baca dan membandingkannya dengan data lama, tetapi itu hanya
   pengaman tambahan: karena enkripsi lama bisa dibalik penuh, pengecekan itu secara matematis tidak pernah gagal. Pengaman
   yang sebenarnya adalah syarat enam ulangan yang sama dan huruf ASCII 32-126.
3. Password lama hanya ada di memori selama satu baris diproses, tidak pernah ditulis ke file, log, atau event kemajuan.
4. Pengguna masuk dengan password lamanya sejak hari pertama, tanpa diminta membuat password baru.

Alasan memilih membaca saat pindah, bukan mencocokkan saat login: algoritmanya terbukti bisa dibalik, jadi tidak perlu kolom
`pswdlama`, tidak perlu kode enkripsi lama di `auth.rs`, dan bentuk lemahnya tidak disimpan di database baru sama sekali.
Pemeriksaan enam ulangan dan rentang ASCII membuat salah baca berakhir sebagai password sementara, bukan password salah.

Pilihan yang ditolak: *menyimpan `pswduser` lama lalu mencocokkannya saat login*. Ini rencana sebelum algoritma terbukti. Sekarang
cara itu hanya menambah kolom, kode, dan masa simpan data lemah tanpa manfaat tambahan.

Risiko yang perlu diketahui pemilik:

- Installer resmi membawa akun `ADMIN` (Manager) dengan password bawaan 6 karakter yang sama di semua toko, dan `admin`/`kasir`
  untuk dua akun lain. Toko yang tidak pernah menggantinya akan membawa password bawaan itu ke Toko Pro baru, sama seperti di
  aplikasi lama. Keputusan pemilik: ringkasan setelah pindah tidak menyebutnya.
- **Nama pengguna yang hanya beda huruf besar-kecil** (risiko yang sudah ada di kode sekarang, lihat 8.6a).
- Karena enkripsi lama bisa dibalik oleh siapa pun yang punya file `DATAPOS.FDB` lama, panduan menyarankan file lama disimpan
  di tempat aman atau dihapus setelah pindah berhasil.

Teks untuk pengguna:

| Keadaan | Teks |
|---|---|
| Password lama terbaca | (tidak ada pesan; pengguna masuk dengan password lamanya) |
| Ada pengguna yang password lamanya tidak terbaca (ringkasan di Pusat) | 2 pengguna dari Toko Pro lama belum bisa memakai password lamanya. Mereka masuk dengan password sementara **admin**, lalu Toko Pro meminta membuat password baru. |

### 8.6a Login dengan nama pengguna yang hanya beda huruf besar-kecil

Masalah di kode sekarang: `auth::load` (`src-tauri/src/auth.rs`) mencari dengan `UPPER(u.iduser) = UPPER(?1)`, mengurutkan nama
yang hurufnya persis sama lebih dulu (`ORDER BY (u.iduser = ?1) DESC`), lalu mengambil **satu** baris (`LIMIT 1`). `login` dan
`verifikasi_pengelola` hanya memeriksa password akun itu.

Database bawaan installer punya `ADMIN` (Manager) dan `Admin` (Supervisor). Bila pengguna mengetik `admin` sesuai panduan
`BACA DULU!!.txt`, tidak ada yang hurufnya persis sama, sehingga akun yang terpilih tidak pasti. Bila yang terpilih `ADMIN`,
password `admin` ditolak padahal akun `Admin` dengan password itu ada. Hari ini masalah ini tertutup karena semua password hasil
pindah kosong (semuanya menerima `admin`). Begitu password lama ikut pindah (8.6), masalahnya muncul.

Aplikasi lama tidak punya masalah ini karena mencocokkan ID dan password sekaligus di SQL (SYS-50:
`where upper(iduser)='<USER>' and pswduser='<enkripsi>'`), jadi akun yang passwordnya cocok selalu ketemu.

Keputusan:

- Fungsi baru `calon_login(conn, iduser) -> Vec<(Option<String>, User, i64)>` mengembalikan **semua** akun dengan
  `UPPER(iduser) = UPPER(?)`, diurutkan: huruf persis sama lebih dulu, lalu `iduser` (supaya urutannya tetap).
- `login` memakai **akun aktif pertama yang passwordnya cocok**. Aturan kecocokan:
  - Akun yang punya password asli dicocokkan tanpa membedakan huruf besar-kecil nama.
  - Akun tanpa password (NULL atau kosong) menerima password sementara `admin` hanya bila nama yang diketik **persis sama
    hurufnya** dengan akun itu, atau akun itu **satu-satunya** akun dengan nama tersebut. Tanpa aturan ini, `ADMIN` (Manager,
    tanpa password) akan menangkap login `Admin`/`admin` yang ditujukan ke `Admin` (Supervisor, ber-password).
- Pesan "Akun ini sedang dinonaktifkan" hanya muncul bila password yang diketik cocok dengan akun nonaktif bernama sama dan tidak
  ada akun aktif yang cocok. Password yang tidak cocok dengan akun mana pun mendapat pesan salah password biasa, jadi orang tidak
  bisa menebak ada tidaknya sebuah nama.
- `verifikasi_pengelola` memilih akun aktif pertama yang passwordnya cocok **dan** levelnya bukan Kasir/Lainnya. Pesan
  "berlevel Kasir" hanya dipakai bila ada akun aktif yang cocok tetapi tak satu pun levelnya memenuhi.
- Pemakaian `load` lain (`change_password`, `simpan_user`, `hapus_user`, `daftar_akses`/`simpan_akses`, `restore_session`)
  menerima `iduser` persis dari sesi atau daftar pengguna, jadi tetap memakai `load`. Urutan "huruf persis sama lebih dulu" sudah
  menjamin akun yang benar.
- Biaya: Argon2 dijalankan sekali per calon yang dicoba. Paling banyak beberapa akun, jadi tidak terasa.

Perubahan ini kecil, tidak bergantung pada mode Komputer Pusat, dan harus selesai **sebelum atau bersamaan** dengan pembacaan
password lama (8.6).

Pilihan yang ditolak:

- *Menolak nama yang hanya beda huruf besar-kecil saat pindah data* (mis. mengganti `Admin` jadi `Admin2`). Mengubah nama yang
  sudah dikenal kasir dan pemilik, dan tetap tidak menolong login yang mengetik huruf kecil semua.
- *Mencocokkan nama secara persis (peka huruf).* Berbeda dari aplikasi lama, yang mengubah nama ketikan ke huruf besar; kasir yang
  terbiasa mengetik `kasir` atau `KASIR` akan ditolak.

### 8.7 Yang tetap tidak bisa otomatis

Butir ini muncul di ringkasan setelah pindah (8.2 langkah 6) atau sebagai pesan di tempatnya, hanya bila berlaku untuk komputer itu.

| Butir | Kenapa tidak otomatis | Teks untuk pengguna |
|---|---|---|
| Toko Pro lama masih terbuka di komputer lain | Aplikasi tidak bisa memeriksa proses di komputer lain; data yang diubah setelah diambil tidak ikut | (di layar konfirmasi Pusat) Tutup dulu Toko Pro lama di semua komputer toko. Transaksi yang dibuat di Toko Pro lama setelah data diambil tidak ikut pindah. |
| Toko Pro lama masih terbuka di komputer ini | Database sedang dipakai | Toko Pro lama masih terbuka di komputer ini. Tutup Toko Pro lama, lalu Toko Pro baru akan melanjutkan sendiri. |
| Izin Windows di Pusat | Butuh persetujuan administrator (UAC) | Windows akan bertanya apakah Toko Pro boleh menerima komputer kasir. Pilih **Ya**. |
| Izin Windows ditolak atau gagal | Pengguna memilih Tidak, atau akun bukan administrator | Komputer kasir belum bisa tersambung karena Windows belum mengizinkannya. Tekan **Beri izin**, lalu pilih **Ya**. Kalau Windows meminta kata sandi administrator, minta bantuan orang yang memasang komputer ini. |
| Printer struk & laci kasir | Sudah didukung otomatis lewat pengaturan yang ikut pindah (`peralatan.rs`: WinSpool RAW untuk USB dan tulis port untuk LPT/COM) | (tidak muncul di daftar sisa; hanya muncul bila ada pilihan lama yang tidak dikenal dan diganti) |
| Laporan buatan sendiri (`LokasiReport`) | Format `.rpx` aplikasi lama tidak dipakai; bawaan `\_report\` selalu terisi walau tanpa laporan kustom | (tidak ditampilkan di ringkasan pindah; semua laporan bawaan ada di menu Laporan) |
| Tampilan Office 2007 (`AKTIFSKIN`) | Tidak ada di aplikasi baru | (tidak ditampilkan; perubahan tampilan sudah jelas) |
| Password yang tidak terbaca | Hasil baca gagal diperiksa (bukan enam ulangan, atau ada huruf di luar ASCII) (8.6) | 2 pengguna dari Toko Pro lama belum bisa memakai password lamanya. Mereka masuk dengan password sementara **admin**, lalu Toko Pro meminta membuat password baru. |
| Nama Pusat tidak ditemukan dari Kasir | Nama di `Settings.ini` lama mungkin sudah tidak dipakai, atau komputer Pusat berganti nama | Komputer Pusat "SERVER" tidak ditemukan. Pastikan komputer itu menyala dan Toko Pro baru sudah dibuka di sana. Kalau nama komputer Pusat sudah berubah, ketik nama barunya di sini. |
| Peran tidak jelas | `NamaKomputer` berisi `localhost` tetapi tidak ada `DATAPOS.FDB` | (pertanyaan tiga pilihan biasa, 7.1) |
| Foto yang namanya bukan kode barang | Tidak ada cara mengetahui barangnya | Ada 12 foto yang namanya tidak sama dengan kode barang mana pun, jadi tidak ikut pindah. Foto itu tetap ada di folder Toko Pro lama. |
| Komputer Pusat harus menyala | Sama dengan aplikasi lama (server Firebird) | (hanya di layar Komputer Pusat dan Panduan, bukan di daftar sisa pindah) |

## 9. Rencana tahapan

Setiap tahap bisa dikerjakan dan diuji sendiri, dan aplikasi tetap bisa dirilis setelah setiap tahap (mode Tunggal tidak berubah).
Kode ditulis oleh subagent; setiap tahap selesai bila `cargo test`, `npx tsc --noEmit -p .`, dan `npm run build` bersih.

| Tahap | Isi | Selesai bila |
|---|---|---|
| 0. Uji coba kecil | Server axum 0.8 di `tauri::async_runtime`, satu rute `/halo`, dijalankan di Windows: dialog firewall, `netsh` dengan UAC (profil Private, Public, Domain), akses dari komputer lain lewat kabel RJ45 langsung (seperti toko pengguna lama), router, dan Wi-Fi. Catat: apakah `localsubnet` mencakup `169.254.x.x`, apakah nama komputer yang dipakai aplikasi lama ditemukan di profil Public, crate pembaca alamat IP. Cek `updater_builder().endpoints()` di dokumentasi plugin updater. Di satu instalasi Toko Pro lama sungguhan (server dan kasir): salin `Settings.ini`, catat bagian setiap kunci, dan periksa apakah ada kunci di registry `HKCU\Software\VB and VBA Program Settings` (8.4). | Komputer kedua bisa membuka `/halo`; catatan hasilnya ditambahkan ke dokumen ini. |
| 1. Dispatcher lokal | Crate `perintah-macro` (`#[perintah]`, `daftar_perintah!`), `Konteks`, perintah `jalankan`, cari-ganti tanda tangan di semua modul, `src/lib/panggil.ts`, import di 11 file, `tauriMock` membuka `jalankan`. Belum ada jaringan. | Semua tes lama lulus tanpa diubah; tes baru: setiap nama di `src/api` ada di daftar perintah, argumen camelCase terbaca. Aplikasi berjalan sama persis. |
| 2. Sesi per komputer | `DaftarSesi`, token `"lokal"`, tabel `sesi_perangkat` (langkah migrasi baru), `restore_session` ditolak lewat jaringan. | Tes: dua sesi login sebagai pengguna berbeda, `my_menus` dan `require_menu` berbeda per sesi; sesi bertahan setelah `DaftarSesi` dimuat ulang dari database. |
| 3. Server Pusat | Mode di `pusat.json`, server axum (`/halo`, `/sambung`, `/jalankan`), tabel `perangkat`, kode sambung, masa terima otomatis (8.5), batas percobaan kode dan login per perangkat, golongan perintah dan penolakan "Khusus Pusat". | Tes integrasi Rust: server di port acak, klien `reqwest` tersambung dengan kode, perintah tanpa token ditolak 401, perintah khusus Pusat ditolak; `/sambung` tanpa kode diterima hanya selama masa terima otomatis dan dari subnet yang sama. |
| 4. Klien Kasir | `nama_komputer_lama()` dari `Settings.ini` (memakai fungsi di `pindah_lama.rs`), urutan percobaan nama lalu IP terakhir, `jalankan` meneruskan lewat `reqwest`, perintah lokal tetap lokal, salinan `User` untuk izin lokal, pemeriksa `/halo`, event `status-pusat`, awalan error `[pusat] `, Kasir tidak membuka database. | Tes unit `nama_komputer_lama`: `localhost`, nama sendiri, `SERVER/3050`, IP, kosong. Dua proses di satu mesin (lihat 10.2): login, jual, cetak struk dari Kasir; matikan Pusat, lihat status berubah dan tersambung lagi. |
| 5. Kebenaran data | `idPermintaan` + tabel `permintaan_selesai`, `BEGIN IMMEDIATE`, audit pola dua kunci, `jam_pusat` + `today()`. | Tes beban (10.1) lulus: nomor unik dan berurutan, stok sesuai; simpan diulang dengan ID sama tidak menggandakan. |
| 6. Fitur khusus | Mode perawatan untuk restore dan pindah lama, auto-backup dimatikan di Kasir, `foto_simpan_data`, kunci versi dan pembaruan ke versi Pusat, cadangan database lama saat komputer dijadikan Kasir. | Tes restore saat Kasir tersambung: Kasir diminta masuk lagi, data baru terlihat. Foto dari Kasir tampil di Pusat. Kunci versi, keamanan alamat file, dan auto-backup di Kasir diuji (tests_tahap6.rs). |
| 7. Tampilan | Layar pilihan awal, layar Komputer Pusat (kode sambung, daftar perangkat, Putuskan), ikon status, dialog Coba Lagi, konfirmasi menutup Pusat, menu khusus Pusat dikunci di Kasir. Teks ditinjau dengan `writing-4c`. | Dicek di browser dev (`tauriMock` meniru setiap status) dan di aplikasi, mode terang dan gelap. |
| 8. Pindah otomatis | `cari()` mengembalikan folder instalasi dan isi `Settings.ini`; penentuan peran (8.1); layar konfirmasi Pusat/Kasir/menunggu Pusat; alur Pusat tanpa pilih file (8.2); salin foto, logo, latar (8.3); perintah `lama_pengaturan` + pemetaan dan `rapikan()` dipindah ke `localSettings.ts` (8.4); Kasir mengirim fotonya yang belum ada di Pusat; ringkasan dan daftar sisa (8.7); `lama_buka_password` (validasi enam ulangan + ASCII) + `pswduser` diisi hash Argon2 saat pindah (8.6), dan login yang mencoba semua akun senama tanpa beda huruf (8.6a). Keduanya bisa dikerjakan lebih dulu dan terpisah, dengan 8.6a sebelum atau bersamaan 8.6. | Tes Rust dengan folder instalasi tiruan: peran Pusat/Kasir/tidak jelas untuk `localhost`, nama sendiri, IP sendiri, `SERVER/3050`, nama lain; foto `<kode>.jpg` tersalin dan yang tidak cocok dihitung; tes Rust `lama_buka_password` dengan vektor `admin`/`kasir` dari 8.6 dan data rusak (panjang bukan kelipatan 6, ulangan berbeda) → `None`; data rusak satu byte → `pswduser` NULL dan `must_change`; login dengan password lama setelah pindah; tes `auth` 8.6a: akun `ADMIN` dan `Admin` dengan password berbeda, ketik `admin` + password masing-masing → masuk ke akun yang benar, password salah → ditolak, akun nonaktif dilewati, `verifikasi_pengelola` berperilaku sama; tes TS pemetaan setiap kunci di tabel 8.4 (termasuk `-1`/`True`, `PilihanHome` berupa indeks). Uji di dua komputer Windows dengan Toko Pro lama terpasang: pasang Kasir dulu lalu Pusat, dan sebaliknya; keduanya siap tanpa isian. |
| 9. Firewall dan panduan | `netsh` dengan UAC untuk semua profil, aturan dibuat ulang bila lokasi program berubah, hook uninstall NSIS, alamat IP Pusat di layar Komputer Pusat, bab baru di Panduan Penggunaan dan README (alamat `169.254.x.x` bisa berubah, Wi-Fi tamu). | Uji di dua komputer Windows bersih dengan kabel RJ45 langsung (profil Public), lalu lewat router: Jadikan Pusat → kasir tersambung tanpa membuka pengaturan firewall manual. |
| 10. Uji lapangan | Toko sungguhan atau salinannya: satu server dan dua kasir Toko Pro lama dengan kabel RJ45 langsung, dipindah dengan alur bagian 8. Ukur waktu laporan (4.4). | Satu hari simulasi toko tanpa selisih stok/kas; keputusan perlu atau tidaknya koneksi baca kedua. |

**Sudah dikerjakan (Tahap 5):** `idPermintaan` dan `permintaan_selesai` (4.2), `BEGIN IMMEDIATE` dan hasil audit (4.1), `jam_pusat` dan `today()` (4.3), keputusan 4.4 (ditunda ke hasil ukur Tahap 10),
dan tes beban di `tests_data.rs`. Yang tersisa dari bab 4: penulisan `permintaan_selesai` di dalam transaksi perintah, dan koneksi baca kedua.

**Sudah dikerjakan (Tahap 6)**, kode di `jaringan/server.rs` (`dengan_perawatan`, `HEADER_VERSI`), `jaringan/klien.rs`, `jaringan/perangkat.rs`, `berkas.rs`, `alat.rs`, `database.rs`, `pembaruan_pusat.rs`, `lib.rs`; tes di `tests_tahap6.rs`:

- **Mode perawatan (6.1).** `db_restore` dan `lama_pindahkan` yang dijalankan dari jendela Pusat dibungkus `Pusat::dengan_perawatan` (daftar `golongan::PERAWATAN`). Selama berjalan, `/jalankan` dijawab 503
  dan `/halo` melapor `perawatan`. Bila berhasil, semua sesi Kasir dihapus: perintah Kasir berikutnya mendapat "Sesi Anda sudah berakhir. Silakan masuk lagi." (jalur `sesi` yang sudah ada di Tahap 4).
  Tabel `perangkat` bukan data toko: isinya disalin sebelum dan dikembalikan sesudah, jadi Kasir tidak perlu kode sambung baru. Bila perintahnya gagal, sesi dibiarkan.
- **Auto-backup (6.1).** Rust Kasir menjawab `backup_otomatis` dengan nilai kosong tanpa menghubungi Pusat. `cadanganSaatKeluar` menerima hasil kosong.
- **Foto (6.5).** `foto_simpan` tetap golongan Campuran: Kasir membaca file gambarnya (ekstensi dan 10 MB sama seperti sebelumnya), mengirim `foto_simpan_data(kode, ekstensi, data)` dengan isi base64, lalu menghapus file asal bila `hapusAsal`.
  Pusat menyimpan lewat `foto_tulis` (nama file dari kode yang sudah dibersihkan, ekstensi dibatasi). Alamat file dari Kasir tidak pernah dikirim. Agar `foto_baca`/`foto_simpan_data` bisa jalan lewat server (tanpa jendela),
  `Data` punya `folder_data()` dan `Konteks::dengan_folder_data`; sebelumnya `foto_baca` lewat jaringan gagal karena `Konteks` server tidak punya `AppHandle`.
- **Kunci versi (6.4).** Kasir mengirim header `x-versi-kasir` di setiap `/jalankan`. Pusat menjawab 409 (`versi-beda`, memuat `versiPusat`) bila header kosong atau berbeda. Klien Kasir memberi status `versi-beda`
  (dari `/halo` atau dari jawaban 409) dan tidak lagi mengirim perintah data. Pesannya dua macam: Kasir lebih lama ("Perbarui sekarang") atau Pusat lebih lama ("Perbarui Toko Pro di komputer Pusat dulu").
- **Pembaruan ke versi Pusat (6.4).** Dicek di kode sumber `tauri-plugin-updater` 2.14.1 (Context7 tidak memuat plugin ini): `check()` di JS tidak bisa mengganti `endpoints`, hanya `updater_builder().endpoints()` di Rust yang bisa,
  dan secara bawaan hanya menawarkan versi yang lebih tinggi (tidak pernah turun). Karena itu komputer Kasir memakai perintah Tauri `pembaruan_pusat_cek` dan `pembaruan_pusat_pasang` (`pembaruan_pusat.rs`) dengan alamat
  `.../releases/download/v<versi-pusat>/latest.json`, diturunkan dari alamat di `tauri.conf.json`. `latest.json` ikut diunggah di setiap tag (`uploadUpdaterJson: true`), tetapi rilisnya harus sudah dipublikasikan, bukan draf.
  Di Kasir semua akun boleh memasang (dialog tidak lagi meminta Manager). Pusat dan Tunggal tidak berubah. **Belum diuji dengan rilis sungguhan.**
- **Cadangan database lama (6.2).** `kasir_atur` dan `pusat_atur_mode(kasir)` memanggil `database::cadangan_sebelum_kasir` sebelum berpindah dari Tunggal atau Pusat: bila ada barang atau transaksi, salinan `sebelum-jadi-kasir-*.db` dibuat di folder `backup`
  di samping database (gagal berarti komputer belum dijadikan Kasir). `tokopro.db` dibiarkan. Lokasi cadangan dikembalikan di field `cadangan`.
- **Audit alamat file dan folder.** Di golongan Data, hanya perintah berikut yang punya parameter mirip alamat:
  `impor_baca(path)` dan `impor_proses(path, folder)` membaca atau menulis file di Pusat, jadi **dipindah ke Khusus Pusat** (impor Excel hanya dari komputer Pusat; Kasir mendapat pesan "hanya bisa dibuka di komputer Pusat").
  `alat_sinkron_harga_beli`, `alat_sinkron_jual`, `alat_hapus_transaksi`, dan `alat_hapus_data` menerima `folder` untuk cadangan pengaman: dari jaringan `folder` diabaikan dan cadangan masuk ke folder bawaan Pusat (`alat::folder_aman`).
  `foto_baca`, `foto_hapus`, dan `foto_simpan_data` hanya menerima kode barang yang dibersihkan menjadi huruf, angka, `-`, `_`. `db_path` dan `db_info` hanya mengembalikan alamat (bukan menerima), dan hanya untuk Manager atau pengelola; dibiarkan.
  Perintah lain golongan Data tidak punya parameter alamat. Satu tes memeriksa semua parameter golongan Data supaya perintah baru dengan parameter mirip alamat tidak lolos tanpa tinjauan.
- Penyimpangan dari rancangan awal: `impor` pindah dari Data ke Khusus Pusat (tabel 2.3 diperbarui); rancangan Tahap 6 menyebut "Kasir mengirim isi file" untuk impor, tetapi impor dari komputer Kasir belum dikerjakan (keputusan paling sederhana, dicatat sebagai tahap lanjutan).

**Sudah dikerjakan (Tahap 7)**, kode di `src/pages/PilihanAwal.tsx`, `src/pages/KomputerPusat.tsx`, `src/components/{PilihanPeran,StatusPusat,KunciPusat,CobaLagiDialog}.tsx`, `src/lib/{statusPusat,cobaLagi,panggil}.ts`, `src/api/pusat.ts`, `App.tsx`, dan `tauriMock.ts`:

- **Layar pilihan awal.** Tampil sebelum login bila `pusat_status.perluPilihan`: belum ada `pusat.json` dan database kosong, atau komputer sudah dipilih sebagai kasir tetapi belum pernah tersambung (supaya pilihannya bisa diubah). Pilihan bawaan "Hanya di komputer ini". "Nama komputer Pusat" terisi dari `kasir_nama_lama`; kode sambung opsional. Perintah baru `awal_pilih(mode, pusat?)` (`lib.rs`) menyimpan pilihan sebelum ada yang masuk, dan menolak bila `perluPilihan` sudah salah. Instalasi yang sudah punya data tidak pernah ditanya (Tunggal).
- **Layar Komputer Pusat** (`KomputerPusat`): dialog dari ikon status, dan tab "Komputer Pusat" di Alat Bantu (tab baru, bukan menu baru, karena menu VB berasal dari `menu.json`). Di Pusat: nama dan alamat IP dengan tombol Salin, kode sambung dengan hitung mundur, daftar komputer kasir dengan Putuskan. Di Kasir: keadaan sambungan, ubah Pusat dan sambungkan ulang, tombol "Perbarui Sekarang" bila Pusat lebih baru. "Ubah cara pakai" (Manager) memakai pilihan yang sama dengan layar awal.
- **Ikon status** di bilah atas (Lucide, titik hijau/kuning/merah dari token tema), ikon jam kuning terpisah, teks lengkap di tooltip dan status bar. `pusat_status` kini memuat `kasirTersambung` (ada pengguna masuk atau terlihat dalam 3 menit; `perangkat::jumlah_tersambung`) dan `perluPilihan`. Status dibaca ulang tiap 5 detik di Pusat, dan lewat event `status-pusat` di Kasir.
- **Coba Lagi.** `invoke` di `panggil.ts` memberi `idPermintaan` pada perintah simpan (daftar yang sama dengan `perintah_simpan` di Rust). Bila Pusat menjawab error `[pusat] ` yang memuat "Coba Lagi", dialog tampil dan layar pemanggil menunggu; Coba Lagi memakai ID yang sama, Tutup (Esc) melempar error ke layar itu. ID simpan yang belum pasti diingat 10 menit, supaya Simpan ditekan lagi nanti tidak menggandakan. `errText` membuang awalan `[pusat] `.
- **Menutup Pusat** saat ada kasir tersambung: konfirmasi di Keluar dan di tombol X jendela (`onCloseRequested`; izin `core:window:allow-destroy` ditambahkan di capabilities).
- **Menu khusus Pusat di Kasir:** tab Backup, Restore, Import, Perbaiki, dan SQL Editor di Alat Bantu, serta dialog Pengaturan Database, diganti pesan "Menu ini hanya bisa dibuka di komputer Pusat (nama)".
- **Peringatan** di atas layar kerja: versi berbeda (pesan dari Rust, plus tombol Perbarui Sekarang bila Pusat lebih baru) dan jam berbeda.
- `tauriMock`: `?simulasiPusat=` pusat, tersambung, menyambung, terputus, versi-beda, perawatan, ditolak, belum-sambung, awal, belum-pasti; `&jamBeda=1`. Pada `terputus`, simpan gagal dua kali lalu berhasil.
- Penyimpangan (diselesaikan di Tahap 9): kalimat "Windows akan meminta izin..." di 7.1, tombol "Beri izin", dan pesan port terpakai khusus (7.3) dikerjakan di Tahap 9; pesan galat server dari Rust ditampilkan apa adanya. Pemberitahuan "komputer tersambung" belum ada. Belum diuji di jendela Tauri asli: penutupan jendela dengan konfirmasi.

**Sudah dikerjakan (Tahap 8, tanpa 8.6 dan 8.6a yang sudah selesai lebih dulu)**, kode di `src-tauri/src/pindah_otomatis.rs` (baru), `pindah_lama.rs` (`Instalasi`, `Temuan.instalasi`), `jaringan/klien.rs` (`tunggu_pusat`), `lib.rs`, `src/pages/PilihanAwal.tsx`, `src/pages/localSettings.ts`, `src/lib/fotoLama.ts`, `src/api/pusat.ts`, `App.tsx`, `tauriMock.ts`; tes di `tests_pindah_otomatis.rs` dan `tools/pengaturan-lama.test.mjs` (`npm run tes:pengaturan`, `node --test` dengan `--experimental-strip-types` bawaan Node 24, tanpa dependensi baru):

- **`cari()`** kini juga mengembalikan `instalasi` (folder dan isi `Settings.ini`): `Settings.ini` paling baru diubah yang punya bagian `[Database]`.
- **Aturan peran** (`tentukan_peran`): `NamaKomputer` dibersihkan (spasi dan port dibuang). Bila kosong, `localhost`, loopback, nama komputer ini, atau salah satu IP komputer ini: **Pusat** bila file data ada (`LokasiData`, lalu `<folder>\_data\DATAPOS.FDB`), selain itu **tidak jelas** (pertanyaan tiga pilihan). Nama atau IP lain: **Kasir**, meski file data ada. Perbandingan tanpa beda huruf besar-kecil.
- **Perintah baru.** Perintah Tauri biasa (tanpa sesi, hanya selama `perluPilihan`): `lama_deteksi`, `lama_terbuka`, `lama_pusat_mulai`, `kasir_tunggu_pusat`. Lewat dispatcher: `lama_pengaturan` dan `lama_foto_daftar` (Lokal), `foto_perlu_kirim` (Data, perlu pengguna masuk).
- **Pusat (8.2).** Tampilan menunggu `lama_terbuka` salah (cek `tasklist` terhadap file `.exe` di folder lama, tiap 2 detik), lalu `lama_pusat_mulai`: `pindahkan` dengan file dari `Settings.ini` (cadangan "sebelum-restore" oleh `pulihkan`), salin foto yang namanya cocok dengan `kodebarang`, jadikan Pusat, buka masa terima otomatis sampai 23.59. Hasilnya ringkasan (jumlah, foto tersalin, tidak cocok, gagal).
- **Foto, logo, latar (8.3).** `salin_foto` (`.jpg/.jpeg/.bmp/.gif`, tanpa beda huruf besar-kecil, file asli tetap). `lama_pengaturan` menyalin logo dan latar ke `gambar/` dan mengganti nilainya dengan alamat baru. Path relatif dihitung dari folder instalasi lama.
- **Pengaturan (8.4).** `lama_pengaturan` mengembalikan peta kunci huruf kecil tanpa nama bagian (`[Application]` didahulukan, kunci database dari `[Database]`). `LokasiBackup` hanya dikembalikan bila alamat lengkap, ada, bisa ditulis, dan di luar folder lama. Pemetaan dan `rapikan()` (beserta daftar pilihannya) ada di `src/pages/localSettings.ts`; `terapkanPengaturanLama` berjalan sekali (`tokopro.dariLama`).
- **Kasir (8.5).** Konfirmasi "Sambungkan" memanggil `awal_pilih`, memetakan pengaturan, lalu menyambung tanpa kode tiap 5 detik (`kasir_tunggu_pusat`). Pusat dalam perawatan menampilkan pesan khusus. Bila Pusat menjawab perlu kode, layar pilihan awal tampil dengan kolom kode. Penanda `tokopro.menungguPusat` membuat layar menunggu muncul lagi setelah aplikasi dibuka ulang. Layar pilihan awal tetap tampil sampai tombol terakhirnya ditekan (`awalBuka` di `App.tsx`).
- **Foto Kasir (8.3).** Setelah ada yang masuk, `kirimFotoLama` memakai `lama_foto_daftar`, `foto_perlu_kirim`, lalu `foto_simpan`, hanya untuk kode yang belum punya foto di Pusat. Bila gagal (mis. akun tanpa hak Data Barang), penanda `tokopro.fotoKirim` dibiarkan dan dicoba lagi saat pengguna lain masuk.
- **Ringkasan dan daftar sisa (8.7)**: dua layar ringkasan (Pusat dan Kasir) berisi butir yang berlaku (foto tidak cocok, printer, laci bila `PakaiDrawer` aktif, laporan buatan sendiri bila `LokasiReport` terisi, Pusat harus menyala).
- Penyimpangan: (1) butir password (password sementara) tidak ditampilkan, sesuai keputusan pemilik. (2) Butir izin Windows tidak ditampilkan karena firewall baru dibuat di Tahap 9, jadi `lama_pusat_mulai` belum membuat aturan firewall. (3) Pembacaan registry (`reg.exe`) untuk kunci yang ternyata tidak ada di `Settings.ini` belum dibuat, menunggu hasil Tahap 0. (4) Pemberitahuan "Komputer KASIR-2 tersambung ke Pusat" belum ada. (5) `rapikan()` dan daftar pilihan dipindah ke `src/pages/localSettings.ts` (file yang sudah ada), bukan `src/lib`. (6) `lama_pindahkan` tetap khusus Manager; alur pertama memakai `lama_pusat_mulai` yang tidak butuh sesi. **Belum diuji** di Windows dengan Toko Pro lama sungguhan: pemeriksaan proses `tasklist`, jalur `\\`/drive, dan dua komputer.

**Sudah dikerjakan (Tahap 9)**, kode di `src-tauri/src/jaringan/firewall.rs` (baru), `jaringan/kendali.rs`, `jaringan/server.rs`, `lib.rs`, `pindah_otomatis.rs`, `src-tauri/windows/hooks.nsh` (baru), `tauri.conf.json`, `src/pages/{KomputerPusat,PilihanAwal,Panduan}.tsx`, `src/components/{PilihanPeran,StatusPusat}.tsx`, `src/api/pusat.ts`, `tauriMock.ts`, README, CLAUDE.md; tes di `tests_firewall.rs`:

- **Aturan firewall (5.3).** Satu aturan bernama `Toko Pro Pusat`, persis perintah di 5.3: masuk, TCP, hanya port Pusat, `profile=private,public,domain`, `remoteip=localsubnet`, `program=<exe>` (`argumen_tambah`). Dibuat lewat `powershell -Command Start-Process powershell -Verb RunAs -Wait -PassThru -EncodedCommand ...` (dialog UAC). Skrip yang naik hak menghapus aturan lama lalu menambah yang baru (`argumen_hapus`, `argumen_tambah`; `netsh --%` supaya tanda kutip dan spasi di alamat program tidak berubah), dan keluar dengan kode `netsh`. Tanpa UAC (ditolak) atau gagal: pesan "Izin dari Windows belum diberikan..." (7.3). Pemeriksaan (`argumen_cek`, `netsh ... show rule ... verbose`) tidak butuh hak administrator; hasilnya dibandingkan hanya nilainya (port dan alamat program), karena label `netsh` mengikuti bahasa Windows. Hasilnya `ada`, `belum`, atau `berbeda` (port atau lokasi program lain), diingat 20 detik. Di macOS/Linux semuanya `tidak-perlu` dan tidak melakukan apa-apa (`#[cfg(windows)]` hanya di modul `sistem`; sisanya dikompilasi di mana saja supaya bisa dites).
- **Kapan dibuat.** Saat komputer dijadikan Pusat: tampilan memanggil perintah baru `pusat_beri_izin` sesudah `awal_pilih` atau `pusat_atur_mode(pusat)` (perintah Tauri sinkron berjalan di thread utama, jadi menunggu UAC tidak dimasukkan ke dalamnya); `lama_pusat_mulai` (Tahap 8) memanggilnya langsung dan melapor di field `izinWindows`. Aplikasi tidak menampilkan UAC sendiri saat dibuka. Bila lokasi program atau port berubah (mis. setelah pembaruan ke folder lain), `pusat_status.izinFirewall` menjadi `berbeda`, ikon status Pusat menjadi kuning, dan layar Komputer Pusat menampilkan pesan dengan tombol **Beri izin** (aturan lama dihapus, yang baru dibuat). Bila UAC ditolak, komputer tetap menjadi Pusat dan status `belum` menampilkan hal yang sama.
- **Port terpakai (5.2, 7.3).** `server::mulai` memberi pesan khusus untuk `AddrInUse`/`PermissionDenied`: "Toko Pro belum bisa menerima komputer kasir karena ada program lain yang memakai jalurnya (port N). Tutup program itu, lalu buka lagi Toko Pro." Rancangan 7.3 menyebut "ubah nomor jalur di Pengaturan lanjutan", tetapi layar itu tidak ada (port hanya lewat `TOKOPRO_PORT`), jadi kalimatnya dibuang.
- **Hook uninstall (5.3).** `bundle.windows.nsis.installerHooks = "./windows/hooks.nsh"` (dicek di dokumentasi Tauri 2 lewat Context7) dengan macro `NSIS_HOOK_POSTUNINSTALL`: bila aturan ada (`netsh ... show rule`), dihapus dengan `ExecShell "runas"` karena installer berjalan tanpa hak administrator (UAC muncul sekali saat uninstall). Dilewati saat `/UPDATE` (`$UpdateMode = 1`, aturan masih dipakai) dan uninstall senyap (`/S`). **Belum diuji**: `makensis` tidak ada di mesin pengembang; hook baru dikompilasi saat build Windows di CI.
- **Tampilan.** Kalimat 7.1 ("Windows akan meminta izin...") di pilihan Pusat, butir izin Windows di 8.7 (peringatan di layar konfirmasi pindah Pusat, dan butir sisa bila UAC ditolak). Alamat IP sudah ada sejak Tahap 7; penjelasan `169.254.x.x` **tetap hanya di panduan**, sesuai 5.1 ("Tidak ada keterangan jenis jaringan di layar"). Bab "Komputer Pusat dan komputer kasir" di Panduan dan bagian di README; CLAUDE.md memuat peta file dan aturan golongan perintah.
- Penyimpangan: tidak ada fungsi "hapus aturan" di aplikasi (hanya di skrip penambahan dan hook NSIS), karena mengganti mode dari Pusat tidak boleh memunculkan UAC; aturan yang tertinggal hanya membuka port yang tidak didengarkan program mana pun. **Belum diuji**: UAC, `netsh`, dan sambungan sungguhan di Windows (dua komputer, kabel langsung profil Public, lalu router), sesuai kolom "Selesai bila" Tahap 9.

**Perbaikan dari tinjauan (sesudah Tahap 9).** Ringkasan per temuan; rinciannya ada di bagian yang disebut.

| Kode | Perbaikan | Bagian |
|---|---|---|
| S1 | Masa terima otomatis: maksimal 10 perangkat, tombol "Selesai menyambungkan", perangkat "Tanpa kode" tampil dengan tombol Putuskan, risiko `login_bawaan` dicatat | 5.4, 8.5, 11 |
| S2 | Batas login per perangkat dan per IP; satu perangkat per IP per masa terima (yang baru menggantikan yang lama) | 5.4 |
| S3 | Reservasi percobaan login (`Pembatas::coba`) | 5.4 |
| S4 | Sesi diam lebih dari 12 jam ditolak di setiap perintah | 5.4 |
| S5 | Token diperiksa sebelum badan dibaca; badan `/sambung` 16 KB, `/jalankan` 20 MB setelah token lolos | 5.4 |
| S6 | `perintah_baca` diturunkan dari `perintah_simpan` | 4.2 |
| D1, D2 | Selisih jam dinding tanpa zona; dibuang saat mode berganti | 4.3 |
| D3 | Tidak ada lagi ingatan ID berdasarkan isi perintah | 4.2 |
| D4 | Pesan "belum pasti" yang jujur; celah commit tetap tahap lanjutan | 4.2, 7.3, 11 |
| D5 | Jawaban bukan JSON untuk simpan = belum pasti | 4.2 |
| D6 | Tombol "Jadikan komputer ini Pusat" di layar menunggu Pusat | 8.1 |
| D7 | `database_berisi` bersama | 7.1 |
| D8 | Ringkasan pindah jujur soal pengaturan lama | 7.1 |
| D9 | `hanyaBaru` untuk foto dari Toko Pro lama, di bawah kunci penulisan | 6.5 |

Celah tes yang ditutup: langkah migrasi 2 sampai 4 diuji sendiri tanpa pelengkap `schema.sql` (`tests_migrasi.rs`), tes jawaban hilang yang pasti (hook `hilangkan_jawaban` di server), tes `MAKS_SALAH_PER_KODE`,
dan `folder_cadangan_dari_kasir_tidak_dipakai_pusat` tidak lagi menelan galat (`.ok()` dihapus, setiap panggilan benar-benar berjalan). Tes baru ada di `tests_jaringan.rs`, `tests_perbaikan.rs`, `tests_data.rs`, dan `tools/{jam-pusat,perintah-simpan}.test.mjs`.

Tahap lanjutan (setelah rilis pertama, sesuai kebutuhan): TLS dengan sertifikat tersemat, koneksi baca kedua, backup harian di Pusat, `GET /foto/{kode}` dengan cache, Pusat tetap berjalan di system tray saat jendela ditutup,
penulisan `permintaan_selesai` di dalam transaksi perintah.

Pustaka baru yang dipakai: `axum` 0.8 dan `tower` (server), `reqwest` sebagai dependensi langsung (sudah ada di `Cargo.lock`),
`uuid` atau `getrandom` untuk token (dicek dulu; `getrandom` sudah ada lewat `argon2`). Proc-macro memakai `syn`/`quote`/`proc-macro2`
yang sudah dibawa Tauri. Setiap pustaka dicek versinya dan dokumentasinya sebelum dipakai.

## 10. Cara mengetes

### 10.1 Tes otomatis (Rust)

- **Tes lama tetap lulus** di setiap tahap. Ini bukti utama bahwa dispatcher tidak mengubah perilaku.
- **Tes jaringan** (`tests_jaringan.rs`): Pusat dijalankan di `127.0.0.1:0` dengan database sementara, klien `reqwest` sungguhan.
  Kasus: sambung dengan kode benar/salah/kedaluwarsa, token dicabut, perintah khusus Pusat, `restore_session` ditolak,
  versi berbeda, mode perawatan.
- **Tes bersamaan**: 4 klien × 50 `save_penjualan` untuk barang yang sama secara serentak (thread terpisah). Periksa:
  50×4 `notrans` unik dan berurutan tanpa lompatan, `stokakhir` = stok awal − total jumlah, saldo kas sesuai, dan
  `IZINSTOKMIN = 0` menolak penjualan yang melebihi stok tepat pada batasnya.
- **Tes idempotensi**: kirim simpan, jawabannya sengaja tidak pernah dikirim (hook `hilangkan_jawaban` di server, hanya build tes), kirim lagi dengan `idPermintaan` sama;
  hanya satu transaksi tercatat dan jawaban kedua berisi `notrans` yang lama.
- **Tes tampilan (Node)**: `npm run tes:pengaturan`, `npm run tes:jam` (jam dinding Pusat di beberapa zona waktu), `npm run tes:simpan` (daftar perintah simpan sama dengan di Rust).
- **Tes E2E siklus toko** (`tests_e2e.rs`) dijalankan dua kali: sekali langsung lewat dispatcher, sekali lewat HTTP, dengan
  hasil yang harus sama.

### 10.2 Dua proses di satu mesin pengembang

Variabel lingkungan (hanya dibaca di build debug, kecuali `TOKOPRO_PORT` yang selalu dibaca):

- `TOKOPRO_DATA_DIR`: folder data aplikasi (`pusat.json`, `foto/`, dan database bila `TOKOPRO_DB` tidak diisi). **Wajib berbeda untuk setiap proses**, kalau tidak keduanya membaca `pusat.json` yang sama.
- `TOKOPRO_DB`: file database. Hanya dipakai Pusat; Kasir tidak membuka database.
- `TOKOPRO_PORT`: port server Pusat (di Pusat) atau port Pusat yang dituju (di Kasir). Pakai nilai yang sama di keduanya bila bukan 47210.

Langkahnya (biner debug memuat tampilan dari server Vite, jadi jalankan `npm run dev` dulu; port bawaan 1420):

```bash
# jendela 1: Pusat
TOKOPRO_DATA_DIR=/tmp/tokopro-pusat TOKOPRO_PORT=47211 npm run tauri dev
```

Masuk sebagai Manager, lalu jadikan komputer ini Pusat (layar Komputer Pusat dikerjakan di Tahap 7; sementara ini lewat `pusat_atur_mode` dari console, atau tulis `{"mode":"pusat"}` ke
`/tmp/tokopro-pusat/pusat.json` sebelum membuka). Buat kode sambung.

```bash
# jendela 2: Kasir (setelah build debug ada di src-tauri/target/debug)
TOKOPRO_DATA_DIR=/tmp/tokopro-kasir1 TOKOPRO_PORT=47211 ./src-tauri/target/debug/tokopro-app
```

Di jendela Kasir, atur Pusat ke `127.0.0.1` lalu sambung dengan kode (Tahap 7; sementara lewat `kasir.atur("127.0.0.1")` dan `kasir.sambung("123456")` dari `src/api/pusat.ts`). Nama
komputer Kasir dan Pusat sama di satu mesin, itu wajar. Bila `pusat.json` Kasir berisi `"mode":"kasir"`, `/tmp/tokopro-kasir1` tidak akan berisi `tokopro.db`.

Catatan: kedua jendela memakai `localStorage` yang sama (identitas aplikasi sama), jadi pengaturan per komputer saling menimpa. Ini hanya terjadi di mesin pengembang.
Tes otomatisnya (`src-tauri/src/tests_klien.rs`) menjalankan Pusat dan Kasir di satu proses tanpa semua ini.

Uji manual yang wajib: dua kasir menekan Bayar hampir bersamaan; matikan Pusat saat kasir di tengah transaksi lalu nyalakan lagi;
restore di Pusat saat kasir masuk; ubah hak menu seorang pengguna di Pusat lalu periksa menunya di Kasir setelah masuk lagi.

### 10.3 Uji di jaringan sungguhan

Mesin pengembang macOS sebagai Pusat dan mesin virtual Windows (mode jaringan *bridged*) sebagai Kasir, lalu sebaliknya. Uji
dialog firewall, nama komputer Windows, jaringan Public, dan pembaruan ke versi Pusat memakai dua draft rilis berurutan.

Matriks jaringan yang wajib diuji (minimal dua laptop Windows sungguhan untuk baris kabel):

| Jaringan | Yang diperiksa |
|---|---|
| Kabel RJ45 langsung, komputer bekas server dan kasir Toko Pro lama (kasus utama) | nama Pusat terisi dari `Settings.ini` lama; tersambung dengan nama itu tanpa mengubah pengaturan jaringan atau firewall secara manual |
| Kabel lewat router (DHCP) | sambung dengan nama komputer; IP berubah setelah router dinyalakan ulang |
| Kasir Wi-Fi, Pusat kabel, router sama | sambung dengan nama dan IP |
| Kabel langsung tanpa router, alamat `169.254.x.x` | profil Public; firewall terbuka; nama ditemukan atau tidak; IP diketik di isian nama; alamat setelah Pusat dinyalakan ulang |
| Kabel langsung dengan IP tetap `192.168.10.x` | sambung dengan IP; tersambung lagi setelah kabel dicabut-colok |
| Pusat punya kabel dan Wi-Fi sekaligus | layar Pusat menampilkan dua alamat; kasir dari kedua jaringan bisa tersambung |
| Wi-Fi tamu atau isolasi klien | pesan "Pusat tidak terjangkau" muncul dengan jelas, aplikasi tidak macet |

## 11. Risiko

| Risiko | Akibat | Penanganan |
|---|---|---|
| Komputer Pusat mati atau Toko Pro di Pusat ditutup | Semua kasir tidak bisa menyimpan | Pesan jelas, keranjang tetap ada, konfirmasi saat menutup Pusat; tahap lanjutan: tetap jalan di system tray. Dicatat di panduan: Pusat harus menyala selama toko buka (sama dengan aplikasi lama). |
| Simpan ganda saat jaringan putus | Stok dan kas salah | `idPermintaan` + `permintaan_selesai` (4.2), satu pengulangan otomatis dengan ID yang sama. **Risiko tersisa:** bila Pusat mati tepat di antara `commit` dan penulisan `permintaan_selesai`, pengulangan dengan ID yang sama tidak dikenali dan data bisa ganda. Pesan ke pengguna tidak berjanji lebih dari "memeriksa dulu"; penutupnya (`Konteks::catat_selesai(&tx)`) tetap tahap lanjutan |
| Laporan berat menahan kasir | Antrean lambat | Ukur di Tahap 10, koneksi baca kedua bila perlu (4.4) |
| Perubahan tanda tangan ±110 perintah | Perintah salah argumen saat dipanggil | Compiler memeriksa tipe; tes nama perintah dari `src/api`; tes lama tetap lulus; macro cadangan berupa tabel manual |
| Lalu lintas tanpa enkripsi | Kata sandi bisa disadap di LAN | Diterima untuk versi pertama (setara aplikasi lama); TLS tersemat di tahap lanjutan |
| Firewall atau jaringan Public di Windows | Kasir tidak bisa tersambung | Aturan `netsh` untuk semua profil, dibatasi `localsubnet` dan program Toko Pro (5.3) |
| Port terbuka di profil Public saat laptop Pusat dibawa ke Wi-Fi umum | Perangkat asing bisa mencoba menyambung | Token perangkat wajib, kode sambung hanya aktif saat ditampilkan, server mati bila Toko Pro ditutup |
| Kabel langsung tanpa router: nama tidak ditemukan, alamat `169.254.x.x` berubah | Kasir gagal tersambung | Nama sama dengan yang sudah jalan di aplikasi lama; IP bisa diketik di isian yang sama; alamat tampil di layar Pusat (5.1) |
| IP Pusat berubah (DHCP) | Kasir gagal tersambung | Nama komputer dulu, lalu IP terakhir; nama di `/halo` dicocokkan |
| Versi Kasir dan Pusat berbeda | Perintah gagal dengan cara yang membingungkan | Kunci versi ketat dan pembaruan ke versi Pusat (6.4) |
| Jam Kasir salah | Tanggal transaksi salah | `today()` memakai jam dinding Pusat, peringatan selisih jam |
| Restore saat kasir bekerja | Kasir memakai sesi dari data lama | Mode perawatan, semua sesi diakhiri (6.1) |
| Password lama tidak terbaca untuk sebagian pengguna (mis. huruf non-ASCII) | Pengguna itu tidak bisa masuk dengan password lamanya | Pemeriksaan enam ulangan menghasilkan `None`, lalu password sementara `admin` (8.6) |
| Nama pengguna hanya beda huruf besar-kecil (`ADMIN`/`Admin`) | Setelah password lama ikut pindah, pengguna ditolak padahal passwordnya benar | Login mencoba semua akun senama dan memilih yang passwordnya cocok (8.6a), dikerjakan sebelum atau bersamaan dengan 8.6 |
| Perangkat asing tersambung selama masa terima otomatis | Perangkat itu bisa mencoba menebak kata sandi | Masa hanya sampai akhir hari pindah dan satu subnet; login tetap wajib, batas percobaan login per perangkat, daftar perangkat dengan tanda "diterima otomatis" (8.5) |
| Peran salah ditebak dari `Settings.ini` (mis. komputer kasir yang `NamaKomputer`-nya `localhost` dan kebetulan punya `DATAPOS.FDB` lama) | Dua Pusat di satu toko | Layar konfirmasi menyebut perannya dan menyediakan "Atur sendiri"; Kasir yang menemukan Pusat lain di `/halo` dengan nama toko sama memberi peringatan |
| Data berubah di Toko Pro lama setelah diambil | Transaksi hilang | Layar konfirmasi meminta semua Toko Pro lama ditutup; pindah dilakukan serentak dalam satu hari (12) |
| Kode sambung ditebak | Perangkat asing masuk | 6 angka, 10 menit, sekali pakai, kunci setelah 5 salah per alamat dan 20 salah dari alamat mana pun (kode dibatalkan), daftar perangkat bisa diputus |
| Login pengguna dimatikan (`aktiflogin = 0`) di toko yang memakai Komputer Pusat | Setiap perangkat yang tersambung masuk sebagai Manager "Administrator" tanpa kata sandi (perilaku aplikasi lama, `login_bawaan`) | **Diterima oleh toko yang mematikan login:** setiap komputer yang tersambung ke Pusat masuk sebagai Administrator. Dikurangi dengan masa terima otomatis yang dibatasi 10 perangkat, satu per alamat, bisa ditutup dengan "Selesai menyambungkan", daftar perangkat bertanda "Tanpa kode" dengan tombol Putuskan, dan catatan di panduan (S1) |
| Zona waktu Windows di komputer kasir salah | Tanggal transaksi mundur sehari sekitar 15 jam per hari | Selisih jam dihitung sebagai jam dinding tanpa zona (4.3, D1) |
| Foto dari Toko Pro lama menimpa foto yang sudah ada di Pusat | Foto yang diganti pengguna hilang | `hanyaBaru` diperiksa di Pusat dalam kunci yang sama dengan penulisan (6.5, D9) |
| Database yang hanya berisi pelanggan, supplier, kas, dan sejenisnya dianggap kosong | Layar pilihan awal muncul, atau tidak ada cadangan sebelum jadi Kasir | `database_berisi` menghitung semua tabel isian pengguna, selain data bawaan (7.1, D7) |

## 12. Pilihan yang ditolak sejak awal

Diputuskan bersama pemilik toko sebelum rancangan ini, dicatat supaya tidak dibahas ulang:

- **Sinkronisasi antar-database lokal** (setiap komputer punya database sendiri). Stok bisa bentrok dan nomor transaksi
  bisa ganda bila dua komputer menjual barang yang sama sebelum sinkron.
- **PostgreSQL atau Firebird yang dipasang pengguna.** Terlalu teknis untuk pemilik toko, dan installer tidak bisa lagi sama untuk semua komputer.
- **Server cloud.** Toko berhenti saat internet putus.
- **Menaruh `tokopro.db` di folder jaringan bersama.** SQLite dengan WAL tidak aman lewat SMB: kunci file tidak bisa diandalkan dan database bisa rusak.
- **Aplikasi lama dan baru dipakai bersamaan.** Tidak perlu: toko pindah serentak dalam satu hari (6.3).
