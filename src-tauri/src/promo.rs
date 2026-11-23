//! Promo penjualan: barang diskon (MDBARANGDISKON), barang bonus (MDBARANGBONUS),
//! dan diskon PDP (MDBARANGPDP). Modul ini berisi isian data promo dan fungsi murni
//! `promo_untuk` / `pdp_untuk` yang kelak dipakai kasir.
//!
//! Aturan dari query aplikasi lama:
//! - diskon: `select hrgdiskon from MDBARANGDISKON where kodebarang=? and tglawal<=hariini and tglakhir>=hariini`
//! - bonus: `select kodebonus,minbeli,jmlbonus,... from mdbarangbonus bn left join mdbarang b on b.kodebarang=bn.kodebonus where bn.kodebarang=?`
//! - semua promo hanya berlaku kalau pengaturan "Aktifkan Promo Penjualan" (tseting.aktifpromo) menyala.

use crate::auth::{Session, User};
use crate::db::{e, round2, rows, Db, Res};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use perintah_macro::perintah;

/// Hasil pencarian promo untuk satu barang.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct PromoResult {
    /// Harga jual normal barang (per satuan dasar).
    pub hrgnormal: f64,
    /// Harga setelah diskon (per satuan dasar); kosong kalau barang tidak sedang didiskon.
    pub hrgdiskon: Option<f64>,
    /// Potongan per satuan dasar (hrgnormal - hrgdiskon), 0 kalau tidak ada diskon.
    pub potongan: f64,
    pub bonus: Vec<BonusItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BonusItem {
    pub kodebonus: String,
    pub namabonus: String,
    pub kodesatuan: String,
    pub hrgbeli: f64,
    pub hrgjual: f64,
    pub minbeli: f64,
    /// Bonus untuk satu kelipatan pembelian.
    pub jmlbonus: f64,
    /// Total bonus untuk jumlah beli yang diminta (kelipatan x jmlbonus).
    pub jml: f64,
}

/// Diskon PDP: potongan harga kalau total belanja satu transaksi mencapai batas minimal.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PdpResult {
    pub minbelanja: f64,
    pub diskon: f64,
    pub hrgdiskon: f64,
    pub hrgnormal: f64,
}

pub fn promo_aktif(conn: &Connection) -> Res<bool> {
    let v: Option<i64> = conn
        .query_row("SELECT COALESCE(aktifpromo,0) FROM tseting LIMIT 1", [], |r| r.get(0))
        .ok();
    Ok(v.unwrap_or(0) != 0)
}

const BERLAKU: &str = "(tglawal IS NULL OR tglawal = '' OR tglawal <= ?2) AND (tglakhir IS NULL OR tglakhir = '' OR tglakhir >= ?2)";

fn hrgjual(conn: &Connection, kodebarang: &str) -> f64 {
    conn.query_row("SELECT COALESCE(hrgjual,0) FROM mdbarang WHERE kodebarang = ?1", params![kodebarang], |r| r.get(0)).unwrap_or(0.0)
}

fn diskon_aktif(conn: &Connection, kodebarang: &str, tgl: &str) -> Res<Option<f64>> {
    let sql = format!("SELECT hrgdiskon FROM mdbarangdiskon WHERE kodebarang = ?1 AND {BERLAKU} ORDER BY bid LIMIT 1");
    match conn.query_row(&sql, params![kodebarang, tgl], |r| r.get::<_, Option<f64>>(0)) {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(e(err)),
    }
}

/// Promo yang berlaku untuk `kodebarang` pada tanggal `tgl` (YYYY-MM-DD) kalau pembeli mengambil `jml`.
/// `kodepelanggan` belum menentukan apa pun: aturan lama tidak membedakan pelanggan.
pub fn promo_untuk(conn: &Connection, kodebarang: &str, _kodepelanggan: &str, tgl: &str, jml: f64) -> Res<PromoResult> {
    let normal = hrgjual(conn, kodebarang);
    let mut out = PromoResult { hrgnormal: normal, ..Default::default() };
    if !promo_aktif(conn)? {
        return Ok(out);
    }
    if let Some(h) = diskon_aktif(conn, kodebarang, tgl)? {
        if h > 0.0 && h < normal {
            out.hrgdiskon = Some(h);
            out.potongan = round2(normal - h);
        }
    }
    let sql = format!(
        "SELECT bn.kodebonus, COALESCE(b.namabarang, bn.kodebonus), COALESCE(b.kodesatuan,''), COALESCE(b.hrgbeli,0), COALESCE(b.hrgjual,0),
                COALESCE(bn.minbeli,1), COALESCE(bn.jmlbonus,0)
         FROM mdbarangbonus bn LEFT JOIN mdbarang b ON b.kodebarang = bn.kodebonus
         WHERE bn.kodebarang = ?1 AND {} ORDER BY bn.bid",
        BERLAKU.replace("tglawal", "bn.tglawal").replace("tglakhir", "bn.tglakhir")
    );
    let mut stmt = conn.prepare(&sql).map_err(e)?;
    let list = stmt
        .query_map(params![kodebarang, tgl], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?, r.get::<_, f64>(5)?, r.get::<_, f64>(6)?))
        })
        .map_err(e)?;
    for it in list {
        let (kodebonus, namabonus, kodesatuan, hrgbeli, hrgjual, minbeli, jmlbonus) = it.map_err(e)?;
        if jmlbonus <= 0.0 {
            continue;
        }
        // Beli sekian gratis sekian: (pembulatan jumlah \ pembulatan minimal beli) x jumlah bonus, pembagian bilangan bulat.
        let min = minbeli.round_ties_even() as i64;
        if min < 1 {
            continue;
        }
        let kali = (jml.round_ties_even() as i64) / min;
        if kali < 1 {
            continue;
        }
        out.bonus.push(BonusItem { kodebonus, namabonus, kodesatuan, hrgbeli, hrgjual, minbeli, jmlbonus, jml: round2(kali as f64 * jmlbonus) });
    }
    Ok(out)
}

/// Diskon PDP untuk `kodebarang` kalau total belanja transaksi (`total`) mencapai batas minimalnya.
/// Kalau ada beberapa aturan yang terpenuhi, dipakai yang batas minimalnya paling tinggi.
pub fn pdp_untuk(conn: &Connection, kodebarang: &str, tgl: &str, total: f64) -> Res<Option<PdpResult>> {
    if !promo_aktif(conn)? {
        return Ok(None);
    }
    let sql = format!(
        "SELECT COALESCE(minbelanja,0), COALESCE(diskon,0), COALESCE(hrgdiskon,0) FROM mdbarangpdp
         WHERE kodebarang = ?1 AND {BERLAKU} AND COALESCE(minbelanja,0) <= ?3 ORDER BY minbelanja DESC, bid LIMIT 1"
    );
    match conn.query_row(&sql, params![kodebarang, tgl, total], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?))) {
        Ok((minbelanja, diskon, hrgdiskon)) => {
            let hrgnormal = hrgjual(conn, kodebarang);
            Ok(Some(PdpResult { minbelanja, diskon, hrgdiskon, hrgnormal }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(e(err)),
    }
}

fn tgl_pendek(iso: &str) -> String {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d").map(|d| d.format("%d/%m/%y").to_string()).unwrap_or_default()
}

fn berlaku(awal: &str, akhir: &str) -> String {
    format!("Berlaku : {} - {}", tgl_pendek(awal), tgl_pendek(akhir))
}

/// Harga promo dan keterangannya untuk label (FrmCetakBarcode.cCetak_Click): (hrgpromo, ketpromo).
/// Seperti aslinya: tidak melihat `aktifpromo` dan tidak membandingkan dengan harga jual. Kalau ada diskon yang berlaku hari ini,
/// harga promo = `hrgdiskon` dan keterangannya "Berlaku : dd/mm/yy - dd/mm/yy" (bonus tidak dilihat lagi). Kalau tidak ada diskon
/// tetapi ada bonus yang berlaku, harga promo 0 dan keterangannya "Beli <minbeli> gratis <jmlbonus> <nama bonus>", baris baru, " Berlaku : ...".
pub fn label_promo(conn: &Connection, kodebarang: &str, tgl: &str) -> Res<(f64, String)> {
    let sql = "SELECT COALESCE(hrgdiskon,0), COALESCE(tglawal,''), COALESCE(tglakhir,'') FROM mdbarangdiskon
               WHERE UPPER(kodebarang) = UPPER(?1) AND tglawal <= ?2 AND tglakhir >= ?2 ORDER BY bid LIMIT 1";
    if let Ok((h, a, b)) = conn.query_row(sql, params![kodebarang, tgl], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))) {
        return Ok((h, berlaku(&a, &b)));
    }
    let sql = "SELECT COALESCE(bn.minbeli,0), COALESCE(bn.jmlbonus,0), COALESCE(md.namabarang,''), COALESCE(bn.tglawal,''), COALESCE(bn.tglakhir,'')
               FROM mdbarangbonus bn LEFT JOIN mdbarang md ON md.kodebarang = bn.kodebonus
               WHERE UPPER(bn.kodebarang) = UPPER(?1) AND bn.tglawal <= ?2 AND bn.tglakhir >= ?2 ORDER BY bn.bid LIMIT 1";
    if let Ok((min, jml, nama, a, b)) = conn.query_row(sql, params![kodebarang, tgl], |r| {
        Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
    }) {
        let fmt = |x: f64| if x.fract() == 0.0 { format!("{}", x as i64) } else { format!("{x}") };
        return Ok((0.0, format!("Beli {} gratis {} {}\r\n {}", fmt(min), fmt(jml), nama, berlaku(&a, &b))));
    }
    Ok((0.0, String::new()))
}

/* ------------------------------------------------------------------ */
/* Isian data promo                                                    */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Jenis {
    Diskon,
    Bonus,
    Pdp,
}

impl Jenis {
    pub fn parse(s: &str) -> Res<Jenis> {
        match s {
            "diskon" => Ok(Jenis::Diskon),
            "bonus" => Ok(Jenis::Bonus),
            "pdp" => Ok(Jenis::Pdp),
            _ => Err("Jenis promo tidak dikenal.".into()),
        }
    }
    fn table(self) -> &'static str {
        match self {
            Jenis::Diskon => "mdbarangdiskon",
            Jenis::Bonus => "mdbarangbonus",
            Jenis::Pdp => "mdbarangpdp",
        }
    }
}

/// Satu baris isian promo. Kolom yang tidak dipakai jenisnya diabaikan.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct PromoRow {
    pub bid: Option<i64>,
    pub kodebarang: String,
    pub minbeli: f64,
    pub kodebonus: String,
    pub jmlbonus: f64,
    pub minbelanja: f64,
    pub diskon: f64,
    pub hrgdiskon: f64,
    pub tglawal: String,
    pub tglakhir: String,
}

/// Daftar isian promo. Untuk PDP, `dari` dan `sampai` (YYYY-MM-DD) menyaring kolom `tglakhir`, seperti `tampilData` di aslinya;
/// kalau salah satunya kosong, daftar tidak disaring. Diskon dan bonus selalu tampil semua.
pub fn list(conn: &Connection, jenis: Jenis, dari: &str, sampai: &str) -> Res<Vec<Value>> {
    let sql = match jenis {
        Jenis::Diskon => {
            "SELECT p.bid, p.kodebarang, COALESCE(b.namabarang, p.namabarang) AS namabarang, COALESCE(b.hrgjual, p.hrgnormal) AS hrgnormal, p.diskon, p.hrgdiskon, p.tglawal, p.tglakhir
             FROM mdbarangdiskon p LEFT JOIN mdbarang b ON b.kodebarang = p.kodebarang ORDER BY p.bid"
        }
        Jenis::Bonus => {
            "SELECT p.bid, p.kodebarang, COALESCE(b.namabarang, p.namabarang) AS namabarang, p.minbeli, p.kodebonus, n.namabarang AS namabonus, p.jmlbonus, p.tglawal, p.tglakhir
             FROM mdbarangbonus p LEFT JOIN mdbarang b ON b.kodebarang = p.kodebarang LEFT JOIN mdbarang n ON n.kodebarang = p.kodebonus ORDER BY p.bid"
        }
        Jenis::Pdp => {
            "SELECT p.bid, p.minbelanja, p.kodebarang, COALESCE(b.namabarang, p.namabarang) AS namabarang, COALESCE(b.hrgjual, p.hrgnormal) AS hrgnormal, p.diskon, p.hrgdiskon, p.tglawal, p.tglakhir
             FROM mdbarangpdp p LEFT JOIN mdbarang b ON b.kodebarang = p.kodebarang
             WHERE (?1 = '' OR ?2 = '' OR (p.tglakhir >= ?1 AND p.tglakhir <= ?2)) ORDER BY p.bid"
        }
    };
    if jenis == Jenis::Pdp {
        return rows(conn, sql, params![dari, sampai]);
    }
    rows(conn, sql, [])
}

fn cek_tgl(s: &str, nama: &str) -> Res<()> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map(|_| ()).map_err(|_| format!("{nama} belum diisi atau formatnya salah. Tulis dengan format DD/MM/YYYY."))
}

fn barang(conn: &Connection, kode: &str) -> Res<(String, f64)> {
    conn.query_row("SELECT COALESCE(namabarang,''), COALESCE(hrgjual,0) FROM mdbarang WHERE kodebarang = ?1", params![kode], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| format!("Barang {kode} tidak ditemukan."))
}

/// Simpan semua baris isian sekaligus (tambah baru kalau `bid` kosong, selain itu ubah). Semua atau tidak sama sekali.
pub fn save(conn: &mut Connection, user: &User, jenis: Jenis, data: &[PromoRow]) -> Res<usize> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mengubah data promo.".into());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    for (i, r) in data.iter().enumerate() {
        let baris = format!("Baris {}: ", i + 1);
        let kode = r.kodebarang.trim();
        if kode.is_empty() {
            return Err(format!("{baris}kode barang belum diisi."));
        }
        let (nama, jual) = barang(&tx, kode).map_err(|m| format!("{baris}{m}"))?;
        cek_tgl(&r.tglawal, "Tanggal mulai").map_err(|m| format!("{baris}{m}"))?;
        cek_tgl(&r.tglakhir, "Tanggal berakhir").map_err(|m| format!("{baris}{m}"))?;
        if r.tglakhir < r.tglawal {
            return Err(format!("{baris}tanggal berakhir tidak boleh sebelum tanggal mulai."));
        }
        match jenis {
            Jenis::Bonus => {
                let bonus = r.kodebonus.trim();
                if bonus.is_empty() {
                    return Err(format!("{baris}barang bonus belum diisi."));
                }
                barang(&tx, bonus).map_err(|m| format!("{baris}{m}"))?;
                if r.minbeli <= 0.0 {
                    return Err(format!("{baris}jumlah minimal beli harus lebih dari 0."));
                }
                if r.jmlbonus <= 0.0 {
                    return Err(format!("{baris}jumlah bonus harus lebih dari 0."));
                }
                match r.bid {
                    Some(bid) => tx.execute(
                        "UPDATE mdbarangbonus SET kodebarang=?1, namabarang=?2, minbeli=?3, kodebonus=?4, jmlbonus=?5, tglawal=?6, tglakhir=?7 WHERE bid=?8",
                        params![kode, nama, r.minbeli, bonus, r.jmlbonus, r.tglawal, r.tglakhir, bid],
                    ),
                    None => tx.execute(
                        "INSERT INTO mdbarangbonus (kodebarang,namabarang,minbeli,kodebonus,jmlbonus,tglawal,tglakhir) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![kode, nama, r.minbeli, bonus, r.jmlbonus, r.tglawal, r.tglakhir],
                    ),
                }
                .map_err(e)?;
            }
            Jenis::Diskon | Jenis::Pdp => {
                // Boleh isi persen diskon atau harga setelah diskon; yang satunya dihitung.
                let (diskon, harga) = if r.hrgdiskon > 0.0 {
                    (if jual > 0.0 { round2((1.0 - r.hrgdiskon / jual) * 100.0) } else { 0.0 }, r.hrgdiskon)
                } else if r.diskon > 0.0 {
                    (r.diskon, round2(jual * (1.0 - r.diskon / 100.0)))
                } else {
                    return Err(format!("{baris}diskon atau harga diskon belum diisi."));
                };
                if diskon < 0.0 || diskon > 100.0 || harga > jual {
                    return Err(format!("{baris}harga diskon tidak boleh lebih besar dari harga jual, dan diskon harus antara 0 dan 100 persen."));
                }
                if jenis == Jenis::Pdp {
                    if r.minbelanja < 0.0 {
                        return Err(format!("{baris}minimal transaksi tidak boleh minus."));
                    }
                    match r.bid {
                        Some(bid) => tx.execute(
                            "UPDATE mdbarangpdp SET minbelanja=?1, kodebarang=?2, namabarang=?3, hrgnormal=?4, diskon=?5, hrgdiskon=?6, tglawal=?7, tglakhir=?8 WHERE bid=?9",
                            params![r.minbelanja, kode, nama, jual, diskon, harga, r.tglawal, r.tglakhir, bid],
                        ),
                        None => tx.execute(
                            "INSERT INTO mdbarangpdp (minbelanja,kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                            params![r.minbelanja, kode, nama, jual, diskon, harga, r.tglawal, r.tglakhir],
                        ),
                    }
                    .map_err(e)?;
                } else {
                    match r.bid {
                        Some(bid) => tx.execute(
                            "UPDATE mdbarangdiskon SET kodebarang=?1, namabarang=?2, hrgnormal=?3, diskon=?4, hrgdiskon=?5, tglawal=?6, tglakhir=?7 WHERE bid=?8",
                            params![kode, nama, jual, diskon, harga, r.tglawal, r.tglakhir, bid],
                        ),
                        None => tx.execute(
                            "INSERT INTO mdbarangdiskon (kodebarang,namabarang,hrgnormal,diskon,hrgdiskon,tglawal,tglakhir) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                            params![kode, nama, jual, diskon, harga, r.tglawal, r.tglakhir],
                        ),
                    }
                    .map_err(e)?;
                }
            }
        }
    }
    tx.commit().map_err(e)?;
    Ok(data.len())
}

pub fn delete(conn: &Connection, user: &User, jenis: Jenis, bid: i64) -> Res<()> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa menghapus data promo.".into());
    }
    conn.execute(&format!("DELETE FROM {} WHERE bid = ?1", jenis.table()), params![bid]).map_err(e)?;
    Ok(())
}

/// Menu yang mengatur jenis promo ini.
fn menu_promo(jenis: &str) -> &'static str {
    if jenis == "bonus" { "mnInvPromoBonus" } else { "mnInvPromoJual" }
}

#[perintah]
pub fn promo_list(db: &Db, jenis: String, dari: Option<String>, sampai: Option<String>) -> Res<Vec<Value>> {
    list(&*db.lock()?, Jenis::parse(&jenis)?, &dari.unwrap_or_default(), &sampai.unwrap_or_default())
}

#[perintah]
pub fn promo_save(db: &Db, session: &Session, jenis: String, data: Vec<PromoRow>) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, menu_promo(&jenis))?;
    let n = save(&mut conn, &user, Jenis::parse(&jenis)?, &data)?;
    Ok(json!({ "jumlah": n }))
}

#[perintah]
pub fn promo_delete(db: &Db, session: &Session, jenis: String, bid: i64) -> Res<()> {
    let user = session.user()?;
    let conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, menu_promo(&jenis))?;
    delete(&conn, &user, Jenis::parse(&jenis)?, bid)
}

/// Untuk kasir: promo satu barang pada tanggal dan jumlah beli tertentu.
#[perintah]
pub fn promo_barang(db: &Db, kodebarang: String, kodepelanggan: Option<String>, tgl: String, jml: f64) -> Res<PromoResult> {
    promo_untuk(&*db.lock()?, &kodebarang, &kodepelanggan.unwrap_or_default(), &tgl, jml)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema.sql")).unwrap();
        c.execute_batch(
            "INSERT INTO tseting (namausaha, aktifpromo) VALUES ('Toko', 1);
             INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual) VALUES ('A1','Sabun','Barang','PCS',5000,10000);
             INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual) VALUES ('B1','Permen','Barang','PCS',100,200);",
        )
        .unwrap();
        c
    }

    fn user(level: &str) -> User {
        User { iduser: "u".into(), kodekaryawan: "E1".into(), namakaryawan: "Uji".into(), level: level.into(), must_change: false }
    }

    fn diskon(bid: Option<i64>, kode: &str, persen: f64, harga: f64, a: &str, b: &str) -> PromoRow {
        PromoRow { bid, kodebarang: kode.into(), diskon: persen, hrgdiskon: harga, tglawal: a.into(), tglakhir: b.into(), ..Default::default() }
    }

    #[test]
    fn diskon_hitung_harga_atau_persen() {
        let mut c = conn();
        save(&mut c, &user("Manager"), Jenis::Diskon, &[diskon(None, "A1", 10.0, 0.0, "2026-11-01", "2026-11-30"), diskon(None, "B1", 0.0, 150.0, "2026-11-01", "2026-11-30")]).unwrap();
        let l = list(&c, Jenis::Diskon, "", "").unwrap();
        assert_eq!(l[0]["hrgdiskon"], 9000.0);
        assert_eq!(l[0]["hrgnormal"], 10000.0);
        assert_eq!(l[1]["diskon"], 25.0);
    }

    #[test]
    fn diskon_berlaku_hanya_dalam_tanggal() {
        let mut c = conn();
        save(&mut c, &user("Manager"), Jenis::Diskon, &[diskon(None, "A1", 20.0, 0.0, "2026-11-10", "2026-11-20")]).unwrap();
        let p = |tgl: &str| promo_untuk(&c, "A1", "", tgl, 1.0).unwrap();
        assert_eq!(p("2026-11-09").hrgdiskon, None);
        assert_eq!(p("2026-11-10").hrgdiskon, Some(8000.0));
        assert_eq!(p("2026-11-20").potongan, 2000.0);
        assert_eq!(p("2026-11-21").hrgdiskon, None);
        assert_eq!(p("2026-11-15").hrgnormal, 10000.0);
        // pengaturan promo dimatikan: semua promo diabaikan
        c.execute("UPDATE tseting SET aktifpromo = 0", []).unwrap();
        assert_eq!(p("2026-11-15").hrgdiskon, None);
    }

    #[test]
    fn bonus_berlaku_per_kelipatan() {
        let mut c = conn();
        let r = PromoRow { kodebarang: "A1".into(), minbeli: 3.0, kodebonus: "B1".into(), jmlbonus: 2.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(), ..Default::default() };
        save(&mut c, &user("Manager"), Jenis::Bonus, &[r]).unwrap();
        let p = |jml: f64| promo_untuk(&c, "A1", "C1", "2026-11-15", jml).unwrap();
        assert!(p(2.0).bonus.is_empty());
        assert_eq!(p(3.0).bonus[0].jml, 2.0);
        assert_eq!(p(8.0).bonus[0].jml, 4.0, "dua kelipatan 3");
        assert_eq!(p(5.6).bonus[0].jml, 4.0, "jumlah dibulatkan dulu (6), lalu dibagi bulat: 2 x 2");
        assert_eq!(p(5.4).bonus[0].jml, 2.0, "jumlah dibulatkan dulu (5), lalu dibagi bulat: 1 x 2");
        let b = &p(3.0).bonus[0];
        assert_eq!((b.kodebonus.as_str(), b.namabonus.as_str(), b.hrgbeli), ("B1", "Permen", 100.0));
        assert!(promo_untuk(&c, "A1", "", "2026-12-01", 3.0).unwrap().bonus.is_empty());
        let (h, ket) = label_promo(&c, "A1", "2026-11-15").unwrap();
        assert_eq!(h, 0.0);
        assert_eq!(ket, "Beli 3 gratis 2 Permen\r\n Berlaku : 01/11/26 - 30/11/26");
    }

    #[test]
    fn pdp_butuh_total_belanja_cukup() {
        let mut c = conn();
        let r = PromoRow { minbelanja: 100000.0, kodebarang: "A1".into(), diskon: 50.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(), ..Default::default() };
        save(&mut c, &user("Manager"), Jenis::Pdp, &[r]).unwrap();
        assert!(pdp_untuk(&c, "A1", "2026-11-15", 99999.0).unwrap().is_none());
        let p = pdp_untuk(&c, "A1", "2026-11-15", 100000.0).unwrap().unwrap();
        assert_eq!((p.hrgdiskon, p.hrgnormal), (5000.0, 10000.0));
        assert!(pdp_untuk(&c, "B1", "2026-11-15", 1e9).unwrap().is_none());
    }

    #[test]
    fn simpan_menolak_isian_salah_tanpa_menyimpan_apa_pun() {
        let mut c = conn();
        let m = user("Manager");
        let ok = diskon(None, "A1", 10.0, 0.0, "2026-11-01", "2026-11-30");
        let err = save(&mut c, &m, Jenis::Diskon, &[ok.clone(), diskon(None, "XX", 10.0, 0.0, "2026-11-01", "2026-11-30")]).unwrap_err();
        assert!(err.contains("Baris 2") && err.contains("tidak ditemukan"), "{err}");
        assert_eq!(list(&c, Jenis::Diskon, "", "").unwrap().len(), 0);
        assert!(save(&mut c, &m, Jenis::Diskon, &[diskon(None, "A1", 10.0, 0.0, "2026-11-30", "2026-11-01")]).is_err());
        assert!(save(&mut c, &m, Jenis::Diskon, &[diskon(None, "A1", 0.0, 0.0, "2026-11-01", "2026-11-30")]).is_err());
        assert!(save(&mut c, &m, Jenis::Diskon, &[diskon(None, "A1", 0.0, 20000.0, "2026-11-01", "2026-11-30")]).is_err());
        assert!(save(&mut c, &m, Jenis::Diskon, &[diskon(None, "A1", 10.0, 0.0, "01/11/2026", "2026-11-30")]).is_err());
        assert!(save(&mut c, &user("Kasir"), Jenis::Diskon, &[ok]).unwrap_err().contains("kasir"));
    }

    #[test]
    fn ubah_dan_hapus() {
        let mut c = conn();
        let m = user("Manager");
        save(&mut c, &m, Jenis::Diskon, &[diskon(None, "A1", 10.0, 0.0, "2026-11-01", "2026-11-30")]).unwrap();
        let bid = list(&c, Jenis::Diskon, "", "").unwrap()[0]["bid"].as_i64().unwrap();
        save(&mut c, &m, Jenis::Diskon, &[diskon(Some(bid), "A1", 50.0, 0.0, "2026-11-01", "2026-11-30")]).unwrap();
        let l = list(&c, Jenis::Diskon, "", "").unwrap();
        assert_eq!((l.len(), l[0]["hrgdiskon"].as_f64().unwrap()), (1, 5000.0));
        assert!(delete(&c, &user("Kasir"), Jenis::Diskon, bid).is_err());
        delete(&c, &m, Jenis::Diskon, bid).unwrap();
        assert!(list(&c, Jenis::Diskon, "", "").unwrap().is_empty());
    }

    #[test]
    fn label_diskon() {
        let mut c = conn();
        save(&mut c, &user("Manager"), Jenis::Diskon, &[diskon(None, "A1", 10.0, 0.0, "2026-11-01", "2026-11-30")]).unwrap();
        assert_eq!(label_promo(&c, "A1", "2026-11-15").unwrap(), (9000.0, "Berlaku : 01/11/26 - 30/11/26".to_string()));
        assert_eq!(label_promo(&c, "B1", "2026-11-15").unwrap(), (0.0, String::new()));
        // diskon yang berlaku mengalahkan bonus; tidak melihat aktifpromo maupun harga jual
        let r = PromoRow { kodebarang: "A1".into(), minbeli: 1.0, kodebonus: "B1".into(), jmlbonus: 1.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(), ..Default::default() };
        save(&mut c, &user("Manager"), Jenis::Bonus, &[r]).unwrap();
        c.execute("UPDATE tseting SET aktifpromo = 0", []).unwrap();
        assert_eq!(label_promo(&c, "A1", "2026-11-15").unwrap().0, 9000.0);
        c.execute("UPDATE mdbarangdiskon SET hrgdiskon = 12000", []).unwrap();
        assert_eq!(label_promo(&c, "A1", "2026-11-15").unwrap().0, 12000.0, "hrgdiskon di atas harga jual tetap dipakai");
        // di luar tanggal diskon, bonus yang dipakai
        c.execute("UPDATE mdbarangdiskon SET tglakhir = '2026-11-10'", []).unwrap();
        assert!(label_promo(&c, "A1", "2026-11-15").unwrap().1.starts_with("Beli 1 gratis 1 Permen"));
    }

    #[test]
    fn pdp_disaring_menurut_tglakhir() {
        let mut c = conn();
        let r = |k: &str, akhir: &str| PromoRow { minbelanja: 1000.0, kodebarang: k.into(), diskon: 10.0, tglawal: "2026-01-01".into(), tglakhir: akhir.into(), ..Default::default() };
        save(&mut c, &user("Manager"), Jenis::Pdp, &[r("A1", "2026-11-22"), r("B1", "2026-12-31")]).unwrap();
        assert_eq!(list(&c, Jenis::Pdp, "2026-11-22", "2026-11-22").unwrap().len(), 1);
        assert_eq!(list(&c, Jenis::Pdp, "2026-11-01", "2026-12-31").unwrap().len(), 2);
        assert_eq!(list(&c, Jenis::Pdp, "2027-01-01", "2027-01-31").unwrap().len(), 0);
        assert_eq!(list(&c, Jenis::Pdp, "", "").unwrap().len(), 2);
    }
}
