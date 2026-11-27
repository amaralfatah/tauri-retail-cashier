// Ikon Kasir Jet: barcode Code 128 yang miring ke depan dan terbaca sebagai "kasirjet".
// Rancangan dan alasannya ada di docs/rancangan-branding.md, bagian 6.
//
// Pakai: node branding/kasir-jet/generate.mjs   (menulis SVG ke folder ini)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEXT = "kasirjet";
const BLUE = "#0071e3", INK = "#1d1d1f", WHITE = "#ffffff";
const SKEW = 12; // derajat; miring tidak mengubah lebar batang kalau diukur mendatar, jadi tetap terbaca
const f = (n) => +n.toFixed(2);

// Pola Code 128 nilai 0-105 (lebar batang dan celah bergantian, dalam modul). Stop terpisah.
const PATTERN = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 " +
  "122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 " +
  "322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 " +
  "112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 " +
  "331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
  "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
  "124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 " +
  "411311 113141 114131 311141 411131 211412 211214 211232"
).split(" ");
const STOP = "2331112", START_B = 104;

// Code 128 set B: start, data, checksum, stop. Hasilnya daftar [posisi, lebar] batang dalam modul.
function code128(text) {
  const values = [START_B, ...[...text].map((c) => c.charCodeAt(0) - 32)];
  const sum = values.reduce((s, v, i) => s + v * Math.max(i, 1), 0);
  const modules = values.map((v) => PATTERN[v]).join("") + PATTERN[sum % 103] + STOP;
  const bars = [];
  let x = 0;
  for (let i = 0; i < modules.length; i++) {
    const w = +modules[i];
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  }
  return { bars, total: x };
}

// Squircle ala Apple (superellipse n = 5) di kanvas 100 x 100.
function squircle(n = 5, steps = 120) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${f(50 + 50 * Math.sign(c) * Math.abs(c) ** (2 / n))} ${f(50 + 50 * Math.sign(s) * Math.abs(s) ** (2 / n))}`);
  }
  return `M${pts.join("L")}Z`;
}

// Batang miring dari y 25 sampai 75, lebar total 80 unit (x 10-90) termasuk kemiringan.
// Garis sinar scan memotong di tengah; scanner tetap membaca di atas atau di bawahnya.
function barcodeGlyph(fg, bg) {
  const { bars, total } = code128(TEXT);
  const H = 50, y0 = 25, t = Math.tan((SKEW * Math.PI) / 180) * H;
  const m = (80 - t) / total, x0 = (100 - (total * m + t)) / 2;
  const d = bars.map(([bx, w]) => {
    const a = x0 + bx * m, b = a + w * m;
    return `M${f(a)} ${y0 + H}H${f(b)}L${f(b + t)} ${y0}H${f(a + t)}Z`;
  }).join("");
  return `<path d="${d}" fill="${fg}"/><rect x="0" y="48.8" width="100" height="2.4" fill="${bg}"/>`;
}

// Versi kecil (48 px ke bawah): lima batang tebal dengan kemiringan yang sama. Tidak bisa di-scan,
// karena di ukuran itu barcode asli menyatu jadi satu bidang.
function smallGlyph(fg) {
  const H = 56, y0 = 22, t = Math.tan((SKEW * Math.PI) / 180) * H;
  const bars = [[14, 10], [28, 5], [37, 11], [52, 5], [61, 11]];
  const shift = (100 - (bars.at(-1)[0] + bars.at(-1)[1] + t - bars[0][0])) / 2 - bars[0][0];
  const d = bars.map(([x, w]) => {
    const a = x + shift, b = a + w;
    return `M${f(a)} ${y0 + H}H${f(b)}L${f(b + t)} ${y0}H${f(a + t)}Z`;
  }).join("");
  return `<path d="${d}" fill="${fg}" stroke="${fg}" stroke-width="1.2" stroke-linejoin="round"/>`;
}

const svg = (label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${label}">${body}</svg>\n`;
const SQ = squircle();

const files = {
  // Ikon utama untuk layar: batang putih di biru. Bentuk squircle untuk web, promosi, dan macOS.
  "icon.svg": svg("Kasir Jet", `<path d="${SQ}" fill="${BLUE}"/>${barcodeGlyph(WHITE, BLUE)}`),
  // Sama, tapi persegi penuh: sumber untuk `npx tauri icon` dan ikon Android (launcher yang memotong).
  "icon-square.svg": svg("Kasir Jet", `<rect width="100" height="100" fill="${BLUE}"/>${barcodeGlyph(WHITE, BLUE)}`),
  // macOS: badan ikon hanya 824 dari 1024 px (grid ikon Apple), sisanya ruang kosong di tepi.
  // Tanpa ini ikon tampil lebih besar daripada ikon lain di Dock. Sumber `icon.icns`.
  "icon-mac.svg": svg("Kasir Jet", `<g transform="translate(50 50) scale(${f(824 / 1024)}) translate(-50 -50)"><path d="${SQ}" fill="${BLUE}"/>${barcodeGlyph(WHITE, BLUE)}</g>`),
  "icon-dark.svg": svg("Kasir Jet", `<path d="${SQ}" fill="${INK}"/>${barcodeGlyph(WHITE, INK)}`),
  "icon-small.svg": svg("Kasir Jet", `<path d="${SQ}" fill="${BLUE}"/>${smallGlyph(WHITE)}`),
  // Untuk cetak yang ingin bisa di-scan (stiker, spanduk): batang gelap di latar putih,
  // karena banyak scanner kasir tidak membaca barcode terbalik (putih di gelap).
  "cetak.svg": svg("Kasir Jet", `<rect width="100" height="100" fill="${WHITE}"/>${barcodeGlyph(INK, WHITE)}`),
};
for (const [name, content] of Object.entries(files)) writeFileSync(join(here, name), content);
console.log(`${Object.keys(files).length} file ditulis ke ${here}`);
