//! Uji hak akses per menu (MDUSERMENU).

use crate::auth::{daftar_akses, menu_ditolak, require_menu, simpan_akses, User};
use crate::db;
use rusqlite::Connection;

fn setup() -> (Connection, std::path::PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-akses-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    conn.execute_batch(
        "INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('Dewi', 'x', '-', 'Supervisor', 1), ('kasir', 'x', '-', 'Kasir', 1), ('baru', 'x', '-', 'Supervisor', 1);",
    )
    .unwrap();
    (conn, dir)
}

fn user(id: &str, level: &str) -> User {
    User { iduser: id.into(), kodekaryawan: "-".into(), namakaryawan: id.into(), level: level.into(), must_change: false }
}

fn ids(c: &Connection, nama: &[&str]) -> Vec<String> {
    nama.iter().map(|n| c.query_row("SELECT idmenu FROM mdmenu WHERE namamenu = ?1", [n], |r| r.get(0)).unwrap()).collect()
}

#[test]
fn simpan_akses_mengisi_menu_dan_menyaring() {
    let (mut c, d) = setup();
    let mgr = user("admin", "Manager");
    // Database baru belum punya MDMENU: diisi dari daftar menu bawaan.
    let semua = daftar_akses(&c, &mgr, "Dewi").unwrap();
    assert!(semua.len() >= 60);
    assert!(semua.iter().all(|m| m["akses"] == 1), "tanpa baris = semua boleh");

    let boleh = ids(&c, &["mnMDDataBarang", "mnTRTrPenjualan", "mnTRReturJual"]);
    simpan_akses(&mut c, &mgr, "Dewi", &boleh).unwrap();
    let dewi = user("DEWI", "Supervisor"); // huruf besar/kecil tidak dibedakan
    let ditolak = menu_ditolak(&c, &dewi).unwrap();
    assert!(!ditolak.contains(&"mnMDDataBarang".to_string()));
    assert!(ditolak.contains(&"mnMDDataPelanggan".to_string()));
    assert!(require_menu(&c, &dewi, "mnMDDataBarang").is_ok());
    let err = require_menu(&c, &dewi, "mnMDDataPelanggan").unwrap_err();
    assert!(err.contains("Data Pelanggan"), "{err}");

    // Induk menu: sebagian = 2, semua = 1, kosong = 0.
    let akses = |c: &Connection, id: &str| -> i64 {
        c.query_row("SELECT akses FROM mdusermenu WHERE iduser='Dewi' AND idmenu = (SELECT idmenu FROM mdmenu WHERE namamenu=?1)", [id], |r| r.get(0)).unwrap()
    };
    assert_eq!(akses(&c, "mnMasterData"), 2);
    assert_eq!(akses(&c, "mnTRPenjualan"), 2);
    assert_eq!(akses(&c, "mnInventori"), 0);
    assert_eq!(akses(&c, "mnMDDataBarang"), 1);

    // Pengguna lain, dan pengguna tanpa baris, tidak terpengaruh.
    assert!(menu_ditolak(&c, &user("baru", "Supervisor")).unwrap().is_empty());
    // Manager tidak pernah dibatasi, bahkan kalau ada barisnya.
    simpan_akses(&mut c, &mgr, "admin", &[]).unwrap_or(());
    assert!(menu_ditolak(&c, &user("Dewi", "Manager")).unwrap().is_empty());

    // Simpan ulang menggantikan hak lama.
    let p = ids(&c, &["mnMDDataPelanggan"]);
    simpan_akses(&mut c, &mgr, "Dewi", &p).unwrap();
    assert!(require_menu(&c, &dewi, "mnMDDataBarang").is_err());
    assert!(require_menu(&c, &dewi, "mnMDDataPelanggan").is_ok());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn menu_tanpa_baris_mengikuti_aturan_level_dan_data_lama() {
    let (c, d) = setup();
    // Data lama: baris dengan huruf berbeda dan menu yang belum punya baris (mnKeuangan).
    c.execute_batch(
        "INSERT INTO mdmenu (idmenu,namamenu,captionmenu,mlevel,parent,aktif) VALUES ('M002','mnMDDataBarang','Data Barang','1','M001',1),('M062','mnKeuangan','Keuangan','0','0',1);
         INSERT INTO mdusermenu VALUES ('ADMIN','M002',1),('admin','M002',0),('Admin','M002',1);",
    )
    .unwrap();
    // Salah satu baris mengizinkan: menu terbuka.
    assert!(menu_ditolak(&c, &user("Admin", "Supervisor")).unwrap().is_empty());
    c.execute("UPDATE mdusermenu SET akses = 0", []).unwrap();
    assert_eq!(menu_ditolak(&c, &user("admin", "Supervisor")).unwrap(), vec!["mnMDDataBarang".to_string()]);
    // Menu yang tidak punya baris (mnKeuangan) tidak ikut ditolak.
    assert!(require_menu(&c, &user("admin", "Supervisor"), "mnKeuangan").is_ok());
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn hanya_pengelola_mengatur_akses() {
    let (mut c, d) = setup();
    let err = simpan_akses(&mut c, &user("kasir", "Kasir"), "Dewi", &[]).unwrap_err();
    assert!(err.contains("mengelola pengguna"));
    assert!(daftar_akses(&c, &user("kasir", "Kasir"), "Dewi").is_err());
    // Supervisor tidak boleh mengubah hak Manager.
    c.execute("INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif) VALUES ('bos','x','-','Manager',1)", []).unwrap();
    assert!(simpan_akses(&mut c, &user("Dewi", "Supervisor"), "bos", &[]).is_err());
    assert!(simpan_akses(&mut c, &user("Dewi", "Supervisor"), "tidakada", &[]).is_err());
    let _ = std::fs::remove_dir_all(d);
}
