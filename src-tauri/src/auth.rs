use crate::db::{e, one, rows, Db, Res};
use argon2::password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::Argon2;
use rusqlite::params;
use serde::Serialize;
use serde_json::{Map, Value};
use std::sync::Mutex;
use tauri::State;

/// Password sementara untuk user yang belum punya password (database baru atau hasil impor).
const DEFAULT_PASSWORD: &str = "admin";

#[derive(Clone, Serialize)]
pub struct User {
    pub iduser: String,
    pub kodekaryawan: String,
    pub namakaryawan: String,
    pub level: String,
    pub must_change: bool,
}

#[derive(Default)]
pub struct Session(pub Mutex<Option<User>>);

impl Session {
    pub fn user(&self) -> Res<User> {
        self.0
            .lock()
            .map_err(e)?
            .clone()
            .ok_or_else(|| "Sesi Anda sudah berakhir. Silakan masuk lagi.".to_string())
    }
}

fn hash(password: &str) -> Res<String> {
    Argon2::default().hash_password(password.as_bytes()).map(|h| h.to_string()).map_err(e)
}

fn check(stored: Option<&str>, password: &str) -> bool {
    match stored {
        None | Some("") => password == DEFAULT_PASSWORD,
        Some(h) => PasswordHash::new(h)
            .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
            .unwrap_or(false),
    }
}

/// User tanpa karyawan (kodekaryawan kosong atau "-") memakai ID-nya sendiri sebagai kode kasir,
/// supaya nama kasir di struk dan laporan tidak kosong.
fn load(conn: &rusqlite::Connection, iduser: &str) -> Res<Option<(Option<String>, User, i64)>> {
    let mut stmt = conn
        .prepare(
            "SELECT u.pswduser, u.iduser, COALESCE(NULLIF(NULLIF(u.kodekaryawan,''),'-'), u.iduser), COALESCE(k.namakaryawan, u.iduser), COALESCE(u.\"level\",''), COALESCE(u.aktif,1)
             FROM mduser u LEFT JOIN mdkaryawan k ON k.kodekaryawan = u.kodekaryawan WHERE UPPER(u.iduser) = UPPER(?1) ORDER BY (u.iduser = ?1) DESC LIMIT 1",
        )
        .map_err(e)?;
    let mut q = stmt.query(params![iduser]).map_err(e)?;
    let Some(r) = q.next().map_err(e)? else { return Ok(None) };
    let pswd: Option<String> = r.get(0).map_err(e)?;
    let user = User {
        iduser: r.get(1).map_err(e)?,
        kodekaryawan: r.get(2).map_err(e)?,
        namakaryawan: r.get(3).map_err(e)?,
        level: r.get(4).map_err(e)?,
        must_change: pswd.as_deref().unwrap_or("").is_empty(),
    };
    Ok(Some((pswd, user, r.get(5).map_err(e)?)))
}

#[tauri::command]
pub fn login(db: State<Db>, session: State<Session>, iduser: String, password: String) -> Res<User> {
    let conn = db.lock()?;
    let wrong = "Nama pengguna atau password salah. Silakan coba lagi.".to_string();
    let Some((pswd, user, aktif)) = load(&conn, iduser.trim())? else { return Err(wrong) };
    if aktif == 0 {
        return Err("Akun ini sedang dinonaktifkan. Hubungi pemilik toko untuk mengaktifkannya.".into());
    }
    if !check(pswd.as_deref(), &password) {
        return Err(wrong);
    }
    *session.0.lock().map_err(e)? = Some(user.clone());
    Ok(user)
}

/// Pengaturan "Aktifkan Login" (aktiflogin) mati: program langsung masuk sebagai "Administrator", seperti aslinya.
/// Mengembalikan `None` kalau login masih aktif (atau pengaturannya belum ada), jadi layar masuk tetap tampil.
pub fn masuk_bawaan(conn: &rusqlite::Connection, session: &Session) -> Res<Option<User>> {
    let aktif: i64 = conn.query_row("SELECT COALESCE(aktiflogin,1) FROM tseting LIMIT 1", [], |r| r.get(0)).unwrap_or(1);
    if aktif != 0 {
        return Ok(None);
    }
    let user = User { iduser: "Administrator".into(), kodekaryawan: "Administrator".into(), namakaryawan: "Administrator".into(), level: "Manager".into(), must_change: false };
    *session.0.lock().map_err(e)? = Some(user.clone());
    Ok(Some(user))
}

#[tauri::command]
pub fn login_bawaan(db: State<Db>, session: State<Session>) -> Res<Option<User>> {
    let conn = db.lock()?;
    masuk_bawaan(&conn, &session)
}

/// Periksa nama user dan kata sandi seorang pengelola (bukan Kasir atau Lainnya, masih aktif). Dipakai untuk Verifikasi Admin.
pub fn verifikasi_pengelola(conn: &rusqlite::Connection, iduser: &str, password: &str) -> Res<User> {
    let salah = "Nama user atau kata sandi salah. Silakan coba lagi.".to_string();
    let Some((pswd, user, aktif)) = load(conn, iduser.trim())? else { return Err(salah) };
    if aktif == 0 || !check(pswd.as_deref(), password) {
        return Err(salah);
    }
    if user.level == "Kasir" || user.level == "Lainnya" {
        return Err(format!("Akun ini berlevel {}, jadi tidak bisa memberi izin. Minta supervisor atau pemilik toko yang masuk.", user.level));
    }
    Ok(user)
}

#[tauri::command]
pub fn logout(session: State<Session>) -> Res<()> {
    *session.0.lock().map_err(e)? = None;
    Ok(())
}

#[tauri::command]
/// Seperti FrmZEditProfil aslinya: kata sandi baru langsung menggantikan yang lama tanpa menanyakan kata sandi lama.
/// `old` tidak dipakai lagi dan hanya dipertahankan supaya pemanggil lama tetap jalan. Disimpan sebagai hash Argon2.
pub fn change_password(db: State<Db>, session: State<Session>, #[allow(unused_variables)] old: String, new: String) -> Res<()> {
    let mut user = session.user()?;
    if new.is_empty() {
        return Err("Kata sandi baru belum diisi.".into());
    }
    let conn = db.lock()?;
    load(&conn, &user.iduser)?.ok_or("Akun Anda tidak ditemukan.")?;
    conn.execute("UPDATE mduser SET pswduser = ?1, tglupdate = date('now','localtime') WHERE iduser = ?2", params![hash(&new)?, user.iduser])
        .map_err(e)?;
    user.must_change = false;
    *session.0.lock().map_err(e)? = Some(user);
    Ok(())
}

// ---- Pengaturan toko (tabel TSETING, satu baris) ----

const SETTING_COLS: &[&str] = &[
    "namausaha", "bidangusaha", "alamat", "kota", "provinsi", "kodepos", "pemilik", "tlp", "email", "website",
    "header1", "header2", "footer1", "footer2", "aktiflevel", "aktifsatuan", "updateharga", "aktifppn", "ppn", "tempopiutang",
    "fax", "aktiflogin", "aktifpromo", "izinharga", "izindiskon", "aktiftranskas", "aktifpoin", "izinstokmin", "aktiftranspoin",
    "mintranspoin", "jmlpointrans", "berlakukelipatanpoin", "konfirmasikredit", "aktifotentikasi", "nonaktifstokhabis", "tampilnonaktif",
];

#[tauri::command]
pub fn get_settings(db: State<Db>) -> Res<Value> {
    let conn = db.lock()?;
    Ok(one(&conn, "SELECT * FROM tseting LIMIT 1", [])?.unwrap_or(Value::Null))
}

#[tauri::command]
pub fn save_settings(db: State<Db>, session: State<Session>, data: Map<String, Value>) -> Res<()> {
    let user = session.user()?;
    if user.level == "Kasir" {
        return Err("Hanya pemilik atau supervisor yang bisa mengubah pengaturan.".into());
    }
    let conn = db.lock()?;
    require_menu(&conn, &user, "mnPengaturanProgram")?;
    let cols: Vec<&str> = SETTING_COLS.iter().copied().filter(|c| data.contains_key(*c)).collect();
    if cols.is_empty() {
        return Ok(());
    }
    let set = cols.iter().enumerate().map(|(i, c)| format!("{c} = ?{}", i + 1)).collect::<Vec<_>>().join(", ");
    let vals: Vec<_> = cols.iter().map(|c| crate::db::to_sql(&data[*c])).collect();
    conn.execute(&format!("UPDATE tseting SET {set}"), rusqlite::params_from_iter(vals)).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn list_users(db: State<Db>, session: State<Session>) -> Res<Vec<Value>> {
    let user = session.user()?;
    hanya_pengelola(&user)?;
    let conn = db.lock()?;
    require_menu(&conn, &user, "mnPengaturanPengguna")?;
    rows(&conn, "SELECT u.iduser, u.kodekaryawan, k.namakaryawan, u.\"level\", u.aktif, (u.pswduser IS NULL) AS belum_ada_password FROM mduser u LEFT JOIN mdkaryawan k ON k.kodekaryawan = u.kodekaryawan ORDER BY u.iduser", [])
}

/// Isi combo Level di FrmZPengguna aslinya, urut sama (sub di 0x869f80).
const LEVELS: &[&str] = &["Kasir", "Supervisor", "Manager", "Direktur", "Lainnya"];

fn teks(data: &Map<String, Value>, k: &str) -> String {
    data.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn hanya_pengelola(actor: &User) -> Res<()> {
    if actor.level == "Kasir" {
        return Err("Hanya pemilik atau supervisor yang bisa mengelola pengguna.".into());
    }
    Ok(())
}

/// Satu karyawan satu akun, seperti aslinya (delete from mduser where kodekaryawan = ?): akun lain milik karyawan ini diganti.
fn satu_akun_per_karyawan(conn: &rusqlite::Connection, actor: &User, id: &str, kar: &str) -> Res<()> {
    if kar == "-" {
        return Ok(());
    }
    let mut st = conn.prepare("SELECT iduser, COALESCE(\"level\",'') FROM mduser WHERE kodekaryawan = ?1 AND UPPER(iduser) <> UPPER(?2)").map_err(e)?;
    let lain: Vec<(String, String)> = st.query_map(params![kar, id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(e)?.collect::<Result<_, _>>().map_err(e)?;
    for (uid, lvl) in &lain {
        if uid.eq_ignore_ascii_case(&actor.iduser) {
            return Err(format!("Karyawan ini sudah memakai akun {uid} yang sedang Anda pakai, jadi akunnya tidak bisa diganti."));
        }
        if lvl == "Manager" && actor.level != "Manager" {
            return Err(format!("Karyawan ini sudah punya akun {uid} berlevel Manager. Hanya pemilik yang bisa menggantinya."));
        }
    }
    for (uid, _) in &lain {
        conn.execute("DELETE FROM mdusermenu WHERE iduser = ?1", params![uid]).map_err(e)?;
        conn.execute("DELETE FROM mduser WHERE iduser = ?1", params![uid]).map_err(e)?;
    }
    Ok(())
}

/// Simpan satu pengguna. `baru` = true membuat pengguna baru, false mengubah pengguna yang sudah ada.
/// Password kosong pada pengguna baru berarti ia masuk dengan password sementara; pada pengguna lama berarti tidak diubah.
pub fn simpan_user(conn: &rusqlite::Connection, actor: &User, data: &Map<String, Value>, baru: bool) -> Res<()> {
    hanya_pengelola(actor)?;
    let id = teks(data, "iduser");
    let level = teks(data, "level");
    let kar = teks(data, "kodekaryawan");
    let pswd = data.get("password").and_then(Value::as_str).unwrap_or("");
    if id.is_empty() {
        return Err("Nama user belum diisi.".into());
    }
    if id.chars().count() > 30 {
        return Err("Nama user terlalu panjang. Pakai maksimal 30 karakter.".into());
    }
    if !LEVELS.contains(&level.as_str()) {
        return Err("Level belum dipilih.".into());
    }
    if level == "Manager" && actor.level != "Manager" {
        return Err("Hanya pemilik yang bisa memberi level Manager.".into());
    }
    let kar = if kar.is_empty() { "-".to_string() } else { kar };
    if kar != "-" {
        let ada: i64 = conn.query_row("SELECT COUNT(*) FROM mdkaryawan WHERE kodekaryawan = ?1", params![kar], |r| r.get(0)).map_err(e)?;
        if ada == 0 {
            return Err("Karyawan yang Anda pilih tidak ditemukan.".into());
        }
    }
    let lama = load(conn, &id)?;
    if baru {
        if lama.is_some() {
            return Err(format!("Nama user {id} sudah dipakai. Silakan pilih nama lain."));
        }
        let h = if pswd.is_empty() { None } else { Some(hash(pswd)?) };
        satu_akun_per_karyawan(conn, actor, &id, &kar)?;
        conn.execute(
            "INSERT INTO mduser (iduser, pswduser, kodekaryawan, \"level\", aktif, tglupload, jamupload) VALUES (?1, ?2, ?3, ?4, 1, date('now','localtime'), time('now','localtime'))",
            params![id, h, kar, level],
        )
        .map_err(e)?;
        return Ok(());
    }
    let Some((_, ada, _)) = lama else { return Err("Pengguna yang Anda pilih tidak ditemukan.".into()) };
    if ada.level == "Manager" && actor.level != "Manager" {
        return Err("Hanya pemilik yang bisa mengubah pengguna berlevel Manager.".into());
    }
    if id == actor.iduser {
        if level != ada.level {
            return Err("Level akun yang sedang Anda pakai tidak bisa diubah.".into());
        }
        if !pswd.is_empty() {
            return Err("Untuk mengganti kata sandi Anda sendiri, pakai tombol Ganti Password.".into());
        }
    }
    satu_akun_per_karyawan(conn, actor, &id, &kar)?;
    conn.execute(
        "UPDATE mduser SET kodekaryawan = ?1, \"level\" = ?2, tglupdate = date('now','localtime'), jamupdate = time('now','localtime') WHERE iduser = ?3",
        params![kar, level, id],
    )
    .map_err(e)?;
    if !pswd.is_empty() {
        conn.execute("UPDATE mduser SET pswduser = ?1 WHERE iduser = ?2", params![hash(pswd)?, id]).map_err(e)?;
    }
    Ok(())
}

pub fn hapus_user(conn: &rusqlite::Connection, actor: &User, iduser: &str) -> Res<()> {
    hanya_pengelola(actor)?;
    if iduser == actor.iduser {
        return Err("Akun yang sedang Anda pakai tidak bisa dihapus.".into());
    }
    let Some((_, ada, _)) = load(conn, iduser)? else { return Err("Pengguna yang Anda pilih tidak ditemukan.".into()) };
    if ada.level == "Manager" && actor.level != "Manager" {
        return Err("Hanya pemilik yang bisa menghapus pengguna berlevel Manager.".into());
    }
    conn.execute("DELETE FROM mdusermenu WHERE iduser = ?1", params![iduser]).map_err(e)?;
    conn.execute("DELETE FROM mduser WHERE iduser = ?1", params![iduser]).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn save_user(db: State<Db>, session: State<Session>, data: Map<String, Value>, baru: bool) -> Res<()> {
    let actor = session.user()?;
    let conn = db.lock()?;
    require_menu(&conn, &actor, "mnPengaturanPengguna")?;
    simpan_user(&conn, &actor, &data, baru)
}

#[tauri::command]
pub fn delete_user(db: State<Db>, session: State<Session>, iduser: String) -> Res<()> {
    let actor = session.user()?;
    let conn = db.lock()?;
    require_menu(&conn, &actor, "mnPengaturanPengguna")?;
    hapus_user(&conn, &actor, &iduser)
}


// ---- Hak akses per menu (tabel MDUSERMENU) ----


const MENU_JSON: &str = include_str!("../../src/vb/menu.json");

/// Database baru belum punya isi MDMENU; isi dari daftar menu bawaan supaya hak akses bisa diatur.
fn isi_menu(conn: &rusqlite::Connection) -> Res<()> {
    let ada: i64 = conn.query_row("SELECT COUNT(*) FROM mdmenu", [], |r| r.get(0)).map_err(e)?;
    if ada > 0 {
        return Ok(());
    }
    fn simpan(conn: &rusqlite::Connection, nodes: &Value, parent: &str, level: i64) -> Res<()> {
        for n in nodes.as_array().into_iter().flatten() {
            let id = n["id"].as_str().unwrap_or("");
            conn.execute(
                "INSERT OR IGNORE INTO mdmenu (idmenu, namamenu, captionmenu, mlevel, parent, aktif) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![id, n["nama"].as_str().unwrap_or(""), n["caption"].as_str().unwrap_or(""), level.to_string(), parent],
            )
            .map_err(e)?;
            simpan(conn, &n["children"], id, level + 1)?;
        }
        Ok(())
    }
    let tree: Value = serde_json::from_str(MENU_JSON).map_err(e)?;
    simpan(conn, &tree, "0", 0)
}

/// Nama menu (kolom namamenu) yang tidak boleh dibuka `iduser`: baris MDUSERMENU dengan akses 0.
/// Menu tanpa baris dianggap tidak diatur per pengguna, jadi aturan level yang berlaku.
/// Pengguna Manager tidak pernah dibatasi. ID pengguna dibandingkan tanpa melihat huruf besar/kecil,
/// seperti data lama yang menyimpan "ADMIN", "Admin", dan "admin" bersamaan.
pub fn menu_ditolak(conn: &rusqlite::Connection, user: &User) -> Res<Vec<String>> {
    if user.level == "Manager" {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            "SELECT m.namamenu FROM mdusermenu um JOIN mdmenu m ON m.idmenu = um.idmenu
             WHERE UPPER(um.iduser) = UPPER(?1) GROUP BY m.namamenu HAVING MAX(COALESCE(um.akses,0)) = 0 ORDER BY m.namamenu",
        )
        .map_err(e)?;
    let list = stmt.query_map(params![user.iduser], |r| r.get::<_, String>(0)).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?;
    Ok(list)
}

/// Tolak kalau menu `nama` (mis. "mnMDDataBarang") dinonaktifkan untuk pengguna ini.
pub fn require_menu(conn: &rusqlite::Connection, user: &User, nama: &str) -> Res<()> {
    if menu_ditolak(conn, user)?.iter().any(|m| m == nama) {
        let caption: Option<String> = conn
            .query_row("SELECT captionmenu FROM mdmenu WHERE namamenu = ?1", params![nama], |r| r.get(0))
            .ok();
        return Err(format!("Anda tidak punya hak akses ke menu {}. Hubungi pemilik toko untuk meminta akses.", caption.unwrap_or_else(|| nama.to_string())));
    }
    Ok(())
}

/// Menu yang disembunyikan untuk pengguna yang sedang masuk.
#[tauri::command]
pub fn my_menus(db: State<Db>, session: State<Session>) -> Res<Vec<String>> {
    let user = session.user()?;
    let conn = db.lock()?;
    menu_ditolak(&conn, &user)
}

/// Hak akses satu pengguna: tiap menu aktif (idmenu) dengan nilai akses 0, 1, atau 2 (sebagian).
/// Pengguna yang belum punya baris sama sekali dianggap boleh membuka semua menu.
pub fn daftar_akses(conn: &rusqlite::Connection, actor: &User, iduser: &str) -> Res<Vec<Value>> {
    hanya_pengelola(actor)?;
    isi_menu(conn)?;
    rows(
        conn,
        "SELECT m.idmenu, m.namamenu, m.captionmenu, m.parent, COALESCE((SELECT MAX(um.akses) FROM mdusermenu um WHERE UPPER(um.iduser) = UPPER(?1) AND um.idmenu = m.idmenu), 1) AS akses
         FROM mdmenu m WHERE COALESCE(m.aktif,1) = 1 ORDER BY m.idmenu",
        params![iduser],
    )
}

/// Ganti seluruh hak akses satu pengguna. `diizinkan` berisi idmenu yang dicentang (menu paling bawah);
/// induk menu diberi nilai 1 kalau semua anaknya dicentang, 2 kalau sebagian, 0 kalau tidak ada.
pub fn simpan_akses(conn: &mut rusqlite::Connection, actor: &User, iduser: &str, diizinkan: &[String]) -> Res<()> {
    hanya_pengelola(actor)?;
    let Some((_, target, _)) = load(conn, iduser)? else { return Err("Pengguna yang Anda pilih tidak ditemukan.".into()) };
    if target.level == "Manager" && actor.level != "Manager" {
        return Err("Hanya pemilik yang bisa mengubah hak akses pengguna berlevel Manager.".into());
    }
    isi_menu(conn)?;
    let menus = rows(conn, "SELECT idmenu, parent FROM mdmenu WHERE COALESCE(aktif,1) = 1 ORDER BY idmenu", [])?;
    let info: Vec<(String, String)> = menus
        .iter()
        .map(|m| (m["idmenu"].as_str().unwrap_or("").to_string(), m["parent"].as_str().unwrap_or("0").to_string()))
        .collect();
    // Nilai akses sebuah menu: daun = 1/0, induk = ringkasan anak-anaknya.
    fn nilai(id: &str, info: &[(String, String)], ok: &[String]) -> i64 {
        let anak: Vec<&String> = info.iter().filter(|(_, p)| p == id).map(|(i, _)| i).collect();
        if anak.is_empty() {
            return ok.iter().any(|x| x == id) as i64;
        }
        let v: Vec<i64> = anak.iter().map(|a| nilai(a, info, ok)).collect();
        if v.iter().all(|x| *x == 1) { 1 } else if v.iter().all(|x| *x == 0) { 0 } else { 2 }
    }
    let tx = conn.transaction().map_err(e)?;
    tx.execute("DELETE FROM mdusermenu WHERE UPPER(iduser) = UPPER(?1)", params![iduser]).map_err(e)?;
    for (id, _) in &info {
        tx.execute("INSERT INTO mdusermenu (iduser, idmenu, akses) VALUES (?1, ?2, ?3)", params![iduser, id, nilai(id, &info, diizinkan)]).map_err(e)?;
    }
    tx.commit().map_err(e)
}

#[tauri::command]
pub fn user_akses(db: State<Db>, session: State<Session>, iduser: String) -> Res<Vec<Value>> {
    let actor = session.user()?;
    let conn = db.lock()?;
    require_menu(&conn, &actor, "mnPengaturanPengguna")?;
    daftar_akses(&conn, &actor, &iduser)
}

#[tauri::command]
pub fn save_user_akses(db: State<Db>, session: State<Session>, iduser: String, diizinkan: Vec<String>) -> Res<()> {
    let actor = session.user()?;
    let mut conn = db.lock()?;
    require_menu(&conn, &actor, "mnPengaturanPengguna")?;
    simpan_akses(&mut conn, &actor, &iduser, &diizinkan)
}

/// User yang sedang masuk, atau `None` kalau belum ada sesi.
#[tauri::command]
pub fn current_user(session: State<Session>) -> Res<Option<User>> {
    Ok(session.0.lock().map_err(e)?.clone())
}

/// Hanya di build pengembangan: pulihkan sesi setelah backend dimulai ulang oleh `tauri dev`,
/// supaya hot reload tidak selalu kembali ke layar login. Build rilis selalu menolak.
#[tauri::command]
pub fn restore_session(db: State<Db>, session: State<Session>, iduser: String) -> Res<Option<User>> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }
    let conn = db.lock()?;
    let Some((_, user, aktif)) = load(&conn, iduser.trim())? else { return Ok(None) };
    if aktif == 0 || user.must_change {
        return Ok(None);
    }
    *session.0.lock().map_err(e)? = Some(user.clone());
    Ok(Some(user))
}
