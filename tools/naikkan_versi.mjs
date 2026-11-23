#!/usr/bin/env node
// Samakan versi aplikasi di semua file sebelum membuat tag rilis.
// Pemakaian: npm run versi 1.2.3
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const versi = process.argv[2]?.replace(/^v/, "");
if (!versi || !/^\d+\.\d+\.\d+$/.test(versi)) {
  console.error("Tulis versi barunya, misalnya: npm run versi 1.2.3");
  process.exit(1);
}

const akar = join(dirname(fileURLToPath(import.meta.url)), "..");
const ubah = (file, fn) => {
  const p = join(akar, file);
  const lama = readFileSync(p, "utf8");
  const baru = fn(lama);
  if (baru === lama) {
    console.error(`Versi di ${file} tidak ditemukan atau sudah ${versi}.`);
  }
  writeFileSync(p, baru);
  console.log(`${file} → ${versi}`);
};

const json = (file, fn) =>
  ubah(file, (teks) => {
    const data = JSON.parse(teks);
    fn(data);
    return JSON.stringify(data, null, 2) + "\n";
  });

json("package.json", (d) => { d.version = versi; });
json("package-lock.json", (d) => {
  d.version = versi;
  if (d.packages?.[""]) d.packages[""].version = versi;
});
json("src-tauri/tauri.conf.json", (d) => { d.version = versi; });
// Hanya baris version pertama di [package], bukan versi dependensi.
ubah("src-tauri/Cargo.toml", (t) => t.replace(/^(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/m, `$1${versi}$2`));
ubah("src-tauri/Cargo.lock", (t) => t.replace(/(name = "tokopro-app"\nversion = ")[^"]*(")/, `$1${versi}$2`));

console.log(`\nSelesai. Lanjutkan dengan:\n  git commit -am "Rilis v${versi}"\n  git tag v${versi}\n  git push origin main v${versi}`);
