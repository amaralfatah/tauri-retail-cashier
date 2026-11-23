//! Uji migrasi susunan database: database baru, lama (versi 0), langkah tambahan, versi lebih baru, restore, dan pemindahan data lama.

use crate::migrasi::{self, tambah_kolom, Aksi, Migrasi, MIGRASI};
use crate::{database, db};
use rusqlite::Connection;
use std::path::PathBuf;

struct Dir(PathBuf);
impl Dir {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("tokopro-mig-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        std::fs::create_dir_all(&p).unwrap();
        Dir(p)
    }
}
impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn ver(c: &Connection) -> i64 {
    migrasi::versi(c).unwrap()
}

fn kolom_ada(c: &Connection, tabel: &str, kolom: &str) -> bool {
    let mut st = c.prepare(&format!("PRAGMA table_info({tabel})")).unwrap();
    let v: Vec<String> = st.query_map([], |r| r.get(1)).unwrap().map(|x| x.unwrap()).collect();
    v.iter().any(|k| k == kolom)
}

fn jumlah_backup(d: &Dir, awalan: &str) -> usize {
    std::fs::read_dir(d.0.join("backup")).map(|r| r.flatten().filter(|f| f.file_name().to_string_lossy().starts_with(awalan)).count()).unwrap_or(0)
}

fn langkah2_sql() -> Vec<Migrasi> {
    vec![
        Migrasi { no: 1, deskripsi: "satu", aksi: Aksi::Fungsi(|_| Ok(())) },
        Migrasi { no: 2, deskripsi: "kolom uji", aksi: Aksi::Fungsi(|tx| tambah_kolom(tx, "mdbarang", "warna", "TEXT DEFAULT ''")) },
    ]
}

/// Database lama persis seperti milik toko hari ini: tabel terbaru, versi 0, ada data.
fn buat_lama(d: &Dir) -> PathBuf {
    let p = d.0.join("lama.db");
    {
        let c = Connection::open(&p).unwrap();
        c.execute_batch(db::SCHEMA).unwrap();
        c.execute_batch("INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun');").unwrap();
        assert_eq!(ver(&c), 0);
    }
    p
}

#[test]
fn nomor_langkah_berurutan() {
    for (i, m) in MIGRASI.iter().enumerate() {
        assert_eq!(m.no, i as i64 + 1);
    }
    assert_eq!(migrasi::versi_terbaru(), MIGRASI.len() as i64);
}

#[test]
fn database_baru_langsung_versi_terbaru_tanpa_cadangan() {
    let d = Dir::new();
    let c = db::open(&d.0.join("t.db")).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 0);
    // Dibuka lagi: tidak berubah.
    drop(c);
    let c = db::open(&d.0.join("t.db")).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    // Database di memori tidak membuat cadangan dan tidak error.
    let mut m = Connection::open_in_memory().unwrap();
    migrasi::siapkan(&mut m).unwrap();
    assert_eq!(ver(&m), migrasi::versi_terbaru());
}

#[test]
fn database_lama_versi_nol_naik_dan_data_utuh() {
    let d = Dir::new();
    let p = buat_lama(&d);
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(nama, "Sabun");
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 1);
    // Cadangan berisi data lama dan masih versi 0.
    let f = std::fs::read_dir(d.0.join("backup")).unwrap().flatten().find(|f| f.file_name().to_string_lossy().starts_with("sebelum-update")).unwrap().path();
    let b = Connection::open(&f).unwrap();
    assert_eq!(ver(&b), 0);
    let n: i64 = b.query_row("SELECT COUNT(*) FROM mdbarang", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    // Buka lagi: tidak ada cadangan tambahan.
    drop(c);
    db::open(&p).unwrap();
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 1);
}

#[test]
fn database_lama_kosong_tanpa_cadangan() {
    let d = Dir::new();
    let p = d.0.join("lama.db");
    Connection::open(&p).unwrap().execute_batch(db::SCHEMA).unwrap();
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 0);
}

#[test]
fn pending_lama_tetap_dipindah_saat_naik_versi() {
    let d = Dir::new();
    let p = buat_lama(&d);
    Connection::open(&p).unwrap().execute_batch(
        "INSERT INTO pendingjual (nopending,tgltrans,kodekaryawan,kodepelanggan,kodesales,catatan,jmltrans) VALUES ('PD2611-00001','2026-11-20','E1','','','lama',6000);
         INSERT INTO pendingjualdetil (nopending,nourut,kodebarang,satuanjual,jmljual,hrgterjual) VALUES ('PD2611-00001',1,'A1','PCS',1,6000);",
    ).unwrap();
    let c = db::open(&p).unwrap();
    let n: i64 = c.query_row("SELECT COUNT(*) FROM transaksi WHERE kode='TP'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn langkah_baru_jalan_sekali_dan_aman_diulang() {
    let d = Dir::new();
    let p = d.0.join("t.db");
    let schema = db::SCHEMA;
    drop(db::open(&p).unwrap());
    let mut c = Connection::open(&p).unwrap();
    c.execute_batch("INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun'); PRAGMA user_version = 0;").unwrap();
    assert!(!kolom_ada(&c, "mdbarang", "warna"));
    let daftar = langkah2_sql();
    migrasi::jalankan(&mut c, schema, &daftar).unwrap();
    assert_eq!(ver(&c), 2);
    assert!(kolom_ada(&c, "mdbarang", "warna"));
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 1);
    // Ulang: tidak ada yang berubah, tidak ada cadangan baru.
    migrasi::jalankan(&mut c, schema, &daftar).unwrap();
    assert_eq!(ver(&c), 2);
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 1);
    // Pembantu aman dijalankan langsung berulang.
    let tx = c.transaction().unwrap();
    tambah_kolom(&tx, "mdbarang", "warna", "TEXT").unwrap();
}

#[test]
fn langkah_gagal_dibatalkan_seluruhnya() {
    let d = Dir::new();
    let p = d.0.join("t.db");
    drop(db::open(&p).unwrap());
    let mut c = Connection::open(&p).unwrap();
    c.execute_batch("PRAGMA user_version = 0").unwrap();
    let daftar = vec![
        Migrasi { no: 1, deskripsi: "satu", aksi: Aksi::Fungsi(|_| Ok(())) },
        Migrasi { no: 2, deskripsi: "gagal di tengah", aksi: Aksi::Sql("ALTER TABLE mdbarang ADD COLUMN setengah TEXT; INSERT INTO tabel_tidak_ada VALUES (1);") },
    ];
    let err = migrasi::jalankan(&mut c, db::SCHEMA, &daftar).unwrap_err();
    assert!(err.contains("langkah 2") && err.contains("tidak berubah"), "{err}");
    assert_eq!(ver(&c), 1);
    assert!(!kolom_ada(&c, "mdbarang", "setengah"), "perubahan setengah jalan harus dibatalkan");
    // Langkah yang gagal lewat fungsi Rust juga dibatalkan.
    let daftar = vec![
        Migrasi { no: 1, deskripsi: "satu", aksi: Aksi::Fungsi(|_| Ok(())) },
        Migrasi { no: 2, deskripsi: "fungsi gagal", aksi: Aksi::Fungsi(|tx| {
            tambah_kolom(tx, "mdbarang", "setengah", "TEXT")?;
            Err("gagal sengaja".into())
        }) },
    ];
    assert!(migrasi::jalankan(&mut c, db::SCHEMA, &daftar).is_err());
    assert_eq!(ver(&c), 1);
    assert!(!kolom_ada(&c, "mdbarang", "setengah"));
}

#[test]
fn versi_lebih_tinggi_ditolak_dan_tidak_disentuh() {
    let d = Dir::new();
    let p = d.0.join("t.db");
    drop(db::open(&p).unwrap());
    let tinggi = migrasi::versi_terbaru() + 5;
    Connection::open(&p).unwrap().execute_batch(&format!("PRAGMA user_version = {tinggi}")).unwrap();
    let err = db::open(&p).unwrap_err();
    assert_eq!(err, "Data ini dibuat oleh Toko Pro versi yang lebih baru. Pasang versi terbaru, lalu buka lagi.");
    assert_eq!(ver(&Connection::open(&p).unwrap()), tinggi);
}

#[test]
fn restore_backup_terlalu_baru_ditolak_di_depan() {
    let d = Dir::new();
    let mut c = db::open(&d.0.join("t.db")).unwrap();
    c.execute_batch("INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun');").unwrap();
    let folder = d.0.join("backup");
    let file = database::backup_ke(&c, &folder, "tokopro").unwrap();
    Connection::open(&file).unwrap().execute_batch(&format!("PRAGMA user_version = {}", migrasi::versi_terbaru() + 1)).unwrap();
    let err = database::pulihkan(&mut c, &file, &folder).unwrap_err();
    assert!(err.contains("versi yang lebih baru"), "{err}");
    assert!(database::cek_file_backup(&file).unwrap_err().contains("versi yang lebih baru"));
    // Tidak ada cadangan "sebelum-restore" dan data tetap utuh.
    assert_eq!(jumlah_backup(&d, "sebelum-restore"), 0);
    let n: i64 = c.query_row("SELECT COUNT(*) FROM mdbarang", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn restore_backup_lama_versi_nol_dinaikkan() {
    let d = Dir::new();
    let mut c = db::open(&d.0.join("t.db")).unwrap();
    let lama = buat_lama(&d);
    let folder = d.0.join("backup");
    database::pulihkan(&mut c, &lama, &folder).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    let n: i64 = c.query_row("SELECT COUNT(*) FROM mdbarang", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn pindah_lama_lalu_pulihkan_berakhir_di_versi_terbaru() {
    use crate::pindah_lama::{bangun_sqlite, Sumber};
    struct Satu;
    impl Sumber for Satu {
        fn kolom(&self, t: &str) -> db::Res<Vec<String>> {
            Ok(if t == "MDBARANG" { vec!["KODEBARANG".into(), "NAMABARANG".into()] } else { vec![] })
        }
        fn baris(&self, t: &str, _k: &[String]) -> db::Res<Vec<Vec<Option<String>>>> {
            Ok(if t == "MDBARANG" { vec![vec![Some("B1".into()), Some("Kopi".into())]] } else { vec![] })
        }
    }
    let d = Dir::new();
    let baru = d.0.join("impor.db");
    bangun_sqlite(&Satu, &baru, &mut |_| {}).unwrap();
    assert_eq!(ver(&Connection::open(&baru).unwrap()), migrasi::versi_terbaru());

    let mut c = db::open(&d.0.join("t.db")).unwrap();
    database::pulihkan(&mut c, &baru, &d.0.join("backup")).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    let n: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='B1'", [], |r| r.get(0)).unwrap();
    assert_eq!(n, "Kopi");
    // Data impor sudah susunan terbaru, jadi tidak ada cadangan "sebelum-update" dari langkah yang salah jalan.
    assert_eq!(jumlah_backup(&d, "sebelum-update"), 0);
}

#[test]
fn versi_satu_naik_ke_dua_dengan_tabel_sesi_dan_data_utuh() {
    let d = Dir::new();
    let p = d.0.join("v1.db");
    {
        let c = Connection::open(&p).unwrap();
        c.execute_batch(db::SCHEMA).unwrap();
        c.execute_batch("DROP TABLE sesi_perangkat; INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun'); PRAGMA user_version = 1;").unwrap();
    }
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    assert!(migrasi::versi_terbaru() >= 2);
    assert!(kolom_ada(&c, "sesi_perangkat", "token_hash"));
    assert!(kolom_ada(&c, "sesi_perangkat", "iduser"));
    let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(nama, "Sabun");
    // Dibuka lagi: aman, tabel tetap ada.
    drop(c);
    let c = db::open(&p).unwrap();
    assert!(kolom_ada(&c, "sesi_perangkat", "mulai"));
}

#[test]
fn versi_dua_naik_ke_tiga_dengan_tabel_perangkat_dan_data_utuh() {
    let d = Dir::new();
    let p = d.0.join("v2.db");
    {
        let c = Connection::open(&p).unwrap();
        c.execute_batch(db::SCHEMA).unwrap();
        c.execute_batch("DROP TABLE perangkat; INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun'); PRAGMA user_version = 2;").unwrap();
    }
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    assert!(migrasi::versi_terbaru() >= 3);
    for k in ["id", "nama_komputer", "token_hash", "dibuat", "terakhir_terlihat", "aktif", "otomatis"] {
        assert!(kolom_ada(&c, "perangkat", k), "kolom {k} tidak ada");
    }
    let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(nama, "Sabun");
    // Langkah aman diulang: dibuka lagi tidak mengubah apa pun.
    drop(c);
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
}

#[test]
fn versi_tiga_naik_ke_empat_dengan_tabel_permintaan_selesai_dan_data_utuh() {
    let d = Dir::new();
    let p = d.0.join("v3.db");
    {
        let c = Connection::open(&p).unwrap();
        c.execute_batch(db::SCHEMA).unwrap();
        c.execute_batch("DROP TABLE permintaan_selesai; INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun'); PRAGMA user_version = 3;").unwrap();
    }
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
    assert!(migrasi::versi_terbaru() >= 4);
    for k in ["id", "perintah", "hasil_json", "waktu"] {
        assert!(kolom_ada(&c, "permintaan_selesai", k), "kolom {k} tidak ada");
    }
    let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
    assert_eq!(nama, "Sabun");
    drop(c);
    let c = db::open(&p).unwrap();
    assert_eq!(ver(&c), migrasi::versi_terbaru());
}

/* ---- Langkah diuji sendiri, tanpa `schema.sql` sebagai pelengkap ---- */

/// Tabel dan kolom yang harus dibuat tiap langkah (nomor langkah, tabel, kolom).
const HASIL_LANGKAH: &[(i64, &str, &[&str])] = &[
    (2, "sesi_perangkat", &["token_hash", "idperangkat", "iduser", "mulai", "terakhir"]),
    (3, "perangkat", &["id", "nama_komputer", "token_hash", "dibuat", "terakhir_terlihat", "aktif", "otomatis"]),
    (4, "permintaan_selesai", &["id", "perintah", "hasil_json", "waktu"]),
];

fn tabel_ada(c: &Connection, tabel: &str) -> bool {
    c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1", [tabel], |r| r.get::<_, i64>(0)).unwrap() > 0
}

/// Database versi `no - 1`: susunan terbaru, tetapi tabel hasil langkah `no` dan sesudahnya dihapus.
fn db_sebelum_langkah(d: &Dir, no: i64) -> Connection {
    let c = Connection::open(d.0.join(format!("sebelum-{no}.db"))).unwrap();
    c.execute_batch(db::SCHEMA).unwrap();
    for (n, tabel, _) in HASIL_LANGKAH.iter().filter(|(n, _, _)| *n >= no) {
        c.execute_batch(&format!("DROP TABLE {tabel}")).unwrap_or_else(|e| panic!("langkah {n}: {e}"));
    }
    c.execute_batch(&format!("INSERT INTO mdbarang (kodebarang, namabarang) VALUES ('A1','Sabun'); PRAGMA user_version = {};", no - 1)).unwrap();
    c
}

#[test]
fn setiap_langkah_membuat_tabelnya_sendiri_tanpa_pelengkap_schema() {
    for (no, tabel, kolom) in HASIL_LANGKAH {
        let d = Dir::new();
        let mut c = db_sebelum_langkah(&d, *no);
        assert!(!tabel_ada(&c, tabel), "langkah {no}: tabel {tabel} seharusnya belum ada");
        // `schema` kosong: yang membuat tabelnya hanya langkah itu sendiri.
        migrasi::jalankan(&mut c, "", MIGRASI).unwrap_or_else(|e| panic!("langkah {no}: {e}"));
        assert_eq!(ver(&c), migrasi::versi_terbaru(), "langkah {no}");
        assert!(tabel_ada(&c, tabel), "langkah {no} tidak membuat tabel {tabel}");
        for k in *kolom {
            assert!(kolom_ada(&c, tabel, k), "langkah {no}: kolom {k} tidak ada di {tabel}");
        }
        let nama: String = c.query_row("SELECT namabarang FROM mdbarang WHERE kodebarang='A1'", [], |r| r.get(0)).unwrap();
        assert_eq!(nama, "Sabun", "langkah {no}: data toko harus utuh");
        // Dijalankan lagi (versi sudah terbaru) tidak mengubah apa pun.
        migrasi::jalankan(&mut c, "", MIGRASI).unwrap();
    }
}

#[test]
fn langkah_yang_dikosongkan_membuat_tes_di_atas_gagal() {
    // Bukti tes peka: langkah 2 yang SQL-nya kosong tidak membuat tabel bila tidak ada pelengkap `schema`.
    let d = Dir::new();
    let mut c = db_sebelum_langkah(&d, 2);
    let kosong = [
        Migrasi { no: 1, deskripsi: "satu", aksi: Aksi::Fungsi(|_| Ok(())) },
        Migrasi { no: 2, deskripsi: "kosong", aksi: Aksi::Sql("") },
        Migrasi { no: 3, deskripsi: "kosong", aksi: Aksi::Sql("") },
        Migrasi { no: 4, deskripsi: "kosong", aksi: Aksi::Sql("") },
    ];
    migrasi::jalankan(&mut c, "", &kosong).unwrap();
    assert!(!tabel_ada(&c, "sesi_perangkat"));
    assert!(!tabel_ada(&c, "perangkat"));
    assert!(!tabel_ada(&c, "permintaan_selesai"));
}

#[test]
fn langkah_berurutan_dari_setiap_versi_awal_sampai_terbaru() {
    // Dari versi 1, 2, dan 3 sekaligus naik ke terbaru dengan hanya langkahnya.
    for awal in 1..migrasi::versi_terbaru() {
        let d = Dir::new();
        let mut c = db_sebelum_langkah(&d, awal + 1);
        migrasi::jalankan(&mut c, "", MIGRASI).unwrap();
        for (_, tabel, _) in HASIL_LANGKAH {
            assert!(tabel_ada(&c, tabel), "dari versi {awal}: tabel {tabel} tidak ada");
        }
    }
}
