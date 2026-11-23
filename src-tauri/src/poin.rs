//! Poin member: perolehan dari penjualan, penukaran, dan koreksi.
//! Saldo ada di MDPELANGGAN.POIN; setiap perubahan dicatat di TRANSAKSIPOIN (nomor P + yymm + "-" + 5 digit).

use crate::auth::{Session, User};
use crate::db::{e, one, rows, Db, Res};
use crate::trans::{check_date, next_number};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use perintah_macro::perintah;

/// Pengaturan poin dari tabel TSETING.
#[allow(dead_code)]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PoinSetting {
    /// AKTIFPOIN: poin member dipakai.
    pub aktif: bool,
    /// MINTRANSPOIN: belanja minimal untuk mendapat poin. 0 berarti tanpa minimal.
    pub min_transaksi: f64,
    /// JMLPOINTRANS: poin yang didapat.
    pub jml_poin: f64,
    /// BERLAKUKELIPATANPOIN: belanja kelipatan minimal mendapat poin kelipatan juga.
    pub kelipatan: bool,
}

#[allow(dead_code)]
impl PoinSetting {
    pub fn dari_db(conn: &Connection) -> PoinSetting {
        conn.query_row(
            "SELECT COALESCE(aktifpoin,0), COALESCE(mintranspoin,0), COALESCE(jmlpointrans,0), COALESCE(berlakukelipatanpoin,0) FROM tseting LIMIT 1",
            [],
            |r| {
                Ok(PoinSetting {
                    aktif: r.get::<_, i64>(0)? == 1,
                    min_transaksi: r.get(1)?,
                    jml_poin: r.get::<_, f64>(2)?,
                    kelipatan: r.get::<_, i64>(3)? != 0,
                })
            },
        )
        .unwrap_or_default()
    }
}

/// Poin yang didapat dari satu transaksi penjualan dengan total belanja `total` (pelanggan bukan Tunai).
/// Aturan aplikasi lama:
/// - Poin tidak aktif, minimal belanja 0, atau total belanja tidak lebih besar dari minimal: tidak dapat poin.
/// - Kelipatan berlaku: (pembulatan total \ pembulatan minimal) x jumlah poin, pembagian bilangan bulat.
/// - Selain itu: jumlah poin diberikan satu kali.
#[allow(dead_code)]
pub fn poin_dari_transaksi(setting: &PoinSetting, total: f64) -> f64 {
    if !setting.aktif || setting.min_transaksi <= 0.0 || total <= setting.min_transaksi {
        return 0.0;
    }
    if setting.kelipatan {
        let min = (setting.min_transaksi.round_ties_even() as i64).max(1);
        let kali = (total.round_ties_even() as i64) / min;
        return kali as f64 * setting.jml_poin;
    }
    setting.jml_poin
}

fn hari_ini() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn cari_pelanggan(conn: &Connection, kode: &str) -> Res<Value> {
    one(
        conn,
        "SELECT kodepelanggan, namapelanggan, COALESCE(poin,0) AS poin FROM mdpelanggan WHERE UPPER(kodepelanggan) = UPPER(?1)",
        params![kode.trim()],
    )?
    .ok_or_else(|| "Pelanggan dengan kode ini tidak ditemukan.".to_string())
}

/// Tambah atau kurangi poin dan catat riwayatnya. Dipakai penukaran, koreksi, dan (nanti) penjualan.
pub fn catat_poin(conn: &Connection, kodekaryawan: &str, kodepelanggan: &str, tgl: &str, masuk: i64, keluar: i64, ket: &str, ref_trans: &str) -> Res<String> {
    check_date(tgl)?;
    let awal: i64 = conn
        .query_row("SELECT COALESCE(poin,0) FROM mdpelanggan WHERE kodepelanggan = ?1", params![kodepelanggan], |r| r.get(0))
        .map_err(|_| "Pelanggan dengan kode ini tidak ditemukan.".to_string())?;
    let baru = awal + masuk - keluar;
    if baru < 0 {
        return Err("Jumlah penukaran melebihi sisa poin yang bisa ditukarkan.".into());
    }
    let notukar = next_number(conn, "transaksipoin", "notukar", "P", tgl)?;
    conn.execute("UPDATE mdpelanggan SET poin = ?1 WHERE kodepelanggan = ?2", params![baru, kodepelanggan]).map_err(e)?;
    conn.execute(
        "INSERT INTO transaksipoin (notukar,tgltukar,kodekaryawan,kodepelanggan,poinawal,poinmasuk,poinkeluar,ket1,reftukar) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![notukar, tgl, kodekaryawan, kodepelanggan, awal, masuk, keluar, ket, ref_trans],
    ).map_err(e)?;
    Ok(notukar)
}

#[perintah]
pub fn poin_member(db: &Db, session: &Session, kode: String) -> Res<Value> {
    session.user()?;
    cari_pelanggan(&*db.lock()?, &kode)
}

#[perintah]
pub fn poin_histori(db: &Db, session: &Session, kode: String, jumlah: Option<i64>) -> Res<Vec<Value>> {
    session.user()?;
    histori(&*db.lock()?, &kode, jumlah.unwrap_or(20))
}

pub fn histori(conn: &Connection, kode: &str, jumlah: i64) -> Res<Vec<Value>> {
    rows(
        conn,
        "SELECT p.notukar, p.tgltukar, COALESCE(k.namakaryawan, p.kodekaryawan) AS namakaryawan, p.poinawal, p.poinmasuk, p.poinkeluar,
                (p.poinawal + p.poinmasuk - p.poinkeluar) AS sisapoin, p.ket1
         FROM transaksipoin p LEFT JOIN mdkaryawan k ON k.kodekaryawan = p.kodekaryawan
         WHERE UPPER(p.kodepelanggan) = UPPER(?1)
         ORDER BY p.notukar DESC LIMIT ?2",
        params![kode.trim(), jumlah.clamp(1, 1000)],
    )
}

#[perintah]
pub fn poin_tukar(db: &Db, session: &Session, kode: String, jumlah: f64, catatan: String) -> Res<Value> {
    let user = session.user()?;
    tukar(&mut *db.lock()?, &user, &kode, jumlah, &catatan)
}

pub fn tukar(conn: &mut Connection, user: &User, kode: &str, jumlah: f64, catatan: &str) -> Res<Value> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let p = cari_pelanggan(&tx, kode)?;
    let kodepel = p["kodepelanggan"].as_str().unwrap_or_default().to_string();
    let poin = p["poin"].as_i64().unwrap_or(0);
    if jumlah.fract() != 0.0 || jumlah <= 0.0 {
        return Err("Isi jumlah poin yang akan ditukar dengan bilangan bulat lebih dari 0.".into());
    }
    let jumlah = jumlah as i64;
    if jumlah > poin {
        return Err("Jumlah penukaran melebihi sisa poin yang bisa ditukarkan.".into());
    }
    let ket = if catatan.trim().is_empty() { "Penukaran poin" } else { catatan.trim() };
    let notukar = catat_poin(&tx, &user.kodekaryawan, &kodepel, &hari_ini(), 0, jumlah, ket, "")?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notukar": notukar, "poin": poin - jumlah }))
}

#[perintah]
pub fn poin_koreksi(db: &Db, session: &Session, kode: String, poin_baru: f64) -> Res<Value> {
    let user = session.user()?;
    koreksi(&mut *db.lock()?, &user, &kode, poin_baru)
}

pub fn koreksi(conn: &mut Connection, user: &User, kode: &str, poin_baru: f64) -> Res<Value> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengoreksi poin. Silakan minta supervisor atau pemilik.".into());
    }
    if poin_baru.fract() != 0.0 || poin_baru < 0.0 {
        return Err("Isi poin yang benar dengan bilangan bulat, 0 atau lebih.".into());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let p = cari_pelanggan(&tx, kode)?;
    let kodepel = p["kodepelanggan"].as_str().unwrap_or_default().to_string();
    let lama = p["poin"].as_i64().unwrap_or(0);
    let baru = poin_baru as i64;
    if baru == lama {
        return Err("Poin yang diisi sama dengan poin saat ini, jadi tidak ada yang perlu dikoreksi.".into());
    }
    let (masuk, keluar) = if baru > lama { (baru - lama, 0) } else { (0, lama - baru) };
    let notukar = catat_poin(&tx, &user.kodekaryawan, &kodepel, &hari_ini(), masuk, keluar, "Koreksi Poin Member", "")?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notukar": notukar, "poin": baru }))
}
