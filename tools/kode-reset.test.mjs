// Vektor uji yang sama dengan tes Rust di src-tauri/src/reset_manager.rs. Jalankan: npm run tes:reset
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { KUNCI_UJI, hitungKodeReset, normalisasi, normalisasiPermintaan, tampilkanKodeReset } from "./kode_reset.mjs";

const VEKTOR = [
  ["7KQ2M9XA", "31RV9R1HEZQY"],
  ["01234567", "2J84SSFYP5RE"],
  ["ZZZZZZZZ", "KXGV1V5H8YSK"],
];

test("vektor uji kunci 0x00..0x1f", () => {
  for (const [permintaan, kode] of VEKTOR) assert.equal(hitungKodeReset(KUNCI_UJI, permintaan), kode, permintaan);
});

test("normalisasi mengikuti aturan Crockford", () => {
  assert.equal(normalisasi(" 7kq2-m9xa "), "7KQ2M9XA");
  assert.equal(normalisasi("OIL0-1111"), "01101111");
  assert.equal(hitungKodeReset(KUNCI_UJI, normalisasi("OI23-4567")), hitungKodeReset(KUNCI_UJI, "01234567"));
  assert.equal(normalisasiPermintaan("7kq2 m9xa"), "7KQ2M9XA");
  assert.equal(normalisasiPermintaan("7KQ2-M9X"), null);
  assert.equal(normalisasiPermintaan("7KQU-M9XA"), null);
});

test("tampilan kode reset berkelompok empat", () => {
  assert.equal(tampilkanKodeReset("31RV9R1HEZQY"), "31RV-9R1H-EZQY");
});

test("alat baris perintah memakai --uji dan menolak kode salah", () => {
  const url = new URL("./kode_reset.mjs", import.meta.url).pathname;
  assert.equal(execFileSync("node", [url, "--uji", "7KQ2-M9XA"], { encoding: "utf8" }).trim(), "31RV-9R1H-EZQY");
  const r = spawnSync("node", [url, "--uji", "7KQ2"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tidak valid/);
});
