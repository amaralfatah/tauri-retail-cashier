// Alat pengembang: hitung kode reset untuk "Lupa password" Manager di KasirJet.
//
//   node tools/kode_reset.mjs 7KQ2-M9XA     cetak kode reset untuk kode permintaan itu
//   node tools/kode_reset.mjs --buat-kunci  buat kunci rahasia baru di ~/.kasirjet/kunci-reset
//   node tools/kode_reset.mjs --uji 7KQ2-M9XA   pakai kunci uji (sama dengan build debug aplikasi)
//
// Kunci dibaca dari env KASIRJET_KUNCI_RESET (64 karakter heksa), atau dari ~/.kasirjet/kunci-reset.
// Rumusnya harus sama dengan src-tauri/src/reset_manager.rs.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ALFABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Kunci uji build debug: 32 byte 0x00..0x1f. */
export const KUNCI_UJI = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
export const FILE_KUNCI = join(homedir(), ".kasirjet", "kunci-reset");

/** Huruf besar, buang spasi dan "-", lalu aturan Crockford: O jadi 0, I dan L jadi 1. */
export function normalisasi(teks) {
  return String(teks).toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Kode permintaan yang sah: 8 karakter dari alfabet Crockford. Mengembalikan bentuk baku atau null. */
export function normalisasiPermintaan(teks) {
  const n = normalisasi(teks);
  return n.length === 8 && [...n].every((c) => ALFABET.includes(c)) ? n : null;
}

/** Kode reset 12 karakter (tanpa tanda "-") dari kunci dan kode permintaan yang sudah dinormalisasi. */
export function hitungKodeReset(kunci, permintaanNorm) {
  const mac = createHmac("sha256", kunci).update(permintaanNorm, "utf8").digest();
  // 60 bit pertama = 12 karakter x 5 bit, dari byte awal.
  let bit = 0n;
  for (let i = 0; i < 8; i++) bit = (bit << 8n) | BigInt(mac[i]);
  bit >>= 4n;
  let hasil = "";
  for (let i = 11; i >= 0; i--) hasil += ALFABET[Number((bit >> BigInt(i * 5)) & 31n)];
  return hasil;
}

export const tampilkanKodeReset = (k) => `${k.slice(0, 4)}-${k.slice(4, 8)}-${k.slice(8, 12)}`;

export function bacaKunci(heks) {
  const h = String(heks).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("Kunci harus 64 karakter heksa (0-9 dan a-f).");
  return Buffer.from(h, "hex");
}

function kunciDariLingkungan() {
  if (process.env.KASIRJET_KUNCI_RESET) return bacaKunci(process.env.KASIRJET_KUNCI_RESET);
  if (existsSync(FILE_KUNCI)) return bacaKunci(readFileSync(FILE_KUNCI, "utf8"));
  throw new Error(
    `Kunci belum ada. Buat dulu dengan: node tools/kode_reset.mjs --buat-kunci\n(atau isi env KASIRJET_KUNCI_RESET). File kunci: ${FILE_KUNCI}`,
  );
}

function buatKunci() {
  if (existsSync(FILE_KUNCI)) throw new Error(`Kunci sudah ada di ${FILE_KUNCI}. Tidak ditimpa. Hapus file itu sendiri kalau memang ingin kunci baru.`);
  mkdirSync(join(homedir(), ".kasirjet"), { recursive: true, mode: 0o700 });
  const heks = randomBytes(32).toString("hex");
  writeFileSync(FILE_KUNCI, heks + "\n", { mode: 0o600, flag: "wx" });
  console.log(`Kunci dibuat di ${FILE_KUNCI}.`);
  console.log("Salin isinya ke secret GitHub KASIRJET_KUNCI_RESET, dan simpan cadangannya di tempat aman.");
  console.log("Mengganti kunci membuat versi lama hanya menerima kode dari kunci lama.");
}

function utama(argv) {
  const uji = argv.includes("--uji");
  const sisa = argv.filter((a) => a !== "--uji");
  if (sisa.includes("--buat-kunci")) return buatKunci();
  const masukan = sisa[0];
  if (!masukan) throw new Error("Pemakaian: node tools/kode_reset.mjs [--uji] XXXX-XXXX\n         node tools/kode_reset.mjs --buat-kunci");
  const permintaan = normalisasiPermintaan(masukan);
  if (!permintaan) throw new Error("Kode permintaan tidak valid. Harus 8 huruf atau angka (tanpa U), mis. 7KQ2-M9XA.");
  const kunci = uji ? KUNCI_UJI : kunciDariLingkungan();
  console.log(tampilkanKodeReset(hitungKodeReset(kunci, permintaan)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    utama(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
