//! Uji dispatcher perintah: daftar nama, pembacaan argumen camelCase, dan sesi lewat `Konteks`.

use crate::auth::Session;
use crate::db::{self, Db};
use crate::konteks::Konteks;
use crate::{dispatch, NAMA_PERINTAH, PARAMETER_PERINTAH};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn siapkan() -> (Db, Session, PathBuf) {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("tokopro-dispatch-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    let conn = db::open(&dir.join("t.db")).unwrap();
    (Db(Mutex::new(conn)), Session::default(), dir)
}

fn panggil(db: &Db, sesi: &Session, nama: &str, args: Value) -> Result<Value, String> {
    let Value::Object(m) = args else { panic!("args harus objek") };
    dispatch(&Konteks::baru(db, sesi), nama, &m)
}

#[test]
fn nama_perintah_unik_dan_lengkap() {
    let semua: HashSet<_> = NAMA_PERINTAH.iter().collect();
    assert_eq!(semua.len(), NAMA_PERINTAH.len(), "ada nama perintah ganda");
    assert!(NAMA_PERINTAH.len() >= 110);
    for n in ["login", "save_penjualan", "cetak", "lama_pindahkan", "foto_simpan"] {
        assert!(semua.contains(&n), "{n} tidak ada di daftar");
    }
}

/// Semua berkas tampilan yang boleh memanggil backend.
fn berkas_tampilan(dir: &Path, hasil: &mut Vec<PathBuf>) {
    for ent in std::fs::read_dir(dir).unwrap() {
        let p = ent.unwrap().path();
        if p.is_dir() {
            if p.file_name().unwrap() != "dev" {
                berkas_tampilan(&p, hasil);
            }
        } else if matches!(p.extension().and_then(|x| x.to_str()), Some("ts" | "tsx")) {
            hasil.push(p);
        }
    }
}

/// Lewati teks dalam tanda kutip (`'`, `"`, atau backtick) yang dimulai di `b[i]`; mengembalikan indeks setelah penutupnya.
fn lewati_teks(b: &[char], mut i: usize) -> usize {
    let q = b[i];
    i += 1;
    while i < b.len() {
        if b[i] == '\\' {
            i += 2;
        } else if b[i] == q {
            return i + 1;
        } else {
            i += 1;
        }
    }
    i
}

/// Kunci tingkat atas dari objek literal yang `{`-nya ada di `b[mulai]`. `None` bila tidak bisa diurai
/// secara statis (kunci terhitung). Spread dicatat sebagai kunci \"...\".
fn kunci_objek(b: &[char], mulai: usize) -> Option<Vec<String>> {
    let (mut i, mut dalam) = (mulai, 0i32);
    let mut bagian: Vec<String> = vec![String::new()];
    while i < b.len() {
        let c = b[i];
        if matches!(c, '\'' | '"' | '`') {
            let j = lewati_teks(b, i);
            bagian.last_mut().unwrap().extend(&b[i..j]);
            i = j;
            continue;
        }
        match c {
            '{' | '(' | '[' => dalam += 1,
            '}' | ')' | ']' => dalam -= 1,
            _ => {}
        }
        if dalam == 0 {
            break;
        }
        if c == ',' && dalam == 1 {
            bagian.push(String::new());
        } else if !(i == mulai && c == '{') {
            bagian.last_mut().unwrap().push(c);
        }
        i += 1;
    }
    let mut kunci = Vec::new();
    for bg in bagian {
        let bg = bg.trim();
        if bg.is_empty() {
            continue;
        }
        if bg.starts_with("...") {
            kunci.push("...".to_string()); // spread: kunci lain tetap diperiksa, argumen wajib tidak
            continue;
        }
        if bg.starts_with('[') {
            return None;
        }
        let nama: String = if bg.starts_with('"') || bg.starts_with('\'') {
            let q = bg.chars().next().unwrap();
            bg[1..].split(q).next().unwrap().to_string()
        } else {
            bg.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect()
        };
        if nama.is_empty() {
            return None;
        }
        kunci.push(nama);
    }
    Some(kunci)
}

/// Setiap pemanggilan `invoke<...>("nama", ...)` di sebuah berkas: nama perintah dan kunci objek argumennya
/// (`Some([])` bila tanpa argumen, `None` bila argumen tidak bisa diurai secara statis).
fn panggilan_invoke(teks: &str) -> Vec<(String, Option<Vec<String>>)> {
    let b: Vec<char> = teks.chars().collect();
    let mut hasil = Vec::new();
    let mut i = 0;
    while i + 6 <= b.len() {
        let kata: String = b[i..i + 6].iter().collect();
        let sebelum_ok = i == 0 || !(b[i - 1].is_alphanumeric() || b[i - 1] == '_' || b[i - 1] == '.');
        if kata != "invoke" || !sebelum_ok {
            i += 1;
            continue;
        }
        let mut j = i + 6;
        if b.get(j) == Some(&'<') {
            let mut dalam = 0;
            while j < b.len() {
                match b[j] {
                    '<' => dalam += 1,
                    '>' if b[j - 1] != '=' => {
                        dalam -= 1;
                        if dalam == 0 {
                            j += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
        }
        if b.get(j) == Some(&'(') {
            let sisa: String = b[j + 1..].iter().take(80).collect();
            let sisa = sisa.trim_start();
            assert!(sisa.starts_with('"'), "invoke harus memakai nama perintah berupa teks tetap: {}", &sisa[..sisa.len().min(40)]);
            let akhir = sisa[1..].find('"').expect("nama perintah tidak ditutup");
            let nama = sisa[1..1 + akhir].to_string();
            // Lewati ke setelah nama, lalu baca argumen kedua.
            let mut k = j + 1;
            while b[k] != '"' {
                k += 1;
            }
            k = lewati_teks(&b, k);
            while b.get(k).is_some_and(|c| c.is_whitespace()) {
                k += 1;
            }
            let kunci = if b.get(k) == Some(&')') {
                Some(vec![])
            } else if b.get(k) == Some(&',') {
                k += 1;
                while b.get(k).is_some_and(|c| c.is_whitespace()) {
                    k += 1;
                }
                match b.get(k) {
                    Some(')') => Some(vec![]),
                    Some('{') => kunci_objek(&b, k),
                    _ => None,
                }
            } else {
                None
            };
            hasil.push((nama, kunci));
        }
        i = j.max(i + 6);
    }
    hasil
}

/// Nama perintah dari setiap pemanggilan `invoke<...>("nama", ...)` di sebuah berkas.
fn nama_invoke(teks: &str) -> Vec<String> {
    panggilan_invoke(teks).into_iter().map(|(n, _)| n).collect()
}

#[test]
fn semua_perintah_tampilan_ada_di_daftar() {
    let akar = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
    let mut berkas = Vec::new();
    berkas_tampilan(&akar, &mut berkas);
    assert!(!berkas.is_empty());
    let daftar: HashSet<&str> = NAMA_PERINTAH.iter().copied().collect();
    let mut dipanggil = HashSet::new();
    for p in &berkas {
        let teks = std::fs::read_to_string(p).unwrap();
        let nama_berkas = p.file_name().unwrap().to_str().unwrap();
        // Hanya panggil.ts yang boleh memakai invoke bawaan Tauri; yang lain lewat `jalankan`.
        if nama_berkas != "panggil.ts" {
            assert!(!teks.contains("@tauri-apps/api/core"), "{} memanggil invoke Tauri langsung; pakai @/lib/panggil", p.display());
        }
        if nama_berkas == "panggil.ts" {
            continue;
        }
        for n in nama_invoke(&teks) {
            assert!(daftar.contains(n.as_str()), "{}: perintah \"{n}\" tidak ada di daftar_perintah!", p.display());
            dipanggil.insert(n);
        }
    }
    assert!(dipanggil.len() >= 90, "hanya {} perintah terbaca dari tampilan; pembaca nama salah?", dipanggil.len());
}

#[test]
fn pembaca_nama_invoke_menangani_bentuk_umum() {
    let t = r#"import { invoke } from "@/lib/panggil";
      a: () => invoke<void>("satu"),
      b: () => invoke<{ rows: Row[]; total: number }>("dua", { x }),
      c: (f: (a: number) => void) => invoke<Map<string, Row[]>>(
        "tiga", {}),
      d: () => invoke("empat"),
      e: () => reinvoke("bukan"),"#;
    assert_eq!(nama_invoke(t), ["satu", "dua", "tiga", "empat"]);
}

#[test]
fn argumen_camelcase_terbaca() {
    let (db, sesi, dir) = siapkan();
    // tableName <- table_name, hanyaKodeNama <- hanya_kode_nama
    let r = panggil(&db, &sesi, "master_list", json!({ "tableName": "mdsatuan", "search": "box", "hanyaKodeNama": true })).unwrap();
    assert_eq!(r["total"], 1);
    assert_eq!(r["rows"][0]["kodesatuan"], "BOX");
    // onlyActive dan limit ikut terbaca; argumen Option yang tidak dikirim dianggap kosong.
    let r = panggil(&db, &sesi, "master_list", json!({ "tableName": "mdsatuan", "limit": 2, "onlyActive": false })).unwrap();
    assert_eq!(r["rows"].as_array().unwrap().len(), 2);
    assert_eq!(r["total"], 4);
    // Nama snake_case tidak dikenal (sama dengan Tauri): argumen wajib dianggap hilang.
    let err = panggil(&db, &sesi, "master_list", json!({ "table_name": "mdsatuan" })).unwrap_err();
    assert!(err.contains("tableName"), "{err}");
    // Tipe salah
    let err = panggil(&db, &sesi, "master_list", json!({ "tableName": "mdsatuan", "limit": "banyak" })).unwrap_err();
    assert!(err.contains("limit"), "{err}");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn nama_tidak_dikenal_ditolak() {
    let (db, sesi, dir) = siapkan();
    let err = panggil(&db, &sesi, "tidak_ada", json!({})).unwrap_err();
    assert!(err.contains("tidak_ada"), "{err}");
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn sesi_lewat_konteks() {
    let (db, sesi, dir) = siapkan();
    assert_eq!(panggil(&db, &sesi, "current_user", json!({})).unwrap(), Value::Null);
    let err = panggil(&db, &sesi, "my_menus", json!({})).unwrap_err();
    assert!(!err.is_empty());
    let hash = crate::auth::hash("rahasia123").unwrap();
    db.lock().unwrap().execute("UPDATE mduser SET pswduser = ?1 WHERE iduser = 'admin'", [hash]).unwrap();
    let u = panggil(&db, &sesi, "login", json!({ "iduser": "admin", "password": "rahasia123" })).unwrap();
    assert_eq!(u["iduser"], "admin");
    assert_eq!(panggil(&db, &sesi, "current_user", json!({})).unwrap()["iduser"], "admin");
    panggil(&db, &sesi, "logout", json!({})).unwrap();
    assert_eq!(panggil(&db, &sesi, "current_user", json!({})).unwrap(), Value::Null);
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn perintah_tanpa_jendela_ditolak_dengan_pesan() {
    let (db, sesi, dir) = siapkan();
    let err = panggil(&db, &sesi, "cetak", json!({})).unwrap_err();
    assert!(err.contains("jendela"), "{err}");
    let err = panggil(&db, &sesi, "ekspor_nama", json!({ "nama": "x" })).unwrap_err();
    assert!(err.contains("jendela"), "{err}");
    std::fs::remove_dir_all(dir).ok();
}

/// Pemanggilan yang objek argumennya bukan literal (variabel, kunci terhitung). Spread tetap diperiksa
/// sebagian: kunci tertulisnya harus dikenal, argumen wajib dianggap datang dari spread (tsc memeriksanya). Isinya diperiksa manual. Format: "berkas:perintah". Tambah baris di sini hanya bila memang tidak bisa diurai.
const ARGUMEN_DILEWATI: &[&str] = &[];

#[test]
fn kunci_argumen_invoke_cocok_dengan_parameter_rust() {
    let akar = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
    let mut berkas = Vec::new();
    berkas_tampilan(&akar, &mut berkas);
    let param: std::collections::HashMap<&str, &[(&str, bool)]> = PARAMETER_PERINTAH.iter().copied().collect();
    assert_eq!(param.len(), NAMA_PERINTAH.len());
    let (mut diperiksa, mut dilewati) = (0, Vec::new());
    for p in &berkas {
        let nama_berkas = p.file_name().unwrap().to_str().unwrap();
        if nama_berkas == "panggil.ts" {
            continue;
        }
        let teks = std::fs::read_to_string(p).unwrap();
        for (nama, kunci) in panggilan_invoke(&teks) {
            let Some(ps) = param.get(nama.as_str()) else { continue }; // yang tak ada di daftar ditangkap tes lain
            let Some(kunci) = kunci else {
                dilewati.push(format!("{nama_berkas}:{nama}"));
                continue;
            };
            diperiksa += 1;
            let spread = kunci.iter().any(|k| k == "...");
            for k in kunci.iter().filter(|k| *k != "...") {
                assert!(ps.iter().any(|(n, _)| n == k), "{}: perintah \"{nama}\" menerima kunci \"{k}\" yang tidak dikenal Rust (parameter: {:?})", p.display(), ps.iter().map(|x| x.0).collect::<Vec<_>>());
            }
            for (n, wajib) in ps.iter() {
                assert!(spread || !*wajib || kunci.iter().any(|k| k == n), "{}: perintah \"{nama}\" tidak mengirim argumen wajib \"{n}\"", p.display());
            }
        }
    }
    assert!(diperiksa >= 90, "hanya {diperiksa} pemanggilan diperiksa; pembaca argumen salah?");
    dilewati.sort();
    dilewati.dedup();
    let tak_terdaftar: Vec<_> = dilewati.iter().filter(|d| !ARGUMEN_DILEWATI.contains(&d.as_str())).collect();
    assert!(tak_terdaftar.is_empty(), "argumen tidak bisa diurai dan belum ada di ARGUMEN_DILEWATI: {tak_terdaftar:?}");
}

#[test]
fn pembaca_kunci_argumen_menangani_bentuk_umum() {
    let t = r#"
      a: () => invoke<void>("satu"),
      b: () => invoke<R>("dua", { x, y: f(1, { z: 2 }), "tiga": `a,b${c}`, ["d"]: 1 }),
      c: () => invoke<R>("empat", {
        iduser,
        password: ", }",
      }),
      d: () => invoke("lima", args),
      e: () => invoke("enam", { tableName, ...opts }),
      f: () => invoke("tujuh", {}),"#;
    let h = panggilan_invoke(t);
    assert_eq!(h[0], ("satu".to_string(), Some(vec![])));
    assert_eq!(h[1].1, None, "kunci terhitung tidak bisa diurai");
    assert_eq!(h[2].1, Some(vec!["iduser".to_string(), "password".to_string()]));
    assert_eq!(h[3].1, None);
    assert_eq!(h[4].1, Some(vec!["tableName".to_string(), "...".to_string()]));
    assert_eq!(h[5].1, Some(vec![]));
    let u = panggilan_invoke(r#"invoke("a", { x, y: f(1, { z: 2 }), "w": `a,b${c}` })"#);
    assert_eq!(u[0].1, Some(vec!["x".to_string(), "y".to_string(), "w".to_string()]));
}

#[test]
fn parameter_perintah_mencatat_wajib_dan_opsional() {
    let p: std::collections::HashMap<_, _> = PARAMETER_PERINTAH.iter().copied().collect();
    let ml = p["master_list"];
    assert!(ml.contains(&("tableName", true)));
    assert!(ml.contains(&("limit", false)));
    assert!(ml.contains(&("hanyaKodeNama", false)));
    assert!(p["logout"].is_empty(), "&Session tidak dihitung");
}
