//! Pembanding angka aplikasi baru dengan aplikasi lama (VB6 + Firebird) untuk data toko yang sama.
//!
//! Dilewati kalau `TOKOPRO_FB_DOCKER` kosong. Kalau diisi, tes ini:
//! 1. memindahkan salinan `DATAPOS.FDB` lewat jalur migrasi resmi (`pindahkan`),
//! 2. menghitung angka sisi baru (jumlah baris dan jumlah kolom tiap tabel, laporan, dashboard, stok),
//! 3. menulis semuanya ke `baru.json` dan `stok.json` di folder `TOKOPRO_BANDING_OUT`.
//!
//! Angka sisi lama dihitung skrip terpisah langsung di Firebird; skrip pembanding menulis `hasil.md`.
//! Tes ini tidak membandingkan apa pun sendiri, jadi lulus selama angka bisa dihitung.

use crate::db::{self, Db};
use crate::pindah_lama::*;
use crate::report::{dashboard_query, lap_query, laporan_stok, notifikasi_query, LapFilter};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::Mutex;

type Metrik = BTreeMap<String, Value>;

fn angka(v: &Value, k: &str) -> f64 {
    match v.get(k) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn teks(v: &Value, k: &str) -> String {
    match v.get(k) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn jumlah(rows: &[Value], k: &str) -> f64 {
    rows.iter().map(|r| angka(r, k)).sum()
}

/// Jumlah kolom `k` dengan tiap nota dihitung sekali (nilai di baris pertama nota itu).
fn jumlah_per_nota(rows: &[Value], k: &str) -> f64 {
    let mut lihat = std::collections::HashSet::new();
    rows.iter().filter(|r| lihat.insert(teks(r, "notrans"))).map(|r| angka(r, k)).sum()
}

fn beda(rows: &[Value], k: &str) -> usize {
    rows.iter().map(|r| teks(r, k)).collect::<std::collections::HashSet<_>>().len()
}

fn taruh(m: &mut Metrik, k: String, v: f64) {
    m.insert(k, json!(v));
}

fn filter_semua() -> LapFilter {
    LapFilter { dari: "0001-01-01".into(), sampai: "9999-12-31".into(), ..Default::default() }
}

fn tmp(nama: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("tokopro-banding-{nama}-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn stok_barang(c: &rusqlite::Connection) -> BTreeMap<String, Value> {
    let mut st = c.prepare("SELECT kodebarang, jenis, stokawal, stokmasuk, stokkeluar, stokopname, stokakhir FROM mdbarang").unwrap();
    st.query_map([], |r| {
        let kode: String = r.get::<_, Option<String>>(0)?.unwrap_or_default();
        let jenis: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
        let n = |i: usize| r.get::<_, Option<f64>>(i).map(|x| x.unwrap_or(0.0));
        Ok((kode, json!({ "jenis": jenis, "v": [n(2)?, n(3)?, n(4)?, n(5)?, n(6)?] })))
    })
    .unwrap()
    .map(|x| x.unwrap())
    .collect()
}

fn lap(c: &rusqlite::Connection, jenis: &str, f: &LapFilter) -> Vec<Value> {
    lap_query(c, jenis, f).unwrap_or_else(|er| panic!("{jenis}: {er}"))
}

fn metrik_laporan(c: &rusqlite::Connection, m: &mut Metrik) {
    let f = filter_semua();

    // ---- laporan per nota dengan rincian barang
    for jenis in ["jual_detil", "beli_detil", "jual_barang", "retur_jual", "retur_beli", "order_jual", "order_beli", "opname"] {
        let r = lap(c, jenis, &f);
        let p = format!("lap.{jenis}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        taruh(m, format!("{p}.nota"), beda(&r, "notrans") as f64);
        taruh(m, format!("{p}.sub"), jumlah(&r, "subtotal"));
        if ["jual_detil", "beli_detil", "jual_barang"].contains(&jenis) {
            taruh(m, format!("{p}.tot_nota"), jumlah_per_nota(&r, "totaltrans"));
            taruh(m, format!("{p}.diskon_nota"), jumlah_per_nota(&r, "diskonnilai"));
            taruh(m, format!("{p}.bayar_nota"), jumlah_per_nota(&r, "jmlbayar"));
            taruh(m, format!("{p}.sisa_nota"), jumlah_per_nota(&r, "sisa"));
        }
        if jenis == "jual_detil" || jenis == "jual_barang" {
            taruh(m, format!("{p}.laba"), jumlah(&r, "keuntungansubtotal"));
        }
        if jenis.starts_with("order") {
            taruh(m, format!("{p}.uangmuka_nota"), jumlah_per_nota(&r, "jmlbayar"));
        }
        if jenis == "opname" {
            taruh(m, format!("{p}.selisih"), jumlah(&r, "selisih"));
        }
    }

    // ---- laporan per nota tanpa rincian (harian, bulanan, supplier, sales)
    for jenis in ["jual_head", "beli_head", "jual_sales"] {
        let r = lap(c, jenis, &f);
        let p = format!("lap.{jenis}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        taruh(m, format!("{p}.tot"), jumlah(&r, "totaltrans"));
        let hari: std::collections::BTreeSet<String> = r.iter().map(|x| teks(x, "tgltrans")).collect();
        let mut per_bulan: BTreeMap<String, f64> = BTreeMap::new();
        for x in &r {
            *per_bulan.entry(teks(x, "tgltrans").chars().take(7).collect()).or_default() += angka(x, "totaltrans");
        }
        taruh(m, format!("{p}.hari"), hari.len() as f64);
        taruh(m, format!("{p}.bulan"), per_bulan.len() as f64);
        for (b, v) in per_bulan {
            taruh(m, format!("{p}.bulan.{b}"), v);
        }
        if jenis == "jual_sales" {
            let sales: std::collections::HashSet<String> = r.iter().map(|x| teks(x, "namasales")).collect();
            taruh(m, format!("{p}.sales"), sales.len() as f64);
        }
    }

    // ---- piutang dan hutang
    for jenis in ["piutang", "hutang"] {
        let r = lap(c, jenis, &f);
        let p = format!("lap.{jenis}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        for k in ["jmlpiutang", "jmlterbayar", "kekurangan"] {
            taruh(m, format!("{p}.{k}"), jumlah(&r, k));
        }
    }
    for jenis in ["pelunasan_piutang", "pelunasan_hutang"] {
        let r = lap(c, jenis, &f);
        let p = format!("lap.{jenis}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        taruh(m, format!("{p}.kartu"), beda(&r, "nopiutang") as f64);
        taruh(m, format!("{p}.jmlbayar"), jumlah(&r, "jmlbayar"));
        let mut lihat = std::collections::HashSet::new();
        let kartu: Vec<&Value> = r.iter().filter(|x| lihat.insert(teks(x, "nopiutang"))).collect();
        for k in ["jmlpiutang", "jmlterbayar", "kekurangan"] {
            taruh(m, format!("{p}.{k}_kartu"), kartu.iter().map(|x| angka(x, k)).sum());
        }
    }

    // ---- kas
    let r = lap(c, "kas", &f);
    taruh(m, "lap.kas.baris".into(), r.len() as f64);
    taruh(m, "lap.kas.masuk".into(), jumlah(&r, "masuk"));
    taruh(m, "lap.kas.keluar".into(), jumlah(&r, "keluar"));
    taruh(m, "lap.kas.saldo_akhir".into(), r.last().map(|x| angka(x, "saldo")).unwrap_or(0.0));

    // ---- terlaris dan omset
    for jenis in ["terlaris", "omset"] {
        let r = lap(c, jenis, &f);
        let p = format!("lap.{jenis}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        taruh(m, format!("{p}.jmltotal"), jumlah(&r, "jmltotal"));
        taruh(m, format!("{p}.jmlomset"), jumlah(&r, "jmlomset"));
        let kunci = if jenis == "terlaris" { "jmltotal" } else { "jmlomset" };
        for (i, x) in r.iter().take(10).enumerate() {
            m.insert(format!("{p}.top{}.kode", i + 1), json!(teks(x, "kodebarang")));
            taruh(m, format!("{p}.top{}.nilai", i + 1), angka(x, kunci));
        }
    }

    // ---- laba rugi
    let r = lap(c, "lr_detil", &f);
    taruh(m, "lap.lr_detil.baris".into(), r.len() as f64);
    taruh(m, "lap.lr_detil.nota".into(), beda(&r, "notrans") as f64);
    taruh(m, "lap.lr_detil.laba".into(), jumlah(&r, "keuntungansubtotal"));
    let per_kode = |kode: &str| r.iter().filter(|x| teks(x, "kode") == kode).map(|x| angka(x, "keuntungansubtotal")).sum::<f64>();
    taruh(m, "lap.lr_detil.laba_tj".into(), per_kode("TJ"));
    taruh(m, "lap.lr_detil.laba_rj".into(), per_kode("RJ"));
    taruh(m, "lap.lr_detil.baris_tj".into(), r.iter().filter(|x| teks(x, "kode") == "TJ").count() as f64);
    taruh(m, "lap.lr_detil.baris_rj".into(), r.iter().filter(|x| teks(x, "kode") == "RJ").count() as f64);
    let r = lap(c, "lr_head", &f);
    taruh(m, "lap.lr_head.baris".into(), r.len() as f64);
    taruh(m, "lap.lr_head.laba".into(), jumlah(&r, "laba"));
    let mut per_bulan: BTreeMap<String, f64> = BTreeMap::new();
    let mut per_hari: BTreeMap<String, f64> = BTreeMap::new();
    for x in &r {
        let t = teks(x, "tgltrans");
        *per_bulan.entry(t.chars().take(7).collect()).or_default() += angka(x, "laba");
        *per_hari.entry(t).or_default() += angka(x, "laba");
    }
    taruh(m, "lap.lr_head.hari".into(), per_hari.len() as f64);
    taruh(m, "lap.lr_head.bulan".into(), per_bulan.len() as f64);
    for (b, v) in per_bulan {
        taruh(m, format!("lap.lr_head.bulan.{b}"), v);
    }

    // ---- laba rugi komparatif: periode berjalan = bulan kas terakhir
    let akhir: String = c.query_row("SELECT COALESCE(MAX(tglkas),'') FROM keuangan", [], |x| x.get(0)).unwrap();
    let periode: String = format!("{}{}", akhir.get(0..4).unwrap_or(""), akhir.get(5..7).unwrap_or(""));
    m.insert("lap.lr_komparatif.periode".into(), json!(periode));
    let k = LapFilter { dari: akhir.clone(), ..Default::default() };
    for x in lap(c, "lr_komparatif", &k) {
        let kat = teks(&x, "kategori");
        for kol in ["lalu_masuk", "lalu_keluar", "mutasi_masuk", "mutasi_keluar", "semua_masuk", "semua_keluar"] {
            taruh(m, format!("lap.lr_komparatif.{kat}.{kol}"), angka(&x, kol));
        }
    }

    // ---- laporan stok. Layar laporan memuat seluruh mdbarang lalu menyaring di layar (`lewatBatas`).
    let semua = crate::db::rows(c, "SELECT * FROM mdbarang", []).unwrap();
    let mut stok_laporan = |nama: &str, r: Vec<&Value>| {
        let p = format!("lap.{nama}");
        taruh(m, format!("{p}.baris"), r.len() as f64);
        for k in ["stokawal", "stokmasuk", "stokkeluar", "stokopname", "stokakhir"] {
            taruh(m, format!("{p}.{k}"), r.iter().map(|x| angka(x, k)).sum());
        }
        taruh(m, format!("{p}.nilaibeli"), r.iter().map(|x| angka(x, "stokakhir") * angka(x, "hrgbeli")).sum());
        taruh(m, format!("{p}.nilaijual"), r.iter().map(|x| angka(x, "stokakhir") * angka(x, "hrgjual")).sum());
    };
    stok_laporan("stok", semua.iter().collect());
    stok_laporan("stok_min", semua.iter().filter(|x| angka(x, "stokakhir") <= angka(x, "stokmin")).collect());
    stok_laporan("stok_max", semua.iter().filter(|x| angka(x, "stokakhir") > angka(x, "stokmax")).collect());
}

fn metrik_dashboard(c: &rusqlite::Connection, m: &mut Metrik, tgl: &str) {
    let d = dashboard_query(c, tgl).unwrap();
    let p = format!("dash.{tgl}");
    for k in ["rata_jual", "hari_jual", "rata_laba", "hari_laba"] {
        taruh(m, format!("{p}.{k}"), d[k].as_f64().unwrap_or(0.0));
    }
    let daftar = |k: &str| d[k].as_array().cloned().unwrap_or_default();
    let p15 = daftar("penjualan15");
    taruh(m, format!("{p}.penjualan15.n"), p15.len() as f64);
    taruh(m, format!("{p}.penjualan15.sum"), jumlah(&p15, "total"));
    for x in &p15 {
        taruh(m, format!("{p}.penjualan15.{}", teks(x, "tgl")), angka(x, "total"));
    }
    for x in daftar("per_hari") {
        taruh(m, format!("{p}.per_hari.{}", angka(&x, "hari") as i64), angka(&x, "total"));
    }
    let l30 = daftar("laba30");
    taruh(m, format!("{p}.laba30.n"), l30.len() as f64);
    taruh(m, format!("{p}.laba30.sum"), jumlah(&l30, "total"));
    for x in &l30 {
        taruh(m, format!("{p}.laba30.{}", teks(x, "tgl")), angka(x, "total"));
    }
    let lb = daftar("laba_bulan");
    taruh(m, format!("{p}.laba_bulan.n"), lb.len() as f64);
    taruh(m, format!("{p}.laba_bulan.sum"), jumlah(&lb, "total"));
    for x in &lb {
        taruh(m, format!("{p}.laba_bulan.{}", teks(x, "bulan")), angka(x, "total"));
    }
    for (i, x) in daftar("pelanggan").iter().enumerate() {
        m.insert(format!("{p}.pelanggan.{}.kode", i + 1), json!(teks(x, "kode")));
        taruh(m, format!("{p}.pelanggan.{}.total", i + 1), angka(x, "total"));
    }
    let pi = daftar("piutang");
    taruh(m, format!("{p}.piutang.n"), pi.len() as f64);
    taruh(m, format!("{p}.piutang.sum"), jumlah(&pi, "piutang"));
    for x in &pi {
        taruh(m, format!("{p}.piutang.{}", teks(x, "kode")), angka(x, "piutang"));
    }
    let n = notifikasi_query(c, tgl).unwrap();
    taruh(m, format!("{p}.notif_jatuh_tempo"), n["piutang_jatuh_tempo"].as_f64().unwrap_or(0.0));
}

#[test]
fn banding_dengan_firebird_lama() {
    let container = std::env::var("TOKOPRO_FB_DOCKER").unwrap_or_default();
    if container.trim().is_empty() {
        eprintln!("dilewati: TOKOPRO_FB_DOCKER tidak diisi");
        return;
    }
    let container = container.trim().to_string();
    let keluar = std::env::var("TOKOPRO_BANDING_OUT").map(std::path::PathBuf::from).unwrap_or_else(|_| tmp("keluar"));
    std::fs::create_dir_all(&keluar).unwrap();

    // ---- 1. pindahkan lewat jalur resmi
    let d = tmp("kerja");
    let contoh = d.join("DATAPOS.FDB");
    let asal = std::env::var("TOKOPRO_FB_CONTOH").unwrap_or_else(|_| "/data/DATAPOS.FDB".into());
    let cp = std::process::Command::new("docker").args(["cp", &format!("{container}:{asal}"), &contoh.display().to_string()]).status().unwrap();
    assert!(cp.success());
    let db = Db(Mutex::new(db::open(&d.join("tokopro.db")).unwrap()));
    let fb = Firebird::docker(&container);
    let h = pindahkan(&db, &contoh, Some(&d.join("backup").display().to_string()), &fb, &mut |_| {}).unwrap();
    let mut m: Metrik = BTreeMap::new();
    for t in &h.hasil {
        m.insert(format!("pindah.{}", t.tabel.to_lowercase()), json!(t.jumlah as f64));
    }
    let peringatan = h.peringatan.clone();

    let mut conn = db.lock().unwrap();
    let c = &mut *conn;

    // ---- 2. jumlah baris dan jumlah semua kolom angka tiap tabel
    let tabel: Vec<String> = {
        let mut st = c.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap();
        st.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|x| x.unwrap()).collect()
    };
    for t in &tabel {
        let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM \"{t}\""), [], |r| r.get(0)).unwrap();
        taruh(&mut m, format!("tabel.{t}.baris"), n as f64);
        let kolom: Vec<(String, String)> = {
            let mut st = c.prepare(&format!("PRAGMA table_info(\"{t}\")")).unwrap();
            st.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?))).unwrap().map(|x| x.unwrap()).collect()
        };
        for (nama, tipe) in kolom {
            let tp = tipe.to_uppercase();
            if ["INT", "REAL", "NUM", "DEC", "FLOA", "DOUB"].iter().any(|k| tp.contains(k)) {
                let s: f64 = c.query_row(&format!("SELECT COALESCE(SUM(\"{nama}\"),0.0) FROM \"{t}\""), [], |r| r.get(0)).unwrap();
                taruh(&mut m, format!("tabel.{t}.sum.{nama}"), s);
            }
        }
    }

    // ---- 3. laporan dan dashboard pada data hasil pindahan (sebelum stok diputar ulang)
    metrik_laporan(c, &mut m);
    // laporan_stok perintah (jalur lain untuk stok)
    let db_ref = &db;
    drop(conn);
    for (mode, nama) in [("", "semua"), ("minimum", "minimum"), ("habis", "habis")] {
        let r = laporan_stok(db_ref, Some(String::new()), mode.to_string()).unwrap();
        let p = format!("lap.laporan_stok.{nama}");
        taruh(&mut m, format!("{p}.baris"), r.len() as f64);
        taruh(&mut m, format!("{p}.stokakhir"), jumlah(&r, "stokakhir"));
        taruh(&mut m, format!("{p}.nilaibeli"), jumlah(&r, "nilaibeli"));
        taruh(&mut m, format!("{p}.nilaijual"), jumlah(&r, "nilaijual"));
    }
    let mut conn = db.lock().unwrap();
    let c = &mut *conn;
    for tgl in ["2018-10-15", "2018-12-31", "2019-03-01", "2020-12-20", "2021-07-20", "2021-12-31", "2024-06-30", "2024-09-26"] {
        metrik_dashboard(c, &mut m, tgl);
    }

    // ---- 4. stok per barang: tersimpan hasil pindahan, putar ulang lewat trigger baru, lalu hitung_ulang_stok
    let migrasi = stok_barang(c);
    let baris_detil: i64 = c.query_row("SELECT COUNT(*) FROM transaksidetil", [], |r| r.get(0)).unwrap();
    let kol: Vec<String> = {
        let mut st = c.prepare("PRAGMA table_info(transaksidetil)").unwrap();
        st.query_map([], |r| r.get::<_, String>(1)).unwrap().map(|x| x.unwrap()).collect()
    };
    let semua: Vec<Vec<rusqlite::types::Value>> = {
        let mut st = c.prepare(&format!("SELECT {} FROM transaksidetil ORDER BY rowid", kol.join(","))).unwrap();
        st.query_map([], |r| (0..kol.len()).map(|i| r.get::<_, rusqlite::types::Value>(i)).collect::<Result<Vec<_>, _>>())
            .unwrap()
            .map(|x| x.unwrap())
            .collect()
    };
    assert_eq!(semua.len() as i64, baris_detil);
    // Data contoh punya baris yang merujuk nota yang tidak ada (peringatan migrasi), jadi kunci asing dimatikan selama putar ulang.
    c.pragma_update(None, "foreign_keys", "OFF").unwrap();
    c.execute_batch("UPDATE mdbarang SET stokmasuk = 0, stokkeluar = 0, stokopname = 0; DELETE FROM transaksidetil;").unwrap();
    {
        let sql = format!("INSERT INTO transaksidetil ({}) VALUES ({})", kol.join(","), vec!["?"; kol.len()].join(","));
        let mut ins = c.prepare(&sql).unwrap();
        for b in &semua {
            ins.execute(rusqlite::params_from_iter(b.iter())).unwrap();
        }
    }
    let replay = stok_barang(c);
    let berubah = crate::alat::hitung_ulang_stok(c).unwrap();
    let ulang = stok_barang(c);
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    taruh(&mut m, "stok.hitung_ulang_berubah".into(), berubah as f64);
    taruh(&mut m, "stok.replay_baris".into(), semua.len() as f64);

    let mut stok = Map::new();
    for (kode, a) in &migrasi {
        stok.insert(kode.clone(), json!({ "jenis": a["jenis"], "migrasi": a["v"], "replay": replay[kode]["v"], "ulang": ulang[kode]["v"] }));
    }

    std::fs::write(keluar.join("baru.json"), serde_json::to_string_pretty(&json!({ "metrik": m, "peringatan_pindah": peringatan })).unwrap()).unwrap();
    std::fs::write(keluar.join("stok.json"), serde_json::to_string(&Value::Object(stok)).unwrap()).unwrap();
    eprintln!("angka sisi baru ditulis ke {} ({} metrik, {} barang)", keluar.display(), m.len(), migrasi.len());
    drop(conn);
    let _ = std::fs::remove_dir_all(d);
}
