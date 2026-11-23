//! Pindahkan data dari Toko Pro lama (VB6 + Firebird 2.5) ke database SQLite aplikasi ini.
//! Logikanya port dari `tools/import_firebird.py`: baca lewat `isql` (cp1252), tulis ke SQLite baru,
//! lalu tukar database yang sedang dipakai lewat `database::pulihkan` (yang membuat cadangan pengaman).

use crate::auth::Session;
use crate::database::{folder_bawaan, hanya_manager, lokasi_db, pulihkan};
use crate::db::{e, Db, Res};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, State};

const SEP: char = '\x1f';
const NULL_MARK: &str = "\x1e";
const START: &str = "@@R@@";
const END: &str = "@@E@@";

/// Urutan tabel. MDBARANG paling akhir supaya trigger stok tidak menghitung ulang mutasi lama.
pub(crate) const URUTAN: [&str; 24] = [
    "TSETING", "MDSATUAN", "MDKELOMPOK", "MDKATEGORI", "MDPELANGGAN", "MDPEMASOK",
    "MDKARYAWAN", "MDUSER", "MDMENU", "MDUSERMENU", "MDJENISNONTUNAI", "MDJENISNONTUNAIITEM",
    "MDBARANGBARCODE", "MDBARANGBONUS", "MDBARANGDISKON", "MDBARANGPDP",
    "TRANSAKSI", "TRANSAKSIDETIL", "TRANSAKSIPOIN", "TRKARTUPIUTANG", "TRKARTUPIUTANGDETIL",
    "KEUANGAN", "APPLOG", "MDBARANG",
];

pub(crate) fn nama_tabel(tabel: &str) -> &'static str {
    match tabel {
        "TSETING" => "Pengaturan",
        "MDSATUAN" => "Satuan",
        "MDKELOMPOK" => "Kelompok",
        "MDKATEGORI" => "Kategori",
        "MDPELANGGAN" => "Pelanggan",
        "MDPEMASOK" => "Supplier",
        "MDKARYAWAN" => "Karyawan",
        "MDUSER" => "Pengguna",
        "MDMENU" => "Menu",
        "MDUSERMENU" => "Hak akses menu",
        "MDJENISNONTUNAI" => "Jenis non tunai",
        "MDJENISNONTUNAIITEM" => "Rincian non tunai",
        "MDBARANGBARCODE" => "Barcode barang",
        "MDBARANGBONUS" => "Promo bonus",
        "MDBARANGDISKON" => "Promo diskon",
        "MDBARANGPDP" => "Diskon PDP",
        "TRANSAKSI" => "Transaksi",
        "TRANSAKSIDETIL" => "Detail transaksi",
        "TRANSAKSIPOIN" => "Poin",
        "TRKARTUPIUTANG" => "Kartu piutang/hutang",
        "TRKARTUPIUTANGDETIL" => "Detail kartu piutang/hutang",
        "KEUANGAN" => "Kas",
        "APPLOG" => "Catatan aktivitas",
        "MDBARANG" => "Barang",
        _ => "Data lain",
    }
}

const PESAN_TIDAK_ADA: &str = "Program pembaca data lama (Firebird) tidak ada di komputer ini. Jalankan pemindahan di komputer yang dulu memakai Toko Pro lama.";
const PESAN_BUKAN: &str = "File ini bukan data Toko Pro lama. Pilih file DATAPOS.FDB atau file backup .fdk dari aplikasi lama.";
const PESAN_TERKUNCI: &str = "File data Toko Pro lama sedang dipakai. Tutup dulu aplikasi Toko Pro lama, lalu coba lagi.";

fn pesan_tidak_terbuka(detail: &str) -> String {
    format!("Data lama belum bisa dibuka. Nyalakan ulang komputer, lalu coba lagi. ({})", ringkas(detail))
}

/// Satu baris pendek dari pesan teknis, maksimal 160 karakter.
fn ringkas(s: &str) -> String {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > 160 { format!("{}...", t.chars().take(160).collect::<String>()) } else { t }
}

// ---------------------------------------------------------------- cp1252

const CP1252_80: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

/// Charset database lama NONE; teksnya cp1252 (Windows Indonesia).
pub(crate) fn dekode_cp1252(b: &[u8]) -> String {
    b.iter()
        .map(|&x| match x {
            0x80..=0x9F => CP1252_80[(x - 0x80) as usize],
            _ => x as char,
        })
        .collect()
}

// ---------------------------------------------------------------- Settings.ini

/// Kunci diubah ke huruf kecil dengan awalan bagian: `database.lokasidata`.
pub(crate) fn baca_ini(teks: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut bagian = String::new();
    for baris in teks.lines() {
        let b = baris.trim().trim_start_matches('\u{FEFF}');
        if b.is_empty() || b.starts_with(';') {
            continue;
        }
        if b.starts_with('[') && b.ends_with(']') {
            bagian = b[1..b.len() - 1].trim().to_lowercase();
        } else if let Some((k, v)) = b.split_once('=') {
            out.insert(format!("{}.{}", bagian, k.trim().to_lowercase()), v.trim().trim_matches('"').to_string());
        }
    }
    out
}

fn baca_ini_file(p: &Path) -> Option<HashMap<String, String>> {
    let bytes = std::fs::read(p).ok()?;
    Some(baca_ini(&dekode_cp1252(&bytes)))
}

// ---------------------------------------------------------------- proses luar

fn senyap(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

struct Keluaran {
    ok: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl Keluaran {
    fn teks_galat(&self) -> String {
        let a = dekode_cp1252(&self.stderr);
        if a.trim().is_empty() { dekode_cp1252(&self.stdout) } else { a }
    }
}

fn jalankan(cmd: &mut Command, stdin: Option<&[u8]>) -> Res<Keluaran> {
    senyap(cmd).stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut anak = cmd.spawn().map_err(|err| format!("Program tidak bisa dijalankan. ({err})"))?;
    if let Some(data) = stdin {
        use std::io::Write;
        if let Some(mut si) = anak.stdin.take() {
            let _ = si.write_all(data);
        }
    }
    let o = anak.wait_with_output().map_err(e)?;
    Ok(Keluaran { ok: o.status.success(), stdout: o.stdout, stderr: o.stderr })
}

// ---------------------------------------------------------------- Firebird

enum Mode {
    Lokal(PathBuf),
    Docker(String),
}

pub struct Firebird {
    mode: Mode,
}

fn nama_exe(n: &str) -> String {
    if cfg!(windows) { format!("{n}.exe") } else { n.to_string() }
}

fn folder_firebird_valid(d: &Path) -> bool {
    d.join(nama_exe("isql")).is_file()
}

impl Firebird {
    /// Cari Firebird: `TOKOPRO_FB_DOCKER`, lalu `TOKOPRO_FB_BIN`, folder dari Settings.ini lama, lalu lokasi bawaan.
    pub fn temukan(dari_ini: &[PathBuf]) -> Option<Firebird> {
        if let Ok(c) = std::env::var("TOKOPRO_FB_DOCKER") {
            if !c.trim().is_empty() {
                return Some(Firebird::docker(c.trim()));
            }
        }
        let mut calon: Vec<PathBuf> = vec![];
        if let Ok(b) = std::env::var("TOKOPRO_FB_BIN") {
            calon.push(PathBuf::from(b));
        }
        calon.extend(dari_ini.iter().cloned());
        calon.push(PathBuf::from(r"C:\Program Files\Firebird\Firebird_2_5\bin"));
        calon.push(PathBuf::from(r"C:\Program Files (x86)\Firebird\Firebird_2_5\bin"));
        calon.into_iter().find(|d| folder_firebird_valid(d)).map(|d| Firebird { mode: Mode::Lokal(d) })
    }

    pub fn docker(container: &str) -> Firebird {
        Firebird { mode: Mode::Docker(container.to_string()) }
    }

    pub fn lokasi(&self) -> String {
        match &self.mode {
            Mode::Lokal(d) => d.display().to_string(),
            Mode::Docker(c) => format!("docker:{c}"),
        }
    }

    fn perintah(&self, alat: &str) -> Command {
        match &self.mode {
            Mode::Lokal(d) => Command::new(d.join(nama_exe(alat))),
            Mode::Docker(c) => {
                let mut x = Command::new("docker");
                x.args(["exec", "-i", c, &format!("/usr/local/firebird/bin/{alat}")]);
                x
            }
        }
    }

    /// Alamat database untuk isql/gbak: `localhost:<path>` di Windows, path di dalam container untuk Docker.
    fn alamat(&self, path: &str) -> String {
        match &self.mode {
            Mode::Lokal(_) => format!("localhost:{path}"),
            Mode::Docker(_) => path.to_string(),
        }
    }

    fn docker_exec(&self, root: bool, args: &[&str]) -> Res<Keluaran> {
        let Mode::Docker(c) = &self.mode else { return Err("Mode Docker tidak aktif.".into()) };
        let mut cmd = Command::new("docker");
        cmd.arg("exec");
        if root {
            cmd.args(["-u", "root"]);
        }
        cmd.arg(c).args(args);
        jalankan(&mut cmd, None)
    }

    /// Taruh file di tempat yang bisa dibaca Firebird. Lokal: path yang sama. Docker: disalin ke container.
    fn siapkan_file(&self, file: &Path, nama_unik: &str) -> Res<String> {
        match &self.mode {
            Mode::Lokal(_) => Ok(file.display().to_string()),
            Mode::Docker(c) => {
                let dir = format!("/tmp/pindah-lama/{nama_unik}");
                let r = self.docker_exec(true, &["sh", "-c", &format!("mkdir -p {dir} && chmod 777 /tmp/pindah-lama {dir}")])?;
                if !r.ok {
                    return Err(pesan_tidak_terbuka(&r.teks_galat()));
                }
                let nama = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "data".into());
                let tujuan = format!("{dir}/{nama}");
                let cp = jalankan(Command::new("docker").args(["cp", &file.display().to_string(), &format!("{c}:{tujuan}")]), None)?;
                if !cp.ok {
                    return Err(pesan_tidak_terbuka(&cp.teks_galat()));
                }
                self.docker_exec(true, &["chmod", "666", &tujuan])?;
                Ok(tujuan)
            }
        }
    }

    /// Hapus sisa file di container (Docker saja). Mode lokal dibersihkan lewat folder kerja.
    fn bersihkan(&self, nama_unik: &str) {
        if let Mode::Docker(_) = &self.mode {
            let _ = self.docker_exec(true, &["rm", "-rf", &format!("/tmp/pindah-lama/{nama_unik}")]);
        }
    }

    /// Pulihkan backup `.fdk` jadi database baru. Mengembalikan alamat file hasilnya (path versi Firebird).
    fn pulihkan_fdk(&self, fdk: &Path, kerja: &Path, nama_unik: &str) -> Res<String> {
        let (sumber, tujuan) = match &self.mode {
            Mode::Lokal(_) => (fdk.display().to_string(), kerja.join("data-lama.fdb").display().to_string()),
            Mode::Docker(_) => {
                let s = self.siapkan_file(fdk, nama_unik)?;
                (s.clone(), format!("/tmp/pindah-lama/{nama_unik}/data-lama.fdb"))
            }
        };
        let mut cmd = self.perintah("gbak");
        cmd.args(["-c", "-user", "SYSDBA", "-password", "masterkey", &sumber, &self.alamat(&tujuan)]);
        let r = jalankan(&mut cmd, None)?;
        if !r.ok {
            return Err(format!("{} ({})", PESAN_BUKAN, ringkas(&r.teks_galat())));
        }
        Ok(tujuan)
    }

    fn isql(&self, db_path: &str, sql: &str) -> Res<String> {
        let mut cmd = self.perintah("isql");
        cmd.args(["-user", "SYSDBA", "-password", "masterkey", &self.alamat(db_path)]);
        let r = jalankan(&mut cmd, Some(sql.as_bytes()))?;
        let gabung = format!("{} {}", dekode_cp1252(&r.stdout), dekode_cp1252(&r.stderr));
        if !r.ok {
            let t = r.teks_galat();
            if gabung.contains("not a valid database") || gabung.contains("Unsupported on-disk") || gabung.contains("ODS") {
                return Err(format!("{} ({})", PESAN_BUKAN, ringkas(&t)));
            }
            return Err(pesan_tidak_terbuka(&t));
        }
        Ok(dekode_cp1252(&r.stdout))
    }
}

// ---------------------------------------------------------------- pembaca data (bisa diganti di tes)

pub trait Sumber {
    fn kolom(&self, tabel: &str) -> Res<Vec<String>>;
    fn baris(&self, tabel: &str, kolom: &[String]) -> Res<Vec<Vec<Option<String>>>>;
}

/// Pembaca data dari satu file Firebird lewat isql.
pub struct SumberFirebird<'a> {
    pub fb: &'a Firebird,
    pub db_path: String,
}

pub(crate) fn sql_kolom(tabel: &str) -> String {
    format!(
        "set list on; select '{START}' || trim(rdb$field_name) || '{END}' as c from rdb$relation_fields where rdb$relation_name='{tabel}' order by rdb$field_position;"
    )
}

pub(crate) fn sql_baris(tabel: &str, kolom: &[String]) -> String {
    let bagian: Vec<String> = kolom
        .iter()
        .map(|c| {
            let v = format!("cast(\"{c}\" as varchar(300))");
            let v = format!("replace(replace({v}, ascii_char(13), ' '), ascii_char(10), ' ')");
            format!("coalesce({v}, ascii_char(30))")
        })
        .collect();
    let ekspresi = bagian.join(" || ascii_char(31) || ");
    format!("set list on; select '{START}' || {ekspresi} || '{END}' as r from \"{tabel}\";")
}

/// Ambil isi di antara penanda dari tiap baris keluaran isql.
fn isi_baris<'a>(keluaran: &'a str) -> impl Iterator<Item = &'a str> {
    keluaran.split('\n').filter_map(|l| {
        let (_, sisa) = l.split_once(START)?;
        Some(sisa.rsplit_once(END).map(|(a, _)| a).unwrap_or(sisa))
    })
}

pub(crate) fn urai_kolom(keluaran: &str) -> Vec<String> {
    isi_baris(keluaran).map(|s| s.to_string()).collect()
}

/// Pecah keluaran isql jadi baris data. Galat bila jumlah kolom tidak cocok.
pub(crate) fn urai_baris(tabel: &str, keluaran: &str, jumlah_kolom: usize) -> Res<Vec<Vec<Option<String>>>> {
    let mut out = vec![];
    for isi in isi_baris(keluaran) {
        let r: Vec<Option<String>> = isi.split(SEP).map(|v| if v == NULL_MARK { None } else { Some(v.to_string()) }).collect();
        if r.len() != jumlah_kolom {
            return Err(format!("Baris di tabel {tabel} rusak: ada {} kolom, seharusnya {jumlah_kolom}. Data lama tidak bisa dipindahkan.", r.len()));
        }
        out.push(r);
    }
    Ok(out)
}

impl Sumber for SumberFirebird<'_> {
    fn kolom(&self, tabel: &str) -> Res<Vec<String>> {
        Ok(urai_kolom(&self.fb.isql(&self.db_path, &sql_kolom(tabel))?))
    }
    fn baris(&self, tabel: &str, kolom: &[String]) -> Res<Vec<Vec<Option<String>>>> {
        urai_baris(tabel, &self.fb.isql(&self.db_path, &sql_baris(tabel, kolom))?, kolom.len())
    }
}

// ---------------------------------------------------------------- bangun SQLite

#[derive(Clone, Debug, PartialEq)]
pub struct Progres {
    pub tahap: &'static str,
    pub tabel: String,
    pub nama: String,
    pub ke: usize,
    pub dari: usize,
    pub jumlah: usize,
}

impl Progres {
    pub fn json(&self) -> Value {
        json!({ "tahap": self.tahap, "tabel": self.tabel, "nama": self.nama, "ke": self.ke, "dari": self.dari, "jumlah": self.jumlah })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HasilTabel {
    pub tabel: String,
    pub nama: String,
    pub jumlah: usize,
}

fn ubah(kolom: &str, nilai: Option<String>) -> Option<String> {
    let v = nilai?;
    if kolom.to_lowercase().starts_with("jam") && v.chars().count() > 8 {
        return Some(v.chars().take(8).collect());
    }
    Some(v)
}

/// Buat file SQLite baru di `tujuan` dari `sumber`. Tidak memakai `db::open` supaya tidak ada data awal.
pub fn bangun_sqlite(sumber: &dyn Sumber, tujuan: &Path, progres: &mut dyn FnMut(Progres)) -> Res<(Vec<HasilTabel>, Vec<String>)> {
    let _ = std::fs::remove_file(tujuan);
    let mut conn = Connection::open(tujuan).map_err(e)?;
    conn.execute_batch(crate::db::SCHEMA).map_err(e)?;
    conn.pragma_update(None, "foreign_keys", "OFF").map_err(e)?;
    let mut hasil = vec![];
    let mut peringatan = vec![];
    let tx = conn.transaction().map_err(e)?;
    for (i, tabel) in URUTAN.iter().enumerate() {
        let nama = nama_tabel(tabel);
        let kolom = sumber.kolom(tabel)?;
        let lokal = tabel.to_lowercase();
        let ada: Vec<String> = {
            let mut st = tx.prepare(&format!("PRAGMA table_info({lokal})")).map_err(e)?;
            st.query_map([], |r| r.get::<_, String>(1)).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?
        };
        let ada: Vec<String> = ada.into_iter().map(|c| c.to_lowercase()).collect();
        let simpan: Vec<usize> = (0..kolom.len()).filter(|&k| ada.contains(&kolom[k].to_lowercase())).collect();
        if simpan.len() != kolom.len() {
            let hilang: Vec<&str> = kolom.iter().filter(|c| !ada.contains(&c.to_lowercase())).map(|c| c.as_str()).collect();
            peringatan.push(format!("Kolom {} di data {} tidak ikut dipindahkan karena tidak dipakai lagi.", hilang.join(", "), nama.to_lowercase()));
        }
        let mut jumlah = 0;
        if !simpan.is_empty() {
            let nama_kol: Vec<String> = simpan.iter().map(|&k| kolom[k].to_lowercase()).collect();
            let sql = format!(
                "INSERT INTO {lokal} ({}) VALUES ({})",
                nama_kol.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join(","),
                vec!["?"; nama_kol.len()].join(",")
            );
            let mut st = tx.prepare(&sql).map_err(e)?;
            for r in sumber.baris(tabel, &kolom)? {
                let mut nilai: Vec<Option<String>> = simpan.iter().map(|&k| ubah(&kolom[k], r[k].clone())).collect();
                if *tabel == "MDUSER" {
                    if let Some(p) = nama_kol.iter().position(|n| n == "pswduser") {
                        nilai[p] = None;
                    }
                }
                st.execute(rusqlite::params_from_iter(nilai.iter())).map_err(e)?;
                jumlah += 1;
            }
        }
        hasil.push(HasilTabel { tabel: tabel.to_string(), nama: nama.to_string(), jumlah });
        progres(Progres { tahap: "baca", tabel: tabel.to_string(), nama: nama.to_string(), ke: i + 1, dari: URUTAN.len(), jumlah });
    }
    tx.commit().map_err(e)?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(e)?;
    let rusak: Vec<String> = {
        let mut st = conn.prepare("PRAGMA foreign_key_check").map_err(e)?;
        st.query_map([], |r| r.get::<_, String>(0)).map_err(e)?.collect::<Result<Vec<_>, _>>().map_err(e)?
    };
    if !rusak.is_empty() {
        let mut per: Vec<(String, usize)> = vec![];
        for t in rusak {
            match per.iter_mut().find(|x| x.0 == t) {
                Some(x) => x.1 += 1,
                None => per.push((t, 1)),
            }
        }
        for (t, n) in per {
            peringatan.push(format!("{n} baris di tabel {t} merujuk data yang tidak ditemukan. Barisnya tetap ikut dipindahkan."));
        }
    }
    drop(conn);
    Ok((hasil, peringatan))
}

// ---------------------------------------------------------------- pindahkan

pub struct HasilPindah {
    pub hasil: Vec<HasilTabel>,
    pub cadangan: PathBuf,
    pub peringatan: Vec<String>,
}

fn cap_waktu() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn salin_lama(file: &Path, tujuan: &Path) -> Res<()> {
    std::fs::copy(file, tujuan).map(|_| ()).map_err(|err| {
        if matches!(err.raw_os_error(), Some(32) | Some(33)) {
            PESAN_TERKUNCI.to_string()
        } else if err.kind() == std::io::ErrorKind::NotFound {
            "File data lama tidak ditemukan. Periksa lokasinya, lalu coba lagi.".to_string()
        } else {
            format!("File data lama tidak bisa disalin. Pastikan Toko Pro lama sudah ditutup, lalu coba lagi. ({})", ringkas(&err.to_string()))
        }
    })
}

/// Bangun SQLite baru dari file lama di folder kerja. Mengembalikan lokasi SQLite, hasil, dan peringatan.
fn siapkan_sqlite(fb: &Firebird, file: &Path, kerja: &Path, nama_unik: &str, progres: &mut dyn FnMut(Progres)) -> Res<(PathBuf, Vec<HasilTabel>, Vec<String>)> {
    progres(Progres { tahap: "salin", tabel: String::new(), nama: "Menyalin data lama".into(), ke: 0, dari: URUTAN.len(), jumlah: 0 });
    let ext = file.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
    let db_path = match ext.as_str() {
        "fdb" => {
            let salinan = kerja.join("data-lama.fdb");
            salin_lama(file, &salinan)?;
            fb.siapkan_file(&salinan, nama_unik)?
        }
        "fdk" => fb.pulihkan_fdk(file, kerja, nama_unik)?,
        _ => return Err(PESAN_BUKAN.into()),
    };
    let ada = fb.isql(&db_path, &format!(
        "set list on; select '{START}' || count(*) || '{END}' as r from rdb$relations where rdb$relation_name in ('MDBARANG','TRANSAKSI','TSETING');"
    ))?;
    if urai_kolom(&ada).first().map(String::as_str) != Some("3") {
        return Err(PESAN_BUKAN.into());
    }
    let sumber = SumberFirebird { fb, db_path };
    let baru = kerja.join("tokopro-baru.db");
    let (hasil, peringatan) = bangun_sqlite(&sumber, &baru, progres)?;
    Ok((baru, hasil, peringatan))
}

pub fn pindahkan(db: &Db, file: &Path, folder: Option<&str>, fb: &Firebird, progres: &mut dyn FnMut(Progres)) -> Res<HasilPindah> {
    let (datadir, folder_aman) = {
        let conn = db.lock()?;
        let datadir = lokasi_db(&conn)?.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
        let aman = match folder.map(str::trim).filter(|f| !f.is_empty()) {
            Some(f) => PathBuf::from(f),
            None => folder_bawaan(&conn)?,
        };
        (datadir, aman)
    };
    static URUT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let nama_unik = format!("{}-{}-{}", cap_waktu(), std::process::id(), URUT.fetch_add(1, std::sync::atomic::Ordering::SeqCst));
    let kerja = datadir.join("pindah-lama").join(&nama_unik);
    std::fs::create_dir_all(&kerja).map_err(|err| format!("Folder kerja tidak bisa dibuat. Periksa ruang kosong di komputer Anda. ({})", ringkas(&err.to_string())))?;
    let hasil = (|| -> Res<HasilPindah> {
        let (baru, hasil, peringatan) = siapkan_sqlite(fb, file, &kerja, &nama_unik, progres)?;
        let cadangan = {
            let mut conn = db.lock()?;
            pulihkan(&mut conn, &baru, &folder_aman)?
        };
        let total = hasil.len();
        progres(Progres { tahap: "selesai", tabel: String::new(), nama: String::new(), ke: total, dari: total, jumlah: hasil.iter().map(|h| h.jumlah).sum() });
        Ok(HasilPindah { hasil, cadangan, peringatan })
    })();
    fb.bersihkan(&nama_unik);
    let _ = std::fs::remove_dir_all(&kerja);
    let _ = std::fs::remove_dir(datadir.join("pindah-lama")); // hanya berhasil kalau kosong
    hasil
}

// ---------------------------------------------------------------- cari

#[derive(Clone, Debug, PartialEq)]
pub struct Kandidat {
    pub path: String,
    pub jenis: &'static str,
    pub ukuran: u64,
    pub waktu: String,
    modif: std::time::SystemTime,
}

#[derive(Default)]
pub struct Temuan {
    pub kandidat: Vec<Kandidat>,
    pub folder_firebird: Vec<PathBuf>,
}

fn kandidat_dari(p: &Path, jenis: &'static str) -> Option<Kandidat> {
    let m = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
    let modif = m.modified().unwrap_or(std::time::UNIX_EPOCH);
    Some(Kandidat {
        path: p.display().to_string(),
        jenis,
        ukuran: m.len(),
        waktu: chrono::DateTime::<chrono::Local>::from(modif).format("%Y-%m-%d %H:%M").to_string(),
        modif,
    })
}

fn sub_folder(d: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(d).map(|rd| rd.flatten().map(|f| f.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

fn periksa_folder(d: &Path, t: &mut Temuan, cadangan: &mut Vec<Kandidat>) {
    let data_bawaan = d.join("_data").join("DATAPOS.FDB");
    if let Some(k) = kandidat_dari(&data_bawaan, "fdb") {
        t.kandidat.push(k);
    }
    let ini = d.join("Settings.ini");
    if !ini.is_file() {
        return;
    }
    let Some(kv) = baca_ini_file(&ini) else { return };
    let Some(lokasi) = kv.get("database.lokasidata").filter(|s| !s.is_empty()) else { return };
    if let Some(k) = kandidat_dari(Path::new(lokasi), "fdb") {
        t.kandidat.push(k);
    }
    if let Some(fb) = kv.get("database.firebirdlocation").filter(|s| !s.is_empty()) {
        t.folder_firebird.push(PathBuf::from(fb));
    }
    if let Some(bk) = kv.get("database.lokasibackup").filter(|s| !s.is_empty()) {
        if let Ok(rd) = std::fs::read_dir(bk) {
            for f in rd.flatten() {
                let p = f.path();
                if p.extension().map(|x| x.to_string_lossy().eq_ignore_ascii_case("fdk")).unwrap_or(false) {
                    cadangan.extend(kandidat_dari(&p, "fdk"));
                }
            }
        }
    }
}

/// Cari instalasi lama di `akar` (kedalaman 1 dan 2). Dipisah dari `cari()` supaya bisa dites.
pub fn cari_di(akar: &[PathBuf]) -> Temuan {
    let mut t = Temuan::default();
    let mut cadangan = vec![];
    for a in akar.iter().filter(|a| a.is_dir()) {
        for d1 in sub_folder(a) {
            let nama = d1.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if matches!(nama.as_str(), "windows" | "$recycle.bin" | "system volume information") {
                continue;
            }
            periksa_folder(&d1, &mut t, &mut cadangan);
            for d2 in sub_folder(&d1) {
                periksa_folder(&d2, &mut t, &mut cadangan);
            }
        }
    }
    let kunci = |p: &str| p.to_lowercase().replace('/', "\\");
    let mut lihat = std::collections::HashSet::new();
    t.kandidat.retain(|k| lihat.insert(kunci(&k.path)));
    cadangan.retain(|k| lihat.insert(kunci(&k.path)));
    cadangan.sort_by(|a, b| b.modif.cmp(&a.modif));
    cadangan.truncate(5);
    t.kandidat.extend(cadangan);
    let mut f = std::collections::HashSet::new();
    t.folder_firebird.retain(|p| f.insert(kunci(&p.display().to_string())));
    t
}

pub fn cari() -> Temuan {
    if !cfg!(windows) {
        return Temuan::default();
    }
    let akar: Vec<PathBuf> = [r"C:\Program Files (x86)", r"C:\Program Files", r"C:\", r"D:\"].iter().map(PathBuf::from).collect();
    cari_di(&akar)
}

// ---------------------------------------------------------------- perintah Tauri

#[tauri::command]
pub async fn lama_cari(app: AppHandle, session: State<'_, Session>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    tauri::async_runtime::spawn_blocking(move || -> Res<Value> {
        let t = cari();
        let fb = Firebird::temukan(&t.folder_firebird);
        let db = app.state::<Db>();
        let (barang, transaksi) = {
            let conn = db.lock()?;
            let n = |tabel: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {tabel}"), [], |r| r.get::<_, i64>(0)).map_err(e);
            (n("mdbarang")?, n("transaksi")?)
        };
        Ok(json!({
            "kandidat": t.kandidat.iter().map(|k| json!({ "path": k.path, "jenis": k.jenis, "ukuran": k.ukuran, "waktu": k.waktu })).collect::<Vec<_>>(),
            "firebird": { "ada": fb.is_some(), "lokasi": fb.as_ref().map(|f| f.lokasi()) },
            "data_sekarang": { "barang": barang, "transaksi": transaksi },
        }))
    })
    .await
    .map_err(e)?
}

#[tauri::command]
pub async fn lama_pindahkan(app: AppHandle, session: State<'_, Session>, file: String, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let file = file.trim().to_string();
    if file.is_empty() {
        return Err("Anda belum memilih file data lama.".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Res<Value> {
        let t = cari();
        let fb = Firebird::temukan(&t.folder_firebird).ok_or_else(|| PESAN_TIDAK_ADA.to_string())?;
        let db = app.state::<Db>();
        let emitter = app.clone();
        let h = pindahkan(&db, Path::new(&file), folder.as_deref(), &fb, &mut |p| {
            let _ = emitter.emit("pindah-lama", p.json());
        })?;
        Ok(json!({
            "hasil": h.hasil.iter().map(|x| json!({ "tabel": x.tabel, "nama": x.nama, "jumlah": x.jumlah })).collect::<Vec<_>>(),
            "cadangan": h.cadangan.display().to_string(),
            "peringatan": h.peringatan,
        }))
    })
    .await
    .map_err(e)?
}
