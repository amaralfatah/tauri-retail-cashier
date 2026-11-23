/**
 * Peniru backend Tauri untuk melihat dan menguji tampilan di browser biasa (http://localhost:1420) tanpa `tauri dev`.
 * Hanya dimuat oleh src/main.tsx saat mode pengembangan DAN aplikasi tidak berjalan di jendela Tauri.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

type Row = Record<string, any>;

const user = { iduser: "admin", kodekaryawan: "K001", namakaryawan: "Administrator", level: "Manager", must_change: false };
const users: Row[] = [
  { iduser: "admin", kodekaryawan: "K001", namakaryawan: "Administrator", level: "Manager", aktif: 1, belum_ada_password: 0 },
  { iduser: "rina", kodekaryawan: "K002", namakaryawan: "Rina Kasir", level: "Kasir", aktif: 1, belum_ada_password: 0 },
];
const userMenus = new Map<string, string[]>();

const settings: Row = {
  namausaha: "Toko Contoh", bidangusaha: "Minimarket & Sembako", pemilik: "Budi Santoso",
  alamat: "Jl. Contoh No. 1", kota: "Bandung", provinsi: "Jawa Barat", kodepos: "40111",
  tlp: "022-4201234", email: "info@tokocontoh.id", website: "www.tokocontoh.id",
  header1: "Belanja Hemat Setiap Hari", header2: "Harga Jujur, Kualitas Terjamin",
  footer1: "Terima kasih atas kunjungan Anda", footer2: "Barang yang sudah dibeli tidak dapat ditukar",
  aktiflogin: 0, aktifpromo: 1, aktiflevel: 1, aktifsatuan: 1, aktifpoin: 1, aktiftranspoin: 1,
  mintranspoin: 50000, jmlpointrans: 1, berlakukelipatanpoin: 1,
  izinharga: 1, izinstokmin: 1, izindiskon: 1, aktiftranskas: 1, updateharga: 3, konfirmasikredit: 1, tempopiutang: 30,
};

const satuan: Row[] = [
  { kodesatuan: "PCS", namasatuan: "Pieces" },
  { kodesatuan: "BTL", namasatuan: "Botol" },
  { kodesatuan: "PAK", namasatuan: "Pak" },
  { kodesatuan: "SAK", namasatuan: "Sak / Karung" },
  { kodesatuan: "DUS", namasatuan: "Dus / Karton" },
  { kodesatuan: "LSN", namasatuan: "Lusin" },
];

const kelompok: Row[] = [
  { kodekelompok: "01", namakelompok: "Sembako" },
  { kodekelompok: "02", namakelompok: "Minuman" },
  { kodekelompok: "03", namakelompok: "Kebutuhan Rumah" },
];

const kategori: Row[] = [
  { kodekategori: "001", kodekelompok: "01", namakategori: "Beras & Gula" },
  { kodekategori: "002", kodekelompok: "01", namakategori: "Minyak & Bumbu" },
  { kodekategori: "003", kodekelompok: "02", namakategori: "Teh & Kopi" },
  { kodekategori: "004", kodekelompok: "03", namakategori: "Sabun & Deterjen" },
];

const barang: Row[] = [
  { bid: 1, kodebarang: "B001", barcode: "8991001", namabarang: "Beras Pandan Wangi 5 kg", kodekelompok: "01", namakelompok: "Sembako", kodekategori: "001", namakategori: "Beras & Gula", kodepemasok: "S001", namapemasok: "CV Sumber Rejeki", kodesatuan: "SAK", hrgjual: 78000, hrgbeli: 70000, marginpersen: 11.43, marginnilai: 8000, stokawal: 30, stokmasuk: 15, stokkeluar: 5, stokopname: 0, stokakhir: 40, stokmin: 5, stokmax: 100, rak: "A-1", jenis: "Barang", aktif: 1 },
  { bid: 2, kodebarang: "B002", barcode: "8991002", namabarang: "Minyak Goreng Sawit 2 L", kodekelompok: "01", namakelompok: "Sembako", kodekategori: "002", namakategori: "Minyak & Bumbu", kodepemasok: "S001", namapemasok: "CV Sumber Rejeki", kodesatuan: "BTL", hrgjual: 36500, hrgbeli: 33000, marginpersen: 10.61, marginnilai: 3500, stokawal: 20, stokmasuk: 10, stokkeluar: 6, stokopname: 0, stokakhir: 24, stokmin: 6, stokmax: 60, rak: "A-2", jenis: "Barang", aktif: 1, satuan1: "DUS", konversi1: 6, hrgsatuan1: 35000, hrgmultisatuan1: 210000 },
  { bid: 3, kodebarang: "B003", barcode: "8991003", namabarang: "Gula Pasir Putih 1 kg", kodekelompok: "01", namakelompok: "Sembako", kodekategori: "001", namakategori: "Beras & Gula", kodepemasok: "S001", namapemasok: "CV Sumber Rejeki", kodesatuan: "PCS", hrgjual: 17500, hrgbeli: 15500, marginpersen: 12.9, marginnilai: 2000, stokawal: 10, stokmasuk: 0, stokkeluar: 7, stokopname: 0, stokakhir: 3, stokmin: 10, stokmax: 50, rak: "A-1", jenis: "Barang", aktif: 1 },
  { bid: 4, kodebarang: "B004", barcode: "8991004", namabarang: "Teh Celup Melati isi 25", kodekelompok: "02", namakelompok: "Minuman", kodekategori: "003", namakategori: "Teh & Kopi", kodepemasok: "S002", namapemasok: "PT Nusantara Niaga", kodesatuan: "PAK", hrgjual: 8200, hrgbeli: 7000, marginpersen: 17.14, marginnilai: 1200, stokawal: 50, stokmasuk: 20, stokkeluar: 10, stokopname: 0, stokakhir: 60, stokmin: 10, stokmax: 120, rak: "B-1", jenis: "Barang", aktif: 1 },
  { bid: 5, kodebarang: "B005", barcode: "8991005", namabarang: "Kopi Bubuk Arabika 200 g", kodekelompok: "02", namakelompok: "Minuman", kodekategori: "003", namakategori: "Teh & Kopi", kodepemasok: "S002", namapemasok: "PT Nusantara Niaga", kodesatuan: "PCS", hrgjual: 21000, hrgbeli: 18500, marginpersen: 13.51, marginnilai: 2500, stokawal: 18, stokmasuk: 5, stokkeluar: 5, stokopname: 0, stokakhir: 18, stokmin: 5, stokmax: 40, rak: "B-2", jenis: "Barang", aktif: 1 },
  { bid: 6, kodebarang: "B006", barcode: "8991006", namabarang: "Sabun Mandi Batang 90 g", kodekelompok: "03", namakelompok: "Kebutuhan Rumah", kodekategori: "004", namakategori: "Sabun & Deterjen", kodepemasok: "S002", namapemasok: "PT Nusantara Niaga", kodesatuan: "PCS", hrgjual: 4500, hrgbeli: 3600, marginpersen: 25, marginnilai: 900, stokawal: 100, stokmasuk: 40, stokkeluar: 20, stokopname: 0, stokakhir: 120, stokmin: 20, stokmax: 200, rak: "C-1", jenis: "Barang", aktif: 1, satuan1: "LSN", konversi1: 12, hrgsatuan1: 4250, hrgmultisatuan1: 51000 },
];

const pelanggan: Row[] = [
  { kodepelanggan: "P001", namapelanggan: "Bu Siti", alamat: "Jl. Merdeka No. 12", kota: "Bandung", provinsi: "Jawa Barat", tlp1: "081234567890", level: "Level 1", limitkredit: 2000000, poin: 45, masaaktif: "2027-12-31", aktif: 1 },
  { kodepelanggan: "P002", namapelanggan: "Warung Pak Budi", alamat: "Jl. Ahmad Yani No. 88", kota: "Bandung", provinsi: "Jawa Barat", tlp1: "081298765432", level: "Level 2", limitkredit: 5000000, poin: 120, masaaktif: "2027-12-31", aktif: 1 },
];

const pemasok: Row[] = [
  { kodepemasok: "S001", namapemasok: "CV Sumber Rejeki", namakontak: "Hendra", alamat: "Jl. Soekarno Hatta No. 45", kota: "Bandung", provinsi: "Jawa Barat", tlp1: "022-7501122", aktif: 1 },
  { kodepemasok: "S002", namapemasok: "PT Nusantara Niaga", namakontak: "Dewi", alamat: "Jl. Industri Raya No. 9", kota: "Cimahi", provinsi: "Jawa Barat", tlp1: "022-6654321", aktif: 1 },
];

const karyawan: Row[] = [
  { kodekaryawan: "K001", namakaryawan: "Administrator", alamat: "Bandung", kota: "Bandung", provinsi: "Jawa Barat", tlp1: "0811111111", jabatan: "Manager", aktif: 1 },
  { kodekaryawan: "K002", namakaryawan: "Rina Kasir", alamat: "Bandung", kota: "Bandung", provinsi: "Jawa Barat", tlp1: "0822222222", jabatan: "Kasir", aktif: 1 },
];

const tables: Record<string, Row[]> = {
  mdbarang: barang,
  mdsatuan: satuan,
  mdkelompok: kelompok,
  mdkategori: kategori,
  mdpelanggan: pelanggan,
  mdpemasok: pemasok,
  mdkaryawan: karyawan,
};

const keyField: Record<string, string> = {
  mdbarang: "kodebarang", mdsatuan: "kodesatuan", mdkelompok: "kodekelompok",
  mdkategori: "kodekategori", mdpelanggan: "kodepelanggan", mdpemasok: "kodepemasok", mdkaryawan: "kodekaryawan",
};

const ntJenis: Row[] = [
  { kode: "01", namajenis: "Kartu Debit" },
  { kode: "02", namajenis: "QRIS" },
  { kode: "03", namajenis: "Transfer Bank" },
];
const ntItem: Row[] = [
  { kode: "01", namajenis: "Kartu Debit", namaitem: "BCA" },
  { kode: "01", namajenis: "Kartu Debit", namaitem: "Mandiri" },
  { kode: "02", namajenis: "QRIS", namaitem: "QRIS Toko" },
  { kode: "03", namajenis: "Transfer Bank", namaitem: "BRI" },
];

const kasRows: Row[] = [
  { idkas: 1, nokas: "KS2611-00001", tglkas: "2026-11-23", noreftrans: "-", jenis: "Saldo Awal", kategori: "Modal Awal", namakaryawan: "Administrator", namakontak: "-", keterangan: "Saldo awal kas", masuk: 2500000, keluar: 0, saldo: 2500000 },
  { idkas: 2, nokas: "KS2611-00002", tglkas: "2026-11-23", noreftrans: "TJ2611-00000", jenis: "Masuk", kategori: "Penjualan Barang Dagang", namakaryawan: "Administrator", namakontak: "Bu Siti", keterangan: "Penjualan tunai", masuk: 450000, keluar: 0, saldo: 2950000 },
  { idkas: 3, nokas: "KS2611-00003", tglkas: "2026-11-23", noreftrans: "-", jenis: "Keluar", kategori: "Biaya Operasional", namakaryawan: "Administrator", namakontak: "-", keterangan: "Listrik & Plastik", masuk: 0, keluar: 75000, saldo: 2875000 },
];

/** Tanggal lokal YYYY-MM-DD, digeser `hari` dari hari ini. */
const tglGeser = (hari: number) => { const d = new Date(); d.setDate(d.getDate() + hari); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Satu piutang sudah lewat jatuh tempo (memicu pemberitahuan) dan satu belum, supaya alur pemberitahuan bisa dicoba.
const piutangKartu: Row[] = [
  { nopiutang: "PS2611-00002", noreftrans: "TJ2611-00095", kodepelanggan: "P001", nama: "Bu Siti", namapelanggan: "Bu Siti", jthtempo: tglGeser(-3), jmlpiutang: 180000, jmlterbayar: 0, kekurangan: 180000 },
  { nopiutang: "PS2611-00001", noreftrans: "TJ2611-00099", kodepelanggan: "P002", nama: "Warung Pak Budi", namapelanggan: "Warung Pak Budi", jthtempo: "2026-11-30", jmlpiutang: 350000, jmlterbayar: 100000, kekurangan: 250000 },
];
const hutangKartu: Row[] = [
  { nopiutang: "HP2611-00001", noreftrans: "TB2611-00088", kodepemasok: "S001", nama: "CV Sumber Rejeki", namapemasok: "CV Sumber Rejeki", jthtempo: "2026-12-05", jmlpiutang: 1200000, jmlterbayar: 500000, kekurangan: 700000 },
];

const promoStore: Record<string, Row[]> = {
  diskon: [
    { bid: 1, kodebarang: "B004", namabarang: "Teh Celup Melati isi 25", hrgnormal: 8200, diskon: 10, hrgdiskon: 7380, tglawal: "2026-01-01", tglakhir: "2026-12-31" },
  ],
  bonus: [],
  pdp: [],
};

const poinHistori: Row[] = [
  { notukar: "TP2611-00001", tgltukar: "2026-11-20", namakaryawan: "Administrator", poinawal: 50, poinmasuk: 0, poinkeluar: 5, sisapoin: 45, ket1: "Tukar hadiah minyak 1L" },
];

let nomor = 1;
const transaksi = new Map<string, { header: Row; detail: Row[] }>();
const orders = new Map<string, { header: Row; detail: Row[]; jual: boolean }>();
const pendings = new Map<string, { header: Row; detail: Row[] }>();

const cocok = (b: Row, code: string) =>
  String(b.kodebarang).toUpperCase() === code.toUpperCase() || String(b.barcode).toUpperCase() === code.toUpperCase();
const cari = (q: string, stokMin = false) =>
  barang.filter((b) =>
    `${b.kodebarang} ${b.barcode} ${b.namabarang}`.toLowerCase().includes(q.toLowerCase()) &&
    (!stokMin || (Number(b.stokmin) > 0 && Number(b.stokakhir) <= Number(b.stokmin))),
  );

mockWindows("main");
mockIPC((cmd, args) => {
  const a = (args ?? {}) as Record<string, any>;
  switch (cmd) {
    /* ---- Jendela ---- */
    // Pratinjau browser: tiru zoom webview Tauri dengan CSS zoom supaya Ukuran tampilan bisa dicek.
    // Seperti zoom webview asli, area tampil ikut mengecil (lebar dan tinggi dibagi faktor zoom).
    case "plugin:webview|set_webview_zoom": {
      const st = document.documentElement.style, z = Number(a.value) || 1;
      st.zoom = z === 1 ? "" : String(z);
      st.width = z === 1 ? "" : `${100 / z}vw`;
      st.height = z === 1 ? "" : `${100 / z}vh`;
      return null;
    }
    /* ---- Sesi & Pengguna ---- */
    case "current_user": case "login_bawaan": case "restore_session": case "login": return user;
    case "logout": case "change_password": case "cetak": return null;
    case "verifikasi_admin": return "MOCK-TOKEN-ADMIN";
    case "get_settings": return settings;
    case "save_settings": Object.assign(settings, a.data ?? {}); return null;
    case "my_menus": return userMenus.get(user.iduser) ?? [];
    case "list_users": return users;
    case "save_user": {
      const d = a.data ?? {};
      const kar = karyawan.find((k) => k.kodekaryawan === d.kodekaryawan);
      const idx = users.findIndex((u) => u.iduser === d.iduser);
      const entry = { iduser: d.iduser, level: d.level, kodekaryawan: d.kodekaryawan, namakaryawan: kar?.namakaryawan ?? "", aktif: 1, belum_ada_password: d.password ? 0 : 1 };
      if (idx >= 0) users[idx] = { ...users[idx], ...entry };
      else users.push(entry);
      return null;
    }
    case "delete_user": {
      const idx = users.findIndex((u) => u.iduser === a.iduser);
      if (idx >= 0) users.splice(idx, 1);
      return null;
    }
    case "user_akses": return [];
    case "save_user_akses": return null;
    case "db_path": return "/Users/tokopro/Data/tokopro.db";

    /* ---- Master Data ---- */
    case "master_list": {
      const tbl = String(a.tableName ?? a.table_name ?? "mdbarang");
      let rows = [...(tables[tbl] ?? [])];
      if (a.kelompok) rows = rows.filter((r) => r.kodekelompok === a.kelompok);
      if (a.kategori) rows = rows.filter((r) => r.kodekategori === a.kategori);
      if (a.onlyActive) rows = rows.filter((r) => Number(r.aktif ?? 1) !== 0);
      if (a.search) {
        const q = String(a.search).toLowerCase();
        rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
      }
      return { rows, total: rows.length };
    }
    case "master_save": {
      const tbl = String(a.tableName ?? a.table_name ?? "mdbarang");
      const k = keyField[tbl] ?? "kodebarang";
      const list = tables[tbl] ?? (tables[tbl] = []);
      const orig = a.originalKey ?? a.data?.[k];
      const idx = list.findIndex((r) => String(r[k]).toUpperCase() === String(orig ?? "").toUpperCase());
      if (idx >= 0) list[idx] = { ...list[idx], ...a.data };
      else list.push({ bid: list.length + 1, aktif: 1, ...a.data });
      return null;
    }
    case "master_delete": {
      const tbl = String(a.tableName ?? a.table_name ?? "mdbarang");
      const k = keyField[tbl] ?? "kodebarang";
      const list = tables[tbl] ?? [];
      const idx = list.findIndex((r) => String(r[k]).toUpperCase() === String(a.key ?? "").toUpperCase());
      if (idx >= 0) list.splice(idx, 1);
      return null;
    }
    case "pelanggan_jatuh_tempo": return pelanggan.filter((p) => piutangKartu.some((k) => k.kodepelanggan === p.kodepelanggan && k.kekurangan > 0 && String(k.jthtempo) <= tglGeser(0)));
    case "barang_find": case "barang_find_kasir": case "label_barang_find":
      return barang.find((b) => cocok(b, String(a.code ?? ""))) ?? null;
    case "barang_cari_kasir": case "barang_search":
      return cari(String(a.search ?? ""), !!a.stokMin);
    case "katalog_barang":
      return cari(String(a.search ?? ""));
    case "barang_label": {
      const kodes: string[] = Array.isArray(a.kodes) ? a.kodes : [];
      return barang.filter((b) => kodes.includes(b.kodebarang)).map((b) => {
        const p = promoStore.diskon.find((d) => d.kodebarang === b.kodebarang);
        return { ...b, hrgpromo: p ? p.hrgdiskon : 0, ketpromo: p ? `Diskon ${p.diskon}%` : "" };
      });
    }

    /* ---- Non-Tunai ---- */
    case "nt_list": return { jenis: ntJenis, item: ntItem };
    case "jenis_nontunai": return ntJenis;
    case "nt_jenis_save": {
      const idx = ntJenis.findIndex((j) => j.kode === (a.asli || a.kode));
      if (idx >= 0) ntJenis[idx] = { kode: a.kode, namajenis: a.nama };
      else ntJenis.push({ kode: a.kode, namajenis: a.nama });
      return null;
    }
    case "nt_jenis_delete": {
      const idx = ntJenis.findIndex((j) => j.kode === a.kode);
      if (idx >= 0) ntJenis.splice(idx, 1);
      return null;
    }
    case "nt_item_save": {
      const j = ntJenis.find((x) => x.kode === a.kode);
      const idx = ntItem.findIndex((i) => i.kode === a.kode && i.namaitem === (a.asli || a.nama));
      const row = { kode: a.kode, namajenis: j?.namajenis ?? a.kode, namaitem: a.nama };
      if (idx >= 0) ntItem[idx] = row;
      else ntItem.push(row);
      return null;
    }
    case "nt_item_delete": {
      const idx = ntItem.findIndex((i) => i.kode === a.kode && i.namaitem === a.nama);
      if (idx >= 0) ntItem.splice(idx, 1);
      return null;
    }

    /* ---- Transaksi, Order & Pending ---- */
    case "preview_notrans":
      return `${a.kode}${String(a.tgl ?? "2026-11-23").slice(2, 4)}${String(a.tgl ?? "2026-11-23").slice(5, 7)}-${String(nomor).padStart(5, "0")}`;
    case "promo_keranjang": {
      const items: Row[] = Array.isArray(a.items) ? a.items : [];
      return {
        baris: items.map((i) => ({ harga: Number(i.harga) || 0, disknilai: 0 })),
        bonus: [],
      };
    }
    case "save_penjualan": case "save_penjualan_order": case "save_pembelian": case "save_pembelian_order": {
      const inp = a.input ?? {};
      const jual = cmd.includes("penjualan");
      const tgl = String(inp.tgl ?? "2026-11-23");
      const kode = jual ? "TJ" : "TB";
      const notrans = `${kode}${tgl.slice(2, 4)}${tgl.slice(5, 7)}-${String(nomor++).padStart(5, "0")}`;
      const items: Row[] = Array.isArray(inp.items) ? inp.items : [];
      const jmltrans = items.reduce((s, i) => s + Number(i.jmljual) * Number(i.harga) - Number(i.disknilai ?? 0), 0);
      const diskonnilai = Number(inp.diskonnilai ?? 0);
      const biaya = Number(inp.biaya ?? 0);
      const totaltrans = jmltrans - diskonnilai + biaya;
      const jmlbayar = Number(inp.jmlbayar ?? 0);
      const bayarlain1 = Number(inp.bayarnontunai ?? 0);
      const sisa = jmlbayar + bayarlain1 - totaltrans;
      const pel = pelanggan.find((p) => p.kodepelanggan === inp.kodepelanggan);
      const pem = pemasok.find((p) => p.kodepemasok === inp.kodepemasok);
      const header: Row = {
        notrans, kode, tgltrans: tgl, jamupload: "10:30:00",
        kodepelanggan: inp.kodepelanggan || "Tunai", namapelanggan: pel?.namapelanggan ?? "Tunai",
        kodepemasok: inp.kodepemasok || "Tunai", namapemasok: pem?.namapemasok ?? "Tunai",
        namakontak: jual ? (pel?.namapelanggan ?? "Tunai") : (pem?.namapemasok ?? "Tunai"),
        kontak: jual ? (pel?.namapelanggan ?? "Tunai") : (pem?.namapemasok ?? "Tunai"),
        namakasir: user.namakaryawan, sales: "", namasales: "",
        jmltrans, diskonnilai, biaya, ppn: 0, ppnnilai: 0, totaltrans,
        jmlbayar, bayarlain1, ketbayarlain1: inp.jenisnontunai ?? "", kartu: inp.kartu ?? "", norefkartu: inp.norefkartu ?? "",
        sisa, carabayar: inp.carabayar ?? "Tunai", catatan: inp.catatan ?? "",
      };
      const detail = items.map((i, n) => ({
        ...i, nourut: n + 1, hrgterjual: Number(i.harga) || 0,
        subtotal: Number(i.jmljual) * Number(i.harga) - Number(i.disknilai ?? 0),
        jmlretur: 0, sisa: Number(i.jmljual) || 0,
      }));
      transaksi.set(notrans, { header, detail });
      return { notrans, total: totaltrans, kembali: Math.max(0, sisa), poin: 0 };
    }
    case "list_transaksi": {
      const out: Row[] = [];
      for (const { header } of transaksi.values()) {
        if (!a.kode || header.kode === a.kode) out.push(header);
      }
      return out;
    }
    case "get_transaksi":
      return transaksi.get(String(a.notrans)) ?? { header: { notrans: a.notrans, tgltrans: "2026-11-23", namapelanggan: "Tunai", namakasir: user.namakaryawan, jmltrans: 0, totaltrans: 0, jmlbayar: 0, sisa: 0 }, detail: [] };
    case "save_order": {
      const inp = a.input ?? {};
      const kode = inp.jual ? "SO" : "PO";
      const tgl = String(inp.tgl ?? "2026-11-23");
      const notrans = inp.notrans || `${kode}${tgl.slice(2, 4)}${tgl.slice(5, 7)}-${String(nomor++).padStart(5, "0")}`;
      const items: Row[] = Array.isArray(inp.items) ? inp.items : [];
      const jmltrans = items.reduce((s, i) => s + Number(i.jmljual) * Number(i.harga), 0);
      const pel = pelanggan.find((p) => p.kodepelanggan === inp.kodepelanggan);
      const pem = pemasok.find((p) => p.kodepemasok === inp.kodepemasok);
      const header = {
        notrans, kode, tglorder: tgl, status: 0, jmltrans, jmlbayar: Number(inp.dp ?? 0),
        kodepelanggan: inp.kodepelanggan ?? "", namapelanggan: pel?.namapelanggan ?? "Tunai",
        kodepemasok: inp.kodepemasok ?? "", namapemasok: pem?.namapemasok ?? "Tunai",
        kontak: inp.jual ? (pel?.namapelanggan ?? "Tunai") : (pem?.namapemasok ?? "Tunai"),
        kasir: user.namakaryawan, namakasir: user.namakaryawan, catatan: inp.catatan ?? "",
      };
      const detail = items.map((i, n) => ({ ...i, nourut: n + 1, hrgterjual: Number(i.harga) || 0, subtotal: Number(i.jmljual) * Number(i.harga) }));
      orders.set(notrans, { header, detail, jual: !!inp.jual });
      return { notrans, total: jmltrans };
    }
    case "list_order":
      return [...orders.values()].filter((o) => o.jual === !!a.jual).map((o) => o.header);
    case "get_order":
      return orders.get(String(a.notrans)) ?? { header: {}, detail: [] };
    case "delete_order":
      orders.delete(String(a.notrans)); return null;
    case "save_pending": {
      const inp = a.input ?? {};
      const tgl = String(inp.tgl ?? "2026-11-23");
      const nopending = inp.nopending || `TP${tgl.slice(2, 4)}${tgl.slice(5, 7)}-${String(nomor++).padStart(5, "0")}`;
      const items: Row[] = Array.isArray(inp.items) ? inp.items : [];
      const jmltrans = items.reduce((s, i) => s + Number(i.jmljual) * Number(i.harga), 0);
      const pel = pelanggan.find((p) => p.kodepelanggan === inp.kodepelanggan);
      const header = { nopending, tgltrans: tgl, kodepelanggan: inp.kodepelanggan ?? "", kontak: pel?.namapelanggan ?? "Tunai", kasir: user.namakaryawan, jmltrans, catatan: inp.catatan ?? "" };
      const detail = items.map((i, n) => ({ ...i, nourut: n + 1, hrgterjual: Number(i.harga) || 0 }));
      pendings.set(nopending, { header, detail });
      return { nopending, total: jmltrans };
    }
    case "list_pending":
      return [...pendings.values()].map((p) => p.header);
    case "get_pending":
      return pendings.get(String(a.nopending)) ?? { header: {}, detail: [] };
    case "delete_pending": case "pending_selesai":
      pendings.delete(String(a.nopending)); return null;

    /* ---- Retur & Pelunasan ---- */
    case "get_retur_sumber": {
      const t = transaksi.get(String(a.notrans));
      if (t) return { header: t.header, detail: t.detail, piutang_terbuka: 0 };
      return {
        header: { notrans: a.notrans, tgltrans: "2026-11-23", namakontak: "Tunai", namasales: "" },
        detail: [{ nourut: 1, kodebarang: "B001", namabarang: "Beras Pandan Wangi 5 kg", satuanjual: "SAK", jmljual: 2, jmlretur: 0, sisa: 2, hrgterjual: 78000, disknilai: 0 }],
        piutang_terbuka: 0,
      };
    }
    case "save_retur_jual": case "save_retur_beli": case "save_retur_beli_barang": {
      const notrans = `RJ2611-${String(nomor++).padStart(5, "0")}`;
      return { notrans, total: 78000, dipotong: 0, kas: 78000 };
    }
    case "kartu_kontak":
      return a.jenis === "Piutang" ? pelanggan : pemasok;
    case "kartu_list":
      return a.jenis === "Piutang"
        ? piutangKartu.filter((k) => !a.kode || k.kodepelanggan === a.kode)
        : hutangKartu.filter((k) => !a.kode || k.kodepemasok === a.kode);
    case "save_pelunasan":
      return { total: Number(a.input?.nominal ?? 0), jumlah: 1, kas: Number(a.input?.nominal ?? 0) };

    /* ---- Inventori & Promo ---- */
    case "save_stok_awal": case "save_opname": case "save_opname_stok":
      return { notrans: `OP2611-${String(nomor++).padStart(5, "0")}`, jumlah: (a.items ?? []).length };
    case "promo_list":
      return promoStore[String(a.jenis ?? "diskon")] ?? [];
    case "promo_save": {
      const j = String(a.jenis ?? "diskon");
      const data: Row[] = Array.isArray(a.data) ? a.data : [];
      promoStore[j] = data.map((d, idx) => {
        const b = barang.find((x) => x.kodebarang === d.kodebarang);
        const bn = barang.find((x) => x.kodebarang === d.kodebonus);
        return { ...d, bid: d.bid ?? idx + 1, namabarang: b?.namabarang ?? d.kodebarang, hrgnormal: b?.hrgjual ?? 0, namabonus: bn?.namabarang ?? "" };
      });
      return { jumlah: data.length };
    }
    case "promo_delete": {
      const j = String(a.jenis ?? "diskon");
      promoStore[j] = (promoStore[j] ?? []).filter((x) => x.bid !== a.bid);
      return null;
    }

    /* ---- Keuangan & Poin ---- */
    case "kas_kategori":
      return ["Penjualan Barang Dagang", "Biaya Operasional", "Biaya Gaji, Upah, dll", "Pendapatan Diluar Usaha", "Modal Awal"];
    case "kas_list": {
      const masuk = kasRows.reduce((s, r) => s + Number(r.masuk), 0);
      const keluar = kasRows.reduce((s, r) => s + Number(r.keluar), 0);
      return { rows: kasRows, masuk, keluar, kas: masuk - keluar };
    }
    case "kas_save": {
      const inp = a.input ?? {};
      const idkas = kasRows.length + 1;
      const nokas = `KS2611-${String(idkas).padStart(5, "0")}`;
      const prevSaldo = kasRows[kasRows.length - 1]?.saldo ?? 0;
      const saldo = prevSaldo + Number(inp.masuk ?? 0) - Number(inp.keluar ?? 0);
      kasRows.push({
        idkas, nokas, tglkas: inp.tgl, noreftrans: inp.noref || "-", jenis: inp.jenis, kategori: inp.kategori,
        namakaryawan: user.namakaryawan, namakontak: "-", keterangan: inp.ket, masuk: Number(inp.masuk ?? 0), keluar: Number(inp.keluar ?? 0), saldo,
      });
      return { idkas, nokas };
    }
    case "kas_delete": {
      const idx = kasRows.findIndex((r) => r.idkas === a.idkas);
      if (idx >= 0) kasRows.splice(idx, 1);
      return null;
    }
    case "poin_member": {
      const p = pelanggan.find((x) => x.kodepelanggan.toUpperCase() === String(a.kode ?? "").toUpperCase()) ?? pelanggan[0];
      return { kodepelanggan: p.kodepelanggan, namapelanggan: p.namapelanggan, poin: Number(p.poin) || 0 };
    }
    case "poin_histori":
      return poinHistori;
    case "poin_tukar": {
      const p = pelanggan.find((x) => x.kodepelanggan === a.kode);
      if (p) p.poin = Math.max(0, Number(p.poin) - Number(a.jumlah || 0));
      return { notukar: `TP2611-${String(nomor++).padStart(5, "0")}`, poin: p?.poin ?? 0 };
    }
    case "poin_koreksi": {
      const p = pelanggan.find((x) => x.kodepelanggan === a.kode);
      if (p) p.poin = Number(a.poinBaru || 0);
      return { notukar: `TK2611-${String(nomor++).padStart(5, "0")}`, poin: p?.poin ?? 0 };
    }

    /* ---- Database, Alat & Impor ---- */
    case "db_info":
      return { path: "/Users/tokopro/Data/tokopro.db", ukuran: 524288, folder_backup: "/Users/tokopro/Backup" };
    case "db_daftar_backup":
      return [
        { nama: "backup-2026-11-22.db", path: "/Users/tokopro/Backup/backup-2026-11-22.db", ukuran: 512000, waktu: "22/11/2026 18:00" },
        { nama: "backup-2026-11-21.db", path: "/Users/tokopro/Backup/backup-2026-11-21.db", ukuran: 498000, waktu: "21/11/2026 18:00" },
      ];
    case "db_backup": case "backup_otomatis":
      return { path: "/Users/tokopro/Backup/backup-2026-11-23.db", ukuran: 524288 };
    case "db_cek":
      return { ok: true, masalah: [] };
    case "db_perbaiki": case "db_restore":
      return { cadangan: "/Users/tokopro/Backup/sebelum-perbaikan.db" };
    case "alat_item_hapus":
      return [
        { kunci: "jual", nama: "Transaksi Penjualan" },
        { kunci: "beli", nama: "Transaksi Pembelian" },
        { kunci: "opname", nama: "Stok Opname" },
        { kunci: "stokawal", nama: "Stok Awal" },
        { kunci: "piutang", nama: "Data Piutang" },
        { kunci: "hutang", nama: "Data Hutang" },
        { kunci: "kas", nama: "Transaksi Kas" },
        { kunci: "barang", nama: "Master Barang" },
        { kunci: "pelanggan", nama: "Master Pelanggan" },
        { kunci: "pemasok", nama: "Master Supplier" },
      ];
    case "alat_hitung_stok": case "alat_hitung_kas":
      return { berubah: 0 };
    case "alat_sinkron_harga_beli":
      return { berubah: 0, cadangan: "/Users/tokopro/Backup/cadangan.db" };
    case "alat_sinkron_jual": case "alat_hapus_transaksi":
      return { dihapus: 0, cadangan: "/Users/tokopro/Backup/cadangan.db" };
    case "alat_daftar_transaksi":
      return [...transaksi.values()].map((t) => ({ ...t.header, kunci: t.header.notrans }));
    case "alat_hapus_data":
      return { dihapus: {}, cadangan: "/Users/tokopro/Backup/cadangan.db" };
    case "alat_sql":
      return { kolom: ["kodebarang", "namabarang", "stokakhir"], baris: barang.slice(0, 5).map((b) => [b.kodebarang, b.namabarang, b.stokakhir]), terpotong: false, cadangan: null };
    case "impor_jenis":
      return [
        { kunci: "barang", nama: "Data Barang" },
        { kunci: "updatebarang", nama: "Update Data Barang" },
        { kunci: "stokbarang", nama: "Update Stok Barang" },
        { kunci: "pelanggan", nama: "Data Pelanggan" },
        { kunci: "pemasok", nama: "Data Supplier" },
      ];
    case "impor_baca":
      return { kolom: ["kodebarang", "namabarang", "hrgbeli", "hrgjual"], baris: [["B007", "Kecap Manis 520ml", "18000", "21000"]], jumlah: 1, wajib_hilang: [], tidak_dikenal: [] };
    case "impor_proses":
      return { jumlah: 1, cadangan: "/Users/tokopro/Backup/sebelum-impor.db", notrans: "OP2611-00001" };

    /* ---- Dashboard, Notifikasi, Laporan & Berkas ---- */
    case "dashboard": case "dashboard_data":
      return {
        rata_jual: 1850000, rata_laba: 340000, hari_jual: 2450000, hari_laba: 465000,
        penjualan15: [
          { tgl: "2026-11-18", total: 1650000 }, { tgl: "2026-11-19", total: 1920000 },
          { tgl: "2026-11-20", total: 1750000 }, { tgl: "2026-11-21", total: 2100000 },
          { tgl: "2026-11-22", total: 2300000 }, { tgl: "2026-11-23", total: 2450000 },
        ],
        per_hari: [
          { hari: 1, total: 1800000 }, { hari: 2, total: 1950000 }, { hari: 3, total: 1700000 },
          { hari: 4, total: 2100000 }, { hari: 5, total: 2250000 }, { hari: 6, total: 2600000 }, { hari: 0, total: 2400000 },
        ],
        laba30: [
          { tgl: "2026-11-18", total: 310000 }, { tgl: "2026-11-19", total: 355000 },
          { tgl: "2026-11-20", total: 320000 }, { tgl: "2026-11-21", total: 390000 },
          { tgl: "2026-11-22", total: 430000 }, { tgl: "2026-11-23", total: 465000 },
        ],
        laba_bulan: [
          { bulan: "2026-08", total: 8400000 }, { bulan: "2026-09", total: 9100000 },
          { bulan: "2026-10", total: 9850000 }, { bulan: "2026-11", total: 10200000 },
        ],
        pelanggan: [
          { nama: "Warung Pak Budi", total: 4850000 },
          { nama: "Bu Siti", total: 3200000 },
          { nama: "Toko Berkah", total: 2150000 },
          { nama: "Ibu Rahma", total: 1450000 },
          { nama: "Pak Dedi", total: 980000 },
        ],
        piutang: piutangKartu.map((k) => ({ nama: k.namapelanggan, piutang: k.kekurangan })),
      };
    case "notifikasi":
      // Sama dengan backend: piutang belum lunas yang jatuh temponya sampai tanggal ini.
      return { piutang_jatuh_tempo: piutangKartu.filter((k) => k.kekurangan > 0 && String(k.jthtempo) <= String(a.tgl ?? tglGeser(0))).length };
    case "laporan_data": case "laporan_pembelian": case "laporan_stok": case "laporan_kas": case "laporan_piutang":
      return [];
    case "laporan_penjualan":
      return { rows: [], terlaris: [] };
    case "ekspor_nama":
      return `/Users/tokopro/Documents/${a.nama ?? "ekspor"}-2026-11-23.${a.ext ?? "csv"}`;
    case "simpan_file": case "simpan_xlsx": case "simpan_laporan": case "foto_simpan":
      return String(a.path ?? "/Users/tokopro/Documents/file");
    case "baca_gambar": case "foto_baca":
      return null;
    case "foto_hapus":
      return true;
    default:
      console.info(`[tauriMock] perintah "${cmd}" belum ditiru`, a);
      return null;
  }
});
