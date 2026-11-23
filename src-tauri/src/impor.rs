//! Impor data dari file CSV atau Excel (.xls, .xlsx): barang, pelanggan, pemasok, karyawan, kategori, kelompok, satuan.
//! Kolom dikenali dari nama judulnya (tanpa membedakan huruf besar/kecil), sama dengan nama kolom di data aslinya.

use crate::auth::Session;
use crate::database::{backup_ke, folder_bawaan, hanya_manager};
use crate::db::{e, Db, Res};
use rusqlite::types::Value as Sql;
use rusqlite::{params, params_from_iter, Connection};
use serde_json::{json, Value};
use std::path::Path;
use perintah_macro::perintah;

#[derive(Clone, Copy, PartialEq)]
enum Tipe {
    Teks,
    Angka,
    Tanggal,
}

struct Jenis {
    kunci: &'static str,
    nama: &'static str,
    tabel: &'static str,
    kode: &'static str,
    wajib: &'static [&'static str],
    kolom: &'static [(&'static str, Tipe)],
}

use Tipe::{Angka as A, Tanggal as D, Teks as T};

const JENIS: &[Jenis] = &[
    Jenis {
        kunci: "barang", nama: "Data Barang", tabel: "mdbarang", kode: "kodebarang", wajib: &["kodebarang", "namabarang"],
        kolom: &[
            ("kodebarang", T), ("namabarang", T), ("barcode", T), ("jenis", T), ("kodekelompok", T), ("kodekategori", T), ("kodepemasok", T),
            ("kodesatuan", T), ("rak", T), ("hrgbeli", A), ("marginpersen", A), ("marginnilai", A), ("hrgjual", A), ("stokawal", A),
            ("stokmin", A), ("stokmax", A), ("aktif", A), ("hpp", A),
            ("hrglevel1", A), ("hrglevel2", A), ("hrglevel3", A), ("hrglevel4", A), ("hrglevel5", A),
        ],
    },
    Jenis {
        kunci: "updatebarang", nama: "Update Data Barang", tabel: "mdbarang", kode: "kodebarang", wajib: &["kodebarang"],
        kolom: &[
            ("kodebarang", T), ("namabarang", T), ("barcode", T), ("jenis", T), ("kodekelompok", T), ("kodekategori", T), ("kodepemasok", T),
            ("kodesatuan", T), ("rak", T), ("hrglevel1", A), ("hrglevel2", A), ("hrglevel3", A), ("hrglevel4", A), ("hrglevel5", A),
        ],
    },
    Jenis {
        kunci: "stokbarang", nama: "Update Stok Barang", tabel: "mdbarang", kode: "kodebarang", wajib: &["kodebarang", "stokfisik"],
        kolom: &[("kodebarang", T), ("stokfisik", A)],
    },
    Jenis {
        kunci: "pelanggan", nama: "Data Pelanggan", tabel: "mdpelanggan", kode: "kodepelanggan", wajib: &["kodepelanggan", "namapelanggan"],
        kolom: &[
            ("kodepelanggan", T), ("namapelanggan", T), ("alamat", T), ("kota", T), ("provinsi", T), ("tlp1", T), ("tlp2", T),
            ("email", T), ("masaaktif", D), ("level", T),
        ],
    },
    Jenis {
        kunci: "pemasok", nama: "Data Supplier", tabel: "mdpemasok", kode: "kodepemasok", wajib: &["kodepemasok", "namapemasok"],
        kolom: &[
            ("kodepemasok", T), ("namapemasok", T), ("namakontak", T), ("alamat", T), ("kota", T), ("provinsi", T),
            ("tlp1", T), ("tlp2", T), ("fax", T), ("email", T),
        ],
    },
    Jenis {
        kunci: "karyawan", nama: "Data Karyawan", tabel: "mdkaryawan", kode: "kodekaryawan", wajib: &["kodekaryawan", "namakaryawan"],
        kolom: &[
            ("kodekaryawan", T), ("namakaryawan", T), ("alamat", T), ("kota", T), ("provinsi", T), ("tlp1", T), ("tlp2", T), ("email", T), ("jabatan", T),
        ],
    },
    Jenis {
        kunci: "kategori", nama: "Data Kategori", tabel: "mdkategori", kode: "kodekategori", wajib: &["kodekategori", "namakategori"],
        kolom: &[("kodekategori", T), ("kodekelompok", T), ("namakategori", T)],
    },
    Jenis {
        kunci: "kelompok", nama: "Data Kelompok", tabel: "mdkelompok", kode: "kodekelompok", wajib: &["kodekelompok", "namakelompok"],
        kolom: &[("kodekelompok", T), ("namakelompok", T)],
    },
    Jenis {
        kunci: "satuan", nama: "Data Satuan", tabel: "mdsatuan", kode: "kodesatuan", wajib: &["kodesatuan", "namasatuan"],
        kolom: &[("kodesatuan", T), ("namasatuan", T)],
    },
];

fn jenis(kunci: &str) -> Res<&'static Jenis> {
    JENIS.iter().find(|j| j.kunci == kunci).ok_or_else(|| "Jenis data yang akan diimpor belum dipilih.".to_string())
}

/* ---------------- Membaca CSV ---------------- */

/// Pisahkan teks CSV menjadi baris dan kolom. Pemisah (koma, titik koma, atau tab) dikenali dari baris judul.
pub fn baca_csv(teks: &str) -> Vec<Vec<String>> {
    let teks = teks.trim_start_matches('\u{feff}');
    let judul = teks.lines().next().unwrap_or("");
    let sep = [',', ';', '\t'].into_iter().max_by_key(|c| judul.matches(*c).count()).filter(|c| judul.contains(*c)).unwrap_or(',');
    let mut hasil: Vec<Vec<String>> = vec![];
    let mut baris: Vec<String> = vec![];
    let mut sel = String::new();
    let mut kutip = false;
    let mut ada = false;
    let mut it = teks.chars().peekable();
    while let Some(c) = it.next() {
        if kutip {
            if c == '"' {
                if it.peek() == Some(&'"') {
                    sel.push('"');
                    it.next();
                } else {
                    kutip = false;
                }
            } else {
                sel.push(c);
            }
            continue;
        }
        match c {
            '"' => {
                kutip = true;
                ada = true;
            }
            c if c == sep => {
                baris.push(std::mem::take(&mut sel));
                ada = true;
            }
            '\r' => {}
            '\n' => {
                if ada || !sel.is_empty() {
                    baris.push(std::mem::take(&mut sel));
                    hasil.push(std::mem::take(&mut baris));
                }
                ada = false;
            }
            c => {
                sel.push(c);
                ada = true;
            }
        }
    }
    if ada || !sel.is_empty() {
        baris.push(sel);
        hasil.push(baris);
    }
    hasil
}

/// Isi satu sel Excel sebagai teks yang sama seperti yang akan terbaca dari CSV.
/// Angka memakai koma sebagai pemisah desimal supaya "1,125" tidak terbaca sebagai seribu seratus dua puluh lima.
fn sel_excel(d: &calamine::Data) -> String {
    use calamine::Data;
    match d {
        Data::Empty | Data::Error(_) => String::new(),
        Data::String(s) | Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => format!("{f}").replace('.', ","),
        Data::Bool(b) => if *b { "1".into() } else { "0".into() },
        // Tanggal Excel dihitung sebagai jumlah hari sejak 30 Desember 1899.
        Data::DateTime(dt) => chrono::NaiveDate::from_ymd_opt(1899, 12, 30)
            .and_then(|awal| awal.checked_add_signed(chrono::Duration::days(dt.as_f64().floor() as i64)))
            .map(|x| x.format("%Y-%m-%d").to_string())
            .unwrap_or_default(),
    }
}

/// Baca sheet pertama file .xls atau .xlsx. Baris kosong dilewati seperti pada CSV.
pub fn baca_excel(path: &Path) -> Res<Vec<Vec<String>>> {
    use calamine::{open_workbook_auto, Reader};
    let salah = || "File Excel ini tidak bisa dibaca. Pastikan filenya tidak rusak dan tidak sedang dipakai program lain.".to_string();
    let mut buku = open_workbook_auto(path).map_err(|_| salah())?;
    let nama = buku.sheet_names().first().cloned().ok_or_else(|| "File Excel ini tidak punya lembar kerja.".to_string())?;
    let area = buku.worksheet_range(&nama).map_err(|_| salah())?;
    Ok(area
        .rows()
        .map(|r| r.iter().map(sel_excel).collect::<Vec<_>>())
        .filter(|r| r.iter().any(|s| !s.trim().is_empty()))
        .collect())
}

fn baca_file(path: &str) -> Res<Vec<Vec<String>>> {
    let p = path.trim();
    if p.is_empty() {
        return Err("Lokasi file belum diisi.".into());
    }
    if !Path::new(p).is_file() {
        return Err("File tidak bisa dibuka. Periksa lokasi dan nama filenya.".into());
    }
    let kecil = p.to_lowercase();
    let data = if kecil.ends_with(".xls") || kecil.ends_with(".xlsx") {
        baca_excel(Path::new(p))?
    } else {
        let byte = std::fs::read(Path::new(p)).map_err(|_| "File tidak bisa dibuka. Periksa lokasi dan nama filenya.".to_string())?;
        baca_csv(&String::from_utf8_lossy(&byte))
    };
    if data.len() < 2 {
        return Err("File ini kosong atau hanya berisi judul kolom.".into());
    }
    Ok(data)
}

/// Letak tiap kolom yang dikenali di dalam file: (nama kolom, indeks di file).
fn petakan(j: &Jenis, judul: &[String]) -> Vec<(&'static str, Tipe, usize)> {
    let norm = |s: &str| s.trim().to_lowercase().replace([' ', '_', '.'], "");
    let mut out = vec![];
    let mut punya_stokawal = false;
    for (nama, tipe) in j.kolom {
        if let Some(i) = judul.iter().position(|h| norm(h) == *nama) {
            out.push((*nama, *tipe, i));
            punya_stokawal |= *nama == "stokawal";
        }
    }
    // Update Stok Barang: jumlah stok fisik boleh berjudul stok, stokakhir, atau jumlah.
    if j.kunci == "stokbarang" {
        // Judul "stokfisik" yang sudah ada didahulukan; sinonim hanya dipakai kalau judul itu tidak ada.
        let sudah = out.iter().any(|(n, _, _)| *n == "stokfisik");
        if let (false, Some(i)) = (sudah, judul.iter().position(|h| ["stok", "stokakhir", "jumlah", "jml", "qty"].contains(&norm(h).as_str()))) {
            out.push(("stokfisik", A, i));
        }
    }
    // Berkas lama hanya punya STOKAKHIR: dipakai sebagai stok awal.
    if j.kunci == "barang" && !punya_stokawal {
        if let Some(i) = judul.iter().position(|h| norm(h) == "stokakhir") {
            out.push(("stokawal", A, i));
        }
    }
    out
}

pub fn parse_angka(s: &str) -> Option<f64> {
    let t = s.trim().trim_start_matches("Rp").trim_start_matches("rp").replace(' ', "");
    if t.is_empty() {
        return Some(0.0);
    }
    let (titik, koma) = (t.matches('.').count(), t.matches(',').count());
    let bersih = if titik > 0 && koma > 0 {
        if t.rfind('.') > t.rfind(',') { t.replace(',', "") } else { t.replace('.', "").replace(',', ".") }
    } else if koma > 0 {
        if koma == 1 { t.replace(',', ".") } else { t.replace(',', "") }
    } else if titik > 1 {
        t.replace('.', "")
    } else if titik == 1 {
        // "1.250" dianggap seribu dua ratus lima puluh; "12.5" dianggap dua belas koma lima.
        let (depan, belakang) = t.split_once('.').unwrap_or((&t, ""));
        if belakang.len() == 3 && !depan.is_empty() && depan.len() <= 3 && depan.chars().all(|c| c.is_ascii_digit()) { t.replace('.', "") } else { t.clone() }
    } else {
        t
    };
    bersih.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn parse_tanggal(s: &str) -> Option<String> {
    let t = s.trim();
    for f in ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"] {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(t, f) {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

/* ---------------- Pratinjau ---------------- */

/// Baca file dan tampilkan isinya (maksimal 500 baris) sesuai kolom yang dikenali.
pub fn pratinjau(kunci: &str, path: &str) -> Res<Value> {
    let j = jenis(kunci)?;
    let data = baca_file(path)?;
    let peta = petakan(j, &data[0]);
    let hilang: Vec<&str> = j.wajib.iter().copied().filter(|w| !peta.iter().any(|p| p.0 == *w)).collect();
    let tak_dikenal: Vec<String> = data[0]
        .iter()
        .enumerate()
        .filter(|(i, _)| !peta.iter().any(|p| p.2 == *i))
        .map(|(_, h)| h.clone())
        .filter(|h| !h.trim().is_empty())
        .collect();
    let baris: Vec<Vec<String>> = data[1..]
        .iter()
        .take(500)
        .map(|r| peta.iter().map(|p| r.get(p.2).cloned().unwrap_or_default()).collect())
        .collect();
    Ok(json!({
        "kolom": peta.iter().map(|p| p.0).collect::<Vec<_>>(),
        "baris": baris,
        "jumlah": data.len() - 1,
        "wajib_hilang": hilang,
        "tidak_dikenal": tak_dikenal,
    }))
}

/* ---------------- Proses impor ---------------- */

#[cfg(test)]
pub fn impor(conn: &mut Connection, kunci: &str, path: &str, hapus_lama: bool, folder: &Path) -> Res<Value> {
    impor_dengan(conn, None, kunci, path, hapus_lama, folder)
}

/// Seperti `impor`; `user` dibutuhkan oleh Update Stok Barang untuk mencatat transaksi stok opname.
pub fn impor_dengan(conn: &mut Connection, user: Option<&crate::auth::User>, kunci: &str, path: &str, hapus_lama: bool, folder: &Path) -> Res<Value> {
    let j = jenis(kunci)?;
    let data = baca_file(path)?;
    let peta = petakan(j, &data[0]);
    let ubah = matches!(j.kunci, "updatebarang" | "stokbarang");
    let hilang: Vec<&str> = j.wajib.iter().copied().filter(|w| !peta.iter().any(|p| p.0 == *w)).collect();
    if !hilang.is_empty() {
        return Err(format!("Kolom {} tidak ada di file. Periksa judul kolom di baris pertama.", hilang.join(", ")));
    }

    // Periksa seluruh baris dulu; kalau ada yang salah, tidak ada yang disimpan.
    let mut salah: Vec<String> = vec![];
    let mut baris_siap: Vec<Vec<Sql>> = vec![];
    let mut kode_terlihat: std::collections::HashSet<String> = Default::default();
    let ada_di_db = |kode: &str| -> bool {
        conn.query_row(&format!("SELECT COUNT(*) FROM {} WHERE UPPER({}) = UPPER(?1)", j.tabel, j.kode), params![kode], |r| r.get::<_, i64>(0)).map(|n| n > 0).unwrap_or(false)
    };
    for (no, r) in data.iter().enumerate().skip(1) {
        let ambil = |nama: &str| peta.iter().find(|p| p.0 == nama).and_then(|p| r.get(p.2)).map(|s| s.trim().to_string()).unwrap_or_default();
        if r.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        let kode = ambil(j.kode);
        let mut pesan: Vec<String> = vec![];
        for w in j.wajib {
            if ambil(w).is_empty() {
                pesan.push(format!("kolom {w} belum diisi"));
            }
        }
        if ubah && !kode.is_empty() && !ada_di_db(&kode) {
            pesan.push(format!("kode {kode} tidak ada di database"));
        } else if j.kunci == "stokbarang" && !kode.is_empty() {
            let barang: i64 = conn.query_row("SELECT COUNT(*) FROM mdbarang WHERE UPPER(kodebarang) = UPPER(?1) AND jenis = 'Barang'", params![kode], |r| r.get(0)).unwrap_or(0);
            if barang == 0 {
                pesan.push(format!("{kode} adalah jasa, jadi stoknya tidak bisa diubah"));
            }
        }
        if !kode.is_empty() {
            if !kode_terlihat.insert(kode.to_uppercase()) {
                pesan.push(format!("kode {kode} muncul lebih dari sekali di file"));
            } else if !hapus_lama && !ubah && ada_di_db(&kode) {
                pesan.push(format!("kode {kode} sudah ada di database"));
            }
        }
        let mut nilai: Vec<Sql> = vec![];
        for (nama, tipe, _) in &peta {
            let mentah = ambil(nama);
            nilai.push(match tipe {
                Tipe::Teks => {
                    if *nama == "jenis" {
                        match mentah.to_lowercase().as_str() {
                            "" | "barang" => Sql::Text("Barang".into()),
                            "jasa" => Sql::Text("Jasa".into()),
                            _ => {
                                pesan.push("jenis harus Barang atau Jasa".into());
                                Sql::Null
                            }
                        }
                    } else {
                        Sql::Text(mentah)
                    }
                }
                Tipe::Angka => match parse_angka(&mentah) {
                    Some(v) => Sql::Real(v),
                    None => {
                        pesan.push(format!("kolom {nama} berisi \"{mentah}\" yang bukan angka"));
                        Sql::Null
                    }
                },
                Tipe::Tanggal => {
                    if mentah.is_empty() {
                        Sql::Null
                    } else {
                        match parse_tanggal(&mentah) {
                            Some(d) => Sql::Text(d),
                            None => {
                                pesan.push(format!("kolom {nama} berisi \"{mentah}\" yang bukan tanggal (pakai hari/bulan/tahun)"));
                                Sql::Null
                            }
                        }
                    }
                }
            });
        }
        if pesan.is_empty() {
            baris_siap.push(nilai);
        } else if salah.len() < 15 {
            salah.push(format!("Mohon dikoreksi baris no. {} ({}): {}.", no + 1, if kode.is_empty() { "tanpa kode".to_string() } else { kode }, pesan.join("; ")));
        } else if salah.len() == 15 {
            salah.push("Dan masih ada baris lain yang perlu dibetulkan.".into());
        }
    }
    if !salah.is_empty() {
        return Err(format!("Data belum diimpor. Mohon betulkan dulu:\n{}", salah.join("\n")));
    }
    if baris_siap.is_empty() {
        return Err("Tidak ada baris data di file ini.".into());
    }
    if j.kunci == "stokbarang" {
        let user = user.ok_or("Silakan masuk dulu sebelum memperbarui stok barang.")?;
        if user.level == "Kasir" {
            return Err("Akun kasir tidak bisa mencatat stok opname.".into());
        }
        let cadangan = backup_ke(conn, folder, "sebelum-impor")?;
        let mut items = vec![];
        for b in &baris_siap {
            // Kode di file bisa beda huruf besar/kecil dari yang tersimpan; pakai kode aslinya.
            let kode = match &b[0] { Sql::Text(t) => t.clone(), _ => String::new() };
            let asli: String = conn.query_row("SELECT kodebarang FROM mdbarang WHERE UPPER(kodebarang) = UPPER(?1)", params![kode], |r| r.get(0)).map_err(e)?;
            let fisik = match &b[1] { Sql::Real(v) => *v, _ => 0.0 };
            items.push(crate::trans::OpnameItem { kodebarang: asli, stokfisik: fisik });
        }
        let tgl = chrono::Local::now().format("%Y-%m-%d").to_string();
        let r = crate::trans::opname(conn, user, &tgl, "Opname From Import Excel", &items)?;
        return Ok(json!({ "jumlah": r["jumlah"], "notrans": r["notrans"], "cadangan": cadangan.display().to_string() }));
    }
    if j.kunci == "updatebarang" {
        let cadangan = backup_ke(conn, folder, "sebelum-impor")?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
        let kolom: Vec<&str> = peta.iter().map(|p| p.0).filter(|k| *k != "kodebarang").collect();
        if kolom.is_empty() {
            return Err("File ini tidak punya kolom yang bisa diperbarui selain kodebarang.".into());
        }
        let set = kolom.iter().enumerate().map(|(i, k)| format!("\"{k}\" = ?{}", i + 1)).collect::<Vec<_>>().join(", ");
        let sql = format!("UPDATE mdbarang SET {set}, tglupdate = date('now','localtime'), jamupdate = time('now','localtime') WHERE UPPER(kodebarang) = UPPER(?{})", kolom.len() + 1);
        for b in &baris_siap {
            let mut nilai: Vec<Sql> = vec![];
            let mut kode = Sql::Null;
            for (p, v) in peta.iter().zip(b.iter()) {
                if p.0 == "kodebarang" { kode = v.clone(); } else { nilai.push(v.clone()); }
            }
            nilai.push(kode);
            tx.execute(&sql, params_from_iter(nilai.iter())).map_err(e)?;
        }
        tx.commit().map_err(e)?;
        return Ok(json!({ "jumlah": baris_siap.len(), "cadangan": cadangan.display().to_string() }));
    }

    let cadangan = backup_ke(conn, folder, "sebelum-impor")?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(e)?;
    if hapus_lama {
        tx.execute(&format!("DELETE FROM {}", j.tabel), []).map_err(e)?;
        if j.kunci == "barang" {
            tx.execute("DELETE FROM sqlite_sequence WHERE name = 'mdbarang'", []).map_err(e)?;
        }
    }
    let nama_kolom: Vec<String> = peta.iter().map(|p| format!("\"{}\"", p.0)).collect();
    let tanda: Vec<String> = (1..=peta.len()).map(|i| format!("?{i}")).collect();
    let sql = format!("INSERT INTO {} ({}) VALUES ({})", j.tabel, nama_kolom.join(","), tanda.join(","));
    {
        let mut st = tx.prepare(&sql).map_err(e)?;
        for b in &baris_siap {
            st.execute(params_from_iter(b.iter())).map_err(e)?;
        }
    }
    if j.kunci == "barang" {
        // Barang baru: stok akhir = stok awal; tanpa isian, aktif dan jenis memakai bawaan.
        tx.execute("UPDATE mdbarang SET stokakhir = COALESCE(stokawal,0) + COALESCE(stokmasuk,0) - COALESCE(stokkeluar,0) + COALESCE(stokopname,0) WHERE jenis = 'Barang'", []).map_err(e)?;
    }
    tx.commit().map_err(e)?;
    Ok(json!({ "jumlah": baris_siap.len(), "cadangan": cadangan.display().to_string() }))
}

/* ---------------- Perintah Tauri ---------------- */

#[perintah]
pub fn impor_jenis() -> Vec<Value> {
    JENIS.iter().map(|j| json!({ "kunci": j.kunci, "nama": j.nama })).collect()
}

#[perintah]
pub fn impor_baca(session: &Session, jenis: String, path: String) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    pratinjau(&jenis, &path)
}

#[perintah]
pub fn impor_proses(db: &Db, session: &Session, jenis: String, path: String, hapus_lama: bool, folder: Option<String>) -> Res<Value> {
    hanya_manager(&session.user()?)?;
    let user = session.user()?;
    let mut conn = db.lock()?;
    let f = match folder.as_deref().map(str::trim).filter(|f| !f.is_empty()) {
        Some(f) => std::path::PathBuf::from(f),
        None => folder_bawaan(&conn)?,
    };
    impor_dengan(&mut conn, Some(&user), &jenis, &path, hapus_lama, &f)
}

#[cfg(test)]
mod tests_peta {
    #[test]
    fn stokfisik_tidak_dipetakan_dua_kali() {
        let j = super::jenis("stokbarang").unwrap();
        let judul: Vec<String> = ["Kode Barang", "Stok", "Stok Fisik"].iter().map(|x| x.to_string()).collect();
        let peta = super::petakan(j, &judul);
        let fisik: Vec<_> = peta.iter().filter(|(n, _, _)| *n == "stokfisik").collect();
        assert_eq!(fisik.len(), 1);
        assert_eq!(fisik[0].2, 2, "judul stokfisik menang atas sinonim stok");
        let judul: Vec<String> = ["kodebarang", "Jumlah"].iter().map(|x| x.to_string()).collect();
        assert_eq!(super::petakan(j, &judul).iter().filter(|(n, _, _)| *n == "stokfisik").count(), 1);
    }
}
