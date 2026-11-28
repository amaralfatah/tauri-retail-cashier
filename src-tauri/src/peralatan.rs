//! Pencetakan struk langsung (ESC/POS / RAW) dan pembukaan laci kasir (cash drawer).
//!
//! Mendukung dua jalur pengiriman seperti Toko Pro lama:
//! 1. **Windows Print Spooler (`winspool.drv`, mode RAW)** untuk printer USB maupun printer bersama (`\\PC\Printer`)
//!    berdasarkan nama printer Windows (atau printer bawaan Windows bila nama kosong saat membuka laci).
//! 2. **Port langsung (`LPT1`, `COM1`, dst.)** untuk printer paralel/serial atau laci yang terhubung ke port langsung.
//!
//! Semua perintah di modul ini masuk golongan `Lokal` karena perangkat terpasang di komputer yang sedang dipakai.

use crate::konteks::Konteks;
use perintah_macro::perintah;
use std::io::Write;
use std::path::Path;

/// Kode buka laci bawaan Toko Pro lama (ESC p 0 64 240 — Epson/ESC-POS standar).
pub const KODE_LACI_BAWAAN: &str = "27,112,0,64,240";

/// Jenis jalur pengiriman data mentah ke printer atau laci kasir.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Jalur {
    /// Nama printer di Windows Print Spooler (`None` berarti pakai printer bawaan Windows).
    Spooler(Option<String>),
    /// Port perangkat atau alamat file/berbagi langsung (mis. `LPT1`, `COM1`, `/dev/...`).
    Port(String),
}

/// Urai teks kode laci (mis. `"27,112,0,64,240"` atau `"0x1B,0x70,0,64,240"`) menjadi deretan byte.
/// Bila kosong, memakai kode bawaan Toko Pro lama (`27,112,0,64,240`).
pub fn urai_kode_laci(kode: &str) -> Result<Vec<u8>, String> {
    let sumber = if kode.trim().is_empty() { KODE_LACI_BAWAAN } else { kode };
    let mut hasil = Vec::new();
    for bagian in sumber.split(|c: char| c == ',' || c == ';' || c.is_whitespace()).filter(|s| !s.is_empty()) {
        let angka = if let Some(hex) = bagian.strip_prefix("0x").or_else(|| bagian.strip_prefix("0X")) {
            u8::from_str_radix(hex, 16)
        } else {
            bagian.parse::<u8>()
        };
        match angka {
            Ok(b) => hasil.push(b),
            Err(_) => {
                return Err(format!(
                    "Kode laci \"{bagian}\" tidak valid. Isi angka 0 sampai 255 dipisah koma, misalnya {KODE_LACI_BAWAAN}."
                ));
            }
        }
    }
    if hasil.is_empty() {
        return Err(format!("Kode laci belum diisi. Contoh: {KODE_LACI_BAWAAN}."));
    }
    Ok(hasil)
}

/// Apakah `tujuan` merupakan nama port perangkat langsung Windows (`LPT1..LPT9`, `COM1..COM99`)?
pub fn adalah_port_perangkat(tujuan: &str) -> bool {
    let t = tujuan.trim().trim_end_matches(':');
    let atas = t.to_ascii_uppercase();
    if let Some(sisa) = atas.strip_prefix("LPT").or_else(|| atas.strip_prefix("COM")) {
        return !sisa.is_empty() && sisa.len() <= 2 && sisa.bytes().all(|b| b.is_ascii_digit()) && sisa != "0";
    }
    false
}

/// Tentukan jalur pengiriman berdasarkan `jenis_port` (`"USB"`, `"LPT"`, `"COM"`) dan `tujuan`.
/// Bila `boleh_bawaan` bernilai true dan `tujuan` kosong pada mode USB, akan memakai printer bawaan Windows.
pub fn tentukan_jalur(jenis_port: &str, tujuan: &str, boleh_bawaan: bool) -> Result<Jalur, String> {
    let t = tujuan.trim();
    let port = jenis_port.trim().to_ascii_uppercase();

    if t.is_empty() {
        if boleh_bawaan && (port.is_empty() || port == "USB") {
            return Ok(Jalur::Spooler(None));
        }
        return Err("Nama atau port printer belum diisi. Atur di menu Pengaturan, tab Peralatan.".into());
    }

    if adalah_port_perangkat(t) || port == "LPT" || port == "COM" {
        return Ok(Jalur::Port(t.to_string()));
    }

    // Di non-Windows, alamat file absolut (mis. /dev/usb/lp0 atau file uji) ditulis langsung.
    if !cfg!(windows) && Path::new(t).is_absolute() {
        return Ok(Jalur::Port(t.to_string()));
    }

    Ok(Jalur::Spooler(Some(t.to_string())))
}

/// Ubah teks struk menjadi byte ESC/POS yang aman untuk printer thermal/kasir.
/// Menyertakan reset printer (`ESC @`), akhir baris CRLF, ruang sobek, dan perintah potong kertas bila diminta.
pub fn siapkan_struk_mentah(isi: &str, potong: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(isi.len() + 32);
    // ESC @ — inisialisasi ulang printer agar mode huruf kembali normal.
    out.extend_from_slice(&[0x1B, 0x40]);

    for baris in isi.replace("\r\n", "\n").split('\n') {
        for ch in baris.chars() {
            match ch {
                '\u{00A0}' => out.push(b' '),
                '–' | '—' | '−' => out.push(b'-'),
                '·' | '•' => out.push(b'-'),
                '×' => out.push(b'x'),
                '…' => out.extend_from_slice(b"..."),
                '“' | '”' => out.push(b'"'),
                '‘' | '’' => out.push(b'\''),
                c if c.is_ascii() => out.push(c as u8),
                _ => out.push(b'?'),
            }
        }
        out.extend_from_slice(b"\r\n");
    }

    // Geser kertas melewati pisau/sobekan.
    out.extend_from_slice(b"\r\n\r\n\r\n\r\n");

    if potong {
        // GS V 1 — potong sebagian (ESC/POS standar; diabaikan printer tanpa pemotong otomatis).
        out.extend_from_slice(&[0x1D, 0x56, 0x01]);
    }
    out
}

/// Kirim byte mentah ke jalur yang sudah ditentukan.
pub fn kirim_mentah(jalur: &Jalur, nama_dokumen: &str, data: &[u8]) -> Result<(), String> {
    match jalur {
        Jalur::Port(alamat) => kirim_ke_port(alamat, nama_dokumen, data),
        Jalur::Spooler(nama) => kirim_ke_spooler(nama.as_deref(), nama_dokumen, data),
    }
}

fn kirim_ke_port(alamat: &str, nama_dokumen: &str, data: &[u8]) -> Result<(), String> {
    let target = alamat.trim();
    // Untuk port perangkat Windows (LPT1, COM1, dst.), coba awalan \\.\ lebih dulu.
    let hasil = if cfg!(windows) && adalah_port_perangkat(target) {
        let bersih = target.trim_end_matches(':');
        let jalur_perangkat = format!(r"\\.\{bersih}");
        tulis_ke_file(&jalur_perangkat, data).or_else(|_| tulis_ke_file(bersih, data))
    } else {
        tulis_ke_file(target, data)
    };

    if let Err(err) = hasil {
        // Di Windows, bila alamat berupa printer berbagi (\\PC\Printer) atau nama printer di mode LPT,
        // coba kirim lewat Windows Print Spooler sebagai cadangan.
        #[cfg(windows)]
        if !adalah_port_perangkat(target) && kirim_ke_spooler(Some(target), nama_dokumen, data).is_ok() {
            return Ok(());
        }
        let _ = nama_dokumen;
        return Err(format!(
            "Tidak bisa mengirim ke port \"{target}\": {err}. Pastikan perangkat terpasang dan pengaturan port di Pengaturan sudah benar."
        ));
    }
    Ok(())
}

fn tulis_ke_file(alamat: &str, data: &[u8]) -> Result<(), std::io::Error> {
    let mut f = std::fs::OpenOptions::new().write(true).open(alamat)?;
    f.write_all(data)?;
    f.flush()
}

#[cfg(windows)]
fn kirim_ke_spooler(nama: Option<&str>, nama_dokumen: &str, data: &[u8]) -> Result<(), String> {
    let target = match nama {
        Some(n) if !n.trim().is_empty() => n.trim().to_string(),
        _ => win::printer_bawaan().ok_or_else(|| {
            "Printer bawaan Windows tidak ditemukan. Pilih nama printer di menu Pengaturan, tab Peralatan.".to_string()
        })?,
    };
    win::kirim_raw(&target, nama_dokumen, data)
}

#[cfg(not(windows))]
fn kirim_ke_spooler(nama: Option<&str>, _nama_dokumen: &str, _data: &[u8]) -> Result<(), String> {
    let ket = nama.filter(|s| !s.trim().is_empty()).unwrap_or("printer bawaan");
    Err(format!(
        "Pengiriman langsung ke \"{ket}\" hanya berjalan di Windows. Di macOS/Linux gunakan dialog cetak sistem."
    ))
}

/// Daftar nama printer yang terpasang di komputer ini.
pub fn daftar_printer_sistem() -> Vec<String> {
    #[cfg(windows)]
    {
        win::daftar_printer()
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("lpstat")
            .arg("-e")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                let mut daftar: Vec<String> = String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect();
                daftar.sort();
                daftar.dedup();
                daftar
            })
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------- Perintah Tauri (Golongan::Lokal)

/// Daftar printer yang terpasang di komputer ini (untuk pilihan di menu Pengaturan).
#[perintah]
pub fn daftar_printer(_k: &Konteks) -> Result<Vec<String>, String> {
    Ok(daftar_printer_sistem())
}

/// Cetak teks struk langsung ke printer tanpa membuka dialog cetak Windows.
#[perintah]
pub fn cetak_langsung(
    _k: &Konteks,
    jenis_port: String,
    tujuan: String,
    isi: String,
    potong: Option<bool>,
) -> Result<(), String> {
    if isi.trim().is_empty() {
        return Err("Isi struk kosong, tidak ada yang dicetak.".into());
    }
    let jalur = tentukan_jalur(&jenis_port, &tujuan, false)?;
    let data = siapkan_struk_mentah(&isi, potong.unwrap_or(true));
    kirim_mentah(&jalur, "Struk KasirJet", &data)
}

/// Kirim perintah ESC/POS untuk membuka laci kasir (cash drawer).
#[perintah]
pub fn buka_laci(
    _k: &Konteks,
    jenis_port: String,
    tujuan: String,
    kode: String,
) -> Result<(), String> {
    let data = urai_kode_laci(&kode)?;
    let jalur = tentukan_jalur(&jenis_port, &tujuan, true)?;
    kirim_mentah(&jalur, "Buka Laci KasirJet", &data).map_err(|e| {
        if e.contains("hanya berjalan di Windows") {
            "Pembukaan laci kasir otomatis hanya berjalan di Windows.".into()
        } else {
            format!("Laci kasir tidak bisa dibuka. {e}")
        }
    })
}

// ---------------------------------------------------------------- Windows Print Spooler FFI

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::ptr;

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;
    type Lpwstr = *mut u16;

    const PRINTER_ENUM_LOCAL: Dword = 0x0000_0002;
    const PRINTER_ENUM_CONNECTIONS: Dword = 0x0000_0004;

    #[repr(C)]
    struct DocInfo1W {
        p_doc_name: Lpwstr,
        p_output_file: Lpwstr,
        p_datatype: Lpwstr,
    }

    #[repr(C)]
    struct PrinterInfo4W {
        p_printer_name: Lpwstr,
        p_server_name: Lpwstr,
        attributes: Dword,
    }

    #[link(name = "winspool")]
    unsafe extern "system" {
        fn OpenPrinterW(p_printer_name: Lpwstr, ph_printer: *mut Handle, p_default: *mut c_void) -> Bool;
        fn ClosePrinter(h_printer: Handle) -> Bool;
        fn StartDocPrinterW(h_printer: Handle, level: Dword, p_doc_info: *const DocInfo1W) -> Dword;
        fn EndDocPrinter(h_printer: Handle) -> Bool;
        fn StartPagePrinter(h_printer: Handle) -> Bool;
        fn EndPagePrinter(h_printer: Handle) -> Bool;
        fn WritePrinter(h_printer: Handle, p_buf: *const c_void, cb_buf: Dword, pc_written: *mut Dword) -> Bool;
        fn EnumPrintersW(
            flags: Dword,
            name: Lpwstr,
            level: Dword,
            p_printer_enum: *mut u8,
            cb_buf: Dword,
            pcb_needed: *mut Dword,
            pc_returned: *mut Dword,
        ) -> Bool;
        fn GetDefaultPrinterW(psz_buffer: Lpwstr, pcch_buffer: *mut Dword) -> Bool;
    }

    struct PenutupPrinter(Handle);
    impl Drop for PenutupPrinter {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    ClosePrinter(self.0);
                }
            }
        }
    }

    fn ke_utf16(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn baca_utf16(ptr: Lpwstr) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let mut len = 0usize;
        unsafe {
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            Some(String::from_utf16_lossy(slice))
        }
    }

    pub fn printer_bawaan() -> Option<String> {
        let mut panjang: Dword = 0;
        unsafe {
            GetDefaultPrinterW(ptr::null_mut(), &mut panjang);
        }
        if panjang == 0 {
            return None;
        }
        let mut buf = vec![0u16; panjang as usize];
        let ok = unsafe { GetDefaultPrinterW(buf.as_mut_ptr(), &mut panjang) };
        if ok == 0 {
            return None;
        }
        let isi = buf.split(|&c| c == 0).next().unwrap_or(&[]);
        let nama = String::from_utf16_lossy(isi).trim().to_string();
        if nama.is_empty() { None } else { Some(nama) }
    }

    pub fn daftar_printer() -> Vec<String> {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut perlu: Dword = 0;
        let mut jumlah: Dword = 0;
        unsafe {
            EnumPrintersW(flags, ptr::null_mut(), 4, ptr::null_mut(), 0, &mut perlu, &mut jumlah);
        }
        if perlu == 0 {
            return Vec::new();
        }
        // Pakai Vec<usize> supaya perataan memori cukup untuk PRINTER_INFO_4W.
        let mut buf = vec![0usize; (perlu as usize).div_ceil(std::mem::size_of::<usize>())];
        let ok = unsafe {
            EnumPrintersW(
                flags,
                ptr::null_mut(),
                4,
                buf.as_mut_ptr() as *mut u8,
                (buf.len() * std::mem::size_of::<usize>()) as Dword,
                &mut perlu,
                &mut jumlah,
            )
        };
        if ok == 0 || jumlah == 0 {
            return Vec::new();
        }
        let info = buf.as_ptr() as *const PrinterInfo4W;
        let mut hasil = Vec::with_capacity(jumlah as usize);
        for i in 0..jumlah as usize {
            if let Some(nama) = unsafe { baca_utf16((*info.add(i)).p_printer_name) } {
                let n = nama.trim().to_string();
                if !n.is_empty() {
                    hasil.push(n);
                }
            }
        }
        hasil.sort();
        hasil.dedup();
        hasil
    }

    pub fn kirim_raw(nama_printer: &str, nama_dokumen: &str, data: &[u8]) -> Result<(), String> {
        let mut w_nama = ke_utf16(nama_printer);
        let mut handle: Handle = ptr::null_mut();
        let ok = unsafe { OpenPrinterW(w_nama.as_mut_ptr(), &mut handle, ptr::null_mut()) };
        if ok == 0 || handle.is_null() {
            return Err(format!(
                "Printer \"{nama_printer}\" tidak ditemukan di Windows. Periksa nama printer di menu Pengaturan, tab Peralatan."
            ));
        }
        let _tutup = PenutupPrinter(handle);

        let mut w_doc = ke_utf16(nama_dokumen);
        let mut w_raw = ke_utf16("RAW");
        let doc = DocInfo1W {
            p_doc_name: w_doc.as_mut_ptr(),
            p_output_file: ptr::null_mut(),
            p_datatype: w_raw.as_mut_ptr(),
        };

        let job = unsafe { StartDocPrinterW(handle, 1, &doc) };
        if job == 0 {
            return Err(format!(
                "Printer \"{nama_printer}\" tidak siap menerima cetakan. Pastikan printer menyala dan terhubung."
            ));
        }

        let res = (|| -> Result<(), String> {
            if unsafe { StartPagePrinter(handle) } == 0 {
                return Err(format!("Gagal memulai halaman cetak di printer \"{nama_printer}\"."));
            }
            let mut offset = 0usize;
            while offset < data.len() {
                let sisa = &data[offset..];
                let mut tertulis: Dword = 0;
                let w_ok = unsafe {
                    WritePrinter(
                        handle,
                        sisa.as_ptr() as *const c_void,
                        sisa.len().min(u32::MAX as usize) as Dword,
                        &mut tertulis,
                    )
                };
                if w_ok == 0 || tertulis == 0 {
                    let _ = unsafe { EndPagePrinter(handle) };
                    return Err(format!(
                        "Gagal mengirim data ke printer \"{nama_printer}\". Pastikan kabel dan driver printer normal."
                    ));
                }
                offset += tertulis as usize;
            }
            let _ = unsafe { EndPagePrinter(handle) };
            Ok(())
        })();

        let _ = unsafe { EndDocPrinter(handle) };
        res
    }
}
