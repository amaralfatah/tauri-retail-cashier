//! Uji laporan yang mengikuti aplikasi lama: laba rugi (TJ dan RJ), order terbuka, pelunasan menurut jatuh tempo,
//! omset `hrgjual*jml`, laba rugi komparatif, dan penjualan yang tertunda (TP) tidak ikut dihitung.

use crate::db;
use crate::report::{dashboard_query, lap_query, LapFilter};
use rusqlite::Connection;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-laporan-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let c = db::open(&dir.join("t.db")).unwrap();
    (c, dir)
}

fn lf(dari: &str, sampai: &str) -> LapFilter {
    LapFilter { dari: dari.into(), sampai: sampai.into(), ..Default::default() }
}

fn data_jual(c: &Connection) {
    c.execute_batch(
        "INSERT INTO transaksi (tid,notrans,tgltrans,kode,totaltrans,diskonnilai) VALUES
           (1,'TJ1','2026-11-10','TJ',12000,1000), (2,'RJ1','2026-11-11','RJ',6000,0), (3,'TP1','2026-11-10','TP',99000,0);
         INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,kodesatuan,jml,hrgbeli,hrgjual,satuanjual,jmljual,hrgterjual) VALUES
           ('TJ1','TJ',1,'A1','Sabun','PCS',2,5000,6000,'PCS',2,6000),
           ('RJ1','RJ',1,'A1','Sabun','PCS',1,5000,6000,'PCS',1,6000),
           ('TP1','TP',1,'A1','Sabun','PCS',9,5000,6000,'PCS',9,6000);",
    ).unwrap();
}

#[test]
fn laba_rugi_menjumlah_tj_dan_rj_tanpa_diskon_nota() {
    let (c, d) = setup();
    data_jual(&c);
    let f = lf("2026-11-01", "2026-11-30");
    let det = lap_query(&c, "lr_detil", &f).unwrap();
    assert_eq!(det.len(), 2, "TJ dan RJ saja, penjualan tertunda (TP) tidak ikut");
    assert_eq!(det[0]["notrans"], "RJ1");
    assert_eq!(det[0]["keuntungansubtotal"], -1000.0, "retur mengurangi laba");
    assert_eq!(det[1]["keuntungansubtotal"], 2000.0);
    let head = lap_query(&c, "lr_head", &f).unwrap();
    let total: f64 = head.iter().map(|r| r["laba"].as_f64().unwrap()).sum();
    assert_eq!(total, 1000.0, "diskon nota tidak dikurangkan");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn penjualan_tertunda_tidak_masuk_laporan_dan_dashboard() {
    let (c, d) = setup();
    data_jual(&c);
    let f = lf("2026-11-01", "2026-11-30");
    assert_eq!(lap_query(&c, "jual_head", &f).unwrap().len(), 1);
    assert_eq!(lap_query(&c, "jual_detil", &f).unwrap().len(), 1);
    let dash = dashboard_query(&c, "2026-11-10").unwrap();
    assert_eq!(dash["hari_jual"], 12000.0);
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn order_hanya_yang_belum_diambil() {
    let (c, d) = setup();
    c.execute_batch(
        "INSERT INTO transaksi (tid,notrans,tglorder,kode,status) VALUES (1,'SO1','2026-11-10','SO',0),(2,'SO2','2026-11-10','SO',1),(3,'PO1','2026-11-10','PO',0),(4,'PO2','2026-11-10','PO',1);
         INSERT INTO transaksidetil (notrans,kode,nourut,kodebarang,namabarang,jml,jmljual,hrgterjual) VALUES
           ('SO1','SO',1,'A1','Sabun',1,1,100),('SO2','SO',1,'A1','Sabun',1,1,100),('PO1','PO',1,'A1','Sabun',1,1,100),('PO2','PO',1,'A1','Sabun',1,1,100);",
    ).unwrap();
    let f = lf("2026-11-01", "2026-11-30");
    let so = lap_query(&c, "order_jual", &f).unwrap();
    assert_eq!((so.len(), so[0]["notrans"].as_str().unwrap()), (1, "SO1"));
    let po = lap_query(&c, "order_beli", &f).unwrap();
    assert_eq!((po.len(), po[0]["notrans"].as_str().unwrap()), (1, "PO1"));
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn pelunasan_memakai_jatuh_tempo_dan_hutang_lama_hs_ikut() {
    let (c, d) = setup();
    c.execute_batch(
        "INSERT INTO trkartupiutang (nopiutang,kode,jenis,noreftrans,jthtempo,jmlpiutang,jmlterbayar,kekurangan) VALUES
           ('H1','HS','Hutang','TB1','2026-12-05',100,0,100), ('H2','HP','Hutang','TB2','2026-12-06',200,0,200), ('P1','PS','Piutang','TJ1','2026-12-07',50,0,50);",
    ).unwrap();
    let f = lf("2026-12-01", "2026-12-31");
    assert_eq!(lap_query(&c, "pelunasan_hutang", &f).unwrap().len(), 2);
    assert_eq!(lap_query(&c, "hutang", &f).unwrap().len(), 2);
    assert_eq!(lap_query(&c, "pelunasan_piutang", &f).unwrap().len(), 1);
    assert!(lap_query(&c, "pelunasan_hutang", &lf("2026-11-01", "2026-11-30")).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn omset_memakai_hrgjual_kali_jml() {
    let (c, d) = setup();
    data_jual(&c);
    c.execute("UPDATE transaksidetil SET hrgjual = 7000 WHERE notrans = 'TJ1'", []).unwrap();
    let o = lap_query(&c, "omset", &lf("2026-11-01", "2026-11-30")).unwrap();
    assert_eq!(o.len(), 1);
    assert_eq!(o[0]["jmlomset"], 14000.0, "7000 x 2, bukan harga terjual");
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn laba_rugi_komparatif_per_kategori_dan_periode() {
    let (c, d) = setup();
    c.execute_batch(
        "INSERT INTO keuangan (idkas,nokas,kategori,tglkas,masuk,keluar,periode) VALUES
           (1,'K1','Penjualan barang dagang','2026-10-05',1000,0,'202610'),
           (2,'K2','Penjualan barang dagang','2026-11-05',500,0,'202611'),
           (3,'K3','Biaya operasional','2026-11-06',0,200,'202611');",
    ).unwrap();
    let r = lap_query(&c, "lr_komparatif", &lf("2026-11-20", "2026-11-20")).unwrap();
    let jual = r.iter().find(|x| x["kategori"] == "penjualan barang dagang").unwrap();
    assert_eq!((jual["lalu_masuk"].as_f64(), jual["mutasi_masuk"].as_f64(), jual["semua_masuk"].as_f64()), (Some(1000.0), Some(500.0), Some(1500.0)));
    let biaya = r.iter().find(|x| x["kategori"] == "biaya operasional").unwrap();
    assert_eq!(biaya["mutasi_keluar"], 200.0);
    let _ = std::fs::remove_dir_all(d);
}
