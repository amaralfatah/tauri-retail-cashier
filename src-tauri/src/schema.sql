-- Skema SQLite hasil port dari datapos.fdb (Firebird 2.5).
-- Nama tabel dan kolom sama dengan aslinya supaya data lama bisa diimpor apa adanya.
-- Uang tetap REAL seperti DOUBLE PRECISION aslinya; pembulatan dilakukan di Rust.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS applog (
  lid INTEGER PRIMARY KEY AUTOINCREMENT,
  tgl TEXT, jam TEXT, kodekaryawan TEXT, keterangan TEXT, noref TEXT
);

CREATE TABLE IF NOT EXISTS keuangan (
  idkas INTEGER UNIQUE,
  nokas TEXT PRIMARY KEY NOT NULL,
  kode TEXT, jenis TEXT, kategori TEXT, noreftrans TEXT, tglkas TEXT,
  kodekaryawan TEXT, namakaryawan TEXT, kodekontak TEXT, namakontak TEXT,
  masuk REAL DEFAULT 0, keluar REAL DEFAULT 0, saldo REAL DEFAULT 0,
  keterangan TEXT, periode TEXT
);

CREATE TABLE IF NOT EXISTS mdbarang (
  bid INTEGER PRIMARY KEY AUTOINCREMENT,
  kodebarang TEXT NOT NULL UNIQUE,
  namabarang TEXT, barcode TEXT, barcode2 TEXT,
  jenis TEXT DEFAULT 'Barang',
  kodekelompok TEXT, kodekategori TEXT, kodepemasok TEXT, kodesatuan TEXT,
  hrgbeli REAL DEFAULT 0, marginpersen REAL DEFAULT 0, marginnilai REAL DEFAULT 0, hrgjual REAL DEFAULT 0,
  stokawal REAL DEFAULT 0, stokmasuk REAL DEFAULT 0, stokkeluar REAL DEFAULT 0,
  stokopname REAL DEFAULT 0, stokakhir REAL DEFAULT 0,
  stokmin REAL DEFAULT 0, stokmax REAL DEFAULT 0, jmlreorder REAL DEFAULT 0,
  satuan1 TEXT, konversi1 REAL DEFAULT 0, hrgsatuan1 REAL DEFAULT 0, hrgmultisatuan1 REAL DEFAULT 0,
  satuan2 TEXT, konversi2 REAL DEFAULT 0, hrgsatuan2 REAL DEFAULT 0, hrgmultisatuan2 REAL DEFAULT 0,
  satuan3 TEXT, konversi3 REAL DEFAULT 0, hrgsatuan3 REAL DEFAULT 0, hrgmultisatuan3 REAL DEFAULT 0,
  satuan4 TEXT, konversi4 REAL DEFAULT 0, hrgsatuan4 REAL DEFAULT 0, hrgmultisatuan4 REAL DEFAULT 0,
  satuan5 TEXT, konversi5 REAL DEFAULT 0, hrgsatuan5 REAL DEFAULT 0, hrgmultisatuan5 REAL DEFAULT 0,
  aktif INTEGER DEFAULT 1, bisaeditnama INTEGER DEFAULT 0, bisaedithrg INTEGER DEFAULT 0,
  hpp REAL DEFAULT 0,
  hrglevel1 REAL DEFAULT 0, hrglevel2 REAL DEFAULT 0, hrglevel3 REAL DEFAULT 0, hrglevel4 REAL DEFAULT 0, hrglevel5 REAL DEFAULT 0,
  tglupload TEXT, tglupdate TEXT, jamupload TEXT, jamupdate TEXT,
  rak TEXT,
  hrgtingkat1 REAL DEFAULT 0, hrgtingkat2 REAL DEFAULT 0, hrgtingkat3 REAL DEFAULT 0, hrgtingkat4 REAL DEFAULT 0, hrgtingkat5 REAL DEFAULT 0,
  minhrg1 INTEGER DEFAULT 0, minhrg2 INTEGER DEFAULT 0, minhrg3 INTEGER DEFAULT 0, minhrg4 INTEGER DEFAULT 0, minhrg5 INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_mdbarang_barcode ON mdbarang(barcode);
CREATE INDEX IF NOT EXISTS ix_mdbarang_barcode2 ON mdbarang(barcode2);
CREATE INDEX IF NOT EXISTS ix_mdbarang_nama ON mdbarang(namabarang);

CREATE TABLE IF NOT EXISTS mdbarangbarcode (kodebarang TEXT, namabarang TEXT, hrgjual REAL, hrgpromo REAL, ketpromo TEXT);
CREATE TABLE IF NOT EXISTS mdbarangbonus (bid INTEGER PRIMARY KEY AUTOINCREMENT, kodebarang TEXT, namabarang TEXT, minbeli REAL DEFAULT 1, kodebonus TEXT, jmlbonus REAL DEFAULT 1, tglawal TEXT, tglakhir TEXT, jamawal TEXT, jamakhir TEXT);
CREATE TABLE IF NOT EXISTS mdbarangdiskon (bid INTEGER PRIMARY KEY AUTOINCREMENT, kodebarang TEXT, namabarang TEXT, hrgnormal REAL DEFAULT 0, diskon REAL DEFAULT 0, hrgdiskon REAL DEFAULT 0, tglawal TEXT, tglakhir TEXT, jammulai TEXT, jamselesai TEXT);
CREATE TABLE IF NOT EXISTS mdbarangpdp (bid INTEGER PRIMARY KEY AUTOINCREMENT, minbelanja REAL DEFAULT 0, kodebarang TEXT, namabarang TEXT, hrgnormal REAL DEFAULT 0, diskon REAL DEFAULT 0, hrgdiskon REAL DEFAULT 0, tglawal TEXT, tglakhir TEXT, jammulai TEXT, jamselesai TEXT);

CREATE TABLE IF NOT EXISTS mdjenisnontunai (kode TEXT PRIMARY KEY NOT NULL, namajenis TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mdjenisnontunaiitem (kode TEXT NOT NULL REFERENCES mdjenisnontunai(kode) ON DELETE CASCADE, namaitem TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS mdkaryawan (kodekaryawan TEXT PRIMARY KEY NOT NULL, namakaryawan TEXT, alamat TEXT, kota TEXT, provinsi TEXT, tlp1 TEXT, tlp2 TEXT, email TEXT, jabatan TEXT, aktif INTEGER DEFAULT 1, idtele TEXT);
CREATE TABLE IF NOT EXISTS mdkategori (kodekategori TEXT PRIMARY KEY NOT NULL, kodekelompok TEXT, namakategori TEXT);
CREATE TABLE IF NOT EXISTS mdkelompok (kodekelompok TEXT PRIMARY KEY NOT NULL, namakelompok TEXT);
CREATE TABLE IF NOT EXISTS mdmenu (idmenu TEXT PRIMARY KEY NOT NULL, namamenu TEXT, captionmenu TEXT, mlevel TEXT, parent TEXT, aktif INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS mdpelanggan (kodepelanggan TEXT PRIMARY KEY NOT NULL, namapelanggan TEXT, alamat TEXT, kota TEXT, provinsi TEXT, tlp1 TEXT, tlp2 TEXT, email TEXT, masaaktif TEXT, "level" TEXT, poin INTEGER DEFAULT 0, aktif INTEGER DEFAULT 1, pointerpakai INTEGER DEFAULT 0, limitkredit REAL DEFAULT 0, idtele TEXT);
CREATE TABLE IF NOT EXISTS mdpemasok (kodepemasok TEXT PRIMARY KEY NOT NULL, namapemasok TEXT, namakontak TEXT, alamat TEXT, kota TEXT, provinsi TEXT, tlp1 TEXT, tlp2 TEXT, fax TEXT, email TEXT, aktif INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS mdsatuan (kodesatuan TEXT PRIMARY KEY NOT NULL, namasatuan TEXT);

-- pswduser berisi hash Argon2. NULL berarti password belum diatur (misalnya user hasil impor).
CREATE TABLE IF NOT EXISTS mduser (iduser TEXT PRIMARY KEY NOT NULL, pswduser TEXT, kodekaryawan TEXT, "level" TEXT, aktif INTEGER DEFAULT 1, tglupload TEXT, tglupdate TEXT, jamupload TEXT, jamupdate TEXT);
CREATE TABLE IF NOT EXISTS mdusermenu (iduser TEXT, idmenu TEXT, akses INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS transaksi (
  tid INTEGER UNIQUE,
  notrans TEXT PRIMARY KEY NOT NULL,
  tglorder TEXT, tgltrans TEXT, kode TEXT, jenis TEXT,
  kodekaryawan TEXT, kodesales TEXT, kodepelanggan TEXT, kodepemasok TEXT, catatan TEXT,
  jmltrans REAL DEFAULT 0, diskonpersen REAL DEFAULT 0, diskonnilai REAL DEFAULT 0, biaya REAL DEFAULT 0,
  totalnilaibeli REAL DEFAULT 0, ppn REAL DEFAULT 0, ppnnilai REAL DEFAULT 0, totaltrans REAL DEFAULT 0,
  jmlbayar REAL DEFAULT 0, sisa REAL DEFAULT 0, carabayar TEXT, kartu TEXT, norefkartu TEXT,
  status INTEGER DEFAULT 0, noref TEXT, posted INTEGER DEFAULT 0, jnsstok TEXT,
  bayarlain1 REAL DEFAULT 0, bayarlain2 REAL DEFAULT 0, ketbayarlain1 TEXT, ketbayarlain2 TEXT,
  tahun TEXT, bulan TEXT, tgljthtempo TEXT, tglupload TEXT, tglupdate TEXT, jamupload TEXT, jamupdate TEXT, nonota TEXT
);
CREATE INDEX IF NOT EXISTS ix_transaksi_kode_tgl ON transaksi(kode, tgltrans);

CREATE TABLE IF NOT EXISTS transaksidetil (
  notrans TEXT REFERENCES transaksi(notrans) ON DELETE CASCADE,
  kode TEXT, nourut INTEGER, kodebarang TEXT, namabarang TEXT, kodesatuan TEXT,
  jml REAL DEFAULT 0, hrgbeli REAL DEFAULT 0, hrgjual REAL DEFAULT 0, satuanjual TEXT, jmljual REAL DEFAULT 0,
  hrgterjual REAL DEFAULT 0, diskpersen REAL DEFAULT 0, disknilai REAL DEFAULT 0, subtotal REAL DEFAULT 0,
  jmlretur REAL DEFAULT 0, konversi REAL DEFAULT 0, stokasal REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_transaksidetil_notrans ON transaksidetil(notrans);
CREATE INDEX IF NOT EXISTS ix_transaksidetil_barang ON transaksidetil(kodebarang);

CREATE TABLE IF NOT EXISTS transaksipoin (notukar TEXT PRIMARY KEY NOT NULL, tgltukar TEXT, kodekaryawan TEXT, kodepelanggan TEXT, poinawal INTEGER DEFAULT 0, poinmasuk INTEGER DEFAULT 0, poinkeluar INTEGER DEFAULT 0, nilaitukar REAL DEFAULT 0, ket1 TEXT, ket2 TEXT, reftukar TEXT);

CREATE TABLE IF NOT EXISTS trkartupiutang (nopiutang TEXT PRIMARY KEY NOT NULL, kode TEXT, kodepelanggan TEXT, kodepemasok TEXT, jenis TEXT, noreftrans TEXT, jthtempo TEXT, jmlpiutang REAL DEFAULT 0, jmlterbayar REAL DEFAULT 0, kekurangan REAL DEFAULT 0, status INTEGER DEFAULT 0, keterangan TEXT);
CREATE TABLE IF NOT EXISTS trkartupiutangdetil (xid INTEGER PRIMARY KEY AUTOINCREMENT, nopiutang TEXT REFERENCES trkartupiutang(nopiutang) ON DELETE CASCADE, tglbayar TEXT, kodekaryawan TEXT, jmlbayar REAL DEFAULT 0, denda REAL DEFAULT 0, potongan REAL DEFAULT 0, total REAL DEFAULT 0, catatan TEXT);

CREATE TABLE IF NOT EXISTS tseting (
  namausaha TEXT, bidangusaha TEXT, alamat TEXT, kota TEXT, provinsi TEXT, kodepos TEXT, pemilik TEXT,
  tlp TEXT, fax TEXT, email TEXT, website TEXT,
  aktiflogin INTEGER DEFAULT 1, aktifpromo INTEGER DEFAULT 0, aktiflevel INTEGER DEFAULT 0, aktifsatuan INTEGER DEFAULT 0,
  updateharga INTEGER DEFAULT 0, izinharga INTEGER DEFAULT 0, izindiskon INTEGER DEFAULT 0, aktiftranskas INTEGER DEFAULT 0,
  header1 TEXT, header2 TEXT, footer1 TEXT, footer2 TEXT, modinstalled TEXT,
  aktifpoin INTEGER, izinstokmin INTEGER, aktiftranspoin INTEGER DEFAULT 1, mintranspoin REAL DEFAULT 0,
  jmlpointrans INTEGER DEFAULT 0, berlakukelipatanpoin INTEGER DEFAULT 1, konfirmasikredit INTEGER DEFAULT 0,
  tempopiutang INTEGER DEFAULT 1, versionapp TEXT, aktifotentikasi INTEGER DEFAULT 0, aktifppn INTEGER DEFAULT 0,
  ppn REAL DEFAULT 10, nonaktifstokhabis INTEGER DEFAULT 0, tampilnonaktif INTEGER DEFAULT 0
);

-- Port trigger TRANSAKSIDETIL_INSERT dari Firebird: mutasi stok per kode transaksi.
-- Hanya barang berjenis 'Barang' yang dihitung; jasa tidak punya stok.
CREATE TRIGGER IF NOT EXISTS transaksidetil_insert AFTER INSERT ON transaksidetil
BEGIN
  UPDATE mdbarang SET stokkeluar = stokkeluar + new.jml
    WHERE new.kode IN ('TJ','RB') AND kodebarang = new.kodebarang AND jenis = 'Barang';
  UPDATE mdbarang SET stokmasuk = stokmasuk + new.jml
    WHERE new.kode IN ('RJ','TB') AND kodebarang = new.kodebarang AND jenis = 'Barang';
  UPDATE mdbarang SET stokopname = stokopname + new.jml
    WHERE new.kode = 'OP' AND kodebarang = new.kodebarang AND jenis = 'Barang';
  UPDATE mdbarang SET stokawal = new.jml
    WHERE new.kode = 'SA' AND kodebarang = new.kodebarang AND jenis = 'Barang';
  UPDATE mdbarang SET stokakhir = stokawal + stokmasuk - stokkeluar + stokopname
    WHERE new.kode NOT IN ('SO','PO') AND kodebarang = new.kodebarang AND jenis = 'Barang';
END;

-- Penjualan yang ditunda di layar kasir (tombol Pending). Tidak memengaruhi stok, kas, maupun laporan.
CREATE TABLE IF NOT EXISTS pendingjual (
  nopending TEXT PRIMARY KEY NOT NULL, tgltrans TEXT, kodekaryawan TEXT, kodepelanggan TEXT, kodesales TEXT, catatan TEXT,
  jmltrans REAL DEFAULT 0, tglsimpan TEXT
);
CREATE TABLE IF NOT EXISTS pendingjualdetil (
  nopending TEXT REFERENCES pendingjual(nopending) ON DELETE CASCADE, nourut INTEGER, kodebarang TEXT, satuanjual TEXT, jmljual REAL DEFAULT 0, hrgterjual REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_pendingjualdetil_no ON pendingjualdetil(nopending);
-- Sesi masuk per komputer (mode Komputer Pusat). Token aslinya tidak disimpan, hanya sidik SHA-256.
CREATE TABLE IF NOT EXISTS sesi_perangkat (token_hash TEXT PRIMARY KEY NOT NULL, idperangkat TEXT NOT NULL DEFAULT '', iduser TEXT, mulai INTEGER NOT NULL, terakhir INTEGER NOT NULL);
-- Komputer kasir yang sudah disambungkan ke Pusat. Token aslinya tidak disimpan, hanya sidik SHA-256.
CREATE TABLE IF NOT EXISTS perangkat (id INTEGER PRIMARY KEY AUTOINCREMENT, nama_komputer TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, dibuat INTEGER NOT NULL, terakhir_terlihat INTEGER NOT NULL, aktif INTEGER NOT NULL DEFAULT 1, otomatis INTEGER NOT NULL DEFAULT 0);
-- Hasil perintah simpan dari komputer kasir, dikenali dari idPermintaan. Dipakai supaya simpan yang diulang tidak tercatat dua kali.
CREATE TABLE IF NOT EXISTS permintaan_selesai (id TEXT PRIMARY KEY NOT NULL, perintah TEXT NOT NULL, hasil_json TEXT NOT NULL, waktu INTEGER NOT NULL);
