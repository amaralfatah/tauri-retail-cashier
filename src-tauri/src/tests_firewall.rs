//! Tes aturan firewall Windows (rancangan 5.3): pembentukan perintah `netsh`, skrip UAC, pembacaan hasil cek,
//! dan perilaku tanpa-aksi di luar Windows. Perintah `netsh` sungguhan hanya bisa dicoba di Windows (CI rilis).

use crate::jaringan::firewall::*;

const EXE: &str = r"C:\Program Files\Toko Pro\tokopro-app.exe";

#[test]
fn perintah_tambah_hanya_port_pusat_program_ini_dan_subnet_lokal() {
    let a = argumen_tambah(47210, EXE);
    assert_eq!(
        baris_perintah(&a),
        r#"advfirewall firewall add rule name="Toko Pro Pusat" dir=in action=allow protocol=TCP localport=47210 profile=private,public,domain remoteip=localsubnet program="C:\Program Files\Toko Pro\tokopro-app.exe""#
    );
    // Satu aturan masuk, tanpa rentang port dan tanpa "any": hanya port Pusat, hanya program ini, hanya subnet lokal.
    assert!(a.contains(&"dir=in".to_string()) && a.contains(&"action=allow".to_string()));
    assert!(a.contains(&"remoteip=localsubnet".to_string()));
    assert!(a.contains(&"profile=private,public,domain".to_string()));
    assert!(!a.iter().any(|x| x.contains("any") || x.contains("localport=47210,")));
    assert!(baris_perintah(&argumen_tambah(5000, EXE)).contains("localport=5000 "));
}

#[test]
fn perintah_hapus_dan_cek_memakai_nama_aturan_yang_sama() {
    assert_eq!(baris_perintah(&argumen_hapus()), r#"advfirewall firewall delete rule name="Toko Pro Pusat""#);
    assert_eq!(baris_perintah(&argumen_cek()), r#"advfirewall firewall show rule name="Toko Pro Pusat" verbose"#);
}

#[test]
fn skrip_uac_menghapus_aturan_lama_lalu_membuat_yang_baru() {
    let s = skrip_beri_izin(47210, EXE);
    let baris: Vec<&str> = s.lines().collect();
    assert_eq!(baris.len(), 3);
    assert_eq!(baris[0], r#"netsh --% advfirewall firewall delete rule name="Toko Pro Pusat""#);
    assert!(baris[1].starts_with("netsh --% advfirewall firewall add rule name=\"Toko Pro Pusat\""));
    assert!(baris[1].ends_with(r#"program="C:\Program Files\Toko Pro\tokopro-app.exe""#));
    assert_eq!(baris[2], "exit $LASTEXITCODE");
}

#[test]
fn kode_powershell_adalah_base64_utf16le() {
    // Nilai pembanding dari `[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(...))`.
    assert_eq!(kode_powershell("A"), "QQA=");
    assert_eq!(kode_powershell("exit 1"), "ZQB4AGkAdAAgADEA");
    assert_eq!(kode_powershell(""), "");
    let n = kode_powershell("netsh --% advfirewall");
    assert_eq!(n.len() % 4, 0);
    assert!(n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'='));
}

#[test]
fn perintah_naik_hak_membuka_uac_dan_meneruskan_kode_keluar() {
    let p = perintah_naik_hak("exit 0");
    assert!(p.contains("-Verb RunAs") && p.contains("-Wait") && p.contains("-PassThru"));
    assert!(p.contains(&format!("'{}'", kode_powershell("exit 0"))));
    assert!(p.ends_with("exit $p.ExitCode"));
}

#[test]
fn hasil_cek_cocok_bila_port_dan_program_sama() {
    let keluaran = "Rule Name:                            Toko Pro Pusat\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProfiles:                             Domain,Private,Public\r\nProtocol:                             TCP\r\nLocalPort:                            47210\r\nRemoteIP:                             LocalSubnet\r\nProgram:                              C:\\program files\\toko pro\\tokopro-app.exe\r\nAction:                               Allow\r\n";
    assert!(aturan_cocok(keluaran, 47210, EXE)); // huruf besar-kecil tidak berpengaruh
    assert!(!aturan_cocok(keluaran, 47211, EXE)); // port berbeda
    assert!(!aturan_cocok(keluaran, 4721, EXE)); // bukan potongan dari angka lain
    assert!(!aturan_cocok(keluaran, 47210, r"D:\Baru\tokopro-app.exe")); // program dipindah
    // Alamat dengan huruf non-ASCII: hanya nama file yang dibandingkan.
    assert!(aturan_cocok(keluaran, 47210, r"C:\Pengguna\Budi Santoso\é\tokopro-app.exe"));
}

#[test]
fn kode_izin_dikenali_tampilan() {
    assert_eq!(Izin::Ada.kode(), "ada");
    assert_eq!(Izin::Belum.kode(), "belum");
    assert_eq!(Izin::Berbeda.kode(), "berbeda");
    assert_eq!(Izin::TidakPerlu.kode(), "tidak-perlu");
}

#[cfg(not(windows))]
#[test]
fn di_luar_windows_tidak_ada_yang_dikerjakan() {
    assert_eq!(periksa(47210), Izin::TidakPerlu);
    assert!(beri_izin(47210).is_ok());
}

#[cfg(not(windows))]
#[test]
fn status_pusat_di_luar_windows_tidak_meminta_izin() {
    use crate::jaringan::{kendali::Kendali, mode::Mode};
    let dir = std::env::temp_dir().join(format!("tokopro-fw-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let k = Kendali::baru(dir.join("pusat.json"));
    assert_eq!(k.mode(), Mode::Tunggal);
    assert_eq!(k.status()["izinFirewall"], "tidak-perlu");
    let _ = std::fs::remove_dir_all(&dir);
}
