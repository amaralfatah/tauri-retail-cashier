// Pastikan seluruh menu aktif terpetakan ke layar/laporan dan sambungan dialog backup serta Dashboard -> Pelunasan terjaga.
// Jalankan: npm run tes:menu
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baca = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const menuData = JSON.parse(baca("../src/vb/menu.json"));
const shellSrc = baca("../src/vb/shell.ts");
const defs = await import("../src/pages/laporan/defs.ts");

const ambilSet = (nama) => {
  const m = new RegExp(`${nama}[^=]*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(shellSrc);
  assert.ok(m, `${nama} tidak ditemukan di shell.ts`);
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
};

const ambilTargets = () => {
  const m = /export const TARGETS:\s*Record<string,\s*Target>\s*=\s*\{([\s\S]*?)\n\};/.exec(shellSrc);
  assert.ok(m, "TARGETS tidak ditemukan di shell.ts");
  const out = new Map();
  for (const x of m[1].matchAll(/^\s*(\w+):\s*\{\s*page:\s*"([^"]+)"(?:,\s*tab:\s*"([^"]+)")?\s*\}/gm)) {
    out.set(x[1], { page: x[2], tab: x[3] });
  }
  return out;
};

test("semua menu daun yang tampil punya halaman tujuan dan semua laporan terdaftar", () => {
  const sembunyi = ambilSet("MENU_SEMBUNYI");
  const targets = ambilTargets();
  assert.ok(sembunyi.has("mnBantuanRegistrasi"), "mnBantuanRegistrasi harus disembunyikan");

  const saring = (nodes) =>
    nodes.flatMap((n) => {
      if (sembunyi.has(n.nama)) return [];
      if (!n.children?.length) return [n];
      const children = saring(n.children);
      return children.length ? [{ ...n, children }] : [];
    });

  const aktif = saring(menuData);
  const daun = (n) => (n.children?.length ? n.children.flatMap(daun) : [n]);
  const semuaDaun = aktif.flatMap(daun);
  assert.ok(semuaDaun.length >= 50, "jumlah menu daun aktif tidak wajar");

  for (const m of semuaDaun) {
    assert.ok(!sembunyi.has(m.nama), `${m.nama} seharusnya tersembunyi`);
    const t = targets.get(m.nama);
    assert.ok(t, `Menu "${m.nama}" (${m.caption}) belum dipetakan di TARGETS`);
    if (m.nama.startsWith("mnLap")) {
      assert.ok(defs.LAPORAN[m.nama], `Menu laporan "${m.nama}" belum punya definisi di LAPORAN`);
    }
  }
});

test("dialog folder backup dan klik ganda piutang Dashboard tersambung", () => {
  const dbSrc = baca("../src/pages/Database.tsx");
  const alatSrc = baca("../src/pages/Alat.tsx");
  const dashSrc = baca("../src/pages/Dashboard.tsx");
  const lunasSrc = baca("../src/pages/Pelunasan.tsx");

  assert.match(dbSrc, /pilihFolder\(/, "Database.tsx harus memakai dialog pilihFolder");
  assert.match(alatSrc, /pilihFolder\(/, "Alat.tsx harus memakai dialog pilihFolder");
  assert.match(alatSrc, /pilihBackup\(/, "Alat.tsx harus memakai dialog pilihBackup");
  assert.match(dashSrc, /go\("piutang",\s*p\.kode/, "Dashboard.tsx harus meneruskan kode pelanggan ke Pelunasan");
  assert.match(lunasSrc, /awalKontak\?\.kode/, "Pelunasan.tsx harus memuat piutang dari awalKontak");
});
