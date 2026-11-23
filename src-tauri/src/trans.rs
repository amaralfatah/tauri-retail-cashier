//! Transaksi: penjualan (TJ), pembelian (TB), stok opname (OP).
//! Alur meniru aplikasi lama: header di TRANSAKSI, baris di TRANSAKSIDETIL
//! (trigger SQLite mengubah stok), kas di KEUANGAN, hutang/piutang di TRKARTUPIUTANG.

use crate::auth::{Session, User};
use crate::db::{e, one, round2, rows, Db, Res};
use crate::poin::{self, PoinSetting};
use crate::promo;
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use perintah_macro::perintah;

/// Nomor berikutnya dengan pola lama: KODE + yymm + "-" + 5 digit, misalnya TJ2611-00001.
pub fn next_number(tx: &rusqlite::Connection, table: &str, col: &str, kode: &str, tgl: &str) -> Res<String> {
    let (y, m) = (tgl.get(2..4).unwrap_or("00"), tgl.get(5..7).unwrap_or("00"));
    let prefix = format!("{kode}{y}{m}-");
    let last: Option<String> = tx
        .query_row(&format!("SELECT MAX({col}) FROM {table} WHERE {col} LIKE ?1"), params![format!("{prefix}%")], |r| r.get(0))
        .map_err(e)?;
    let n = last.and_then(|s| s[prefix.len()..].parse::<u32>().ok()).unwrap_or(0) + 1;
    Ok(format!("{prefix}{n:05}"))
}

pub fn check_date(tgl: &str) -> Res<()> {
    chrono::NaiveDate::parse_from_str(tgl, "%Y-%m-%d").map(|_| ()).map_err(|_| "Tanggal transaksi tidak valid.".to_string())
}

pub fn next_id(tx: &rusqlite::Connection, table: &str, col: &str) -> Res<i64> {
    tx.query_row(&format!("SELECT COALESCE(MAX({col}),0)+1 FROM {table}"), [], |r| r.get(0)).map_err(e)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_kas(tx: &Transaction, user: &User, tgl: &str, jenis: &str, kategori: &str, noref: &str, kontak: (&str, &str), jumlah: f64, ket: &str) -> Res<()> {
    insert_kas_oleh(tx, (&user.kodekaryawan, &user.namakaryawan), tgl, jenis, kategori, noref, kontak, jumlah, ket)
}

/// Sama seperti `insert_kas`, tetapi petugas yang dicatat dipilih sendiri (kasir di layar Pelunasan).
#[allow(clippy::too_many_arguments)]
pub fn insert_kas_oleh(tx: &Transaction, petugas: (&str, &str), tgl: &str, jenis: &str, kategori: &str, noref: &str, kontak: (&str, &str), jumlah: f64, ket: &str) -> Res<()> {
    if jumlah.abs() < 0.005 {
        return Ok(());
    }
    insert_kas_paksa(tx, petugas, tgl, jenis, kategori, noref, kontak, jumlah, ket)
}

/// Tulis satu baris kas tanpa melewati jumlah nol (kas manual aslinya tidak menolak jumlah nol). Jenis "Saldo Awal" dihitung sebagai masuk.
#[allow(clippy::too_many_arguments)]
pub fn insert_kas_paksa(tx: &Transaction, petugas: (&str, &str), tgl: &str, jenis: &str, kategori: &str, noref: &str, kontak: (&str, &str), jumlah: f64, ket: &str) -> Res<()> {
    let nokas = next_number(tx, "keuangan", "nokas", "KS", tgl)?;
    let saldo: f64 = tx
        .query_row("SELECT COALESCE((SELECT saldo FROM keuangan ORDER BY idkas DESC LIMIT 1),0)", [], |r| r.get(0))
        .map_err(e)?;
    let (masuk, keluar) = if jenis == "Masuk" || jenis == "Saldo Awal" { (jumlah, 0.0) } else { (0.0, jumlah) };
    tx.execute(
        "INSERT INTO keuangan (idkas,nokas,kode,jenis,kategori,noreftrans,tglkas,kodekaryawan,namakaryawan,kodekontak,namakontak,masuk,keluar,saldo,keterangan,periode)
         VALUES (?1,?2,'KS',?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            next_id(tx, "keuangan", "idkas")?, nokas, jenis, kategori, noref, tgl, petugas.0, petugas.1,
            kontak.0, kontak.1, masuk, keluar, round2(saldo + masuk - keluar), ket, format!("{}{}", &tgl[0..4], &tgl[5..7])
        ],
    ).map_err(e)?;
    Ok(())
}

/// Kas dari transaksi (penjualan, pembelian, retur) hanya ditulis bila pengaturan "hubungkan kas" aktif (TSETING.AKTIFTRANSKAS = 1),
/// seperti aplikasi lama. Catatan kas manual dan pelunasan tidak lewat sini.
#[allow(clippy::too_many_arguments)]
pub fn insert_kas_transaksi(tx: &Transaction, user: &User, tgl: &str, jenis: &str, kategori: &str, noref: &str, kontak: (&str, &str), jumlah: f64, ket: &str) -> Res<()> {
    if !kas_aktif(tx) {
        return Ok(());
    }
    insert_kas(tx, user, tgl, jenis, kategori, noref, kontak, jumlah, ket)
}

/// Pengaturan "hubungkan kas" (TSETING.AKTIFTRANSKAS = 1).
pub fn kas_aktif(conn: &Connection) -> bool {
    conn.query_row("SELECT COALESCE((SELECT aktiftranskas FROM tseting LIMIT 1),0)", [], |r| r.get::<_, i64>(0)).unwrap_or(0) == 1
}

#[derive(Deserialize, Clone)]
pub struct Item {
    pub kodebarang: String,
    pub namabarang: String,
    /// Satuan dasar barang (MDBARANG.KODESATUAN).
    pub kodesatuan: String,
    /// Satuan yang dipakai di transaksi (bisa satuan besar, misalnya BOX).
    pub satuanjual: String,
    /// Isi satuan transaksi dalam satuan dasar.
    pub konversi: f64,
    /// Jumlah dalam satuan transaksi.
    pub jmljual: f64,
    /// Harga per satuan transaksi.
    pub harga: f64,
    #[serde(default)]
    pub disknilai: f64,
}

#[derive(Deserialize, Clone)]
pub struct TransInput {
    pub tgl: String,
    #[serde(default)]
    pub kodepelanggan: String,
    #[serde(default)]
    pub kodepemasok: String,
    #[serde(default)]
    pub kodesales: String,
    #[serde(default)]
    pub catatan: String,
    pub items: Vec<Item>,
    #[serde(default)]
    pub diskonpersen: f64,
    #[serde(default)]
    pub diskonnilai: f64,
    #[serde(default)]
    pub biaya: f64,
    /// "Tunai", "Non Tunai" atau "Kredit".
    pub carabayar: String,
    #[serde(default)]
    pub jmlbayar: f64,
    #[serde(default)]
    pub jenisnontunai: String,
    #[serde(default)]
    pub kartu: String,
    #[serde(default)]
    pub norefkartu: String,
    #[serde(default)]
    pub jthtempo: String,
    /// Pembelian: perbarui harga beli di master barang.
    #[serde(default)]
    pub update_hrgbeli: bool,
    /// Penjualan kredit: pengguna sudah menjawab Ya pada pertanyaan batas kredit terlampaui.
    #[serde(default)]
    pub lanjutkredit: bool,
    /// Penjualan: bagian yang dibayar non tunai (jenisnontunai, kartu, norefkartu). Sisanya tunai dan uang muka.
    #[serde(default)]
    pub bayarnontunai: f64,
    /// Pembelian: harga jual per satuan dasar yang diisi di kolom Hrg. Jual pada layar pembelian.
    #[serde(default)]
    pub hargajual: Vec<HargaJual>,
    /// Kasir yang dipilih di layar (tombol cari kasir). Kosong = user yang masuk.
    #[serde(default)]
    pub kodekasir: String,
}

#[derive(Deserialize, Clone)]
pub struct HargaJual {
    pub kodebarang: String,
    pub hrgjual: f64,
}

struct Totals {
    jmltrans: f64,
    diskon: f64,
    total: f64,
}

/// Total = jumlah belanja - diskon + biaya. Aplikasi lama tidak punya PPN di layar bayar maupun di tabel transaksi.
fn totals(input: &TransInput) -> Res<Totals> {
    if input.items.is_empty() {
        return Err("Belum ada barang di transaksi ini.".into());
    }
    for it in &input.items {
        if it.jmljual <= 0.0 {
            return Err(format!("Jumlah {} harus lebih dari 0.", it.namabarang));
        }
        if it.konversi <= 0.0 || it.harga < 0.0 {
            return Err(format!("Satuan atau harga {} tidak valid.", it.namabarang));
        }
    }
    let jmltrans = round2(input.items.iter().map(|i| i.jmljual * i.harga - i.disknilai).sum());
    let diskon = if input.diskonnilai > 0.0 { input.diskonnilai } else { round2(jmltrans * input.diskonpersen / 100.0) };
    if diskon > jmltrans {
        return Err("Diskon tidak boleh melebihi jumlah belanja.".into());
    }
    Ok(Totals { jmltrans, diskon, total: round2(jmltrans - diskon + input.biaya) })
}

pub fn insert_detail(tx: &Transaction, notrans: &str, kode: &str, items: &[Item], beli: bool) -> Res<f64> {
    let mut nilai_beli = 0.0;
    for (i, it) in items.iter().enumerate() {
        let (hrgbeli_master, hrgjual_master, stok): (f64, f64, f64) = tx
            .query_row(
                "SELECT COALESCE(hrgbeli,0), COALESCE(hrgjual,0), COALESCE(stokakhir,0) FROM mdbarang WHERE kodebarang = ?1",
                params![it.kodebarang],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| format!("Barang {} tidak ditemukan di master barang.", it.kodebarang))?;
        let jml = round2(it.jmljual * it.konversi);
        // Pada pembelian, harga beli dasar diambil dari harga yang diisi; pada penjualan dari master.
        let hrgbeli = if beli { round2(it.harga / it.konversi) } else { hrgbeli_master };
        nilai_beli += hrgbeli * jml;
        tx.execute(
            "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,hrgjual,satuanjual,jmljual,hrgterjual,diskpersen,disknilai,subtotal,jmlretur,konversi,stokasal)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0,?13,?14,0,?15,?16)",
            params![
                notrans, kode, (i + 1) as i64, it.kodebarang, it.namabarang, it.kodesatuan, jml, hrgbeli, hrgjual_master,
                it.satuanjual, it.jmljual, it.harga, it.disknilai, round2(it.jmljual * it.harga - it.disknilai), it.konversi, stok
            ],
        ).map_err(e)?;
    }
    Ok(round2(nilai_beli))
}


/* ------------------------------------------------------------------ */
/* Promo penjualan                                                     */
/* ------------------------------------------------------------------ */

/// Harga dan potongan yang berlaku untuk satu baris penjualan setelah promo.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PromoBaris {
    /// Harga per satuan transaksi setelah diskon promo.
    pub harga: f64,
    /// Potongan PDP untuk seluruh baris (jumlah x selisih harga).
    pub disknilai: f64,
}

/// Barang bonus yang ikut keluar (satuan dasar barang bonus).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BonusBaris {
    pub kodebarang: String,
    pub namabarang: String,
    pub kodesatuan: String,
    pub jml: f64,
    pub hrgbeli: f64,
    pub hrgjual: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct PromoHitung {
    pub baris: Vec<PromoBaris>,
    pub bonus: Vec<BonusBaris>,
}

/// Hitung promo untuk seluruh isi keranjang. Dipakai layar kasir (tampilan) dan simpan penjualan (aturan sebenarnya),
/// jadi keduanya selalu sama.
/// Urutan: harga diskon promo menggantikan harga level/grosir kalau lebih murah; lalu diskon PDP
/// kalau total belanja sudah mencapai batas minimal; bonus dihitung dari jumlah beli per barang (satuan dasar).
pub fn promo_hitung(conn: &Connection, tgl: &str, items: &[Item]) -> Res<PromoHitung> {
    let mut out = PromoHitung {
        baris: items.iter().map(|i| PromoBaris { harga: i.harga, disknilai: i.disknilai }).collect(),
        bonus: vec![],
    };
    if !promo::promo_aktif(conn)? {
        return Ok(out);
    }
    // Jumlah beli per barang dalam satuan dasar.
    let mut jml_barang: Vec<(String, f64)> = vec![];
    for it in items {
        let dasar = it.jmljual * it.konversi;
        match jml_barang.iter_mut().find(|(k, _)| *k == it.kodebarang) {
            Some(x) => x.1 += dasar,
            None => jml_barang.push((it.kodebarang.clone(), dasar)),
        }
    }
    for (i, it) in items.iter().enumerate() {
        if it.konversi <= 0.0 {
            continue;
        }
        let jml = jml_barang.iter().find(|(k, _)| *k == it.kodebarang).map(|x| x.1).unwrap_or(0.0);
        let p = promo::promo_untuk(conn, &it.kodebarang, "", tgl, jml)?;
        if let Some(h) = p.hrgdiskon {
            out.baris[i].harga = round2(it.harga.min(h * it.konversi));
        }
        for b in p.bonus {
            // Satu barang bisa ada di beberapa baris (satuan berbeda): bonusnya cukup dihitung sekali.
            if items[..i].iter().any(|x| x.kodebarang == it.kodebarang) {
                continue;
            }
            match out.bonus.iter_mut().find(|x| x.kodebarang == b.kodebonus) {
                Some(x) => x.jml = round2(x.jml + b.jml),
                None => out.bonus.push(BonusBaris {
                    kodebarang: b.kodebonus, namabarang: b.namabonus, kodesatuan: b.kodesatuan, jml: b.jml, hrgbeli: b.hrgbeli, hrgjual: b.hrgjual,
                }),
            }
        }
    }
    // PDP: dihitung dari total belanja setelah diskon promo.
    let belanja: f64 = items.iter().zip(&out.baris).map(|(it, b)| it.jmljual * b.harga - it.disknilai).sum();
    for (i, it) in items.iter().enumerate() {
        if it.konversi <= 0.0 {
            continue;
        }
        if let Some(p) = promo::pdp_untuk(conn, &it.kodebarang, tgl, belanja)? {
            let harga = out.baris[i].harga;
            let baru = if p.hrgdiskon > 0.0 { p.hrgdiskon * it.konversi } else { harga * (1.0 - p.diskon / 100.0) };
            if baru < harga {
                out.baris[i].disknilai = round2(it.disknilai.max((harga - baru) * it.jmljual));
            }
        }
    }
    Ok(out)
}

#[perintah]
pub fn promo_keranjang(db: &Db, tgl: String, items: Vec<Item>) -> Res<PromoHitung> {
    check_date(&tgl)?;
    promo_hitung(&*db.lock()?, &tgl, &items)
}

/// Simpan barang bonus sebagai baris penjualan: HRGJUAL dan HRGTERJUAL 0, HRGBELI harga beli master (stok ikut berkurang lewat trigger).
fn insert_bonus(tx: &Transaction, notrans: &str, mulai: i64, bonus: &[BonusBaris]) -> Res<f64> {
    let mut nilai_beli = 0.0;
    for (i, b) in bonus.iter().enumerate() {
        let stok: f64 = tx
            .query_row("SELECT COALESCE(stokakhir,0) FROM mdbarang WHERE kodebarang = ?1", params![b.kodebarang], |r| r.get(0))
            .map_err(|_| format!("Barang bonus {} tidak ditemukan di master barang.", b.kodebarang))?;
        nilai_beli += b.hrgbeli * b.jml;
        tx.execute(
            "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,hrgjual,satuanjual,jmljual,hrgterjual,diskpersen,disknilai,subtotal,jmlretur,konversi,stokasal)
             VALUES (?1,'TJ',?2,?3,?4,?5,?6,?7,0,?5,?6,0,0,0,0,0,1,?8)",
            params![notrans, mulai + i as i64, b.kodebarang, b.namabarang, b.kodesatuan, b.jml, b.hrgbeli, stok],
        ).map_err(e)?;
    }
    Ok(nilai_beli)
}

/// Angka rupiah bulat dengan titik ribuan, untuk pesan.
fn rupiah(n: f64) -> String {
    let s = format!("{:.0}", n.round());
    let mut out = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 && c != '-' {
            out.push('.');
        }
        out.push(c);
    }
    out.chars().rev().collect()
}

pub fn nama(tx: &Transaction, sql: &str, kode: &str) -> String {
    tx.query_row(sql, params![kode], |r| r.get::<_, String>(0)).unwrap_or_else(|_| kode.to_string())
}

#[perintah]
pub fn save_penjualan(db: &Db, session: &Session, input: TransInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRTrPenjualan")?;
    penjualan(&mut *conn, &user, &input)
}

pub fn penjualan(conn: &mut Connection, user: &User, input: &TransInput) -> Res<Value> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let r = penjualan_tx(&tx, user, input)?;
    tx.commit().map_err(e)?;
    Ok(r)
}

/// Awal pesan error yang artinya "tanyakan Ya/Tidak dulu"; layar mengenalinya lalu mengirim ulang dengan `lanjutkredit`.
pub const TANDA_KONFIRMASI: &str = "[konfirmasi] ";

/// Isi penjualan tanpa commit, supaya bisa digabung dengan langkah lain (misalnya menandai order sudah diambil).
pub fn penjualan_tx(tx: &Transaction, user: &User, input_asli: &TransInput) -> Res<Value> {
    check_date(&input_asli.tgl)?;
    crate::izin::periksa_penjualan(tx, user, input_asli)?;
    // Harga promo dan PDP selalu dihitung ulang di sini; harga dari layar tidak dipercaya untuk promo.
    let promo = promo_hitung(tx, &input_asli.tgl, &input_asli.items)?;
    let mut efektif = input_asli.clone();
    for (it, b) in efektif.items.iter_mut().zip(&promo.baris) {
        it.harga = b.harga;
        it.disknilai = b.disknilai;
    }
    let input = &efektif;
    let t = totals(input)?;
    let kasir = if input.kodekasir.trim().is_empty() { user.kodekaryawan.clone() } else { input.kodekasir.trim().to_string() };
    let pelanggan = if input.kodepelanggan.trim().is_empty() { "Tunai".to_string() } else { input.kodepelanggan.trim().to_string() };
    let namapelanggan = nama(&tx, "SELECT namapelanggan FROM mdpelanggan WHERE kodepelanggan = ?1", &pelanggan);

    // Pembayaran campuran seperti aplikasi lama: uang muka + tunai + non tunai (nominal sendiri) dibandingkan dengan total.
    let mut nontunai = round2(input.bayarnontunai.max(0.0));
    if input.carabayar == "Non Tunai" && nontunai < 0.005 {
        // Cara lama: seluruh total dibayar non tunai.
        nontunai = t.total;
    }
    if nontunai > 0.0 && input.jenisnontunai.is_empty() {
        return Err("Pilih dulu jenis pembayaran non tunai.".into());
    }
    if nontunai > t.total + 0.005 {
        return Err("Pembayaran non tunai tidak boleh melebihi total belanja.".into());
    }
    let diterima = round2(input.jmlbayar + nontunai);
    let ketnontunai = if nontunai > 0.0 { input.jenisnontunai.clone() } else { String::new() };
    let (jmlbayar, sisa, carabayar, kas_masuk) = match input.carabayar.as_str() {
        "Tunai" | "Non Tunai" => {
            if diterima + 0.005 < t.total {
                return Err("Uang yang dibayar masih kurang dari total belanja.".into());
            }
            let cara = if nontunai > 0.0 && input.jmlbayar < 0.005 { "Non Tunai" } else { "Tunai" };
            (input.jmlbayar, round2(diterima - t.total), cara, t.total)
        }
        "Kredit" => {
            if pelanggan == "Tunai" {
                return Err("Transaksi piutang tidak bisa dilakukan untuk pelanggan 'Tunai'. Pilih nama pelanggan yang terdaftar untuk melanjutkan proses transaksi piutang.".into());
            }
            if diterima >= t.total {
                return Err("Uang muka sudah menutup total belanja. Pilih cara bayar Tunai saja.".into());
            }
            check_date(&input.jthtempo).map_err(|_| "Tanggal jatuh tempo belum diisi dengan benar.".to_string())?;
            let (limit, terpakai): (f64, f64) = tx
                .query_row(
                    "SELECT COALESCE(limitkredit,0), (SELECT COALESCE(SUM(kekurangan),0) FROM trkartupiutang WHERE kode='PS' AND kodepelanggan=?1 AND status=0) FROM mdpelanggan WHERE kodepelanggan=?1",
                    params![pelanggan],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap_or((0.0, 0.0));
            let piutang = t.total - diterima;
            if limit > 0.0 && terpakai + piutang > limit + 0.005 {
                let pesan = format!(
                    "Pelanggan : {namapelanggan} sudah mencapai batas kredit maksimal : {}\nJumlah piutang belum terbayar : {}",
                    rupiah(limit),
                    rupiah(terpakai)
                );
                let konfirmasi: i64 = tx.query_row("SELECT COALESCE(konfirmasikredit,0) FROM tseting LIMIT 1", [], |r| r.get(0)).unwrap_or(0);
                if konfirmasi != 1 {
                    return Err(pesan);
                }
                if !input.lanjutkredit {
                    return Err(format!("{TANDA_KONFIRMASI}{pesan}\nApakah transaksi akan dilanjutkan?"));
                }
            }
            (input.jmlbayar, round2(diterima - t.total), "Kredit", diterima)
        }
        _ => return Err("Cara bayar tidak dikenal.".into()),
    };
    let bayarlain1 = nontunai;
    let ketbayarlain1 = ketnontunai;

    let notrans = next_number(&tx, "transaksi", "notrans", "TJ", &input.tgl)?;
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,kodesales,kodepelanggan,catatan,jmltrans,diskonpersen,diskonnilai,biaya,
           totaltrans,jmlbayar,sisa,carabayar,kartu,norefkartu,status,bayarlain1,ketbayarlain1,tahun,bulan,tgljthtempo,tglupload,jamupload)
         VALUES (?1,?2,?3,'TJ','Sales',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,0,?18,?19,?20,?21,?22,date('now','localtime'),time('now','localtime'))",
        params![
            next_id(&tx, "transaksi", "tid")?, notrans, input.tgl, kasir, input.kodesales, pelanggan, input.catatan,
            t.jmltrans, input.diskonpersen, t.diskon, input.biaya, t.total, jmlbayar, sisa, carabayar,
            input.kartu, input.norefkartu, bayarlain1, ketbayarlain1, &input.tgl[0..4], &input.tgl[5..7],
            if carabayar == "Kredit" { Some(input.jthtempo.clone()) } else { None }
        ],
    ).map_err(e)?;
    let mut nilai_beli = insert_detail(&tx, &notrans, "TJ", &input.items, false)?;
    nilai_beli = round2(nilai_beli + insert_bonus(&tx, &notrans, input.items.len() as i64 + 1, &promo.bonus)?);
    tx.execute("UPDATE transaksi SET totalnilaibeli = ?1 WHERE notrans = ?2", params![nilai_beli, notrans]).map_err(e)?;

    if carabayar == "Kredit" {
        let nopiutang = next_number(&tx, "trkartupiutang", "nopiutang", "PS", &input.tgl)?;
        let piutang = round2(t.total - diterima);
        tx.execute(
            "INSERT INTO trkartupiutang (nopiutang,kode,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan,status,keterangan,kodepelanggan)
             VALUES (?1,'PS','Piutang',?2,?3,?4,0,?4,0,?5,?6)",
            params![nopiutang, notrans, input.jthtempo, piutang, format!("Piutang penjualan {notrans}"), pelanggan],
        ).map_err(e)?;
    }
    let ket = if nontunai > 0.0 { format!("Non tunai {} {}", input.jenisnontunai, input.kartu) } else { carabayar.to_string() };
    insert_kas_transaksi(&tx, user, &input.tgl, "Masuk", "Penjualan barang dagang", &notrans, (&pelanggan, &namapelanggan), kas_masuk, &ket)?;

    // Poin hanya untuk pelanggan terdaftar (bukan "Tunai").
    let mut poin_dapat = 0i64;
    if pelanggan != "Tunai" {
        let terdaftar: bool = tx
            .query_row("SELECT COUNT(*) FROM mdpelanggan WHERE kodepelanggan = ?1", params![pelanggan], |r| r.get::<_, i64>(0))
            .map_err(e)?
            > 0;
        if terdaftar {
            poin_dapat = poin::poin_dari_transaksi(&PoinSetting::dari_db(tx), t.total).round() as i64;
            if poin_dapat > 0 {
                poin::catat_poin(tx, &user.kodekaryawan, &pelanggan, &input.tgl, poin_dapat, 0, &format!("Perolehan Poin dari transaksi: {notrans}"), &notrans)?;
            }
        }
    }
    Ok(json!({ "notrans": notrans, "total": t.total, "kembali": sisa.max(0.0), "poin": poin_dapat, "bonus": promo.bonus.len() }))
}

#[perintah]
pub fn save_pembelian(db: &Db, session: &Session, input: TransInput) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnTRTransPembelian")?;
    pembelian(&mut *conn, &user, &input)
}

/// Pembelian dengan harga jual selalu ikut diperbarui dari margin (sama dengan pengaturan `updateharga` bit 2 aktif).
#[cfg(test)]
pub fn pembelian_margin(conn: &mut Connection, user: &User, input: &TransInput) -> Res<Value> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let r = pembelian_isi(&tx, user, input, true)?;
    tx.commit().map_err(e)?;
    Ok(r)
}

/// Perbarui master barang menurut pengaturan `updateharga` (bit 1 = harga beli, bit 2 = harga jual dari margin).
/// Bit 1: HRGBELI, MARGINPERSEN, MARGINNILAI. Bit 2: MARGINNILAI, HRGJUAL.
fn perbarui_harga(tx: &Transaction, input: &TransInput, bit_jual_paksa: bool) -> Res<()> {
    let ur: i64 = tx.query_row("SELECT COALESCE((SELECT updateharga FROM tseting LIMIT 1),0)", [], |r| r.get(0)).unwrap_or(0);
    let beli_upd = input.update_hrgbeli || ur & 1 != 0;
    let jual_upd = bit_jual_paksa || ur & 2 != 0;
    if !beli_upd && !jual_upd {
        return Ok(());
    }
    let mut sudah: Vec<&str> = vec![];
    for it in input.items.iter().rev() {
        if sudah.contains(&it.kodebarang.as_str()) {
            continue;
        }
        sudah.push(&it.kodebarang);
        let Ok((beli_lama, jual_lama, mp_lama)) = tx.query_row(
            "SELECT COALESCE(hrgbeli,0), COALESCE(hrgjual,0), COALESCE(marginpersen,0) FROM mdbarang WHERE kodebarang = ?1",
            params![it.kodebarang],
            |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?)),
        ) else { continue };
        let beli_baru = round2(it.harga / it.konversi);
        let diisi = input.hargajual.iter().rev().find(|h| h.kodebarang == it.kodebarang).map(|h| h.hrgjual);
        let mut jual = jual_lama;
        if jual_upd {
            jual = match diisi {
                Some(h) if h > 0.0 => h,
                _ if mp_lama > 0.0 => (beli_baru * (1.0 + mp_lama / 100.0)).round(),
                _ if beli_lama > 0.0 && jual_lama > 0.0 && (beli_baru - beli_lama).abs() >= 0.005 => (beli_baru * jual_lama / beli_lama).round(),
                _ => jual_lama,
            };
        }
        let margin_nilai = round2(jual - beli_baru);
        let margin_persen = if beli_baru > 0.0 { round2(margin_nilai / beli_baru * 100.0) } else { 0.0 };
        if beli_upd {
            tx.execute(
                "UPDATE mdbarang SET hrgbeli = ?1, marginpersen = ?2, marginnilai = ?3, tglupdate = date('now','localtime') WHERE kodebarang = ?4",
                params![beli_baru, margin_persen, margin_nilai, it.kodebarang],
            ).map_err(e)?;
        }
        if jual_upd {
            tx.execute(
                "UPDATE mdbarang SET marginnilai = ?1, marginpersen = ?2, hrgjual = ?3, tglupdate = date('now','localtime') WHERE kodebarang = ?4",
                params![margin_nilai, margin_persen, jual, it.kodebarang],
            ).map_err(e)?;
        }
    }
    Ok(())
}

pub fn pembelian(conn: &mut Connection, user: &User, input: &TransInput) -> Res<Value> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let r = pembelian_tx(&tx, user, input)?;
    tx.commit().map_err(e)?;
    Ok(r)
}

/// Isi pembelian tanpa commit (lihat `penjualan_tx`).
pub fn pembelian_tx(tx: &Transaction, user: &User, input: &TransInput) -> Res<Value> {
    pembelian_isi(tx, user, input, false)
}

fn pembelian_isi(tx: &Transaction, user: &User, input: &TransInput, jual_paksa: bool) -> Res<Value> {
    check_date(&input.tgl)?;
    let t = totals(input)?;
    let kasir = if input.kodekasir.trim().is_empty() { user.kodekaryawan.clone() } else { input.kodekasir.trim().to_string() };
    let pemasok = if input.kodepemasok.trim().is_empty() { "Tunai".to_string() } else { input.kodepemasok.trim().to_string() };
    let namapemasok = nama(&tx, "SELECT namapemasok FROM mdpemasok WHERE kodepemasok = ?1", &pemasok);
    let kredit = input.carabayar == "Kredit";
    if kredit {
        if pemasok == "Tunai" {
            return Err("Pembelian kredit perlu pemasok terdaftar. Silakan pilih pemasok dulu.".into());
        }
        check_date(&input.jthtempo).map_err(|_| "Tanggal jatuh tempo belum diisi dengan benar.".to_string())?;
    }
    let jmlbayar = if kredit { input.jmlbayar.min(t.total) } else { t.total };
    let notrans = next_number(&tx, "transaksi", "notrans", "TB", &input.tgl)?;
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,kodepemasok,catatan,noref,jmltrans,diskonpersen,diskonnilai,biaya,totaltrans,
           jmlbayar,sisa,carabayar,status,tahun,bulan,tgljthtempo,tglupload,jamupload,kodesales)
         VALUES (?1,?2,?3,'TB','Purchase',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,0,?16,?17,?18,date('now','localtime'),time('now','localtime'),?19)",
        params![
            next_id(&tx, "transaksi", "tid")?, notrans, input.tgl, kasir, pemasok, input.catatan, input.norefkartu,
            t.jmltrans, input.diskonpersen, t.diskon, input.biaya, t.total, jmlbayar, round2(jmlbayar - t.total),
            if kredit { "Kredit" } else { "Tunai" }, &input.tgl[0..4], &input.tgl[5..7], if kredit { Some(input.jthtempo.clone()) } else { None },
            input.kodesales
        ],
    ).map_err(e)?;
    let nilai = insert_detail(&tx, &notrans, "TB", &input.items, true)?;
    tx.execute("UPDATE transaksi SET totalnilaibeli = ?1 WHERE notrans = ?2", params![nilai, notrans]).map_err(e)?;
    perbarui_harga(tx, input, jual_paksa)?;
    if kredit {
        let nohutang = next_number(&tx, "trkartupiutang", "nopiutang", "HP", &input.tgl)?;
        let hutang = round2(t.total - jmlbayar);
        tx.execute(
            "INSERT INTO trkartupiutang (nopiutang,kode,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan,status,keterangan,kodepemasok)
             VALUES (?1,'HP','Hutang',?2,?3,?4,0,?4,0,?5,?6)",
            params![nohutang, notrans, input.jthtempo, hutang, format!("Hutang pembelian {notrans}"), pemasok],
        ).map_err(e)?;
    }
    insert_kas_transaksi(&tx, user, &input.tgl, "Keluar", "Harga pokok penjualan", &notrans, (&pemasok, &namapemasok), jmlbayar, "Pembayaran Pembelian")?;
    Ok(json!({ "notrans": notrans, "total": t.total }))
}

#[derive(Deserialize)]
pub struct OpnameItem {
    pub kodebarang: String,
    pub stokfisik: f64,
}

#[perintah]
pub fn save_opname(db: &Db, session: &Session, tgl: String, catatan: String, items: Vec<OpnameItem>) -> Res<Value> {
    let user = session.user()?;
    let mut conn = db.lock()?;
    crate::auth::require_menu(&conn, &user, "mnInvStokOpname")?;
    opname(&mut *conn, &user, &tgl, &catatan, &items)
}

pub fn opname(conn: &mut Connection, user: &User, tgl: &str, catatan: &str, items: &[OpnameItem]) -> Res<Value> {
    if user.level == "Kasir" {
        return Err("Akun kasir tidak bisa mencatat stok opname.".into());
    }
    check_date(tgl)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    let notrans = next_number(&tx, "transaksi", "notrans", "OP", tgl)?;
    tx.execute(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,jenis,kodekaryawan,catatan,tahun,bulan,tglupload,jamupload)
         VALUES (?1,?2,?3,'OP','Stok Opname',?4,?5,?6,?7,date('now','localtime'),time('now','localtime'))",
        params![next_id(&tx, "transaksi", "tid")?, notrans, tgl, user.kodekaryawan, catatan, &tgl[0..4], &tgl[5..7]],
    ).map_err(e)?;
    let mut n = 0;
    for it in items {
        let (nama, satuan, stok, hrgbeli): (String, String, f64, f64) = tx
            .query_row(
                "SELECT COALESCE(namabarang,''), COALESCE(kodesatuan,''), COALESCE(stokakhir,0), COALESCE(hrgbeli,0) FROM mdbarang WHERE kodebarang = ?1 AND jenis='Barang'",
                params![it.kodebarang],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|_| format!("Barang {} tidak ditemukan.", it.kodebarang))?;
        let selisih = round2(it.stokfisik - stok);
        if selisih.abs() < 0.005 {
            continue;
        }
        n += 1;
        tx.execute(
            "INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,satuanjual,jmljual,konversi,stokasal,subtotal)
             VALUES (?1,'OP',?2,?3,?4,?5,?6,?7,?5,?6,1,?8,?9)",
            params![notrans, n, it.kodebarang, nama, satuan, selisih, hrgbeli, stok, round2(selisih * hrgbeli)],
        ).map_err(e)?;
    }
    if n == 0 {
        return Err("Semua stok fisik sama dengan stok di sistem, jadi tidak ada yang perlu disimpan.".into());
    }
    tx.commit().map_err(e)?;
    Ok(json!({ "notrans": notrans, "jumlah": n }))
}

/// Syarat tambahan barang di layar kasir. Pengaturan IZINSTOKMIN = 0 (semua level): hanya barang yang masih ada stoknya, atau jasa.
fn syarat_stok_kasir(conn: &Connection) -> &'static str {
    let izin: i64 = conn.query_row("SELECT COALESCE(izinstokmin,0) FROM tseting LIMIT 1", [], |r| r.get(0)).unwrap_or(0);
    if izin == 1 { "" } else { " AND ((jenis='Barang' AND stokakhir>0) OR jenis='Jasa')" }
}

/// Cari barang untuk layar kasir (daftar F10): sama dengan Cari Barang di master, tanpa batas stok.
pub fn cari_barang_kasir(conn: &Connection, search: &str, limit: i64) -> Res<Vec<Value>> {
    crate::master::cari_barang_daftar(conn, search, limit)
}

#[perintah]
pub fn barang_cari_kasir(db: &Db, search: String, limit: Option<i64>) -> Res<Vec<Value>> {
    cari_barang_kasir(&*db.lock()?, &search, limit.unwrap_or(100))
}

/// Cari satu barang dari kode atau barcode yang di-scan di layar kasir; aturan stoknya sama dengan daftar F10.
pub fn cari_satu_kasir(conn: &Connection, code: &str) -> Res<Option<Value>> {
    let sql = format!(
        "SELECT * FROM mdbarang WHERE COALESCE(aktif,1) = 1{} AND (UPPER(kodebarang) = UPPER(?1) OR barcode = ?1 OR barcode2 = ?1) LIMIT 1",
        syarat_stok_kasir(conn)
    );
    one(conn, &sql, params![code.trim()])
}

#[perintah]
pub fn barang_find_kasir(db: &Db, code: String) -> Res<Option<Value>> {
    cari_satu_kasir(&*db.lock()?, &code)
}

#[perintah]
pub fn preview_notrans(db: &Db, kode: String, tgl: String) -> Res<String> {
    check_date(&tgl)?;
    let conn = db.lock()?;
    next_number(&conn, "transaksi", "notrans", &kode, &tgl)
}

#[perintah]
pub fn list_transaksi(db: &Db, kode: String, dari: String, sampai: String, search: Option<String>) -> Res<Vec<Value>> {
    let conn = db.lock()?;
    let s = format!("%{}%", search.unwrap_or_default().trim().to_uppercase());
    rows(
        &conn,
        "SELECT t.notrans, t.tgltrans, t.kode, t.carabayar, t.totaltrans, t.jmlbayar, t.sisa, t.catatan,
                COALESCE(p.namapelanggan, s.namapemasok, NULLIF(t.kodepelanggan,''), t.kodepemasok) AS kontak,
                COALESCE(k.namakaryawan, t.kodekaryawan) AS kasir, COALESCE(sl.namakaryawan, t.kodesales, '') AS sales
         FROM transaksi t
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
         LEFT JOIN mdkaryawan sl ON sl.kodekaryawan = t.kodesales
         WHERE t.kode = ?1 AND t.tgltrans BETWEEN ?2 AND ?3
           AND (UPPER(t.notrans) LIKE ?4 OR UPPER(COALESCE(t.kodepelanggan,'')) LIKE ?4 OR UPPER(COALESCE(t.kodepemasok,'')) LIKE ?4
                OR UPPER(COALESCE(t.kodesales,'')) LIKE ?4 OR UPPER(COALESCE(p.namapelanggan,'')) LIKE ?4
                OR UPPER(COALESCE(s.namapemasok,'')) LIKE ?4 OR UPPER(COALESCE(sl.namakaryawan,'')) LIKE ?4)
         ORDER BY t.notrans LIMIT 2000",
        params![kode, dari, sampai, s],
    )
}

#[perintah]
pub fn get_transaksi(db: &Db, notrans: String) -> Res<Value> {
    let conn = db.lock()?;
    let mut header = one(
        &conn,
        "SELECT t.*, COALESCE(p.namapelanggan, t.kodepelanggan) AS namapelanggan, COALESCE(s.namapemasok, t.kodepemasok) AS namapemasok,
                COALESCE(k.namakaryawan, t.kodekaryawan) AS namakasir
         FROM transaksi t
         LEFT JOIN mdpelanggan p ON p.kodepelanggan = t.kodepelanggan
         LEFT JOIN mdpemasok s ON s.kodepemasok = t.kodepemasok
         LEFT JOIN mdkaryawan k ON k.kodekaryawan = t.kodekaryawan
         WHERE t.notrans = ?1",
        params![notrans],
    )?
    .ok_or("Transaksi tidak ditemukan.")?;
    // Data lama menyimpan SUBTOTAL = 0, jadi subtotal dihitung ulang dari jumlah x harga.
    let detail = rows(
        &conn,
        "SELECT nourut, kodebarang, namabarang, satuanjual, jmljual, hrgterjual, disknilai, jml, stokasal,
                (jmljual * hrgterjual - COALESCE(disknilai,0)) AS subtotal
         FROM transaksidetil WHERE notrans = ?1 ORDER BY nourut",
        params![notrans],
    )?;
    // Poin yang didapat dari transaksi ini dan saldo sesudahnya (kalau ada).
    let poin = one(&conn, "SELECT poinmasuk, poinawal + poinmasuk - poinkeluar AS poinakhir FROM transaksipoin WHERE reftukar = ?1 AND poinmasuk > 0 ORDER BY notukar LIMIT 1", params![notrans])?;
    if let (Some(p), Some(h)) = (poin, header.as_object_mut()) {
        h.insert("poinmasuk".into(), p["poinmasuk"].clone());
        h.insert("poinakhir".into(), p["poinakhir"].clone());
    }
    Ok(json!({ "header": header, "detail": detail }))
}
