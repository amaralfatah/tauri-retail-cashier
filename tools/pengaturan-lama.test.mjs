// Tes pemetaan Settings.ini lama (rancangan 8.4). Jalankan: npm run tes:pengaturan
import test from "node:test";
import assert from "node:assert/strict";

const simpan = new Map();
globalThis.localStorage = {
  getItem: (k) => (simpan.has(k) ? simpan.get(k) : null),
  setItem: (k, v) => void simpan.set(k, String(v)),
  removeItem: (k) => void simpan.delete(k),
};
const m = await import("../src/pages/localSettings.ts");
const peta = (kv, peran = "pusat") => m.petakanPengaturanLama(kv, peran);

test("kotak centang: 1, -1, True, Yes aktif; selain itu mati", () => {
  for (const v of ["1", "-1", "True", "true", "YES", " -1 "]) assert.equal(peta({ aktiffoto: v }).aktifFoto, "1", v);
  for (const v of ["0", "False", "", "2", "tidak"]) assert.equal(peta({ aktiffoto: v }).aktifFoto, "0", v);
});

test("setiap kunci di tabel 8.4 terpetakan", () => {
  const h = peta({
    aktifbackup: "-1", lokasibackup: "D:\\Backup",
    ukurankertas: "Kertas A4", jnsprinter: "Custom", jnsportprinter: "LPT", portprinter: "LPT1",
    pakaidrawer: "True", kodedrawer: "27,112,0,64,240", portdrawer: "COM1",
    modescan: "1", konfirmasicetakstrukjual: "-1", formatqtystruk: "###,##0.0", formathrgstruk: "###,##0.00",
    aktiffoto: "-1", lokasifoto: "\\_foto\\", autoloaddata: "True", kursorkolomjml: "1",
    pilihanhome: "1", defaultjmlbyr: "-1", aktifskin: "1",
    lokasilogo: "C:\\data\\gambar\\logo.gif", lokasibcgrnd: "C:\\data\\gambar\\background.jpg",
  });
  assert.deepEqual(h, {
    autoBackup: "1", folderBackup: "D:\\Backup",
    ukuranKertas: "Kertas A4", jnsPrinter: "Custom", jnsPort: "LPT", portPrinter: "LPT1",
    drawer: "1", kodeDrawer: "27,112,0,64,240", portDrawer: "COM1",
    modeScan: "1", konfirmasiCetak: "1", formatQty: "###,##0.0", formatHrg: "###,##0.00",
    aktifFoto: "1", lokasiFoto: "", autoLoad: "1", kursor: "1",
    home: "Dashboard", defaultJmlByr: "1", aktifSkin: "1",
    logo: "C:\\data\\gambar\\logo.gif", background: "C:\\data\\gambar\\background.jpg",
  });
});

test("kunci yang tidak ada tidak ikut; kunci tanpa tabel (NamaKomputer, LokasiReport, dst.) diabaikan", () => {
  assert.deepEqual(peta({}), {});
  assert.deepEqual(peta({ namakomputer: "SERVER", lokasidata: "x", firebirdlocation: "y", lokasireport: "r", lokasiupload: "u", lokasigambar: "g", firstinstall: "1" }), {});
});

test("AktifBackup dan LokasiBackup tidak berlaku di Kasir", () => {
  const h = peta({ aktifbackup: "1", lokasibackup: "D:\\Backup", ukurankertas: "Kertas A5" }, "kasir");
  assert.deepEqual(h, { ukuranKertas: "Kertas A5" });
});

test("PilihanHome: indeks atau teks", () => {
  assert.equal(peta({ pilihanhome: "0" }).home, "Home");
  assert.equal(peta({ pilihanhome: "1" }).home, "Dashboard");
  assert.equal(peta({ pilihanhome: "7" }).home, "Home");
  assert.equal(peta({ pilihanhome: "dashboard" }).home, "Dashboard");
  assert.equal(peta({ pilihanhome: "Dashboard Transaksi" }).home, "Dashboard");
  assert.equal(peta({ pilihanhome: "entah" }).home, "Home");
});

test("modeScan hanya 0 atau 1", () => {
  assert.equal(peta({ modescan: "0" }).modeScan, "0");
  assert.equal(peta({ modescan: "1" }).modeScan, "1");
  assert.equal(peta({ modescan: "5" }).modeScan, "0");
});

test("terapkan: rapikan pilihan yang tidak ada, simpan, dan hanya sekali", () => {
  simpan.clear();
  const kv = { jnsprinter: "Mini Printer", jnsportprinter: "COM", formatqtystruk: "aneh", aktifbackup: "-1", lokasibackup: "D:\\Backup", pilihanhome: "1", lokasifoto: "\\_foto\\" };
  assert.equal(m.terapkanPengaturanLama(kv, "pusat"), true);
  assert.equal(simpan.get("tokopro.jnsPrinter"), "Direct");
  assert.equal(simpan.get("tokopro.jnsPort"), "USB");
  assert.equal(simpan.get("tokopro.formatQty"), "###,##0");
  assert.equal(simpan.get("tokopro.home"), "Dashboard");
  assert.equal(simpan.get("tokopro.lokasiFoto"), "");
  assert.equal(simpan.get("tokopro.autoBackup"), "1");
  assert.equal(simpan.get("tokopro.folderBackup"), "D:\\Backup");
  assert.equal(simpan.get("tokopro.dariLama"), "1");
  simpan.set("tokopro.home", "Home");
  assert.equal(m.terapkanPengaturanLama(kv, "pusat"), false, "kedua kali tidak berjalan");
  assert.equal(simpan.get("tokopro.home"), "Home");
});

test("pilihanDiganti: menyebut pilihan lama yang tidak ada lagi dan diganti rapikan", () => {
  simpan.clear();
  const d = m.pilihanDiganti({ jnsportprinter: "COM", ukurankertas: "Kertas A4", jnsprinter: "Mini Printer" }, "kasir");
  assert.deepEqual(d.map((x) => [x.nama, x.dulu, x.jadi]), [["Jenis printer", "Mini Printer", "Direct"], ["Port printer", "COM", "USB"]]);
  assert.deepEqual(m.pilihanDiganti({ jnsportprinter: "LPT", ukurankertas: "Kertas A4" }, "kasir"), [], "pilihan yang masih ada tidak dilaporkan");
  assert.deepEqual(m.pilihanDiganti({}, "kasir"), []);
});

test("kasir yang dijadikan Pusat: pengaturan dipakai lagi, cadangan ikut", () => {
  simpan.clear();
  const kv = { aktifbackup: "-1", lokasibackup: "D:\\Backup", ukurankertas: "Kertas A4" };
  assert.equal(m.terapkanPengaturanLama(kv, "kasir"), true);
  assert.equal(simpan.get("tokopro.autoBackup"), undefined);
  assert.equal(m.terapkanPengaturanLama(kv, "pusat"), false);
  m.lupakanPengaturanLama();
  assert.equal(m.terapkanPengaturanLama(kv, "pusat"), true);
  assert.equal(simpan.get("tokopro.autoBackup"), "1");
  assert.equal(simpan.get("tokopro.folderBackup"), "D:\\Backup");
});
