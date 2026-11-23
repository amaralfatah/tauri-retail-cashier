//! Retur penjualan (RJ) dan retur pembelian (RB, per transaksi atau per barang).
//! Stok diubah trigger TRANSAKSIDETIL_INSERT: RJ menambah stok, RB mengurangi.
//! Uangnya: tagihan transaksi asal yang masih terbuka dipotong dulu, sisanya lewat kas.

use crate::auth::{Session, User};
use crate::db::{e, one, round2, rows, Db, Res};
use crate::pelunasan::bayar_kartu;
use crate::trans::{check_date, insert_detail, insert_kas_transaksi, next_id, next_number, Item};
use rusqlite::{params, Connection, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use perintah_macro::perintah;

fn konversi(jml: f64, jmljual: f64, k: f64) -> f64 {
    if k > 0.0 { k } else if jmljual > 0.0 { jml / jmljual } else { 1.0 }
}

/// Transaksi asal (TJ atau TB) beserta barisnya, lengkap dengan jumlah yang sudah diretur.
#[perintah]
pub fn get_retur_sumber(db: &Db, notrans: String, kode: String) -> Res<Value> {
    let conn = db.lock()?;
    let header = one(
        &conn,
        "SELECT t.notrans, t.tgltrans, t.kode, t.kodepelanggan, t.kodepemasok, t.kodesales, t.carabayar, t.totaltrans,
                COALESCE(p.namapelanggan, s.namapemasok, '') AS namakontak, COALESCE(k.namakaryawan,'') AS namasales
         FROM transaksi t LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodesales
         WHERE t.notrans = ?1 AND t.kode = ?2",
        params![notrans, kode],
    )?
    .ok_or_else(|| if kode == "TJ" { "Transaksi penjualan itu tidak ditemukan." } else { "Transaksi pembelian itu tidak ditemukan." })?;
    let detail = rows(
        &conn,
        "SELECT nourut, kodebarang, namabarang, satuanjual, jmljual, hrgterjual, COALESCE(disknilai,0) AS disknilai,
                COALESCE(jmlretur,0) AS jmlretur, jmljual - COALESCE(jmlretur,0) AS sisa
         FROM transaksidetil WHERE notrans = ?1 ORDER BY nourut",
        params![notrans],
    )?;
    // Tagihan transaksi asal yang masih terbuka: layar bertanya dulu apakah retur memotongnya.
    let terbuka: f64 = conn
        .query_row("SELECT COALESCE(SUM(kekurangan),0) FROM trkartupiutang WHERE noreftrans = ?1 AND status = 0 AND kekurangan > 0", params![notrans], |r| r.get(0))
        .map_err(e)?;
    Ok(json!({ "header": header, "detail": detail, "piutang_terbuka": terbuka }))
}

#[derive(Deserialize)]
pub struct ReturLine {
    pub nourut: i64,
    /// Dalam satuan yang dipakai di transaksi asal.
    pub jml: f64,
}

#[derive(Deserialize)]
pub struct ReturInput {
    pub tgl: String,
    pub asal: String,
    #[serde(default)]
    pub catatan: String,
    pub items: Vec<ReturLine>,
    /// Retur penjualan: jawaban "Apakah jml piutang pelanggan akan dikurangi dengan jml retur?". Retur pembelian tidak memotong hutang.
    #[serde(default = "benar")]
    pub potong_piutang: bool,
    /// Kasir yang dipilih di layar. Kosong = user yang masuk.
    #[serde(default)]
    pub kodekasir: String,
}

fn benar() -> bool {
    true
}

/// Potong tagihan terbuka sebesar-besarnya `nilai`; mengembalikan yang benar-benar terpotong.
fn potong_tagihan(tx: &Transaction, user: &User, tgl: &str, kartu: &[(String, f64)], nilai: f64, catatan: &str) -> Res<f64> {
    let mut sisa = nilai;
    for (no, kurang) in kartu {
        if sisa < 0.005 {
            break;
        }
        let pakai = sisa.min(*kurang);
        bayar_kartu(tx, user, tgl, no, pakai, catatan)?;
        sisa = round2(sisa - pakai);
    }
    Ok(round2(nilai - sisa))
}

fn simpan_header(tx: &Transaction, kasir: &str, notrans: &str, kode: &str, jenis: &str, tgl: &str, kodesales: &str, pelanggan: &str, pemasok: &str, catatan: &str, noref: &str) -> Res<()> {
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,kodesales,kodepelanggan,kodepemasok,catatan,noref,tahun,bulan,tglupload,jamupload)
         VALUES (?1,?2,?3,?4,?5,?6,?7,NULLIF(?8,''),NULLIF(?9,''),?10,NULLIF(?11,''),?12,?13,date('now','localtime'),time('now','localtime'))",
        params![next_id(tx, "transaksi", "tid")?, notrans, tgl, kode, jenis, kasir, kodesales, pelanggan, pemasok, catatan, noref, &tgl[0..4], &tgl[5..7]],
    ).map_err(e)?;
    Ok(())
}

#[perintah]
pub fn save_retur_jual(db: &Db, session: &Session, input: ReturInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRReturJual")?;
    retur_transaksi(&mut conn, &user, &input, false)
}

#[perintah]
pub fn save_retur_beli(db: &Db, session: &Session, input: ReturInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRReturBeliPerTrans")?;
    retur_transaksi(&mut conn, &user, &input, true)
}

/// Retur dari satu transaksi: jumlah tidak boleh melebihi yang dibeli/dijual dikurangi yang sudah diretur.
pub fn retur_transaksi(conn: &mut Connection, user: &User, input: &ReturInput, beli: bool) -> Res<Value> {
    check_date(&input.tgl)?;
    // Aplikasi lama menulis jenis "Sales Return" juga untuk retur pembelian (sisa salinan dari form penjualan).
    let (kode_asal, kode_retur, jenis_retur, kategori) =
        if beli { ("TB", "RB", "Sales Return", "Retur pembelian") } else { ("TJ", "RJ", "Sales Return", "Retur penjualan") };
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let (pelanggan, pemasok, sales, jmltrans, diskon): (String, String, String, f64, f64) = tx
        .query_row(
            "SELECT COALESCE(kodepelanggan,''), COALESCE(kodepemasok,''), COALESCE(kodesales,''), COALESCE(jmltrans,0), COALESCE(diskonnilai,0)
             FROM transaksi WHERE notrans = ?1 AND kode = ?2",
            params![input.asal, kode_asal],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| if beli { "Transaksi pembelian itu tidak ditemukan.".to_string() } else { "Transaksi penjualan itu tidak ditemukan.".to_string() })?;
    let lines: Vec<&ReturLine> = input.items.iter().filter(|l| l.jml > 0.0).collect();
    if lines.is_empty() {
        return Err("Belum ada barang yang diretur. Isi jumlah retur dulu.".into());
    }
    // Diskon seluruh nota ikut dibagi rata ke barang yang diretur.
    let faktor = if jmltrans > 0.0 { (jmltrans - diskon) / jmltrans } else { 1.0 };
    let mut items = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if lines[..i].iter().any(|x| x.nourut == l.nourut) {
            return Err("Satu barang muncul dua kali di daftar retur.".into());
        }
        let (kodebarang, nm, kodesatuan, satuan, jmljual, harga, disk, jml, retur, konv): (String, String, String, String, f64, f64, f64, f64, f64, f64) = tx
            .query_row(
                "SELECT kodebarang, COALESCE(namabarang,''), COALESCE(kodesatuan,''), COALESCE(satuanjual,kodesatuan,''), COALESCE(jmljual,0), COALESCE(hrgterjual,0),
                        COALESCE(disknilai,0), COALESCE(jml,0), COALESCE(jmlretur,0), COALESCE(konversi,0)
                 FROM transaksidetil WHERE notrans = ?1 AND nourut = ?2",
                params![input.asal, l.nourut],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)),
            )
            .map_err(|_| "Barang yang diretur tidak ada di transaksi asal.".to_string())?;
        let sisa = jmljual - retur;
        if !beli && l.jml > sisa + 0.005 {
            return Err(format!("Retur {nm} melebihi jumlah yang masih bisa diretur ({sisa:.0} {satuan})."));
        }
        let konv = konversi(jml, jmljual, konv);
        // Retur pembelian memakai harga kolom Hrg. Beli apa adanya; retur penjualan memakai harga setelah diskon baris dan diskon nota.
        let neto = if beli { harga } else if jmljual > 0.0 { (harga - disk / jmljual) * faktor } else { 0.0 };
        items.push((l.nourut, Item {
            kodebarang, namabarang: nm, kodesatuan, satuanjual: satuan, konversi: konv, jmljual: l.jml, harga: round2(neto), disknilai: 0.0,
        }));
    }
    let total = round2(items.iter().map(|(_, it)| it.jmljual * it.harga).sum());
    let notrans = next_number(&tx, "transaksi", "notrans", kode_retur, &input.tgl)?;
    let kasir = if input.kodekasir.trim().is_empty() { user.kodekaryawan.clone() } else { input.kodekasir.trim().to_string() };
    simpan_header(&tx, &kasir, &notrans, kode_retur, jenis_retur, &input.tgl, &sales, &pelanggan, &pemasok, &input.catatan, &input.asal)?;
    let daftar: Vec<Item> = items.iter().map(|(_, it)| clone_item(it)).collect();
    let nilai_beli = insert_detail(&tx, &notrans, kode_retur, &daftar, beli)?;
    tx.execute("UPDATE transaksi SET jmltrans = ?1, totalnilaibeli = ?2 WHERE notrans = ?3", params![total, nilai_beli, notrans]).map_err(e)?;
    for (nourut, it) in &items {
        if beli {
            // Seperti aslinya: retur pembelian menambah JMLRETUR per kode barang.
            tx.execute("UPDATE transaksidetil SET jmlretur = COALESCE(jmlretur,0) + ?1 WHERE notrans = ?2 AND kodebarang = ?3", params![it.jmljual, input.asal, it.kodebarang]).map_err(e)?;
        } else {
            tx.execute("UPDATE transaksidetil SET jmlretur = COALESCE(jmlretur,0) + ?1 WHERE notrans = ?2 AND nourut = ?3", params![it.jmljual, input.asal, nourut]).map_err(e)?;
        }
    }

    let (kolom, kontak, tabel, nm_kol) = if beli { ("kodepemasok", &pemasok, "mdpemasok", "namapemasok") } else { ("kodepelanggan", &pelanggan, "mdpelanggan", "namapelanggan") };
    let nama_kontak: String = tx
        .query_row(&format!("SELECT {nm_kol} FROM {tabel} WHERE {kolom} = ?1"), params![kontak], |r| r.get(0))
        .unwrap_or_else(|_| kontak.clone());
    // Retur penjualan: tagihan transaksi asal yang masih terbuka dipotong bila pengguna menjawab Ya. Retur pembelian tidak memotong hutang.
    let kartu: Vec<(String, f64)> = if beli || !input.potong_piutang { vec![] } else {
        let mut st = tx
            .prepare("SELECT nopiutang, kekurangan FROM trkartupiutang WHERE noreftrans = ?1 AND status = 0 AND kekurangan > 0")
            .map_err(e)?;
        let v = st.query_map(params![input.asal], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
        v
    };
    let dipotong = potong_tagihan(&tx, user, &input.tgl, &kartu, total, &notrans)?;
    let kas = round2(total - dipotong);
    let ket = if beli { format!("Retur Pembelian ke {kontak}-{nama_kontak}") } else { format!("Retur Penjualan dari {kontak}-{nama_kontak}") };
    insert_kas_transaksi(&tx, user, &input.tgl, if beli { "Masuk" } else { "Keluar" }, kategori, &notrans, (kontak, &nama_kontak), kas, &ket)?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "total": total, "dipotong": dipotong, "kas": kas }))
}

fn clone_item(i: &Item) -> Item {
    Item {
        kodebarang: i.kodebarang.clone(), namabarang: i.namabarang.clone(), kodesatuan: i.kodesatuan.clone(), satuanjual: i.satuanjual.clone(),
        konversi: i.konversi, jmljual: i.jmljual, harga: i.harga, disknilai: i.disknilai,
    }
}

#[derive(Deserialize)]
pub struct ReturBrgInput {
    pub tgl: String,
    pub kodepemasok: String,
    #[serde(default)]
    pub catatan: String,
    pub items: Vec<Item>,
    #[serde(default)]
    pub kodekasir: String,
}

#[perintah]
pub fn save_retur_beli_barang(db: &Db, session: &Session, input: ReturBrgInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRReturBeliperBarang")?;
    retur_beli_barang(&mut conn, &user, &input)
}

/// Retur pembelian tanpa transaksi asal: jumlah dibatasi stok dan pembelian dari pemasok itu yang belum diretur.
pub fn retur_beli_barang(conn: &mut Connection, user: &User, input: &ReturBrgInput) -> Res<Value> {
    check_date(&input.tgl)?;
    let pemasok = input.kodepemasok.trim();
    if pemasok.is_empty() {
        return Err("Pilih dulu pemasok yang menerima retur.".into());
    }
    if input.items.is_empty() {
        return Err("Belum ada barang yang diretur.".into());
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let nama_pemasok: String = tx
        .query_row("SELECT namapemasok FROM mdpemasok WHERE kodepemasok = ?1", params![pemasok], |r| r.get(0))
        .map_err(|_| "Pemasok itu tidak ditemukan.".to_string())?;
    for it in &input.items {
        if it.jmljual <= 0.0 || it.konversi <= 0.0 || it.harga < 0.0 {
            return Err(format!("Jumlah atau harga {} tidak valid.", it.namabarang));
        }
    }
    let total = round2(input.items.iter().map(|i| i.jmljual * i.harga - i.disknilai).sum());
    let notrans = next_number(&tx, "transaksi", "notrans", "RB", &input.tgl)?;
    let kasir = if input.kodekasir.trim().is_empty() { user.kodekaryawan.clone() } else { input.kodekasir.trim().to_string() };
    // Jenis "Sales Order" ikut aslinya (salinan dari form lain).
    simpan_header(&tx, &kasir, &notrans, "RB", "Sales Order", &input.tgl, "", "", pemasok, &input.catatan, "")?;
    let nilai = insert_detail(&tx, &notrans, "RB", &input.items, true)?;
    tx.execute("UPDATE transaksi SET jmltrans = ?1, totalnilaibeli = ?2 WHERE notrans = ?3", params![total, nilai, notrans]).map_err(e)?;
    let dipotong = 0.0;
    let kas = total;
    insert_kas_transaksi(&tx, user, &input.tgl, "Masuk", "Retur pembelian", &notrans, (pemasok, &nama_pemasok), kas, &format!("Retur Pembelian ke {pemasok}-{nama_pemasok}"))?;
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "total": total, "dipotong": dipotong, "kas": kas }))
}
