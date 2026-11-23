//! Master data: barang, satuan, kelompok, kategori, pelanggan, pemasok, karyawan.
//! Satu set perintah generik dengan daftar tabel dan kolom yang diizinkan.

use crate::auth::Session;
use crate::db::{e, one, rows, to_sql, Db, Res};
use rusqlite::{params, params_from_iter};
use serde_json::{json, Map, Value};
use perintah_macro::perintah;

pub struct Table {
    pub name: &'static str,
    /// Menu (MDMENU.namamenu) yang mengatur tabel ini.
    menu: &'static str,
    key: &'static str,
    cols: &'static [&'static str],
    search: &'static [&'static str],
    order: &'static str,
}

const BARANG_COLS: &[&str] = &[
    "kodebarang", "namabarang", "barcode", "barcode2", "jenis", "kodekelompok", "kodekategori", "kodepemasok", "kodesatuan",
    "hrgbeli", "marginpersen", "marginnilai", "hrgjual", "stokawal", "stokmin", "stokmax", "rak", "aktif",
    "satuan1", "konversi1", "hrgsatuan1", "hrgmultisatuan1", "satuan2", "konversi2", "hrgsatuan2", "hrgmultisatuan2",
    "satuan3", "konversi3", "hrgsatuan3", "hrgmultisatuan3", "satuan4", "konversi4", "hrgsatuan4", "hrgmultisatuan4",
    "satuan5", "konversi5", "hrgsatuan5", "hrgmultisatuan5",
    "hrglevel1", "hrglevel2", "hrglevel3", "hrglevel4", "hrglevel5",
    "hrgtingkat1", "minhrg1", "hrgtingkat2", "minhrg2", "hrgtingkat3", "minhrg3", "hrgtingkat4", "minhrg4", "hrgtingkat5", "minhrg5",
];

const TABLES: &[Table] = &[
    Table { name: "mdbarang", menu: "mnMDDataBarang", key: "kodebarang", cols: BARANG_COLS, search: &["kodebarang", "barcode", "namabarang"], order: "namabarang" },
    Table { name: "mdsatuan", menu: "mnMDDataSatuan", key: "kodesatuan", cols: &["kodesatuan", "namasatuan"], search: &["kodesatuan", "namasatuan"], order: "kodesatuan" },
    Table { name: "mdkelompok", menu: "mnMDDataKelompok", key: "kodekelompok", cols: &["kodekelompok", "namakelompok"], search: &["kodekelompok", "namakelompok"], order: "kodekelompok" },
    Table { name: "mdkategori", menu: "mnMDDataKategori", key: "kodekategori", cols: &["kodekategori", "kodekelompok", "namakategori"], search: &["kodekategori", "namakategori"], order: "kodekategori" },
    Table { name: "mdpelanggan", menu: "mnMDDataPelanggan", key: "kodepelanggan",
        cols: &["kodepelanggan", "namapelanggan", "alamat", "kota", "provinsi", "tlp1", "tlp2", "email", "masaaktif", "level", "poin", "limitkredit", "aktif", "idtele"],
        search: &["kodepelanggan", "namapelanggan", "tlp1", "kota"], order: "namapelanggan" },
    Table { name: "mdpemasok", menu: "mnMDDataSupplier", key: "kodepemasok",
        cols: &["kodepemasok", "namapemasok", "namakontak", "alamat", "kota", "provinsi", "tlp1", "tlp2", "fax", "email", "aktif"],
        search: &["kodepemasok", "namapemasok", "kota"], order: "namapemasok" },
    Table { name: "mdkaryawan", menu: "mnMDDataKaryawan", key: "kodekaryawan",
        cols: &["kodekaryawan", "namakaryawan", "alamat", "kota", "provinsi", "tlp1", "tlp2", "email", "jabatan", "aktif", "idtele"],
        search: &["kodekaryawan", "namakaryawan", "jabatan"], order: "namakaryawan" },
];

pub fn table(name: &str) -> Res<&'static Table> {
    TABLES.iter().find(|t| t.name == name).ok_or_else(|| format!("Tabel {name} tidak dikenal."))
}

fn q(col: &str) -> String {
    format!("\"{col}\"")
}

#[perintah]
pub fn master_list(db: &Db, table_name: String, search: Option<String>, limit: Option<i64>, offset: Option<i64>, only_active: Option<bool>,
    kelompok: Option<String>, kategori: Option<String>, sort: Option<String>, hanya_kode_nama: Option<bool>) -> Res<Value> {
    let t = table(&table_name)?;
    let conn = db.lock()?;
    let mut wh = vec!["1=1".to_string()];
    let mut ps: Vec<rusqlite::types::Value> = vec![];
    if let Some(s) = search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        // Cari Karyawan/Supplier/Pelanggan aslinya hanya mencocokkan kode dan nama.
        let kolom: Vec<&str> = if hanya_kode_nama.unwrap_or(false) { vec![t.key, t.cols[1]] } else { t.search.to_vec() };
        let like = kolom.iter().map(|c| format!("{} LIKE ?1", q(c))).collect::<Vec<_>>().join(" OR ");
        wh.push(format!("({like})"));
        ps.push(format!("%{s}%").into());
    }
    if only_active.unwrap_or(false) && t.cols.contains(&"aktif") {
        wh.push("COALESCE(aktif,1) = 1".into());
    }
    if t.name == "mdbarang" {
        for (col, val) in [("kodekelompok", &kelompok), ("kodekategori", &kategori)] {
            if let Some(v) = val.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                ps.push(v.to_string().into());
                wh.push(format!("{} = ?{}", q(col), ps.len()));
            }
        }
    }
    // Urutan hanya boleh memakai kolom yang terdaftar.
    // Boleh beberapa kolom dipisah koma (mis. "jenis,kodebarang,namabarang"); `stokakhir` dan `jenis` juga boleh untuk barang.
    let allowed = |c: &str| t.cols.contains(&c) || (t.name == "mdbarang" && (c == "stokakhir" || c == "jenis"));
    let order = match sort.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) if c.split(',').all(|x| allowed(x.trim())) => c.split(',').map(|x| q(x.trim())).collect::<Vec<_>>().join(","),
        _ => t.order.to_string(),
    };
    let where_sql = wh.join(" AND ");
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {} WHERE {where_sql}", t.name), params_from_iter(ps.iter()), |r| r.get(0))
        .map_err(e)?;
    let sql = format!(
        "SELECT * FROM {} WHERE {where_sql} ORDER BY {} LIMIT {} OFFSET {}",
        t.name, order, limit.unwrap_or(100).clamp(1, 5000), offset.unwrap_or(0).max(0)
    );
    let data = rows(&conn, &sql, params_from_iter(ps.iter()))?;
    Ok(json!({ "rows": data, "total": total }))
}

#[perintah]
pub fn master_save(db: &Db, session: &Session, table_name: String, data: Map<String, Value>, original_key: Option<String>) -> Res<()> {
    let user = session.user()?;
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengubah master data. Minta supervisor untuk mengubahnya.".into());
    }
    let t = table(&table_name)?;
    crate::auth::require_menu(&*db.lock()?, &user, t.menu)?;
    let mut conn = db.lock()?;
    simpan_master(&mut conn, t, &data, original_key.as_deref())
}

/// Isi `master_save` tanpa pemeriksaan hak akses (dipakai juga oleh uji).
pub fn simpan_master(conn: &mut rusqlite::Connection, t: &Table, data: &Map<String, Value>, original_key: Option<&str>) -> Res<()> {
    let key_val = data.get(t.key).and_then(Value::as_str).map(str::trim).unwrap_or("");
    if key_val.is_empty() {
        return Err("Kode belum diisi.".into());
    }
    let cols: Vec<&str> = t.cols.iter().copied().filter(|c| data.contains_key(*c)).collect();
    let vals: Vec<_> = cols.iter().map(|c| match &data[*c] {
        Value::String(s) => rusqlite::types::Value::Text(s.trim().to_string()),
        v => to_sql(v),
    }).collect();
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    match original_key {
        None => {
            if t.name == "mdbarang" && kode_dipakai(&tx, key_val, None)? {
                return Err(KODE_KEMBAR.into());
            }
            let ph = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(",");
            let names = cols.iter().map(|c| q(c)).collect::<Vec<_>>().join(",");
            tx.execute(&format!("INSERT INTO {} ({names}) VALUES ({ph})", t.name), params_from_iter(vals)).map_err(e)?;
            if t.name == "mdbarang" {
                tx.execute(
                    "UPDATE mdbarang SET jenis = COALESCE(NULLIF(jenis,''),'Barang'), stokakhir = stokawal + stokmasuk - stokkeluar + stokopname,
                     tglupload = date('now','localtime'), jamupload = time('now','localtime') WHERE kodebarang = ?1",
                    params![key_val],
                ).map_err(e)?;
            }
        }
        Some(orig) => {
            // Barang: kode boleh diganti seperti aslinya (`update mdbarang set ... kodebarang=? ... where bid=?`); stok awal tidak.
            // Aslinya referensi di transaksi tidak ikut diubah; di sini ikut diubah supaya riwayat tetap menunjuk ke barang yang sama.
            let ganti_kode = t.name == "mdbarang" && key_val != orig;
            if ganti_kode && kode_dipakai(&tx, key_val, Some(orig))? {
                return Err(KODE_KEMBAR.into());
            }
            let cols: Vec<&str> = cols.into_iter().filter(|c| *c != "stokawal" && (*c != t.key || t.name == "mdbarang")).collect();
            let vals: Vec<_> = cols.iter().map(|c| match &data[*c] {
                Value::String(s) => rusqlite::types::Value::Text(s.trim().to_string()),
                v => to_sql(v),
            }).collect();
            let set = cols.iter().enumerate().map(|(i, c)| format!("{} = ?{}", q(c), i + 1)).collect::<Vec<_>>().join(", ");
            let n = cols.len() + 1;
            let mut all = vals;
            all.push(orig.to_string().into());
            let changed = tx
                .execute(&format!("UPDATE {} SET {set} WHERE {} = ?{n}", t.name, t.key), params_from_iter(all))
                .map_err(e)?;
            if changed == 0 {
                return Err("Data ini sudah tidak ada. Silakan muat ulang daftar.".into());
            }
            if t.name == "mdbarang" {
                if ganti_kode {
                    pindah_referensi_barang(&tx, orig, key_val)?;
                }
                tx.execute("UPDATE mdbarang SET tglupdate = date('now','localtime'), jamupdate = time('now','localtime') WHERE kodebarang = ?1", params![key_val])
                    .map_err(e)?;
            }
        }
    }
    tx.commit().map_err(e)
}

#[perintah]
pub fn master_delete(db: &Db, session: &Session, table_name: String, key: String) -> Res<()> {
    let user = session.user()?;
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa menghapus master data.".into());
    }
    let t = table(&table_name)?;
    let conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, t.menu)?;
    if t.name == "mdbarang" {
        return hapus_barang(&conn, &key);
    }
    // Seperti aslinya: hapus tidak memeriksa pemakaian (skema asli tanpa foreign key).
    conn.execute(&format!("DELETE FROM {} WHERE UPPER({}) = UPPER(?1)", t.name, t.key), params![key.trim()]).map_err(e)?;
    Ok(())
}

const KODE_KEMBAR: &str = "Kode barang sudah digunakan pada item barang lain, gunakan kode yang lain.";

/// Apakah kode sudah dipakai barang lain (huruf besar/kecil dianggap sama). `kecuali` = kode barang yang sedang diubah.
fn kode_dipakai(conn: &rusqlite::Connection, kode: &str, kecuali: Option<&str>) -> Res<bool> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mdbarang WHERE UPPER(kodebarang) = UPPER(?1) AND (?2 IS NULL OR UPPER(kodebarang) <> UPPER(?2))",
            params![kode, kecuali],
            |r| r.get(0),
        )
        .map_err(e)?;
    Ok(n > 0)
}

/// Kode barang diganti: semua tabel yang menyimpan kode itu ikut diubah.
fn pindah_referensi_barang(conn: &rusqlite::Connection, lama: &str, baru: &str) -> Res<()> {
    for (tbl, col) in [
        ("transaksidetil", "kodebarang"), ("pendingjualdetil", "kodebarang"), ("mdbarangbarcode", "kodebarang"),
        ("mdbarangbonus", "kodebarang"), ("mdbarangbonus", "kodebonus"), ("mdbarangdiskon", "kodebarang"), ("mdbarangpdp", "kodebarang"),
    ] {
        conn.execute(&format!("UPDATE {tbl} SET {col} = ?1 WHERE {col} = ?2"), params![baru, lama]).map_err(e)?;
    }
    Ok(())
}

/// Hapus barang seperti aslinya: langsung `delete from mdbarang where upper(kodebarang)=...` tanpa memeriksa pemakaian,
/// lalu satu baris dicatat ke `del<yymmddhh>.txt` di folder yang sama dengan file database.
pub fn hapus_barang(conn: &rusqlite::Connection, kode: &str) -> Res<()> {
    let kode: String = conn
        .query_row("SELECT kodebarang FROM mdbarang WHERE UPPER(kodebarang) = UPPER(?1)", params![kode.trim()], |r| r.get(0))
        .unwrap_or_else(|_| kode.trim().to_string());
    let n = conn.execute("DELETE FROM mdbarang WHERE UPPER(kodebarang) = UPPER(?1)", params![kode]).map_err(e)?;
    if n == 0 {
        return Err("Data ini sudah tidak ada. Silakan muat ulang daftar.".into());
    }
    if let Some(folder) = conn.path().filter(|p| !p.is_empty()).and_then(|p| std::path::Path::new(p).parent().map(|x| x.to_path_buf())) {
        let now = chrono::Local::now();
        let file = folder.join(format!("del{}.txt", now.format("%y%m%d%H")));
        let baris = format!("{};MDBARANG;KODEBARANG;{}\r\n", now.format("%Y-%m-%d %H:%M:%S"), kode);
        // Catatan penghapusan hanya pelengkap; gagal menulis tidak membatalkan penghapusan.
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
            use std::io::Write;
            let _ = f.write_all(baris.as_bytes());
        }
    }
    Ok(())
}

// ---- Pencarian barang untuk kasir dan pembelian ----

/// Pelanggan yang punya piutang jatuh tempo (tombol Jatuh Tempo di Cari Pelanggan): piutang penjualan (kode PS) yang belum lunas
/// dan jatuh temponya sampai hari ini; `search` mencocokkan kode atau nama.
pub fn pelanggan_jatuh_tempo_daftar(conn: &rusqlite::Connection, search: &str) -> Res<Vec<Value>> {
    let pola = format!("%{}%", search.trim().to_uppercase());
    rows(
        conn,
        "SELECT t.kodepelanggan AS kodepelanggan, p.namapelanggan AS namapelanggan, p.alamat AS alamat, p.level AS level, p.limitkredit AS limitkredit, p.poin AS poin
         FROM trkartupiutang t LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         WHERE t.kode = 'PS' AND t.status = 0 AND t.jthtempo <= date('now','localtime')
           AND (UPPER(t.kodepelanggan) LIKE ?1 OR UPPER(p.namapelanggan) LIKE ?1)
         GROUP BY t.kodepelanggan, p.namapelanggan, p.alamat, p.level, p.limitkredit, p.poin
         ORDER BY t.kodepelanggan",
        [pola],
    )
}

#[perintah]
pub fn pelanggan_jatuh_tempo(db: &Db, session: &Session, search: String) -> Res<Vec<Value>> {
    session.user()?;
    pelanggan_jatuh_tempo_daftar(&*db.lock()?, &search)
}

#[perintah]
pub fn barang_find(db: &Db, code: String) -> Res<Option<Value>> {
    let conn = db.lock()?;
    one(
        &conn,
        "SELECT * FROM mdbarang WHERE COALESCE(aktif,1) = 1 AND (UPPER(kodebarang) = UPPER(?1) OR barcode = ?1 OR barcode2 = ?1) LIMIT 1",
        params![code.trim()],
    )
}

#[perintah]
pub fn barang_search(db: &Db, search: String, limit: Option<i64>, stok_min: Option<bool>) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    cari_barang_opsi(&conn, &search, limit.unwrap_or(50), stok_min.unwrap_or(false))
}

/// Daftar Cari Barang seperti aslinya: frasa dicocokkan ke kode atau nama, barang nonaktif ikut tampil, urut kode.
pub fn cari_barang_daftar(conn: &rusqlite::Connection, search: &str, limit: i64) -> Res<Vec<Value>> {
    cari_barang_opsi(conn, search, limit, false)
}

/// Sama seperti `cari_barang_daftar`; `stok_min` menambah syarat `stokakhir<=stokmin` (mode stok minimum Cari Barang).
pub fn cari_barang_opsi(conn: &rusqlite::Connection, search: &str, limit: i64, stok_min: bool) -> Res<Vec<Value>> {
    let pola = format!("%{}%", search.trim().to_uppercase());
    let sql = format!(
        "SELECT * FROM mdbarang WHERE kodebarang<>'' {} AND (UPPER(kodebarang) LIKE ?1 OR UPPER(namabarang) LIKE ?1) ORDER BY kodebarang LIMIT {}",
        if stok_min { "AND stokakhir <= stokmin" } else { "" },
        limit.clamp(1, 500)
    );
    rows(conn, &sql, [pola])
}

#[perintah]
pub fn jenis_nontunai(db: &Db) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    rows(&conn, "SELECT j.kode, j.namajenis, i.namaitem FROM mdjenisnontunai j LEFT JOIN mdjenisnontunaiitem i ON i.kode = j.kode ORDER BY j.kode, i.namaitem", [])
}
