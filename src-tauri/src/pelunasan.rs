//! Pelunasan piutang pelanggan dan hutang ke pemasok (FrmTransJualPiutang dan FrmTransBeliHutang).
//! Kartu ada di TRKARTUPIUTANG (jenis 'Piutang' atau 'Hutang'), tiap pembayaran jadi satu baris TRKARTUPIUTANGDETIL.

use crate::auth::{Session, User};
use crate::db::{e, round2, rows, Db, Res};
use crate::trans::{check_date, insert_kas_oleh, nama};
use rusqlite::{params, Connection, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use perintah_macro::perintah;

/// Catat satu pembayaran ke satu kartu. Sisa yang habis menandai kartu lunas.
pub fn bayar_kartu(tx: &Transaction, user: &User, tgl: &str, nopiutang: &str, jumlah: f64, catatan: &str) -> Res<()> {
    let kurang: f64 = tx
        .query_row("SELECT COALESCE(kekurangan,0) FROM trkartupiutang WHERE nopiutang = ?1", params![nopiutang], |r| r.get(0))
        .map_err(|_| format!("Kartu {nopiutang} tidak ditemukan."))?;
    if jumlah <= 0.0 {
        return Err("Jumlah pelunasan harus lebih dari 0.".into());
    }
    if jumlah > kurang + 0.005 {
        return Err(format!("Pelunasan {nopiutang} melebihi sisa tagihan Rp {kurang:.0}."));
    }
    let lunas = kurang - jumlah < 0.005;
    tx.execute(
        "UPDATE trkartupiutang SET jmlterbayar = COALESCE(jmlterbayar,0) + ?1, kekurangan = ?2, status = ?3 WHERE nopiutang = ?4",
        params![jumlah, if lunas { 0.0 } else { round2(kurang - jumlah) }, lunas as i64, nopiutang],
    ).map_err(e)?;
    tx.execute(
        "INSERT INTO trkartupiutangdetil (nopiutang,tglbayar,kodekaryawan,jmlbayar,denda,potongan,total,catatan) VALUES (?1,?2,?3,?4,0,0,?4,?5)",
        params![nopiutang, tgl, user.kodekaryawan, jumlah, catatan],
    ).map_err(e)?;
    Ok(())
}

fn kolom(jenis: &str) -> Res<(&'static str, &'static str, &'static str)> {
    match jenis {
        "Piutang" => Ok(("kodepelanggan", "mdpelanggan", "namapelanggan")),
        "Hutang" => Ok(("kodepemasok", "mdpemasok", "namapemasok")),
        _ => Err("Jenis pelunasan tidak dikenal.".into()),
    }
}

/// Pelanggan atau pemasok yang masih punya tagihan, beserta totalnya.
#[perintah]
pub fn kartu_kontak(db: &Db, jenis: String) -> Res<Vec<Value>> {
    let (kol, tabel, nm) = kolom(&jenis)?;
    let conn = db.lock()?;
    rows(
        &conn,
        &format!(
            "SELECT k.{kol} AS kode, COALESCE(m.{nm}, k.{kol}) AS nama, SUM(k.kekurangan) AS total
             FROM trkartupiutang k LEFT JOIN {tabel} m ON m.{kol} = k.{kol}
             WHERE k.jenis = ?1 AND k.status = 0 AND k.kekurangan > 0 AND COALESCE(k.{kol},'') <> ''
             GROUP BY k.{kol} ORDER BY nama"
        ),
        params![jenis],
    )
}

/// Satu kartu yang belum lunas. Urutan daftar sama dengan aplikasi lama: menurut nomor kartu.
struct Kartu {
    nopiutang: String,
    noreftrans: String,
    jmlpiutang: f64,
    jmlterbayar: f64,
    kekurangan: f64,
}

fn muat_kartu(conn: &Connection, jenis: &str, kode: &str) -> Res<Vec<Kartu>> {
    let (kol, _, _) = kolom(jenis)?;
    let mut st = conn
        .prepare(&format!(
            "SELECT nopiutang, COALESCE(noreftrans,''), COALESCE(jmlpiutang,0), COALESCE(jmlterbayar,0), COALESCE(kekurangan,0)
             FROM trkartupiutang WHERE nopiutang <> '' AND {kol} = ?1 AND kekurangan > 0 ORDER BY nopiutang"
        ))
        .map_err(e)?;
    let r = st
        .query_map(params![kode], |r| {
            Ok(Kartu { nopiutang: r.get(0)?, noreftrans: r.get(1)?, jmlpiutang: r.get(2)?, jmlterbayar: r.get(3)?, kekurangan: r.get(4)? })
        })
        .map_err(e)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(e)?;
    Ok(r)
}

/// Semua kartu yang belum lunas milik satu pelanggan atau pemasok, diurutkan menurut nomor kartu.
pub fn kartu_ke_json(conn: &Connection, jenis: &str, kode: &str) -> Res<Vec<Value>> {
    let (kol, _, _) = kolom(jenis)?;
    rows(
        conn,
        &format!(
            "SELECT nopiutang, noreftrans, jthtempo, jmlpiutang, jmlterbayar, kekurangan FROM trkartupiutang
             WHERE nopiutang <> '' AND {kol} = ?1 AND kekurangan > 0 ORDER BY nopiutang"
        ),
        params![kode],
    )
}

#[perintah]
pub fn kartu_list(db: &Db, jenis: String, kode: String) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    kartu_ke_json(&conn, &jenis, &kode)
}

/// Cara pelunasan di layar: "Sesuai Nominal Bayar" atau "Per Transaksi".
#[derive(Deserialize, Default, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Uang yang dibayar dibagi ke kartu menurut urutan nomor kartu.
    #[default]
    Nominal,
    /// Kartu yang dicentang dilunasi seluruh sisanya.
    Transaksi,
}

#[derive(Deserialize)]
pub struct PelunasanInput {
    /// "Piutang" atau "Hutang".
    pub jenis: String,
    pub kode: String,
    pub tgl: String,
    /// Kasir yang dicatat pada pelunasan. Kosong berarti user yang sedang masuk.
    #[serde(default)]
    pub kodekaryawan: String,
    #[serde(default)]
    pub mode: Mode,
    /// Jumlah bayar (mode Nominal).
    #[serde(default)]
    pub nominal: f64,
    /// Nomor kartu yang dicentang (mode Transaksi).
    #[serde(default)]
    pub kartu: Vec<String>,
}

#[perintah]
pub fn save_pelunasan(db: &Db, session: &Session, input: PelunasanInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, if input.jenis == "Hutang" { "mnTRPelunasanHutang" } else { "mnTRPelunasanPiutang" })?;
    pelunasan(&mut conn, &user, &input)
}

/// Kasir yang dipilih di layar. Kosong atau user sendiri berarti user yang masuk.
fn pilih_kasir(conn: &Connection, user: &User, kode: &str) -> Res<(String, String)> {
    let kode = kode.trim();
    if kode.is_empty() || kode == user.kodekaryawan {
        return Ok((user.kodekaryawan.clone(), user.namakaryawan.clone()));
    }
    conn.query_row("SELECT COALESCE(namakaryawan,'') FROM mdkaryawan WHERE kodekaryawan = ?1", params![kode], |r| r.get::<_, String>(0))
        .map(|n| (kode.to_string(), n))
        .map_err(|_| "Karyawan yang Anda pilih tidak ditemukan.".to_string())
}

/// Catat satu pembayaran ke satu kartu. `lunas` menutup kartu (status 1).
fn catat_bayar(tx: &Transaction, tgl: &str, kasir: &str, nopiutang: &str, jumlah: f64, lunas: bool) -> Res<()> {
    tx.execute(
        "UPDATE trkartupiutang SET jmlterbayar = COALESCE(jmlterbayar,0) + ?1, kekurangan = ROUND(COALESCE(kekurangan,0) - ?1, 2), status = ?2 WHERE nopiutang = ?3",
        params![jumlah, lunas as i64, nopiutang],
    ).map_err(e)?;
    tx.execute(
        "INSERT INTO trkartupiutangdetil (nopiutang,tglbayar,kodekaryawan,jmlbayar,total) VALUES (?1,?2,?3,?4,?4)",
        params![nopiutang, tgl, kasir, jumlah],
    ).map_err(e)?;
    Ok(())
}

/// Simpan pelunasan seperti simpanData / simpanData2 di form aslinya.
///
/// - Nominal: kartu diisi menurut urutan nomor kartu; yang terakhir boleh sebagian. Kelebihan bayar tidak dipakai.
/// - Transaksi: tiap kartu yang dicentang dilunasi seluruh sisanya.
/// - Tidak ada nomor pelunasan. Tiap pembayaran jadi satu baris TRKARTUPIUTANGDETIL dengan kasir yang dipilih.
/// - Kas ditulis satu baris saja untuk seluruh pelunasan, dan hanya kalau pengaturan "hubungkan kas" aktif.
pub fn pelunasan(conn: &mut Connection, user: &User, input: &PelunasanInput) -> Res<Value> {
    check_date(&input.tgl)?;
    let (kol, tabel, nm) = kolom(&input.jenis)?;
    let piutang = input.jenis == "Piutang";
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let kartu = muat_kartu(&tx, &input.jenis, &input.kode)?;
    let total: f64 = kartu.iter().map(|k| k.kekurangan).sum();

    // Rencana bayar: (indeks kartu, jumlah, lunas), dan jumlah yang dicatat ke kas.
    let mut rencana: Vec<(usize, f64, bool)> = Vec::new();
    let uang;
    match input.mode {
        Mode::Nominal => {
            if input.nominal <= 0.0 {
                return Err("Jumlah pelunasan masih kosong".into());
            }
            let mut sisa = input.nominal;
            for (i, k) in kartu.iter().enumerate() {
                if sisa <= 0.0 {
                    break;
                }
                let kurang = round2(k.jmlpiutang - k.jmlterbayar);
                let x = if sisa > kurang { kurang } else { sisa };
                sisa = round2(sisa - x);
                if x > 0.0 {
                    rencana.push((i, x, (k.jmlterbayar + x - k.jmlpiutang).abs() < 0.005));
                }
            }
            // Kelebihan bayar dibuang: kas hanya mencatat sebesar tagihan.
            uang = if input.nominal - total > 0.0 { total } else { input.nominal };
        }
        Mode::Transaksi => {
            for no in &input.kartu {
                if rencana.iter().any(|(i, _, _)| &kartu[*i].nopiutang == no) {
                    continue;
                }
                match kartu.iter().position(|k| &k.nopiutang == no) {
                    Some(i) => rencana.push((i, kartu[i].kekurangan, true)),
                    None => return Err(format!("Kartu {no} bukan milik {}.", nama(&tx, &format!("SELECT {nm} FROM {tabel} WHERE {kol} = ?1"), &input.kode))),
                }
            }
            rencana.sort_by_key(|(i, _, _)| *i);
            uang = round2(rencana.iter().map(|(_, x, _)| x).sum());
            if uang <= 0.0 {
                return Err("Jumlah pelunasan masih kosong".into());
            }
        }
    }
    if input.kode.trim().is_empty() {
        return Err(format!("Silakan pilih {} dulu.", if piutang { "pelanggan" } else { "pemasok" }));
    }
    if rencana.is_empty() {
        return Err("Tidak ada tagihan yang bisa dilunasi.".into());
    }

    let (kodekas, namakas) = pilih_kasir(&tx, user, &input.kodekaryawan)?;
    let namakontak = nama(&tx, &format!("SELECT {nm} FROM {tabel} WHERE {kol} = ?1"), &input.kode);
    let mut dibayar = 0.0;
    for (i, x, lunas) in &rencana {
        let k = &kartu[*i];
        catat_bayar(&tx, &input.tgl, &kodekas, &k.nopiutang, *x, *lunas)?;
        // Hanya mode Nominal yang membuka transaksi asalnya: mode Transaksi di aplikasi lama
        // memakai nomor kartu sebagai nomor transaksi, jadi tidak ada baris yang berubah.
        if *lunas && input.mode == Mode::Nominal {
            tx.execute("UPDATE transaksi SET status = 0 WHERE notrans = ?1", params![k.noreftrans]).map_err(e)?;
        }
        dibayar += x;
    }

    let kas_aktif: i64 = tx.query_row("SELECT COALESCE((SELECT aktiftranskas FROM tseting LIMIT 1),0)", [], |r| r.get(0)).map_err(e)?;
    let mut kas = 0.0;
    if kas_aktif == 1 {
        let (arah, kategori, label) = if piutang { ("Masuk", "Penjualan barang dagang", "Pelunasan Piutang") } else { ("Keluar", "Harga pokok penjualan", "Pelunasan Hutang") };
        let ket = format!("{label} {}-{namakontak}", input.kode);
        insert_kas_oleh(&tx, (&kodekas, &namakas), &input.tgl, arah, kategori, "", (&input.kode, &namakontak), uang, &ket)?;
        kas = uang;
    }
    tx.commit().map_err(e)?;
    Ok(json!({ "total": round2(dibayar), "jumlah": rencana.len(), "kas": kas }))
}
