# Panduan Rilis & Build Installer Toko Pro

Dokumen ini berisi langkah-langkah membuat rilis baru dan membangun installer Windows (64-bit & 32-bit) serta macOS (Apple Silicon & Intel) secara otomatis melalui GitHub Actions.

Workflow yang digunakan: `.github/workflows/release.yml`  
Repo GitHub: `https://github.com/amaralfatah/tauri-retail-cashier`

---

## 1. Persiapan sekali saja (sebelum rilis pertama)

Langkah ini cukup dilakukan satu kali saja:

1. **Siapkan kunci penanda tangan pembaruan otomatis**
   - Kunci privat berada di `~/.tauri/tokopro-updater.key` (jangan pernah dimasukkan ke git).
   - Kunci publik sudah terpasang di `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
   - **Penting:** simpan cadangan file `~/.tauri/tokopro-updater.key` di tempat aman. Jika kunci hilang atau diganti, aplikasi yang sudah terpasang di toko tidak bisa menerima pembaruan otomatis lagi.

2. **Pasang GitHub Secret**
   - Buka: `https://github.com/amaralfatah/tauri-retail-cashier/settings/secrets/actions`
   - Salin isi kunci privat ke clipboard (di macOS):
     ```bash
     pbcopy < ~/.tauri/tokopro-updater.key
     ```
   - Klik **New repository secret**:
     - **Name:** `TAURI_SIGNING_PRIVATE_KEY`
     - **Secret:** tempel isi kunci privat
     - Klik **Add secret**
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` **tidak perlu dibuat** selama kunci dibuat tanpa kata sandi.

3. **Pastikan repo berstatus Public**
   - Fitur pembaruan otomatis mengunduh `latest.json` dari GitHub Releases tanpa login, sehingga repo harus berstatus **Public**.

4. **Siapkan kunci reset password Manager**
   - Buat kunci dengan `node tools/kode_reset.mjs --buat-kunci`, lalu pasang isi `~/.kasirjet/kunci-reset` sebagai secret `KASIRJET_KUNCI_RESET`.
   - Build release gagal kalau secret ini belum ada. Langkah lengkapnya ada di [Panduan Reset Password Manager](panduan-reset-password-manager.md#5-menyiapkan-kunci-sekali-saja).

---

## 2. Daftar cek sebelum membuat rilis

Jalankan pemeriksaan berikut dari folder `tokopro-app` untuk memastikan tidak ada error sebelum mendorong tag ke GitHub:

```bash
cd tokopro-app
npx tsc --noEmit -p .
npm run tes:pengaturan
npm run tes:jam
npm run tes:simpan
npm run build
cd src-tauri && cargo test
```

*(Opsional)* Jika ingin mengubah catatan perubahan yang tampil di dialog pembaruan pengguna, sunting bagian `### Yang baru` pada `releaseBody` di `.github/workflows/release.yml` lalu commit sebelum membuat tag.

---

## 3. Langkah rilis otomatis (lewat tag `v*`)

Ganti `0.2.0` dengan nomor versi baru (format `MAJOR.MINOR.PATCH`, misalnya `0.2.1` atau `1.0.0`):

```bash
cd tokopro-app
npm run versi 0.2.0
git commit -am "Rilis v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Apa yang dilakukan skrip `npm run versi`:
- Menyamakan nomor versi di 5 berkas: `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, dan `src-tauri/Cargo.lock`.
- Saat tag `v*` masuk ke GitHub, workflow **Build & Release Desktop Installers** otomatis berjalan dengan 3 tahap:
  1. **Cek versi & tes** di Windows (`windows-latest`): memverifikasi tag cocok dengan versi aplikasi, lalu menjalankan `npm run build` dan `cargo test`.
  2. **Build 4 platform secara paralel**:
     - Windows 64-bit (`..._x64-setup.exe`)
     - Windows 32-bit (`..._x86-setup.exe`)
     - macOS Apple Silicon (`..._aarch64.dmg`)
     - macOS Intel (`..._x64.dmg`)
  3. **Cek `latest.json`**: memastikan keempat platform tercatat lengkap di `latest.json` untuk pembaruan otomatis.

---

## 4. Pantau build, uji coba, lalu terbitkan

1. **Pantau proses build (±10–15 menit):**  
   Buka `https://github.com/amaralfatah/tauri-retail-cashier/actions` dan tunggu semua job bercentang hijau.

2. **Unduh installer dari Draft Release:**  
   Buka `https://github.com/amaralfatah/tauri-retail-cashier/releases`.  
   Workflow selalu membuat rilis sebagai **Draft** (belum tampil ke pengguna dan belum terdeteksi auto-updater).
   - Untuk **Windows 64-bit** (mayoritas komputer): unduh `Toko.Pro_<versi>_x64-setup.exe`
   - Untuk **Windows 32-bit**: unduh `Toko.Pro_<versi>_x86-setup.exe`

3. **Uji dulu di komputer Windows** (migrasi/data, cetak struk langsung, buka laci kasir, sambungan Komputer Pusat jika dipakai).  
   > Saat pertama kali menjalankan installer di Windows, SmartScreen bisa menampilkan *"Windows protected your PC"* karena installer belum memakai sertifikat code-signing berbayar. Klik **More info → Run anyway**.

4. **Terbitkan rilis (jika sudah siap dipakai di toko):**  
   Di halaman Releases, buka Draft versi tersebut → klik **Edit** → periksa isi catatan rilis → klik **Publish release**.  
   Setelah diterbitkan, aplikasi yang sudah terpasang akan otomatis mendeteksi versi baru saat dibuka.

---

## 5. Build manual tanpa membuat tag (uji coba cepat)

Jika hanya ingin membangun installer sementara dari branch `main` tanpa menaikkan versi atau membuat tag:

1. Push perubahan terbaru:
   ```bash
   git push origin main
   ```
2. Buka `https://github.com/amaralfatah/tauri-retail-cashier/actions/workflows/release.yml`.
3. Klik tombol **Run workflow** (kanan atas) → pilih branch `main` → klik **Run workflow**.
4. Setelah selesai, unduh installer dari Draft Release di halaman **Releases**.  
   *(Catatan: job `Cek latest.json` tidak dijalankan pada mode ini karena hanya aktif untuk tag `v*`.)*

---

## 6. Penanganan masalah umum

- **Job `Cek latest.json` gagal karena salah satu platform belum tercatat:**  
  Ini kadang terjadi saat 4 build selesai hampir bersamaan dan menulis `latest.json` berbarengan. Buka halaman run yang gagal di GitHub Actions, lalu klik **Re-run failed jobs** (atau jalankan ulang platform yang hilang).
- **Build gagal dan perlu memperbaiki kode untuk nomor versi yang sama (selama rilis masih Draft):**
  1. Hapus Draft Release di halaman GitHub Releases.
  2. Perbaiki kode dan commit di `main`.
  3. Pindahkan tag dan push ulang:
     ```bash
     git tag -f v0.2.0
     git push origin main
     git push origin :refs/tags/v0.2.0
     git push origin v0.2.0
     ```
- **Rilis sudah terlanjur dipublikasikan (`Published`) lalu ditemukan bug:**  
  Jangan ubah tag lama — langsung buat versi patch berikutnya (misalnya `0.2.1`) mengikuti Langkah 3 agar auto-updater otomatis menawarkan perbaikan ke semua komputer toko.
