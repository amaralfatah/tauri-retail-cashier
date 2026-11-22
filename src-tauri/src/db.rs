use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, Params};
use serde_json::{Map, Number, Value};
use std::path::Path;
use std::sync::Mutex;

pub type Res<T> = Result<T, String>;

pub fn e<E: std::fmt::Display>(err: E) -> String {
    let msg = err.to_string();
    if msg.contains("UNIQUE constraint failed") {
        return "Kode ini sudah dipakai. Silakan pakai kode lain.".into();
    }
    msg
}

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn lock(&self) -> Res<std::sync::MutexGuard<'_, Connection>> {
        self.0.lock().map_err(|_| "Database sedang dipakai proses lain yang gagal. Silakan tutup lalu buka lagi aplikasinya.".to_string())
    }
}

const SCHEMA: &str = include_str!("schema.sql");

pub fn open(path: &Path) -> Res<Connection> {
    let conn = Connection::open(path).map_err(e)?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(e)?;
    conn.execute_batch(SCHEMA).map_err(e)?;
    seed(&conn)?;
    let mut conn = conn;
    crate::order::migrasi_pending(&mut conn)?;
    Ok(conn)
}

fn count(conn: &Connection, table: &str) -> Res<i64> {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).map_err(e)
}

/// Data awal untuk database baru (tanpa impor).
fn seed(conn: &Connection) -> Res<()> {
    if count(conn, "tseting")? == 0 {
        conn.execute(
            "INSERT INTO tseting (namausaha, alamat, kota, footer1, footer2, aktiflevel, aktifsatuan, ppn, aktifppn, versionapp)
             VALUES ('Toko Saya', '', '', 'Barang yang sudah dibeli tidak dapat ditukar.', 'Terima kasih, selamat datang kembali.', 1, 1, 11, 0, '2.0.0')",
            [],
        ).map_err(e)?;
    }
    if count(conn, "mduser")? == 0 {
        // Password NULL: user masuk dengan "admin" lalu diminta membuat password baru.
        conn.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('admin', NULL, '-', 'Manager', 1)", []).map_err(e)?;
    }
    if count(conn, "mdsatuan")? == 0 {
        conn.execute_batch("INSERT INTO mdsatuan VALUES ('PCS','Pieces'),('BOX','Box'),('PAK','Pak'),('KG','Kilogram');").map_err(e)?;
    }
    if count(conn, "mdjenisnontunai")? == 0 {
        conn.execute_batch(
            "INSERT INTO mdjenisnontunai VALUES ('01','Kartu Debit'),('02','Kartu Kredit'),('03','E-Money'),('04','E-Wallet');
             INSERT INTO mdjenisnontunaiitem VALUES ('01','BCA'),('01','BRI'),('01','Mandiri'),('02','BCA'),('04','QRIS');",
        ).map_err(e)?;
    }
    Ok(())
}

pub fn to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

pub fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// Jalankan SELECT dan kembalikan tiap baris sebagai objek JSON.
pub fn rows<P: Params>(conn: &Connection, sql: &str, params: P) -> Res<Vec<Value>> {
    let mut stmt = conn.prepare(sql).map_err(e)?;
    let names: Vec<String> = stmt.column_names().map(|s| s.to_lowercase()).collect();
    let mut q = stmt.query(params).map_err(e)?;
    let mut out = Vec::new();
    while let Some(row) = q.next().map_err(e)? {
        let mut obj = Map::new();
        for (i, n) in names.iter().enumerate() {
            obj.insert(n.clone(), to_json(row.get_ref(i).map_err(e)?));
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

pub fn one<P: Params>(conn: &Connection, sql: &str, params: P) -> Res<Option<Value>> {
    Ok(rows(conn, sql, params)?.into_iter().next())
}

pub fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}
