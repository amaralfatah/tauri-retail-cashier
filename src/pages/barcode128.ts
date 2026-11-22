/**
 * Code 128 untuk label barcode. Ditulis sendiri supaya tidak perlu paket tambahan.
 * Angka genap panjang dipadatkan dengan set C; selebihnya memakai set B (ASCII 32-126).
 */

/** Lebar bar dan spasi bergantian (mulai dari bar) untuk nilai 0..106. Nilai 106 adalah stop. */
export const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Nilai simbol Code 128 untuk teks, termasuk awal, sandi periksa, dan stop. */
export function code128Values(text: string): number[] {
  const t = text.replace(/[^\x20-\x7e]/g, "?");
  const values: number[] = [];
  if (t.length >= 4 && t.length % 2 === 0 && /^\d+$/.test(t)) {
    values.push(START_C);
    for (let i = 0; i < t.length; i += 2) values.push(Number(t.slice(i, i + 2)));
  } else {
    values.push(START_B);
    for (const ch of t) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  return values;
}

/** Bar hitam sebagai pasangan [mulai, lebar] dalam satuan modul, dan lebar total. */
export function code128Bars(text: string): { bars: [number, number][]; width: number } {
  const bars: [number, number][] = [];
  let x = 0;
  for (const v of code128Values(text)) {
    const p = PATTERNS[v];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) bars.push([x, w]);
      x += w;
    }
  }
  return { bars, width: x };
}
