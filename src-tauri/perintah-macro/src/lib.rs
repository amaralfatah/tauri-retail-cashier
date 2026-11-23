//! Macro untuk dispatcher perintah Toko Pro.
//!
//! - `#[perintah]` dipasang pada fungsi perintah. Fungsinya tidak diubah; macro menambah pembungkus
//!   `__jalankan_<nama>(k: &Konteks, args: &Map<String, Value>) -> Res<Value>` yang membaca argumen JSON
//!   (nama camelCase, sama dengan aturan Tauri) lalu memanggil fungsinya.
//!   Parameter bertipe `&Db`, `&Session`, dan `&Konteks` diambil dari konteks, bukan dari argumen.
//!   Macro juga mengekspor `__PARAM_<nama>`: daftar (nama camelCase, wajib) tiap parameter argumen.
//! - `daftar_perintah![modul::fungsi, ...]` membuat `dispatch(k, nama, args)`, `NAMA_PERINTAH`, dan `PARAMETER_PERINTAH`.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::parse::Parser;
use syn::punctuated::Punctuated;
use syn::{parse_macro_input, FnArg, ItemFn, Pat, Path, ReturnType, Token, Type};

/// snake_case -> camelCase (`hapus_asal` -> `hapusAsal`).
fn camel(s: &str) -> String {
    let mut out = String::new();
    let mut besar = false;
    for c in s.trim_start_matches('_').chars() {
        if c == '_' {
            besar = true;
        } else if besar {
            out.extend(c.to_uppercase());
            besar = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn nama_terakhir(t: &Type) -> Option<String> {
    match t {
        Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        _ => None,
    }
}

#[proc_macro_attribute]
pub fn perintah(_atribut: TokenStream, item: TokenStream) -> TokenStream {
    let f = parse_macro_input!(item as ItemFn);
    if f.sig.asyncness.is_some() {
        return syn::Error::new_spanned(&f.sig, "#[perintah] tidak mendukung fungsi async").to_compile_error().into();
    }
    let nama = &f.sig.ident;
    let pembungkus = format_ident!("__jalankan_{}", nama);
    let mut ambil = Vec::new();
    let mut panggil = Vec::new();
    let mut param = Vec::new();
    let param_ident = format_ident!("__PARAM_{}", nama);
    for arg in &f.sig.inputs {
        let FnArg::Typed(pt) = arg else {
            return syn::Error::new_spanned(arg, "#[perintah] tidak mendukung self").to_compile_error().into();
        };
        let Pat::Ident(pi) = &*pt.pat else {
            return syn::Error::new_spanned(&pt.pat, "nama parameter harus berupa pengenal biasa").to_compile_error().into();
        };
        let ident = &pi.ident;
        let acuan = match &*pt.ty {
            Type::Reference(r) => nama_terakhir(&r.elem),
            _ => None,
        };
        match acuan.as_deref() {
            Some("Db") => panggil.push(quote!(k.db)),
            Some("Session") => panggil.push(quote!(k.sesi)),
            Some("Konteks") => panggil.push(quote!(k)),
            _ => {
                if matches!(&*pt.ty, Type::Reference(_)) {
                    return syn::Error::new_spanned(&pt.ty, "argumen perintah harus bertipe nilai (bukan referensi)").to_compile_error().into();
                }
                let ty = &pt.ty;
                let kunci = camel(&ident.to_string());
                let wajib = nama_terakhir(&pt.ty).as_deref() != Some("Option");
                param.push(quote!((#kunci, #wajib)));
                ambil.push(quote!(let #ident: #ty = crate::konteks::ambil(args, #kunci)?;));
                panggil.push(quote!(#ident));
            }
        }
    }
    let hasil = match &f.sig.output {
        ReturnType::Type(_, t) if matches!(nama_terakhir(t).as_deref(), Some("Res") | Some("Result")) => quote!(#nama(#(#panggil),*)?),
        _ => quote!(#nama(#(#panggil),*)),
    };
    quote! {
        #f

        /// Parameter argumen JSON perintah ini: (nama camelCase, wajib).
        #[doc(hidden)]
        #[allow(dead_code, non_upper_case_globals)]
        pub const #param_ident: &[(&str, bool)] = &[#(#param),*];

        #[doc(hidden)]
        #[allow(dead_code)]
        pub fn #pembungkus(
            k: &crate::konteks::Konteks,
            args: &::serde_json::Map<String, ::serde_json::Value>,
        ) -> crate::db::Res<::serde_json::Value> {
            #(#ambil)*
            crate::konteks::ke_json(#hasil)
        }
    }
    .into()
}

#[proc_macro]
pub fn daftar_perintah(input: TokenStream) -> TokenStream {
    let jalur = match Punctuated::<Path, Token![,]>::parse_terminated.parse(input) {
        Ok(j) => j,
        Err(err) => return err.to_compile_error().into(),
    };
    let mut nama = Vec::new();
    let mut cabang = Vec::new();
    let mut daftar_param = Vec::new();
    for p in &jalur {
        let Some(akhir) = p.segments.last() else {
            return syn::Error::new(Span::call_site(), "jalur kosong").to_compile_error().into();
        };
        let teks = akhir.ident.to_string();
        let mut j = p.clone();
        let last = j.segments.last_mut().unwrap();
        last.ident = format_ident!("__jalankan_{}", teks);
        cabang.push(quote!(#teks => #j(k, args),));
        let mut jp = p.clone();
        jp.segments.last_mut().unwrap().ident = format_ident!("__PARAM_{}", teks);
        daftar_param.push(quote!((#teks, #jp)));
        nama.push(teks);
    }
    quote! {
        /// Semua nama perintah yang bisa dipanggil lewat `jalankan`.
        pub const NAMA_PERINTAH: &[&str] = &[#(#nama),*];

        /// Parameter argumen setiap perintah: (nama perintah, [(nama camelCase, wajib)]).
        pub const PARAMETER_PERINTAH: &[(&str, &[(&str, bool)])] = &[#(#daftar_param),*];

        /// Jalankan perintah menurut namanya. Argumen berupa objek JSON dengan nama camelCase.
        pub fn dispatch(
            k: &crate::konteks::Konteks,
            nama: &str,
            args: &::serde_json::Map<String, ::serde_json::Value>,
        ) -> crate::db::Res<::serde_json::Value> {
            match nama {
                #(#cabang)*
                _ => Err(format!("Perintah \"{nama}\" tidak dikenal.")),
            }
        }
    }
    .into()
}
