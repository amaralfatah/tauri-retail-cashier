// Daftar perintah simpan di tampilan harus sama dengan di Rust (jaringan/golongan.rs). Jalankan: npm run tes:simpan
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const m = await import("../src/lib/perintahSimpan.ts");
const rust = readFileSync(new URL("../src-tauri/src/jaringan/golongan.rs", import.meta.url), "utf8");
const larik = (nama) => {
  const hasil = new RegExp(`const ${nama}: &\\[&str\\] = &\\[([^\\]]*)\\]`).exec(rust);
  assert.ok(hasil, `${nama} tidak ditemukan di golongan.rs`);
  return [...hasil[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};

test("daftar perintah simpan sama dengan di Rust", () => {
  assert.deepEqual(m.SIMPAN_SAMA, larik("SAMA"));
  assert.deepEqual(m.SIMPAN_AWALAN, larik("AWALAN"));
});

test("perintah simpan dan baca dikenali", () => {
  for (const n of ["save_penjualan", "kas_save", "foto_simpan_data", "alat_hapus_data", "master_delete"]) assert.equal(m.perintahSimpan(n), true, n);
  for (const n of ["login", "master_list", "kas_list", "list_transaksi", "db_info"]) assert.equal(m.perintahSimpan(n), false, n);
});

test("ID baru: 32 karakter heksa, berbeda setiap kali", () => {
  const a = m.idBaru(), b = m.idBaru();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});
