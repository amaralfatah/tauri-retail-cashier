use crate::db::{e, rows, Db, Res};
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

/// Nilai jual per baris. Data lama menyimpan SUBTOTAL = 0, jadi dihitung dari jumlah x harga.
const LINE_JUAL: &str = "(d.jmljual * d.hrgterjual - COALESCE(d.disknilai,0))";
/// Modal per baris: harga beli dasar x jumlah dalam satuan dasar.
const LINE_MODAL: &str = "(d.hrgbeli * d.jml)";

#[tauri::command]
pub fn dashboard(db: State<Db>, tgl: String) -> Res<Value> {
    let conn = db.lock()?;
    let bulan = tgl.get(0..7).unwrap_or("").to_string();
    let (hari_ini, jml_hari_ini): (f64, i64) = conn
        .query_row("SELECT COALESCE(SUM(totaltrans),0), COUNT(*) FROM transaksi WHERE kode='TJ' AND tgltrans = ?1", params![tgl], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(e)?;
    let bulan_ini: f64 = conn
        .query_row("SELECT COALESCE(SUM(totaltrans),0) FROM transaksi WHERE kode='TJ' AND substr(tgltrans,1,7) = ?1", params![bulan], |r| r.get(0))
        .map_err(e)?;
    let stok_menipis: i64 = conn
        .query_row("SELECT COUNT(*) FROM mdbarang WHERE COALESCE(aktif,1)=1 AND jenis='Barang' AND stokmin > 0 AND stokakhir <= stokmin", [], |r| r.get(0))
        .map_err(e)?;
    let piutang: f64 = conn
        .query_row("SELECT COALESCE(SUM(kekurangan),0) FROM trkartupiutang WHERE kode='PS' AND status=0", [], |r| r.get(0))
        .map_err(e)?;
    let harian = rows(
        &conn,
        "SELECT tgltrans AS tgl, SUM(totaltrans) AS total FROM transaksi WHERE kode='TJ' AND tgltrans BETWEEN date(?1,'-13 days') AND ?1 GROUP BY tgltrans ORDER BY tgltrans",
        params![tgl],
    )?;
    let terakhir = rows(
        &conn,
        "SELECT t.notrans, t.tgltrans, t.totaltrans, t.carabayar, COALESCE(p.namapelanggan, t.kodepelanggan) AS kontak
         FROM transaksi t LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         WHERE t.kode='TJ' ORDER BY t.tid DESC LIMIT 8",
        [],
    )?;
    Ok(json!({ "hari_ini": hari_ini, "jml_hari_ini": jml_hari_ini, "bulan_ini": bulan_ini, "stok_menipis": stok_menipis,
               "piutang": piutang, "harian": harian, "terakhir": terakhir }))
}

#[tauri::command]
pub fn laporan_penjualan(db: State<Db>, dari: String, sampai: String) -> Res<Value> {
    let conn = db.lock()?;
    let data = rows(
        &conn,
        &format!(
            "SELECT t.notrans, t.tgltrans, COALESCE(p.namapelanggan, t.kodepelanggan) AS pelanggan, COALESCE(k.namakaryawan, t.kodekaryawan) AS kasir,
                    t.carabayar, t.totaltrans, t.diskonnilai,
                    (SELECT COALESCE(SUM({LINE_JUAL} - {LINE_MODAL}),0) FROM transaksidetil d WHERE d.notrans = t.notrans) - COALESCE(t.diskonnilai,0) AS laba
             FROM transaksi t
             LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
             LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
             WHERE t.kode='TJ' AND t.tgltrans BETWEEN ?1 AND ?2 ORDER BY t.tgltrans, t.notrans"
        ),
        params![dari, sampai],
    )?;
    let terlaris = rows(
        &conn,
        &format!(
            "SELECT d.kodebarang, MAX(d.namabarang) AS namabarang, SUM(d.jml) AS qty, MAX(d.kodesatuan) AS satuan,
                    SUM({LINE_JUAL}) AS omzet, SUM({LINE_JUAL} - {LINE_MODAL}) AS laba
             FROM transaksidetil d JOIN transaksi t ON t.notrans = d.notrans
             WHERE t.kode='TJ' AND t.tgltrans BETWEEN ?1 AND ?2
             GROUP BY d.kodebarang ORDER BY qty DESC LIMIT 20"
        ),
        params![dari, sampai],
    )?;
    Ok(json!({ "rows": data, "terlaris": terlaris }))
}

#[tauri::command]
pub fn laporan_pembelian(db: State<Db>, dari: String, sampai: String) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    rows(
        &conn,
        "SELECT t.notrans, t.tgltrans, COALESCE(s.namapemasok, t.kodepemasok) AS pemasok, t.carabayar, t.totaltrans, t.jmlbayar
         FROM transaksi t LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         WHERE t.kode='TB' AND t.tgltrans BETWEEN ?1 AND ?2 ORDER BY t.tgltrans, t.notrans",
        params![dari, sampai],
    )
}

#[tauri::command]
pub fn laporan_stok(db: State<Db>, search: Option<String>, mode: String) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    let filter = match mode.as_str() {
        "minimum" => "AND stokmin > 0 AND stokakhir <= stokmin",
        "habis" => "AND stokakhir <= 0",
        _ => "",
    };
    rows(
        &conn,
        &format!(
            "SELECT kodebarang, namabarang, kodesatuan, stokawal, stokmasuk, stokkeluar, stokopname, stokakhir, stokmin, hrgbeli, hrgjual,
                    stokakhir * hrgbeli AS nilaibeli, stokakhir * hrgjual AS nilaijual
             FROM mdbarang WHERE COALESCE(aktif,1)=1 AND jenis='Barang' {filter}
               AND (namabarang LIKE ?1 OR kodebarang LIKE ?1 OR barcode LIKE ?1)
             ORDER BY namabarang LIMIT 5000"
        ),
        params![format!("%{}%", search.unwrap_or_default().trim())],
    )
}

#[tauri::command]
pub fn laporan_kas(db: State<Db>, dari: String, sampai: String) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    rows(
        &conn,
        "SELECT nokas, tglkas, jenis, kategori, noreftrans, namakontak, masuk, keluar, saldo, keterangan
         FROM keuangan WHERE tglkas BETWEEN ?1 AND ?2 ORDER BY idkas",
        params![dari, sampai],
    )
}

#[tauri::command]
pub fn laporan_piutang(db: State<Db>, kode: String) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    rows(
        &conn,
        "SELECT h.nopiutang, h.noreftrans, h.jthtempo, h.jmlpiutang, h.jmlterbayar, h.kekurangan, h.status,
                COALESCE(p.namapelanggan, s.namapemasok, h.kodepelanggan, h.kodepemasok) AS kontak
         FROM trkartupiutang h
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = h.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = h.kodepemasok
         WHERE (h.kode = ?1 OR (?1 = 'HS' AND h.kode = 'HP')) ORDER BY h.status, h.jthtempo",
        params![kode],
    )
}

/// Isian dialog filter laporan. Kolom kosong berarti tidak disaring.
#[derive(Debug, Default, serde::Deserialize)]
#[serde(default)]
pub struct LapFilter {
    pub dari: String,
    pub sampai: String,
    pub notrans: String,
    pub kasir: String,
    pub sales: String,
    pub pelanggan: String,
    pub pemasok: String,
    pub carabayar: String,
    pub kode: String,
    pub barcode: String,
    pub nama: String,
    pub kelompok: String,
    pub kategori: String,
    // Tambahan untuk Filter Barang (FrmFilterBarang) pada laporan Terlaris dan Omset.
    pub jenis: String,
    pub satuan: String,
    pub status: String,
    pub stok1: String,
    pub stok2: String,
}

impl LapFilter {
    /// Urutan sesuai nomor parameter ?1..?18 pada kueri di bawah.
    fn args(&self) -> Vec<&str> {
        vec![
            &self.dari, &self.sampai, &self.notrans, &self.kasir, &self.sales, &self.pelanggan, &self.pemasok,
            &self.carabayar, &self.kode, &self.barcode, &self.nama, &self.kelompok, &self.kategori,
            &self.jenis, &self.satuan, &self.status, &self.stok1, &self.stok2,
        ]
    }
}

/// Syarat nota (?1..?8). `pemasok` = kolom yang dicocokkan dengan ?7.
fn syarat_nota(kode: &str, pemasok: &str) -> String {
    syarat_nota_tgl(kode, pemasok, "t.tgltrans")
}

/// Sama seperti `syarat_nota`, tanggal yang disaring diambil dari kolom `tgl` (order memakai tanggal order).
fn syarat_nota_tgl(kode: &str, pemasok: &str, tgl: &str) -> String {
    syarat_nota_kode(&format!("t.kode = '{kode}'"), pemasok, tgl)
}

/// Sama seperti `syarat_nota_tgl`, tetapi syarat kode transaksi ditulis sendiri (mis. TJ dan RJ untuk laba rugi).
fn syarat_nota_kode(kondisi_kode: &str, pemasok: &str, tgl: &str) -> String {
    format!(
        "{kondisi_kode} AND {tgl} BETWEEN ?1 AND ?2
         AND (?3 = '' OR t.notrans LIKE '%' || ?3 || '%')
         AND (?4 = '' OR t.kodekaryawan = ?4) AND (?5 = '' OR t.kodesales = ?5)
         AND (?6 = '' OR t.kodepelanggan = ?6) AND (?7 = '' OR {pemasok} = ?7)
         AND (?8 = '' OR t.carabayar = ?8)"
    )
}

/// Syarat barang (?9..?13).
const SYARAT_BARANG: &str = "(?9 = '' OR d.kodebarang LIKE '%' || ?9 || '%')
         AND (?10 = '' OR b.barcode LIKE '%' || ?10 || '%' OR b.barcode2 LIKE '%' || ?10 || '%')
         AND (?11 = '' OR d.namabarang LIKE '%' || ?11 || '%')
         AND (?12 = '' OR b.kodekelompok = ?12) AND (?13 = '' OR b.kodekategori = ?13)";

const NAMA_NOTA: &str = "COALESCE(p.namapelanggan, '') AS namapelanggan, COALESCE(s.namapemasok, '') AS namapemasok,
        COALESCE(k.namakaryawan, '') AS namakasir, COALESCE(sl.namakaryawan, '') AS namasales";
const JOIN_NOTA: &str = "LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
        LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
        LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
        LEFT JOIN mdkaryawan sl ON sl.kodekaryawan = t.kodesales";

/// Kueri laporan cetak. `jenis`: jual_detil, jual_barang, beli_detil, jual_head, beli_head, piutang, hutang, kas.
pub fn lap_query(conn: &rusqlite::Connection, jenis: &str, f: &LapFilter) -> Res<Vec<Value>> {
    let a = f.args();
    let p = |n: usize| rusqlite::params_from_iter(a[..n].iter().copied());
    match jenis {
        "jual_detil" | "jual_barang" | "beli_detil" => {
            let jual = jenis != "beli_detil";
            let kode = if jual { "TJ" } else { "TB" };
            let pem = if jenis == "jual_barang" { "b.kodepemasok" } else { "t.kodepemasok" };
            let urut = if jenis == "jual_barang" { "d.kodebarang, t.tgltrans, t.notrans" } else { "t.tgltrans, t.notrans, d.nourut" };
            let sql = format!(
                "SELECT t.notrans, t.tgltrans, t.catatan, t.totaltrans, t.diskonnilai, t.biaya, t.jmlbayar, t.sisa,
                        t.carabayar, t.bayarlain1, t.ketbayarlain1, t.kartu, t.norefkartu, {NAMA_NOTA},
                        d.nourut, d.kodebarang, d.namabarang, d.satuanjual, d.jmljual, d.hrgterjual,
                        d.jmljual * d.hrgterjual AS subtotal,
                        CASE WHEN d.jmljual > 0 THEN d.hrgbeli * d.jml / d.jmljual ELSE d.hrgbeli END AS hrgbelij,
                        d.jmljual * d.hrgterjual - d.hrgbeli * d.jml AS keuntungansubtotal,
                        COALESCE(b.barcode, '') AS barcode
                 FROM transaksi t JOIN transaksidetil d ON d.notrans = t.notrans
                 LEFT JOIN mdbarang b ON b.kodebarang = d.kodebarang {JOIN_NOTA}
                 WHERE {} AND {SYARAT_BARANG} ORDER BY {urut}",
                syarat_nota(kode, pem)
            );
            let _ = jual;
            rows(conn, &sql, p(13))
        }
        "jual_head" | "beli_head" => {
            let kode = if jenis == "jual_head" { "TJ" } else { "TB" };
            let sql = format!(
                "SELECT t.notrans, t.tgltrans, t.totaltrans, t.diskonnilai, {NAMA_NOTA},
                        (SELECT COALESCE(SUM(d.jmljual * d.hrgterjual - d.hrgbeli * d.jml), 0) FROM transaksidetil d WHERE d.notrans = t.notrans)
                          - COALESCE(t.diskonnilai, 0) AS laba
                 FROM transaksi t {JOIN_NOTA}
                 WHERE {} ORDER BY t.tgltrans, t.notrans",
                syarat_nota(kode, "t.kodepemasok")
            );
            rows(conn, &sql, p(8))
        }
        "piutang" | "hutang" => {
            let sql = "SELECT h.nopiutang, h.noreftrans, h.jthtempo, h.jmlpiutang, h.jmlterbayar, h.kekurangan,
                              COALESCE(p.namapelanggan, s.namapemasok, '') AS nama
                       FROM trkartupiutang h
                       LEFT JOIN mdpelanggan p ON p.kodepelanggan = h.kodepelanggan
                       LEFT JOIN mdpemasok s ON s.kodepemasok = h.kodepemasok
                       WHERE (h.jenis = ?3 OR h.kode IN (SELECT value FROM json_each(?6))) AND h.jthtempo BETWEEN ?1 AND ?2
                         AND (?4 = '' OR h.kodepelanggan = ?4) AND (?5 = '' OR h.kodepemasok = ?5)
                       ORDER BY nama, h.jthtempo";
            let (jns, kodes) = if jenis == "piutang" { ("Piutang", "[\"PS\"]") } else { ("Hutang", "[\"HS\",\"HP\"]") };
            rows(conn, sql, rusqlite::params![f.dari, f.sampai, jns, f.pelanggan, f.pemasok, kodes])
        }
        "kas" => rows(
            conn,
            "SELECT nokas, tglkas, noreftrans, keterangan, masuk, keluar, saldo
             FROM keuangan WHERE tglkas BETWEEN ?1 AND ?2 ORDER BY idkas",
            rusqlite::params![f.dari, f.sampai],
        ),
        "jual_sales" => {
            let sql = format!(
                "SELECT t.notrans, t.tgltrans, t.totaltrans, {NAMA_NOTA}
                 FROM transaksi t {JOIN_NOTA}
                 WHERE {} ORDER BY namasales, t.kodesales, t.tgltrans, t.notrans",
                syarat_nota("TJ", "t.kodepemasok")
            );
            rows(conn, &sql, p(8))
        }
        "order_jual" | "order_beli" | "retur_jual" | "retur_beli" | "opname" => {
            let (kode, tgl) = match jenis {
                "order_jual" => ("SO", "COALESCE(NULLIF(t.tglorder,''), t.tgltrans)"),
                "order_beli" => ("PO", "COALESCE(NULLIF(t.tglorder,''), t.tgltrans)"),
                "retur_jual" => ("RJ", "t.tgltrans"),
                "retur_beli" => ("RB", "t.tgltrans"),
                _ => ("OP", "t.tgltrans"),
            };
            // Aslinya order yang sudah diambil tidak ikut (`status=0`); retur dan opname tidak punya status.
            let status = if jenis.starts_with("order") { " AND COALESCE(t.status,0) = 0" } else { "" };
            let sql = format!(
                "SELECT t.notrans, {tgl} AS tgllap, t.catatan, COALESCE(t.status,0) AS status, COALESCE(t.jmlbayar,0) AS jmlbayar, {NAMA_NOTA},
                        d.nourut, d.kodebarang, d.namabarang, d.kodesatuan, d.satuanjual, d.jmljual, d.hrgterjual,
                        d.jmljual * d.hrgterjual AS subtotal, COALESCE(d.stokasal,0) AS stokasal, COALESCE(d.jml,0) AS selisih,
                        COALESCE(d.hrgbeli,0) AS hrgbeli, COALESCE(d.jml,0) * COALESCE(d.hrgbeli,0) AS nilai
                 FROM transaksi t JOIN transaksidetil d ON d.notrans = t.notrans
                 LEFT JOIN mdbarang b ON b.kodebarang = d.kodebarang {JOIN_NOTA}
                 WHERE {} AND {SYARAT_BARANG}{status} ORDER BY {tgl}, t.notrans, d.nourut",
                syarat_nota_tgl(kode, "t.kodepemasok", tgl)
            );
            rows(conn, &sql, p(13))
        }
        "pelunasan_piutang" | "pelunasan_hutang" => {
            // Seperti aslinya: memakai filter Piutang/Hutang, jadi tanggal yang disaring adalah jatuh tempo kartu.
            let sql = "SELECT h.nopiutang, h.noreftrans, h.jmlpiutang, h.jmlterbayar, h.kekurangan,
                              COALESCE(p.namapelanggan, '') AS namapelanggan, COALESCE(s.namapemasok, '') AS namapemasok,
                              dt.tglbayar, COALESCE(k.namakaryawan, '') AS namakaryawan, dt.jmlbayar
                       FROM trkartupiutang h
                       LEFT JOIN trkartupiutangdetil dt ON dt.nopiutang = h.nopiutang
                       LEFT JOIN mdpelanggan p ON p.kodepelanggan = h.kodepelanggan
                       LEFT JOIN mdpemasok s ON s.kodepemasok = h.kodepemasok
                       LEFT JOIN mdkaryawan k ON k.kodekaryawan = dt.kodekaryawan
                       WHERE (h.jenis = ?3 OR h.kode IN (SELECT value FROM json_each(?6))) AND COALESCE(h.nopiutang,'') <> ''
                         AND h.jthtempo BETWEEN ?1 AND ?2
                         AND (?4 = '' OR h.kodepelanggan = ?4) AND (?5 = '' OR h.kodepemasok = ?5)
                       ORDER BY h.nopiutang, dt.tglbayar";
            let (jns, kodes) = if jenis == "pelunasan_piutang" { ("Piutang", "[\"PS\"]") } else { ("Hutang", "[\"HS\",\"HP\"]") };
            rows(conn, sql, rusqlite::params![f.dari, f.sampai, jns, f.pelanggan, f.pemasok, kodes])
        }
        "terlaris" | "omset" => {
            // Filter Barang dengan tanggal. Omset aslinya SUM(HRGJUAL*JML) dari penjualan (TJ), urut dari terbesar.
            let (nilai, urut) = if jenis == "terlaris" { ("SUM(d.jml)", "jmltotal") } else { ("SUM(d.hrgjual * d.jml)", "jmlomset") };
            let sql = format!(
                "SELECT d.kodebarang, MAX(d.namabarang) AS namabarang, MAX(d.kodesatuan) AS kodesatuan,
                        SUM(d.jml) AS jmltotal, SUM(d.hrgjual * d.jml) AS jmlomset
                 FROM transaksi t JOIN transaksidetil d ON d.notrans = t.notrans
                 LEFT JOIN mdbarang b ON b.kodebarang = d.kodebarang
                 WHERE {} AND {SYARAT_BARANG} AND COALESCE(d.kodebarang,'') <> ''
                   AND (?14 = '' OR b.jenis = ?14) AND (?15 = '' OR b.kodesatuan = ?15)
                   AND (?16 = '' OR (?16 = 'Aktif' AND COALESCE(b.aktif,1) = 1) OR (?16 = 'Tidak aktif' AND COALESCE(b.aktif,1) = 0))
                   AND (?17 = '' OR b.stokakhir >= CAST(?17 AS REAL)) AND (?18 = '' OR b.stokakhir <= CAST(?18 AS REAL))
                 GROUP BY d.kodebarang ORDER BY {nilai} DESC, d.kodebarang",
                syarat_nota("TJ", "b.kodepemasok")
            );
            let _ = urut;
            rows(conn, &sql, p(18))
        }
        "lr_detil" | "lr_head" => {
            // Laba rugi aslinya menjumlah laba tiap baris penjualan (TJ) dan retur penjualan (RJ); retur bernilai negatif.
            // Diskon nota tidak dikurangkan.
            let tanda = "(CASE t.kode WHEN 'RJ' THEN -1 ELSE 1 END)";
            let laba = format!("{tanda} * (d.jmljual * d.hrgterjual - d.hrgbeli * d.jml)");
            let syarat = syarat_nota_kode("t.kode IN ('TJ','RJ')", "t.kodepemasok", "t.tgltrans");
            if jenis == "lr_detil" {
                let sql = format!(
                    "SELECT t.notrans, t.kode, t.tgltrans, t.catatan, t.totaltrans, t.diskonnilai, {NAMA_NOTA},
                            d.nourut, d.kodebarang, d.namabarang, d.satuanjual, d.jmljual, d.hrgterjual,
                            d.jmljual * d.hrgterjual AS subtotal,
                            CASE WHEN d.jmljual > 0 THEN d.hrgbeli * d.jml / d.jmljual ELSE d.hrgbeli END AS hrgbelij,
                            {laba} AS keuntungansubtotal
                     FROM transaksi t JOIN transaksidetil d ON d.notrans = t.notrans {JOIN_NOTA}
                     WHERE {syarat} ORDER BY t.notrans, d.nourut, d.kodebarang"
                );
                rows(conn, &sql, p(8))
            } else {
                let sql = format!(
                    "SELECT t.notrans, t.kode, t.tgltrans, t.totaltrans, {NAMA_NOTA},
                            (SELECT COALESCE(SUM({laba}), 0) FROM transaksidetil d WHERE d.notrans = t.notrans) AS laba
                     FROM transaksi t {JOIN_NOTA}
                     WHERE {syarat} ORDER BY t.tgltrans, t.notrans"
                );
                rows(conn, &sql, p(8))
            }
        }
        "lr_komparatif" => {
            // Laba Rugi Komparatif per kategori kas (ARLabaRugiKomperatif). `dari` = tanggal hari ini; periode berjalan = yyyymm.
            let periode = format!("{}{}", f.dari.get(0..4).unwrap_or(""), f.dari.get(5..7).unwrap_or(""));
            rows(
                conn,
                "SELECT lower(trim(kategori)) AS kategori,
                        COALESCE(SUM(CASE WHEN periode <> ?1 THEN masuk END),0) AS lalu_masuk,
                        COALESCE(SUM(CASE WHEN periode <> ?1 THEN keluar END),0) AS lalu_keluar,
                        COALESCE(SUM(CASE WHEN periode = ?1 THEN masuk END),0) AS mutasi_masuk,
                        COALESCE(SUM(CASE WHEN periode = ?1 THEN keluar END),0) AS mutasi_keluar,
                        COALESCE(SUM(masuk),0) AS semua_masuk, COALESCE(SUM(keluar),0) AS semua_keluar
                 FROM keuangan WHERE COALESCE(nokas,'') <> '' GROUP BY lower(trim(kategori))",
                rusqlite::params![periode],
            )
        }
        _ => Err("Laporan ini belum tersedia di versi ini.".into()),
    }
}

#[tauri::command]
pub fn laporan_data(db: State<Db>, jenis: String, filter: LapFilter) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    lap_query(&conn, &jenis, &filter)
}

/// Data Analytic Dashboard (FrmZDashboard). `tgl` = hari ini (yyyy-mm-dd). Rentang dan rumus mengikuti aplikasi lama:
/// - Laba = jumlah (HRGJUAL - HRGBELI) x JML dari TRANSAKSIDETIL penjualan (TJ), tanpa diskon.
/// - Kartu rata-rata: tanggal >= hari ini - 30 hari, dibagi 30. Kartu hari ini: tanggal = hari ini.
/// - Grafik 1: penjualan 15 hari terakhir tanpa hari ini, hanya hari yang ada datanya.
/// - Grafik 2: penjualan per hari dalam minggu (Minggu = 0), 31 hari tanpa hari ini.
/// - Grafik 3: laba harian, 31 hari tanpa hari ini, hanya hari yang ada datanya.
/// - Grafik 4: laba per bulan, 183 hari tanpa hari ini.
/// - 5 pelanggan terbanyak: 183 hari sampai hari ini, tanpa pelanggan Tunai.
/// Kunci hasil `laba30` berisi 31 hari terakhir (nama lama dipertahankan).
pub fn dashboard_query(conn: &rusqlite::Connection, tgl: &str) -> Res<Value> {
    let laba = "((d.hrgjual - d.hrgbeli) * d.jml)";
    let satu = |sql: &str, p: &[&dyn rusqlite::ToSql]| -> Res<f64> { conn.query_row(sql, p, |r| r.get(0)).map_err(e) };
    let rata_jual = satu("SELECT COALESCE(SUM(totaltrans),0)/30.0 FROM transaksi WHERE kode='TJ' AND tgltrans >= date(?1,'-30 days')", &[&tgl])?;
    let hari_jual = satu("SELECT COALESCE(SUM(totaltrans),0) FROM transaksi WHERE kode='TJ' AND tgltrans = ?1", &[&tgl])?;
    let rata_laba = satu(
        &format!("SELECT COALESCE(SUM({laba}),0)/30.0 FROM transaksi t JOIN transaksidetil d ON d.notrans=t.notrans WHERE t.kode='TJ' AND d.kode='TJ' AND t.tgltrans >= date(?1,'-30 days')"),
        &[&tgl],
    )?;
    let hari_laba = satu(
        &format!("SELECT COALESCE(SUM({laba}),0) FROM transaksi t JOIN transaksidetil d ON d.notrans=t.notrans WHERE t.kode='TJ' AND d.kode='TJ' AND t.tgltrans = ?1"),
        &[&tgl],
    )?;
    // Penjualan per hari: hanya hari yang ada transaksinya, dari 15 hari sebelum hari ini sampai kemarin.
    let penjualan15 = rows(
        conn,
        "SELECT t.tgltrans AS tgl, SUM(t.totaltrans) AS total FROM transaksi t
         WHERE t.kode='TJ' AND t.tgltrans >= date(?1,'-15 days') AND t.tgltrans < ?1 GROUP BY t.tgltrans ORDER BY t.tgltrans",
        params![tgl],
    )?;
    let laba30 = rows(
        conn,
        &format!(
            "SELECT t.tgltrans AS tgl, SUM({laba}) AS total FROM transaksi t JOIN transaksidetil d ON d.notrans=t.notrans
             WHERE t.kode='TJ' AND d.kode='TJ' AND t.tgltrans >= date(?1,'-31 days') AND t.tgltrans < ?1 GROUP BY t.tgltrans ORDER BY t.tgltrans"
        ),
        params![tgl],
    )?;
    let per_hari = rows(
        conn,
        "WITH w(h) AS (VALUES (0),(1),(2),(3),(4),(5),(6))
         SELECT w.h AS hari, COALESCE((SELECT SUM(t.totaltrans) FROM transaksi t WHERE t.kode='TJ' AND t.tgltrans >= date(?1,'-31 days') AND t.tgltrans < ?1
                AND CAST(strftime('%w', t.tgltrans) AS INTEGER) = w.h),0) AS total FROM w ORDER BY w.h",
        params![tgl],
    )?;
    let laba_bulan = rows(
        conn,
        &format!(
            "SELECT substr(t.tgltrans,1,7) AS bulan, SUM({laba}) AS total FROM transaksi t JOIN transaksidetil d ON d.notrans=t.notrans
             WHERE t.kode='TJ' AND d.kode='TJ' AND t.tgltrans >= date(?1,'-183 days') AND t.tgltrans < ?1 GROUP BY substr(t.tgltrans,1,7) ORDER BY substr(t.tgltrans,1,7)"
        ),
        params![tgl],
    )?;
    let pelanggan = rows(
        conn,
        "SELECT t.kodepelanggan AS kode, COALESCE(NULLIF(p.namapelanggan,''), t.kodepelanggan) AS nama, SUM(t.totaltrans) AS total
         FROM transaksi t LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         WHERE t.kode='TJ' AND COALESCE(t.kodepelanggan,'') <> '' AND upper(t.kodepelanggan) <> 'TUNAI'
           AND t.tgltrans >= date(?1,'-183 days') AND t.tgltrans <= ?1
         GROUP BY t.kodepelanggan, nama ORDER BY total DESC, nama LIMIT 5",
        params![tgl],
    )?;
    let piutang = rows(
        conn,
        "SELECT COALESCE(NULLIF(p.namapelanggan,''), h.kodepelanggan) AS nama, h.kodepelanggan AS kode, SUM(h.kekurangan) AS piutang
         FROM trkartupiutang h LEFT JOIN mdpelanggan p ON p.kodepelanggan = h.kodepelanggan
         WHERE h.status = 0 AND h.kode = 'PS' GROUP BY nama, h.kodepelanggan ORDER BY piutang DESC, nama",
        [],
    )?;
    Ok(json!({
        "rata_jual": rata_jual, "hari_jual": hari_jual, "rata_laba": rata_laba, "hari_laba": hari_laba,
        "penjualan15": penjualan15, "per_hari": per_hari, "laba30": laba30, "laba_bulan": laba_bulan,
        "pelanggan": pelanggan, "piutang": piutang,
    }))
}

#[tauri::command]
pub fn dashboard_data(db: State<Db>, tgl: String) -> Res<Value> {
    let conn = db.lock()?;
    dashboard_query(&conn, &tgl)
}

/// Pemberitahuan di jendela kecil kanan bawah: jumlah piutang penjualan (kode PS) yang belum lunas dan sudah jatuh tempo (tanggal <= hari ini).
pub fn notifikasi_query(conn: &rusqlite::Connection, tgl: &str) -> Res<Value> {
    let jml: i64 = conn
        .query_row("SELECT COUNT(*) FROM trkartupiutang WHERE status = 0 AND kode = 'PS' AND jthtempo <= ?1", params![tgl], |r| r.get(0))
        .map_err(e)?;
    Ok(json!({ "piutang_jatuh_tempo": jml }))
}

#[tauri::command]
pub fn notifikasi(db: State<Db>, tgl: String) -> Res<Value> {
    let conn = db.lock()?;
    notifikasi_query(&conn, &tgl)
}

/// Simpan hasil ekspor laporan sebagai file baru di Documents atau Downloads. Mengembalikan alamat file.
#[tauri::command]
pub fn simpan_laporan(app: tauri::AppHandle, session: State<crate::auth::Session>, path: String, isi: String) -> Res<String> {
    session.user()?;
    crate::berkas::simpan_teks(&app, &path, &isi, &["txt", "csv", "html", "htm", "rtf"])
}
