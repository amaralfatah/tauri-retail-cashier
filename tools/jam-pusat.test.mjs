// Tes jam Pusat di komputer kasir (rancangan 4.3). Jalankan: npm run tes:jam
// Zona waktu diganti di dalam tes (process.env.TZ), jadi hasilnya tidak bergantung pada zona komputer pengembang.
import test from "node:test";
import assert from "node:assert/strict";

const f = await import("../src/format.ts");

const dua = (n) => String(n).padStart(2, "0");
const lokal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`; };

test.afterEach(() => f.terapkanJamPusat(null));

/** Pusat WIB menunjukkan 01:30 tanggal 23 (di UTC masih tanggal 22). Windows di komputer kasir memakai zona Pacific (bawaan),
 *  tetapi jamnya sudah diatur manual supaya terbaca 01:29:30 tanggal 23, sama dengan jam dinding Pusat. */
function skenarioPacific() {
  process.env.TZ = "America/Los_Angeles";
  const jamKasirMs = new Date(2026, 10, 23, 1, 29, 30).getTime(); // 01:29:30 PST = 09:29:30Z, 15 jam lebih maju dari waktu yang sebenarnya
  const pusatEpoch = Date.UTC(2026, 10, 22, 18, 30, 0); // 01:30 WIB
  return { jamKasirMs, pusatEpoch };
}

test("zona Pacific yang salah: tanggal mengikuti jam dinding Pusat, bukan zona komputer", () => {
  const { jamKasirMs, pusatEpoch } = skenarioPacific();
  // Cara lama (selisih epoch) memberi tanggal mundur sehari. Ini bukti skenarionya nyata.
  assert.equal(lokal(jamKasirMs + (pusatEpoch - jamKasirMs)), "2026-11-22");
  // Cara baru: selisih jam dinding.
  f.terapkanJamPusat({ dariPusat: true, dinding: "2026-11-23 01:30:00" }, jamKasirMs);
  assert.equal(f.today(jamKasirMs), "2026-11-23");
  const s = f.sekarang(jamKasirMs);
  assert.deepEqual([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds()], [2026, 10, 23, 1, 30, 0]);
  // Beberapa jam kemudian tanggalnya tetap mengikuti Pusat, juga saat melewati tengah malam Pusat.
  assert.equal(f.today(jamKasirMs + 22 * 3600 * 1000 + 31 * 60 * 1000), "2026-11-24");
});

test("hasilnya sama di zona mana pun", () => {
  for (const tz of ["America/Los_Angeles", "Asia/Jakarta", "UTC", "Pacific/Auckland", "Asia/Kolkata"]) {
    process.env.TZ = tz;
    const jamKasirMs = new Date(2026, 10, 23, 0, 0, 20).getTime();
    f.terapkanJamPusat({ dariPusat: true, dinding: "2026-11-23 00:00:50" }, jamKasirMs);
    assert.equal(f.today(jamKasirMs), "2026-11-23", tz);
    // Jam Pusat 00:00:50, jam kasir 00:00:20: 40 detik kemudian jam Pusat 00:01:30, kasir 00:01:00.
    const s = f.sekarang(jamKasirMs + 40_000);
    assert.deepEqual([s.getHours(), s.getMinutes(), s.getSeconds()], [0, 1, 30], tz);
    f.terapkanJamPusat(null);
  }
});

test("tanggal Pusat berbeda dari tanggal komputer kasir yang terlambat lewat tengah malam", () => {
  process.env.TZ = "Asia/Jakarta";
  const jamKasirMs = new Date(2026, 10, 22, 23, 58, 0).getTime();
  f.terapkanJamPusat({ dariPusat: true, dinding: "2026-11-23 00:03:00" }, jamKasirMs);
  assert.equal(f.today(jamKasirMs), "2026-11-23");
  assert.equal(f.localDate(new Date(jamKasirMs)), "2026-11-22");
});

test("D2: bukan dari Pusat atau tanpa jam, selisihnya kembali ke nol", () => {
  process.env.TZ = "America/Los_Angeles";
  const jamKasirMs = new Date(2026, 10, 23, 1, 0, 0).getTime();
  f.terapkanJamPusat({ dariPusat: true, dinding: "2026-11-23 05:00:00" }, jamKasirMs);
  assert.equal(f.sekarang(jamKasirMs).getHours(), 5);
  f.terapkanJamPusat({ dariPusat: false, dinding: "2026-11-23 05:00:00" }, jamKasirMs);
  assert.equal(f.sekarang(jamKasirMs).getHours(), 1, "mode Tunggal atau Pusat memakai jam komputer ini");
  f.terapkanJamPusat({ dariPusat: true, dinding: "2026-11-23 05:00:00" }, jamKasirMs);
  f.terapkanJamPusat(null, jamKasirMs);
  assert.equal(f.sekarang(jamKasirMs).getHours(), 1, "tanpa jam Pusat selisih kembali ke nol");
  f.terapkanJamPusat({ dariPusat: true, dinding: "rusak" }, jamKasirMs);
  assert.equal(f.sekarang(jamKasirMs).getHours(), 1, "jam yang tidak terbaca tidak dipakai");
});

test("parseSebagaiLokalNaif membaca jam dinding tanpa menggeser zona", () => {
  process.env.TZ = "America/Los_Angeles";
  const d = new Date(f.parseSebagaiLokalNaif("2026-11-23 01:30:00"));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 23, 1, 30]);
  assert.equal(f.parseSebagaiLokalNaif("bukan tanggal"), null);
});
