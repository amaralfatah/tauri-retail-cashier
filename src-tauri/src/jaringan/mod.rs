#![allow(dead_code)] // sebagian pembantu baru dipakai tahap berikutnya (tampilan, klien Kasir)

//! Mode Komputer Pusat: pengaturan mode (`pusat.json`), server HTTP di komputer Pusat, daftar perangkat,
//! golongan perintah, dan klien komputer Kasir. Mode Tunggal (bawaan) tidak membuka port apa pun.

pub mod batas;
pub mod firewall;
pub mod golongan;
pub mod kendali;
pub mod klien;
pub mod mode;
pub mod perangkat;
pub mod server;
