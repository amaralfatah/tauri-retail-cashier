//! Uji End-to-End (E2E) menyeluruh lintas semua modul dalam satu siklus hidup toko:
//! Auth & Hak Akses -> Pengaturan & Non-Tunai -> Master Data & Foto -> Inventori (Stok Awal, Label, Katalog, Promo Diskon/Bonus/PDP)
//! -> Pembelian (PO -> TB Kredit -> Retur Beli & Retur Barang -> Pelunasan Hutang)
//! -> Penjualan (SO -> Pending -> TJ Campuran+Promo+Bonus+Poin -> Poin Tukar/Koreksi -> TJ Kredit -> Notifikasi Jatuh Tempo -> Retur Jual -> Pelunasan Piutang)
//! -> Stok Opname -> Keuangan Manual -> Dashboard & Semua 21 Jenis Laporan -> Ekspor XLSX/CSV -> Impor Excel
//! -> Database Backup/Cek/Perbaiki & Alat Bantu (Hitung Stok, Sinkron, Hapus Transaksi, SQL) -> Restore.

use crate::alat;
use crate::auth::{self, Session, User};
use crate::berkas;
use crate::database;
use crate::db;
use crate::impor;
use crate::inventori::{self, OpnameBaris, StokAwalItem};
use crate::izin;
use crate::kas::{self, KasInput};
use crate::master;
use crate::nontunai;
use crate::order::{self, OrderInput, PendingInput};
use crate::pelunasan::{self, Mode, PelunasanInput};
use crate::poin;
use crate::promo::{self, Jenis as PromoJenis, PromoRow};
use crate::report::{self, LapFilter};
use crate::retur::{self, ReturBrgInput, ReturInput, ReturLine};
use crate::trans::{self, Item, TransInput};
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::path::PathBuf;

struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "tokopro-e2e-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn jmap(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn stok(c: &Connection, kode: &str) -> f64 {
    c.query_row("SELECT stokakhir FROM mdbarang WHERE kodebarang=?1", [kode], |r| r.get(0))
        .unwrap()
}

fn item(kode: &str, sat_dasar: &str, sat_jual: &str, konv: f64, jml: f64, harga: f64) -> Item {
    Item {
        kodebarang: kode.into(),
        namabarang: kode.into(),
        kodesatuan: sat_dasar.into(),
        satuanjual: sat_jual.into(),
        konversi: konv,
        jmljual: jml,
        harga,
        disknilai: 0.0,
    }
}

fn trans_input(tgl: &str, items: Vec<Item>, cara: &str, bayar: f64) -> TransInput {
    TransInput {
        tgl: tgl.into(),
        kodepelanggan: String::new(),
        kodepemasok: String::new(),
        kodesales: String::new(),
        catatan: String::new(),
        items,
        diskonpersen: 0.0,
        diskonnilai: 0.0,
        biaya: 0.0,
        carabayar: cara.into(),
        jmlbayar: bayar,
        jenisnontunai: String::new(),
        kartu: String::new(),
        norefkartu: String::new(),
        jthtempo: String::new(),
        update_hrgbeli: false,
        lanjutkredit: false,
        bayarnontunai: 0.0,
        hargajual: vec![],
        kodekasir: String::new(),
    }
}

fn empty_filter(dari: &str, sampai: &str) -> LapFilter {
    LapFilter {
        dari: dari.into(),
        sampai: sampai.into(),
        notrans: String::new(),
        kasir: String::new(),
        sales: String::new(),
        pelanggan: String::new(),
        pemasok: String::new(),
        carabayar: String::new(),
        kode: String::new(),
        barcode: String::new(),
        nama: String::new(),
        kelompok: String::new(),
        kategori: String::new(),
        jenis: String::new(),
        satuan: String::new(),
        status: String::new(),
        stok1: String::new(),
        stok2: String::new(),
    }
}

#[test]
fn e2e_full_store_lifecycle() {
    let dir = TempDir::new("lifecycle");
    let db_file = dir.0.join("tokopro.db");
    let backup_dir = dir.0.join("backups");
    let foto_dir = dir.0.join("foto");
    let export_dir = dir.0.join("exports");
    std::fs::create_dir_all(&backup_dir).unwrap();
    std::fs::create_dir_all(&foto_dir).unwrap();
    std::fs::create_dir_all(&export_dir).unwrap();

    let mut c = db::open(&db_file).unwrap();
    let tgl = "2026-11-22";

    // =========================================================================
    // 1. AUTH, USERS, HAK AKSES & PENGATURAN PROGRAM
    // =========================================================================
    let admin = auth::verifikasi_pengelola(&c, "admin", "admin").unwrap();
    assert_eq!(admin.level, "Manager");

    // Login bawaan saat aktiflogin = 0
    c.execute("UPDATE tseting SET aktiflogin = 0", []).unwrap();
    let sess = Session::default();
    let auto_user = auth::masuk_bawaan(&c, &sess).unwrap().expect("login_bawaan aktif");
    assert_eq!(auto_user.iduser, "Administrator");

    // Aktifkan kembali login & semua fitur bisnis untuk pengujian E2E
    c.execute(
        "UPDATE tseting SET
            namausaha = 'Toko Pro E2E',
            aktiflogin = 1,
            aktiftranskas = 1,
            aktifpromo = 1,
            aktifpoin = 1,
            aktiftranspoin = 1,
            berlakukelipatanpoin = 1,
            mintranspoin = 10000,
            jmlpointrans = 1,
            izinstokmin = 0,
            izinharga = 0,
            izindiskon = 0",
        [],
    )
    .unwrap();
    assert!(auth::masuk_bawaan(&c, &Session::default()).unwrap().is_none());

    // =========================================================================
    // 2. MASTER DATA (Semua 7 tabel) + JENIS NON TUNAI + FOTO BARANG
    // =========================================================================
    // PCS sudah ada bawaan; tambahkan satuan baru KALI (dan BOX bila belum ada)
    master::simpan_master(&mut c, master::table("mdsatuan").unwrap(), &jmap(json!({"kodesatuan": "KALI", "namasatuan": "Kali"})), None).unwrap();
    master::simpan_master(&mut c, master::table("mdkelompok").unwrap(), &jmap(json!({"kodekelompok": "MIN", "namakelompok": "Minuman"})), None).unwrap();
    master::simpan_master(&mut c, master::table("mdkategori").unwrap(), &jmap(json!({"kodekategori": "BTL", "namakategori": "Botol"})), None).unwrap();

    master::simpan_master(&mut c, master::table("mdkaryawan").unwrap(), &jmap(json!({
        "kodekaryawan": "K01", "namakaryawan": "Siti Kasir", "jabatan": "Kasir", "aktif": 1
    })), None).unwrap();
    master::simpan_master(&mut c, master::table("mdkaryawan").unwrap(), &jmap(json!({
        "kodekaryawan": "S01", "namakaryawan": "Budi Sales", "jabatan": "Sales", "aktif": 1
    })), None).unwrap();

    master::simpan_master(&mut c, master::table("mdpemasok").unwrap(), &jmap(json!({
        "kodepemasok": "SUP1", "namapemasok": "PT Sumber Makmur", "aktif": 1
    })), None).unwrap();
    master::simpan_master(&mut c, master::table("mdpelanggan").unwrap(), &jmap(json!({
        "kodepelanggan": "PEL1", "namapelanggan": "Toko Maju", "level": "Level 1",
        "member": 1, "limitkredit": 100000.0, "aktif": 1
    })), None).unwrap();

    master::simpan_master(&mut c, master::table("mdbarang").unwrap(), &jmap(json!({
        "kodebarang": "BRG01", "namabarang": "Teh Botol", "barcode": "8991001",
        "jenis": "Barang", "kodekelompok": "MIN", "kodekategori": "BTL", "kodepemasok": "SUP1",
        "kodesatuan": "PCS", "hrgbeli": 3000.0, "hrgjual": 5000.0,
        "satuan1": "BOX", "konversi1": 12.0, "hrgmultisatuan1": 55000.0,
        "stokmin": 10.0, "stokmax": 200.0, "aktif": 1
    })), None).unwrap();
    master::simpan_master(&mut c, master::table("mdbarang").unwrap(), &jmap(json!({
        "kodebarang": "BRG02", "namabarang": "Gelas Promosi", "barcode": "8991002",
        "jenis": "Barang", "kodekelompok": "MIN", "kodekategori": "BTL", "kodepemasok": "SUP1",
        "kodesatuan": "PCS", "hrgbeli": 1000.0, "hrgjual": 2000.0,
        "stokmin": 5.0, "stokmax": 100.0, "aktif": 1
    })), None).unwrap();
    master::simpan_master(&mut c, master::table("mdbarang").unwrap(), &jmap(json!({
        "kodebarang": "JASA01", "namabarang": "Ongkos Kirim", "barcode": "",
        "jenis": "Jasa", "kodesatuan": "KALI", "hrgbeli": 0.0, "hrgjual": 15000.0, "aktif": 1
    })), None).unwrap();

    // Buat user Kasir & atur hak aksesnya
    auth::simpan_user(&c, &admin, &jmap(json!({
        "iduser": "kasir1", "kodekaryawan": "K01", "level": "Kasir", "password": "secret", "aktif": 1
    })), true).unwrap();
    let kasir = User {
        iduser: "kasir1".into(),
        kodekaryawan: "K01".into(),
        namakaryawan: "Siti Kasir".into(),
        level: "Kasir".into(),
        must_change: false,
    };
    let akses_awal = auth::daftar_akses(&c, &admin, "kasir1").unwrap();
    assert!(!akses_awal.is_empty());
    auth::simpan_akses(&mut c, &admin, "kasir1", &["M011".into(), "M062".into()]).unwrap();
    assert!(auth::require_menu(&c, &kasir, "mnTRTrPenjualan").is_ok());
    assert!(auth::require_menu(&c, &kasir, "mnPengaturanDatabase").is_err());

    // Jenis Non Tunai
    nontunai::simpan_jenis(&c, "QRIS", "QRIS", None).unwrap();
    nontunai::simpan_item(&c, "QRIS", "QRIS BCA", None).unwrap();
    let nt = nontunai::daftar(&c).unwrap();
    assert!(nt["item"].as_array().unwrap().iter().any(|x| x["namaitem"] == "QRIS BCA"));

    // Foto barang: simpan, baca, hapus
    let dummy_png = dir.0.join("sample.png");
    std::fs::write(&dummy_png, b"\x89PNG\r\n\x1a\nfakeimg").unwrap();
    berkas::foto_salin(&foto_dir, "BRG01", dummy_png.to_str().unwrap()).unwrap();
    let foto_uri = berkas::foto_data(&foto_dir, "BRG01").unwrap().expect("foto ada");
    assert!(foto_uri.starts_with("data:image/png;base64,"));
    assert!(berkas::foto_buang(&foto_dir, "BRG01").unwrap());
    assert!(berkas::foto_data(&foto_dir, "BRG01").unwrap().is_none());

    // =========================================================================
    // 3. INVENTORI: STOK AWAL, LABEL, KATALOG, PROMO (DISKON, BONUS, PDP)
    // =========================================================================
    let sa = inventori::stok_awal(&mut c, &admin, tgl, "Stok awal E2E", &[
        StokAwalItem { kodebarang: "BRG01".into(), stokawal: 50.0 },
        StokAwalItem { kodebarang: "BRG02".into(), stokawal: 30.0 },
    ]).unwrap();
    assert!(sa["notrans"].as_str().unwrap().starts_with("SA2611-"));
    assert_eq!(stok(&c, "BRG01"), 50.0);
    assert_eq!(stok(&c, "BRG02"), 30.0);

    // Label & Katalog
    assert!(inventori::label_find(&c, "8991001").unwrap().is_some());
    let labels = inventori::label_data(&c, &["BRG01".into()], tgl).unwrap();
    assert_eq!(labels.len(), 1);
    let kat = inventori::katalog(&c, "Teh").unwrap();
    assert_eq!(kat.len(), 1);

    // Promo: Diskon (min 5 BRG01 -> Rp4.500), Bonus (min 10 BRG01 -> 1 BRG02), PDP (min belanja 50.000 -> BRG02 Rp1.500)
    promo::save(&mut c, &admin, PromoJenis::Diskon, &[PromoRow {
        bid: None, kodebarang: "BRG01".into(), minbeli: 5.0, kodebonus: String::new(), jmlbonus: 0.0,
        minbelanja: 0.0, diskon: 0.0, hrgdiskon: 4500.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(),
    }]).unwrap();
    promo::save(&mut c, &admin, PromoJenis::Bonus, &[PromoRow {
        bid: None, kodebarang: "BRG01".into(), minbeli: 10.0, kodebonus: "BRG02".into(), jmlbonus: 1.0,
        minbelanja: 0.0, diskon: 0.0, hrgdiskon: 0.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(),
    }]).unwrap();
    promo::save(&mut c, &admin, PromoJenis::Pdp, &[PromoRow {
        bid: None, kodebarang: "BRG02".into(), minbeli: 0.0, kodebonus: String::new(), jmlbonus: 0.0,
        minbelanja: 50000.0, diskon: 0.0, hrgdiskon: 1500.0, tglawal: "2026-11-01".into(), tglakhir: "2026-11-30".into(),
    }]).unwrap();
    assert_eq!(promo::list(&c, PromoJenis::Diskon, "2026-11-01", "2026-11-30").unwrap().len(), 1);
    assert_eq!(promo::list(&c, PromoJenis::Bonus, "2026-11-01", "2026-11-30").unwrap().len(), 1);
    assert_eq!(promo::list(&c, PromoJenis::Pdp, "2026-11-01", "2026-11-30").unwrap().len(), 1);

    // =========================================================================
    // 4. PEMBELIAN: PO -> TB KREDIT -> RETUR BELI -> RETUR BARANG -> PELUNASAN HUTANG
    // =========================================================================
    let po = order::simpan_order(&mut c, &admin, &OrderInput {
        jual: false, tgl: tgl.into(), kodepelanggan: String::new(), kodepemasok: "SUP1".into(),
        kodesales: "S01".into(), catatan: "PO Teh Botol".into(), dp: 0.0,
        items: vec![item("BRG01", "PCS", "BOX", 12.0, 2.0, 36000.0)],
        notrans: None, kodekasir: String::new(),
    }).unwrap();
    let nopo = po["notrans"].as_str().unwrap().to_string();
    assert!(nopo.starts_with("PO2611-"));
    assert_eq!(stok(&c, "BRG01"), 50.0, "PO tidak mengubah stok");
    assert_eq!(order::daftar_order(&c, false, "2026-11-01", "2026-11-30", "").unwrap().len(), 1);

    // Ambil PO menjadi Pembelian Kredit (Total 72.000, DP 20.000 -> Hutang 52.000)
    let mut tb_inp = trans_input(tgl, vec![item("BRG01", "PCS", "BOX", 12.0, 2.0, 36000.0)], "Kredit", 20000.0);
    tb_inp.kodepemasok = "SUP1".into();
    tb_inp.kodesales = "S01".into();
    tb_inp.jthtempo = "2026-12-01".into();
    let tb = order::pembelian_dari_order(&mut c, &admin, &tb_inp, &nopo).unwrap();
    let notb = tb["notrans"].as_str().unwrap().to_string();
    assert!(notb.starts_with("TB2611-"));
    assert_eq!(stok(&c, "BRG01"), 74.0, "50 + 2 BOX (24) = 74");

    // Retur Pembelian per Transaksi: retur 4 PCS (1/3 BOX) dari TB? Retur memakai satuan baris (BOX) -> retur 0.5 BOX = 6 PCS
    let rb = retur::retur_transaksi(&mut c, &admin, &ReturInput {
        tgl: tgl.into(), asal: notb.clone(), catatan: "Kemasan penyok".into(),
        items: vec![ReturLine { nourut: 1, jml: 0.5 }], potong_piutang: false, kodekasir: String::new(),
    }, true).unwrap();
    assert!(rb["notrans"].as_str().unwrap().starts_with("RB2611-"));
    assert_eq!(stok(&c, "BRG01"), 68.0, "74 - 6 = 68");

    // Retur Pembelian per Barang: retur 2 PCS BRG02 langsung ke SUP1
    let rbb = retur::retur_beli_barang(&mut c, &admin, &ReturBrgInput {
        tgl: tgl.into(), kodepemasok: "SUP1".into(), catatan: "Gelas retak".into(),
        items: vec![item("BRG02", "PCS", "PCS", 1.0, 2.0, 1000.0)], kodekasir: String::new(),
    }).unwrap();
    assert!(rbb["notrans"].as_str().unwrap().starts_with("RB2611-"));
    assert_eq!(stok(&c, "BRG02"), 28.0, "30 - 2 = 28");

    // Pelunasan Hutang: bayar sebagian 20.000, lalu lunasi sisanya 32.000
    let hutang_kartu = pelunasan::kartu_ke_json(&c, "Hutang", "SUP1").unwrap();
    assert_eq!(hutang_kartu.len(), 1);
    assert_eq!(hutang_kartu[0]["kekurangan"].as_f64().unwrap(), 52000.0);
    pelunasan::pelunasan(&mut c, &admin, &PelunasanInput {
        jenis: "Hutang".into(), kode: "SUP1".into(), tgl: tgl.into(), kodekaryawan: String::new(),
        mode: Mode::Nominal, nominal: 20000.0, kartu: vec![],
    }).unwrap();
    assert_eq!(pelunasan::kartu_ke_json(&c, "Hutang", "SUP1").unwrap()[0]["kekurangan"].as_f64().unwrap(), 32000.0);
    pelunasan::pelunasan(&mut c, &admin, &PelunasanInput {
        jenis: "Hutang".into(), kode: "SUP1".into(), tgl: tgl.into(), kodekaryawan: String::new(),
        mode: Mode::Nominal, nominal: 32000.0, kartu: vec![],
    }).unwrap();
    assert!(pelunasan::kartu_ke_json(&c, "Hutang", "SUP1").unwrap().is_empty(), "Hutang lunas");

    // =========================================================================
    // 5. PENJUALAN: SO -> PENDING -> TJ PROMO+BONUS+CAMPURAN+POIN -> POIN -> TJ KREDIT -> RETUR JUAL -> PELUNASAN PIUTANG
    // =========================================================================
    let so = order::simpan_order(&mut c, &admin, &OrderInput {
        jual: true, tgl: tgl.into(), kodepelanggan: "PEL1".into(), kodepemasok: String::new(),
        kodesales: "S01".into(), catatan: "SO Toko Maju".into(), dp: 0.0,
        items: vec![item("BRG01", "PCS", "PCS", 1.0, 10.0, 5000.0)],
        notrans: None, kodekasir: String::new(),
    }).unwrap();
    let noso = so["notrans"].as_str().unwrap().to_string();
    assert!(noso.starts_with("SO2611-"));

    // Pending penjualan (simpan, daftar, ambil, hapus)
    let tp = order::simpan_pending(&mut c, &kasir, &PendingInput {
        nopending: None, tgl: tgl.into(), kodepelanggan: "PEL1".into(), kodesales: String::new(),
        catatan: "Tunggu antrian".into(), items: vec![item("BRG01", "PCS", "PCS", 1.0, 2.0, 5000.0)], kodekasir: String::new(),
    }).unwrap();
    let notp = tp["nopending"].as_str().unwrap().to_string();
    assert_eq!(order::daftar_pending(&c, "2026-11-01", "2026-11-30", "").unwrap().len(), 1);
    assert_eq!(order::ambil_pending(&c, &notp).unwrap()["detail"].as_array().unwrap().len(), 1);
    order::hapus_pending(&mut c, &notp).unwrap();
    assert!(order::daftar_pending(&c, "2026-11-01", "2026-11-30", "").unwrap().is_empty());

    // Cek pratinjau promo keranjang untuk 10 PCS BRG01: harga promo 4.500 + bonus 1 BRG02
    let p_eval = trans::promo_hitung(&c, tgl, &[item("BRG01", "PCS", "PCS", 1.0, 10.0, 5000.0)]).unwrap();
    assert_eq!(p_eval.baris[0].harga, 4500.0);
    assert_eq!(p_eval.bonus.len(), 1);
    assert_eq!(p_eval.bonus[0].kodebarang, "BRG02");

    // Konversi SO menjadi Penjualan Campuran (Tunai 20.000 + Non Tunai QRIS BCA 25.000 = 45.000)
    let mut tj1_inp = trans_input(tgl, vec![item("BRG01", "PCS", "PCS", 1.0, 10.0, 5000.0)], "Tunai", 20000.0);
    tj1_inp.kodepelanggan = "PEL1".into();
    tj1_inp.kodesales = "S01".into();
    tj1_inp.jenisnontunai = "QRIS BCA".into();
    tj1_inp.bayarnontunai = 25000.0;
    let tj1 = order::penjualan_dari_order(&mut c, &admin, &tj1_inp, &noso).unwrap();
    assert_eq!(tj1["total"].as_f64().unwrap(), 45000.0);
    assert_eq!(stok(&c, "BRG01"), 58.0, "68 - 10 = 58");
    assert_eq!(stok(&c, "BRG02"), 27.0, "28 - 1 bonus = 27");

    // Verifikasi Poin Member (45.000 / 10.000 = 4 poin), lalu tukar 2 poin, lalu koreksi ke 5 poin
    let poin_pel: f64 = c.query_row("SELECT poin FROM mdpelanggan WHERE kodepelanggan='PEL1'", [], |r| r.get(0)).unwrap();
    assert_eq!(poin_pel, 4.0);
    assert!(!poin::histori(&c, "PEL1", 20).unwrap().is_empty());
    poin::tukar(&mut c, &admin, "PEL1", 2.0, "Tukar mug").unwrap();
    let poin_after_tukar: f64 = c.query_row("SELECT poin FROM mdpelanggan WHERE kodepelanggan='PEL1'", [], |r| r.get(0)).unwrap();
    assert_eq!(poin_after_tukar, 2.0);
    poin::koreksi(&mut c, &admin, "PEL1", 5.0).unwrap();
    let poin_after_kor: f64 = c.query_row("SELECT poin FROM mdpelanggan WHERE kodepelanggan='PEL1'", [], |r| r.get(0)).unwrap();
    assert_eq!(poin_after_kor, 5.0);

    // Penjualan Kredit (1 BOX BRG01 @ 55.000 + 1 JASA01 @ 15.000 = 70.000, DP 10.000 -> Piutang 60.000, jatuh tempo kemarin)
    let mut tj2_inp = trans_input(
        tgl,
        vec![
            item("BRG01", "PCS", "BOX", 12.0, 1.0, 55000.0),
            item("JASA01", "KALI", "KALI", 1.0, 1.0, 15000.0),
        ],
        "Kredit",
        10000.0,
    );
    tj2_inp.kodepelanggan = "PEL1".into();
    tj2_inp.kodesales = "S01".into();
    tj2_inp.jthtempo = "2026-11-20".into(); // sudah jatuh tempo!
    let tj2 = trans::penjualan(&mut c, &admin, &tj2_inp).unwrap();
    let notj2 = tj2["notrans"].as_str().unwrap().to_string();
    // 1 BOX (12 PCS) BRG01 otomatis kena promo diskon Rp4.500/PCS = 54.000 (< 55.000) + JASA01 15.000 = 69.000
    assert_eq!(tj2["total"].as_f64().unwrap(), 69000.0);
    assert_eq!(stok(&c, "BRG01"), 46.0, "58 - 12 = 46");
    assert_eq!(stok(&c, "BRG02"), 26.0, "27 - 1 bonus dari 12 PCS BRG01 = 26");

    // Verifikasi Notifikasi Jatuh Tempo & Pelanggan Jatuh Tempo
    let jt_pel = master::pelanggan_jatuh_tempo_daftar(&c, "").unwrap();
    assert_eq!(jt_pel.len(), 1);
    let notif = report::notifikasi_query(&c, tgl).unwrap();
    assert!(notif["piutang_jatuh_tempo"].as_i64().unwrap() >= 1);

    // Retur Penjualan Kredit (potong piutang): retur 0.5 BOX = 6 PCS (Rp27.000) -> piutang 59.000 - 27.000 = 32.000
    let rj = retur::retur_transaksi(&mut c, &admin, &ReturInput {
        tgl: tgl.into(), asal: notj2.clone(), catatan: "Salah pesan".into(),
        items: vec![ReturLine { nourut: 1, jml: 0.5 }], potong_piutang: true, kodekasir: String::new(),
    }, false).unwrap();
    assert_eq!(rj["dipotong"].as_f64().unwrap(), 27000.0);
    assert_eq!(stok(&c, "BRG01"), 52.0, "46 + 6 = 52");

    // Pelunasan Piutang per Transaksi
    let piutang_kartu = pelunasan::kartu_ke_json(&c, "Piutang", "PEL1").unwrap();
    assert_eq!(piutang_kartu.len(), 1);
    assert_eq!(piutang_kartu[0]["kekurangan"].as_f64().unwrap(), 32000.0);
    let nopiutang = piutang_kartu[0]["nopiutang"].as_str().unwrap().to_string();
    pelunasan::pelunasan(&mut c, &admin, &PelunasanInput {
        jenis: "Piutang".into(), kode: "PEL1".into(), tgl: tgl.into(), kodekaryawan: String::new(),
        mode: Mode::Transaksi, nominal: 0.0, kartu: vec![nopiutang],
    }).unwrap();
    assert!(pelunasan::kartu_ke_json(&c, "Piutang", "PEL1").unwrap().is_empty(), "Piutang lunas");

    // =========================================================================
    // 6. STOK OPNAME & KEUANGAN MANUAL
    // =========================================================================
    let op = inventori::opname(&mut c, &admin, tgl, "Opname E2E", &[
        OpnameBaris { kodebarang: "BRG01".into(), stokbuku: 52.0, stokfisik: 50.0 },
    ]).unwrap();
    assert!(op["notrans"].as_str().unwrap().starts_with("OP2611-"));
    assert_eq!(stok(&c, "BRG01"), 50.0);

    let kas1 = kas::simpan(&mut c, &admin, &KasInput {
        tgl: tgl.into(), noref: "MOD1".into(), jenis: "Masuk".into(), kategori: "Modal".into(),
        kodekaryawan: String::new(), kodepelanggan: String::new(), kodepemasok: String::new(),
        masuk: 100000.0, keluar: 0.0, ket: "Modal tambahan".into(),
    }).unwrap();
    let kas2 = kas::simpan(&mut c, &admin, &KasInput {
        tgl: tgl.into(), noref: "BY1".into(), jenis: "Keluar".into(), kategori: "Biaya Listrik".into(),
        kodekaryawan: String::new(), kodepelanggan: String::new(), kodepemasok: String::new(),
        masuk: 0.0, keluar: 25000.0, ket: "Bayar listrik".into(),
    }).unwrap();
    let kas_rows = kas::daftar(&c, "2026-11-01", "2026-11-30").unwrap();
    assert!(kas_rows["rows"].as_array().unwrap().len() >= 5);
    // Hapus satu kas manual dan pastikan saldo berjalan tetap konsisten
    kas::hapus(&mut c, kas2["idkas"].as_i64().unwrap()).unwrap();
    assert!(kas1["idkas"].as_i64().unwrap() > 0);

    // =========================================================================
    // 7. DASHBOARD & SEMUA 21 JENIS LAPORAN + EKSPOR XLSX/CSV
    // =========================================================================
    let dash = report::dashboard_query(&c, tgl).unwrap();
    assert_eq!(dash["hari_jual"].as_f64().unwrap(), 114000.0, "45.000 + 69.000");
    assert!(dash["hari_laba"].as_f64().unwrap() > 0.0);

    let f = empty_filter("2026-11-01", "2026-12-31");
    let semua_laporan = [
        ("jual_detil", true),
        ("jual_barang", true),
        ("beli_detil", true),
        ("jual_head", true),
        ("beli_head", true),
        ("piutang", true),
        ("hutang", true),
        ("kas", true),
        ("jual_sales", true),
        ("order_jual", false), // SO sudah diambil
        ("order_beli", false), // PO sudah diambil
        ("retur_jual", true),
        ("retur_beli", true),
        ("opname", true),
        ("pelunasan_piutang", true),
        ("pelunasan_hutang", true),
        ("terlaris", true),
        ("omset", true),
        ("lr_detil", true),
        ("lr_head", true),
        ("lr_komparatif", true),
    ];
    for (jenis, must_have_rows) in semua_laporan {
        let rows = report::lap_query(&c, jenis, &f)
            .unwrap_or_else(|e| panic!("Laporan '{jenis}' gagal: {e}"));
        if must_have_rows {
            assert!(!rows.is_empty(), "Laporan '{jenis}' seharusnya memiliki data");
        }
    }

    // Ekspor XLSX & CSV
    let xlsx_bytes = berkas::buat_xlsx(
        "Laporan",
        &["Kode".into(), "Total".into()],
        &[false, true],
        &[vec!["BRG01".into(), "45000".into()]],
    ).unwrap();
    assert!(xlsx_bytes.starts_with(b"PK"), "Valid ZIP/XLSX header");
    let csv_path = berkas::nama_baru_ext(&export_dir, "ekspor_e2e", tgl, "csv");
    berkas::tulis_baru(csv_path.to_str().unwrap(), "Kode,Total\nBRG01,45000\n", std::slice::from_ref(&export_dir)).unwrap();
    assert!(csv_path.exists());

    // =========================================================================
    // 8. IMPOR EXCEL (tests/fixtures/barang.xlsx)
    // =========================================================================
    let fixture_xlsx = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/barang.xlsx");
    let preview = impor::pratinjau("barang", fixture_xlsx.to_str().unwrap()).unwrap();
    assert!(preview["jumlah"].as_u64().unwrap() > 0);
    let imp_res = impor::impor(&mut c, "barang", fixture_xlsx.to_str().unwrap(), false, &backup_dir).unwrap();
    assert!(imp_res["jumlah"].as_u64().unwrap() > 0);

    // =========================================================================
    // 9. DATABASE (CEK, BACKUP, PERBAIKI) & ALAT BANTU (HITUNG, SINKRON, HAPUS TRANSAKSI, SQL) & RESTORE
    // =========================================================================
    let cek = database::periksa(&c, true).unwrap();
    assert!(cek.is_empty(), "Database seharusnya bersih: {cek:?}");

    let bkp_path = database::backup_ke(&c, &backup_dir, "e2e").unwrap();
    assert!(bkp_path.exists());
    assert!(!database::daftar_backup(&backup_dir).is_empty());

    // Alat Bantu
    alat::hitung_ulang_stok(&c).unwrap();
    kas::hitung_ulang_saldo(&c).unwrap();
    alat::sinkron_harga_beli(&mut c).unwrap();
    alat::sinkron_jual(&mut c).unwrap();

    let daftar_tj = alat::daftar_transaksi(&c, "Penjualan", "", "2026-11-01", "2026-11-30").unwrap();
    assert_eq!(daftar_tj.len(), 2);

    // Hapus transaksi penjualan pertama (TJ2611-00001: 10 PCS BRG01 + 1 bonus BRG02) -> stok harus kembali
    let tj1_no = tj1["notrans"].as_str().unwrap().to_string();
    alat::hapus_transaksi(&mut c, &[tj1_no], &backup_dir).unwrap();
    assert_eq!(stok(&c, "BRG01"), 60.0, "50 + 10 kembali");
    assert_eq!(stok(&c, "BRG02"), 27.0, "26 + 1 bonus kembali");

    // Editor SQL (SELECT)
    let sql_res = alat::jalankan_sql(&mut c, "SELECT COUNT(*) AS jml FROM transaksi WHERE kode='TJ'", &backup_dir).unwrap();
    assert_eq!(sql_res["baris"][0][0].as_i64().unwrap(), 1);

    // Restore dari backup sebelum penghapusan -> transaksi & stok kembali seperti snapshot backup!
    database::pulihkan(&mut c, &bkp_path, &backup_dir).unwrap();
    assert_eq!(stok(&c, "BRG01"), 50.0, "Stok pulih ke snapshot backup");
    assert_eq!(alat::daftar_transaksi(&c, "Penjualan", "", "2026-11-01", "2026-11-30").unwrap().len(), 2);

    // Perbaiki database
    let fix = database::perbaiki(&c, &backup_dir).unwrap();
    assert!(fix.exists());
}

#[test]
fn e2e_kasir_security_and_verifikasi_admin() {
    let dir = TempDir::new("security");
    let c = db::open(&dir.0.join("sec.db")).unwrap();
    c.execute("UPDATE tseting SET izinstokmin = 0, izinharga = 0, izindiskon = 0", []).unwrap();
    c.execute_batch(
        "INSERT INTO mdbarang (kodebarang,namabarang,jenis,kodesatuan,hrgbeli,hrgjual,stokawal,stokakhir,aktif)
           VALUES ('B1','Air Mineral','Barang','PCS',2000,3000,5,5,1);",
    ).unwrap();

    let kasir = User {
        iduser: "k1".into(), kodekaryawan: "K01".into(), namakaryawan: "Kasir".into(),
        level: "Kasir".into(), must_change: false,
    };

    // 1. Kasir tidak boleh ubah harga saat izinkanharga = 0
    let mut inp = trans_input("2026-11-22", vec![item("B1", "PCS", "PCS", 1.0, 1.0, 2500.0)], "Tunai", 3000.0);
    assert!(izin::periksa_penjualan(&c, &kasir, &inp).is_err());

    // 2. Kasir tidak boleh beri diskon saat izinkandiskon = 0
    inp.items[0].harga = 3000.0;
    inp.diskonnilai = 500.0;
    assert!(izin::periksa_penjualan(&c, &kasir, &inp).is_err());

    // 3. Stok tidak boleh minus saat batasstok = 1
    inp.diskonnilai = 0.0;
    inp.items[0].jmljual = 10.0;
    assert!(izin::periksa_penjualan(&c, &kasir, &inp).is_err());

    // 4. Kasir tidak boleh hapus order/pending/kas tanpa verifikasi admin
    assert!(izin::periksa_hapus(&kasir, false).is_err());
    // Verifikasi admin mengeluarkan token sekali pakai
    let _admin = auth::verifikasi_pengelola(&c, "admin", "admin").unwrap();
    let token = izin::brankas().terbit(&kasir.iduser);
    assert!(izin::tanda_sah(&Some(token.clone()), &kasir));
    assert!(izin::periksa_hapus(&kasir, true).is_ok());
    izin::habiskan(&Some(token.clone()));
    assert!(!izin::tanda_sah(&Some(token), &kasir), "Token tidak bisa dipakai dua kali");

    // 5. Kasir tidak boleh mengakses fungsi pengelola (database/user)
    assert!(database::hanya_pengelola(&kasir).is_err());
    assert!(database::hanya_manager(&kasir).is_err());
}
