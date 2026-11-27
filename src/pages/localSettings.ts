/**
 * Pengaturan per komputer. Aslinya disimpan di registry Windows; di sini di localStorage.
 * Nilai disimpan sebagai teks ("1"/"0" untuk kotak centang) di bawah kunci `tokopro.<nama>`.
 */
const PREFIX = "tokopro.";

/** Kode ESC/POS bawaan Toko Pro lama untuk membuka laci kasir (ESC p 0 64 240). */
export const KODE_DRAWER_BAWAAN = "27,112,0,64,240";

export const LOCAL_DEFAULTS = {
  modeScan: "0",
  /** Ukuran tampilan seluruh jendela dalam persen: "100", "115", atau "125". */
  ukuranTampilan: "100",
  konfirmasiCetak: "0",
  formatQty: "###,##0.00",
  formatHrg: "###,##0",
  ukuranKertas: "Mini Printer 75mm-80mm",
  jnsPrinter: "Direct",
  jnsPort: "USB",
  portPrinter: "",
  drawer: "0",
  portDrawer: "",
  kodeDrawer: KODE_DRAWER_BAWAAN,
  defaultJmlByr: "0",
  updateHargaJual: "0",
  autoLoad: "0",
  kursor: "0",
  aktifFoto: "0",
  lokasiFoto: "",
  home: "Home",
  aktifSkin: "0",
  logo: "",
  background: "",
};
export type LocalSettings = typeof LOCAL_DEFAULTS;
export type LocalKey = keyof LocalSettings;

export function getLocal<K extends LocalKey>(key: K): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? LOCAL_DEFAULTS[key];
  } catch {
    return LOCAL_DEFAULTS[key];
  }
}

export function setLocal(key: LocalKey, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch { /* penyimpanan tidak tersedia */ }
}

export const loadLocal = (): LocalSettings =>
  Object.fromEntries((Object.keys(LOCAL_DEFAULTS) as LocalKey[]).map((k) => [k, getLocal(k)])) as LocalSettings;

export function saveLocal(v: LocalSettings) {
  (Object.keys(v) as LocalKey[]).forEach((k) => setLocal(k, v[k]));
}

/* ---- Pilihan yang tersedia di layar Pengaturan ---- */

export const UKURAN_KERTAS = ["Mini Printer 56mm-58mm", "Mini Printer 75mm-80mm", "Kertas A4", "Kertas A5"];
export const JENIS_PRINTER = ["Direct", "Custom", "Direct-Custom"];
export const JENIS_PORT = ["USB", "LPT"];
export const FORMAT_QTY = ["###,##0", "###,##0.0", "###,##0.00"];
export const FORMAT_HRG = ["###,##0", "###,##0.00"];
/** Urutan sama dengan nilai tersimpan: 0 = Grid, 1 = TextBox (kotak scan di atas tabel). */
export const MODE_SCAN = ["Grid", "TextBox"];
/** Nilai tersimpan "Home" atau "Dashboard"; tulisan di combo mengikuti aslinya. */
export const HOME: [string, string][] = [["Home", "Home Background"], ["Dashboard", "Dashboard Transaksi"]];

/** Pengaturan lama bisa berisi pilihan yang tidak ada lagi di combo (mis. Mini Printer atau COM); pakai pilihan pertama. */
export function rapikan(l: LocalSettings): LocalSettings {
  const pilih = (v: string, daftar: string[]) => (daftar.includes(v) ? v : daftar[0]);
  return {
    ...l,
    jnsPrinter: pilih(l.jnsPrinter, JENIS_PRINTER),
    jnsPort: pilih(l.jnsPort, JENIS_PORT),
    formatQty: pilih(l.formatQty, FORMAT_QTY),
    formatHrg: pilih(l.formatHrg, FORMAT_HRG),
    ukuranKertas: pilih(l.ukuranKertas, UKURAN_KERTAS),
    home: pilih(l.home, HOME.map((h) => h[0])),
  };
}

/* ---- Pindah dari Settings.ini Toko Pro lama (rancangan 8.4) ---- */

/** Penanda bahwa pengaturan lama sudah dipindahkan ke komputer ini. */
export const KUNCI_DARI_LAMA = "tokopro.dariLama";

export type PeranLama = "pusat" | "kasir";
/** Hasil pemetaan: kunci `LocalSettings`, ditambah dua setelan per komputer di luar `LocalSettings`. */
export type HasilPeta = Partial<LocalSettings> & { autoBackup?: "1" | "0"; folderBackup?: string };

/** Kotak centang VB6: `1`, `-1`, `True`, `Yes` berarti aktif. Selain itu mati. */
export const centangLama = (v: string): "1" | "0" => (["1", "-1", "true", "yes"].includes(v.trim().toLowerCase()) ? "1" : "0");

/**
 * Petakan isi `Settings.ini` lama (kunci huruf kecil, tanpa nama bagian; dari perintah `lama_pengaturan`) ke pengaturan
 * per komputer. Kunci yang tidak ada di `kv` tidak ikut di hasil. `AktifBackup` dan `LokasiBackup` hanya untuk Pusat.
 */
export function petakanPengaturanLama(kv: Record<string, string>, peran: PeranLama): HasilPeta {
  const ada = (k: string) => Object.prototype.hasOwnProperty.call(kv, k);
  const teks = (k: string) => (kv[k] ?? "").trim();
  const h: HasilPeta = {};
  const langsung = (kunci: string, ke: LocalKey) => { if (ada(kunci)) h[ke] = teks(kunci); };
  const centang = (kunci: string, ke: LocalKey) => { if (ada(kunci)) h[ke] = centangLama(kv[kunci]); };

  if (peran === "pusat") {
    if (ada("aktifbackup")) h.autoBackup = centangLama(kv.aktifbackup);
    if (teks("lokasibackup")) h.folderBackup = teks("lokasibackup");
  }
  langsung("ukurankertas", "ukuranKertas");
  langsung("jnsprinter", "jnsPrinter");
  langsung("jnsportprinter", "jnsPort");
  langsung("portprinter", "portPrinter");
  centang("pakaidrawer", "drawer");
  langsung("kodedrawer", "kodeDrawer");
  langsung("portdrawer", "portDrawer");
  // Settings.ini lama menyimpan teks pilihan cmbModeScan ("Grid"/"TextBox"); indeks "1" juga diterima.
  if (ada("modescan")) h.modeScan = ["1", "textbox"].includes(teks("modescan").toLowerCase()) ? "1" : "0";
  centang("konfirmasicetakstrukjual", "konfirmasiCetak");
  langsung("formatqtystruk", "formatQty");
  langsung("formathrgstruk", "formatHrg");
  centang("aktiffoto", "aktifFoto");
  if (ada("lokasifoto")) h.lokasiFoto = ""; // isi foldernya disalin; aplikasi baru memakai folder fotonya sendiri
  centang("autoloaddata", "autoLoad");
  centang("kursorkolomjml", "kursor");
  if (ada("pilihanhome")) {
    const t = teks("pilihanhome");
    // Indeks `cmbHome.ListIndex`: 0 = Home, 1 = Dashboard. Teks dicocokkan dengan nama pilihan.
    h.home = /^\d+$/.test(t) ? (HOME[Number(t)]?.[0] ?? HOME[0][0]) : (HOME.find(([v, ket]) => [v, ket].some((x) => x.toLowerCase() === t.toLowerCase()))?.[0] ?? HOME[0][0]);
  }
  centang("defaultjmlbyr", "defaultJmlByr");
  centang("aktifskin", "aktifSkin");
  langsung("lokasilogo", "logo");
  langsung("lokasibcgrnd", "background");
  return h;
}

const NAMA_PILIHAN: Partial<Record<LocalKey, string>> = {
  jnsPrinter: "Jenis printer", jnsPort: "Port printer", formatQty: "Format jumlah di struk", formatHrg: "Format harga di struk",
  ukuranKertas: "Ukuran kertas", home: "Layar awal",
};

/**
 * Pilihan dari Toko Pro lama yang tidak ada lagi di Kasir Jet, sehingga `rapikan` menggantinya (mis. port COM menjadi USB).
 * Dihitung sebelum `terapkanPengaturanLama`, karena sesudahnya pilihan yang diganti sudah tersimpan.
 */
export function pilihanDiganti(kv: Record<string, string>, peran: PeranLama): { nama: string; dulu: string; jadi: string }[] {
  const { autoBackup: _a, folderBackup: _f, ...lokal } = petakanPengaturanLama(kv, peran);
  const gabung = { ...loadLocal(), ...lokal } as LocalSettings;
  const rapi = rapikan(gabung);
  return (Object.keys(NAMA_PILIHAN) as LocalKey[]).filter((k) => gabung[k] !== rapi[k]).map((k) => ({ nama: NAMA_PILIHAN[k] ?? k, dulu: gabung[k], jadi: rapi[k] }));
}

/**
 * Lupakan bahwa pengaturan lama sudah dipakai, supaya `terapkanPengaturanLama` berjalan lagi. Dipakai saat komputer yang tadi
 * dipasang sebagai kasir dijadikan Pusat: pengaturan cadangan (khusus Pusat) belum ikut terbawa.
 */
export function lupakanPengaturanLama() {
  try { localStorage.removeItem(KUNCI_DARI_LAMA); } catch { /* penyimpanan tidak tersedia */ }
}

/** Petakan lalu simpan di komputer ini. Hanya sekali: penanda `tokopro.dariLama`. Mengembalikan `false` bila sudah pernah. */
export function terapkanPengaturanLama(kv: Record<string, string>, peran: PeranLama): boolean {
  try {
    if (localStorage.getItem(KUNCI_DARI_LAMA) === "1") return false;
  } catch { return false; }
  const { autoBackup, folderBackup, ...lokal } = petakanPengaturanLama(kv, peran);
  saveLocal(rapikan({ ...loadLocal(), ...lokal }));
  try {
    if (autoBackup === "1") localStorage.setItem("tokopro.autoBackup", "1");
    if (folderBackup) localStorage.setItem("tokopro.folderBackup", folderBackup);
    localStorage.setItem(KUNCI_DARI_LAMA, "1");
  } catch { /* penyimpanan tidak tersedia */ }
  return true;
}
