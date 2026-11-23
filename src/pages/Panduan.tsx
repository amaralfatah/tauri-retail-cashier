import { ReactNode, useRef, useState } from "react";

/** Isi panduan. Semua tombol dan kunci di sini diambil dari layar yang sudah ada di program. */
type Blok =
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { tabel: string[][]; kepala: [string, string] };

interface Bagian { id: string; judul: string; isi: Blok[] }

const BAGIAN: Bagian[] = [
  {
    id: "masuk", judul: "Masuk, kata sandi, dan level pengguna",
    isi: [
      { p: "Ketik nama user dan kata sandi Anda di layar User Login. Tekan Enter atau klik Login." },
      { p: "Kalau akun Anda masih memakai kata sandi sementara, program meminta Anda membuat kata sandi baru dulu. Tanyakan kata sandi sementaranya ke pemilik toko." },
      { p: "Untuk mengganti kata sandi kapan saja, buka Pengaturan, Pengaturan Program, lalu klik Profil Pengguna." },
      { p: "Klik Log Off di bilah atas kalau ingin ganti pengguna tanpa menutup program. Klik Keluar kalau sudah selesai bekerja." },
      { p: "Level pengguna menentukan menu yang bisa Anda buka." },
      {
        kepala: ["Level", "Yang bisa dibuka"],
        tabel: [
          ["Manager", "Semua menu. Level ini milik pemilik toko dan tidak pernah dibatasi."],
          ["Supervisor", "Menu yang diizinkan pemilik toko di Pengaturan Pengguna."],
          ["Kasir", "Transaksi Penjualan, laporan penjualan dan stok, Pengaturan, dan panduan ini."],
        ],
      },
      { p: "Kalau sebuah menu tidak muncul, berarti akun Anda belum diberi izin. Minta pemilik toko membukanya." },
    ],
  },
  {
    id: "layar", judul: "Layar utama dan pemberitahuan",
    isi: [
      { p: "Menu ada di bilah atas, masing-masing dengan ikon: Home, Log Off, Master Data, Penjualan, Pembelian, Inventori, Laporan, Keuangan, Pengaturan, Bantuan, dan Keluar. Klik Home untuk kembali ke layar utama." },
      { p: "Setiap layar punya tombol Tutup di kanan bawah, dengan petunjuk Esc di sebelahnya. Klik Tutup atau tekan Esc untuk menutup layar. Di layar kasir, kalau masih ada barang di tabel, program bertanya dulu karena transaksinya ikut dibatalkan." },
      { p: "Nama layar yang sedang terbuka tampil di kiri bilah status di bagian bawah, disusul nama user, level, dan jam." },
      { p: "Tombol dan kolom yang punya tombol pintas menuliskannya langsung di tombol atau labelnya, misalnya F4 atau Alt+1. Anda tidak perlu menghafal daftarnya." },
      { p: "Tombol bulan atau matahari di bilah atas (tertulis Gelap atau Terang kalau jendela cukup lebar) mengganti tampilan program antara mode terang dan mode gelap. Pilihan Tema di Pengaturan Program, tab Info Usaha, juga bisa Ikut Sistem." },
      { p: "Pertanyaan yang menghapus atau membatalkan sesuatu memilih Tidak lebih dulu, jadi Enter yang tidak sengaja tidak menghapus apa pun. Anda bisa menjawab dengan huruf Y untuk Ya atau T untuk Tidak." },
      { p: "Pemilik toko bisa memilih layar utama berupa Dashboard. Pilihannya ada di Pengaturan Program, tab Transaksi, kolom Pilihan Home Screen. Pilihan ini hanya berlaku di komputer yang Anda pakai." },
      { p: "Dashboard menampilkan penjualan dan laba hari ini, rata-rata 30 hari terakhir, grafik penjualan dan laba, lima pelanggan dengan transaksi terbanyak, serta daftar piutang pelanggan. Klik Refresh untuk memuat data terbaru." },
      { p: "Setelah Anda masuk, program memeriksa piutang yang sudah jatuh tempo. Kalau ada, jendela kecil Notifikasi muncul dari kanan bawah. Klik jendela itu untuk membuka Pelunasan Piutang, atau klik tanda × di pojoknya untuk menutupnya. Program memeriksa satu kali setelah Anda masuk, dan lagi setiap Anda mengklik Notifikasi di Ringkasan Toko. Jendela ini hanya muncul untuk pengguna yang boleh membuka Pelunasan Piutang." },
    ],
  },
  {
    id: "kasir", judul: "Penjualan di kasir",
    isi: [
      { p: "Buka Penjualan, lalu Transaksi Penjualan. Kursor sudah ada di kolom Scan Barcode." },
      { p: "Scan barcode barang, atau ketik kode barangnya, lalu tekan Enter. Barang masuk ke tabel. Scan barang yang sama lagi untuk menambah jumlahnya." },
      { p: "Untuk langsung mengisi jumlah, ketik jumlah, tanda bintang, lalu kode. Contohnya 3*A001 memasukkan 3 barang dengan kode A001." },
      { p: "Kalau kode tidak ditemukan, atau kolom scan kosong lalu Anda tekan Enter, daftar barang terbuka untuk dicari." },
      { p: "Klik baris di tabel untuk mengubah jumlah atau harga. Pilih barang lalu tekan Delete untuk menghapusnya dari tabel." },
      { p: "Pilih kasir, pelanggan, sales, dan isi catatan kalau perlu. Klik ikon kaca pembesar di samping kolomnya untuk membuka daftar." },
      { p: "Tombol keyboard di layar ini:" },
      {
        kepala: ["Tombol", "Fungsi"],
        tabel: [
          ["F1", "Kembali ke kolom Scan Barcode"],
          ["F3", "Ambil Order: memakai order penjualan yang sudah dibuat"],
          ["F4", "Bayar"],
          ["F6", "Batal: mengosongkan semua barang di tabel"],
          ["F7", "Pending: simpan transaksi dulu, bayar nanti"],
          ["F8", "Data Pending: panggil transaksi yang tertunda"],
          ["F9", "Cek Poin pelanggan (kalau poin member aktif)"],
          ["F10", "Cari barang di daftar"],
          ["Delete", "Hapus barang yang dipilih di tabel"],
          ["Esc", "Tutup layar"],
          ["Alt + T", "Pindah ke kolom scan atau tabel"],
          ["Alt + 1", "Ke kolom Tanggal"],
          ["Alt + 2", "Pilih kasir (hanya untuk level selain Kasir)"],
          ["Alt + 3", "Pilih pelanggan"],
          ["Alt + 4", "Pilih sales"],
          ["Alt + 5", "Ke kolom Catatan"],
        ],
      },
      { p: "Tekan Bayar (F4) kalau semua barang sudah masuk. Jendela Pembayaran terbuka dan menampilkan total belanja." },
      { ul: [
        "Pilih cara bayar: Tunai (Alt+1), QRIS (Alt+2), atau Debit/Kartu (Alt+3). Untuk QRIS dan Debit, isi nomor referensi dari struk EDC atau QRIS.",
        "Isi uang yang diterima (Alt+B). Tombol Uang pas (Alt+U) dan pecahan uang di bawahnya mengisi jumlahnya sekali klik. Kembaliannya dihitung otomatis.",
        "Klik Diskon, biaya lain, uang muka, dan non tunai (Alt+L) untuk mengisi diskon, biaya lain, uang muka, atau pembayaran non tunai campuran.",
        "Kalau uang yang diterima kurang dari total, pilih dulu pelanggannya di layar transaksi. Kekurangannya dicatat sebagai piutang, dan Anda mengatur tanggal jatuh temponya di jendela yang sama.",
        "Alt+P menyalakan atau mematikan Lihat struk dulu.",
      ] },
      { p: "Klik Simpan atau tekan Enter. Struk muncul untuk dicetak. Kalau Lihat struk dulu dimatikan, struk langsung dicetak, atau program bertanya dulu bila pilihan konfirmasi cetak aktif di Pengaturan Program. Esc menutup jendela Pembayaran tanpa menyimpan." },
      { p: "Klik Cetak Ulang kalau struk transaksi terakhir perlu dicetak lagi. Tombol Surat Jalan dan SPK Gudang mencetak dokumen untuk gudang." },
      { p: "Kalau pengaturan Izinkan stok minus saat penjualan mati, Anda tidak bisa menjual lebih dari stok. Jumlah yang terlalu banyak dikembalikan ke stok yang ada, dan barang yang stoknya habis tidak muncul saat dicari." },
    ],
  },
  {
    id: "pending", judul: "Pending dan order penjualan",
    isi: [
      { p: "Kalau pembeli belum jadi membayar, klik Pending. Barang di tabel disimpan dulu, dan layar kasir kosong untuk pembeli berikutnya." },
      { p: "Klik Data Pending untuk memanggil transaksi yang tertunda, lalu pilih salah satunya. Barang kembali ke tabel dan Anda bisa melanjutkan dengan Bayar." },
      { p: "Order Penjualan dipakai untuk pesanan yang diambil nanti. Buka Penjualan, lalu Order Penjualan. Isi barangnya seperti di kasir, lalu tekan F4. Uang muka (DP) bisa diisi. Stok barang belum berkurang pada saat order disimpan." },
      { p: "Saat pembeli datang mengambil pesanannya, buka Transaksi Penjualan dan tekan F3 (Ambil Order). Pilih ordernya, lalu bayar seperti biasa. Order yang sudah diambil tidak bisa diambil dua kali." },
    ],
  },
  {
    id: "beli", judul: "Pembelian",
    isi: [
      { p: "Buka Pembelian, lalu Transaksi Pembelian. Cara mengisinya sama seperti penjualan: scan atau ketik kode barang, isi jumlah, lalu cek harga belinya." },
      { p: "Pilih supplier lewat ikon kaca pembesar di samping kolom Supplier (Alt+3)." },
      { ul: [
        "F1: Batal.",
        "F3: Ambil Order Pembelian yang sudah dibuat.",
        "F4: Bayar.",
        "F6: Cari barang yang stoknya sudah di bawah stok minimal. Cocok untuk daftar belanja.",
        "F10: Cari barang.",
      ] },
      { p: "Klik Edit Barang kalau data barang yang dipilih perlu diperbaiki, misalnya harga jual." },
      { p: "Di jendela Pembayaran, isi Jml. Bayar. Kalau yang Anda bayar kurang dari total, sisanya dicatat sebagai hutang ke supplier. Atur Jatuh Tempo di jendela itu." },
      { p: "Dua pengaturan memengaruhi pembelian: Update Harga Beli saat Transaksi Pembelian, dan Update Harga Jual dari margin saat Transaksi Pembelian. Keduanya ada di Pengaturan Program, tab Transaksi." },
      { p: "Order Pembelian ada di menu yang sama. Isinya sama seperti pembelian, tetapi stok belum bertambah sampai barangnya diambil lewat Ambil Order [F3]." },
    ],
  },
  {
    id: "retur", judul: "Retur",
    isi: [
      { p: "Retur Penjualan dipakai kalau pembeli mengembalikan barang. Buka Penjualan, lalu Retur Penjualan. Tekan F3 (Cari Transaksi) dan pilih nota penjualannya. Isi jumlah barang yang dikembalikan, lalu tekan F4 untuk menyimpan." },
      { p: "Retur Pembelian per Transaksi dipakai kalau Anda mengembalikan barang ke supplier dan nota pembeliannya masih ada. Caranya sama seperti retur penjualan." },
      { p: "Retur Pembelian per Barang dipakai kalau nota pembeliannya tidak ada. Pilih supplier dulu, tekan F10 untuk mencari barang, isi jumlahnya, lalu tekan F4." },
      { p: "Jumlah retur tidak boleh lebih besar dari jumlah di nota. Retur dicatat atas nama Anda. F1 membatalkan isian." },
    ],
  },
  {
    id: "pelunasan", judul: "Pelunasan piutang dan hutang",
    isi: [
      { p: "Pelunasan Piutang dipakai kalau pelanggan membayar tagihannya. Buka Penjualan, lalu Pelunasan Piutang. Pilih pelanggannya. Di kolom Mode Pembayaran, pilih Lunasi Transaksi yang Dicentang lalu centang tagihan yang dibayar, atau pilih Bayar Sebagian lalu isi Jml. Pelunasan di tiap tagihan. Tekan F4 untuk menyimpan." },
      { p: "Kolom Kekurangan/Sisa menunjukkan berapa yang masih harus dibayar setelah pelunasan ini. Tagihan yang sudah lunas tidak muncul lagi di daftar piutang." },
      { p: "Pelunasan Hutang ada di menu Pembelian dan caranya sama, untuk hutang ke supplier." },
      { p: "Daftar piutang dan hutang yang belum lunas juga ada di menu Laporan." },
    ],
  },
  {
    id: "stok", judul: "Stok awal, stok opname, dan cetak label",
    isi: [
      { p: "Stok Awal dipakai sekali saat toko mulai memakai program. Buka Inventori, lalu Stok Awal. Tekan F10 untuk mencari barang, isi jumlahnya, lalu tekan F4." },
      { p: "Stok Opname dipakai untuk mencocokkan stok di program dengan hitungan di rak. Buka Inventori, lalu Stok Opname. Tekan F10, pilih barang, lalu isi stok yang Anda hitung. Klik Filter untuk memilih barang berdasarkan kelompok atau kategori. Tekan F4 untuk menyimpan, dan stok barang di program berubah sesuai hitungan Anda. Tekan F1 untuk membatalkan." },
      { p: "Cetak Barcode dan Cetak Price Tag dipakai untuk mencetak label barang. Tambahkan barang, isi jumlah label yang dicetak, lalu klik Cetak." },
      { p: "Katalog Barang dipakai untuk melihat data, harga, dan stok barang. Ketik di kolom Cari, lalu pilih barangnya." },
    ],
  },
  {
    id: "master", judul: "Master data",
    isi: [
      { p: "Menu Master Data berisi daftar barang, kelompok, kategori, satuan, supplier, pelanggan, dan karyawan." },
      { p: "Di setiap daftar, bilah tombolnya sama: Baru, Edit, Hapus, Filter, Refresh, Export, Cetak, dan Tutup. Di Data Barang ada tambahan Import Foto." },
      { ul: [
        "Baru membuka isian kosong. Isi, lalu klik Simpan.",
        "Edit membuka data yang Anda pilih di daftar.",
        "Filter menyaring daftar. Refresh menghapus saringan.",
        "Export menyimpan daftar ke file. Cetak mencetak daftarnya.",
      ] },
      { p: "Barang bisa memakai beberapa satuan dengan harga masing-masing (Harga Multi Satuan) dan harga khusus tiap level pelanggan (Harga Level). Fitur ini aktif kalau dinyalakan di Pengaturan Program." },
      { p: "Data yang sudah dipakai di transaksi tidak bisa dihapus. Program memberi tahu Anda, dan Anda bisa menonaktifkan datanya saja." },
      { p: "Akun Kasir tidak bisa membuka Master Data." },
    ],
  },
  {
    id: "promo", judul: "Promo dan poin pelanggan",
    isi: [
      { p: "Menu Inventori punya dua jenis promo: Promo Penjualan (harga diskon) dan Promo Bonus Produk. Keduanya baru berlaku kalau Aktifkan Promo Penjualan menyala di Pengaturan Program." },
      { ul: [
        "F4 menyimpan, F5 memuat ulang daftar, F6 menghapus baris yang dipilih, Esc menutup.",
        "Tanggal berlaku ditulis dengan format DD/MM/YYYY. Tanggal berakhir tidak boleh sebelum tanggal mulai.",
        "Akun Kasir tidak bisa mengubah atau menghapus promo.",
      ] },
      { p: "Poin pelanggan aktif kalau Aktifkan Poin Member menyala di Pengaturan Program. Di sana Anda mengisi Minimal Transaksi Poin dan Jml Poin yang didapat. Pelanggan terdaftar mendapat poin kalau total belanjanya mencapai Minimal Transaksi Poin. Kalau Berlaku kelipatan menyala, poinnya dikalikan sesuai kelipatan belanja itu." },
      { p: "Pelanggan bisa menukar poin di layar Transaksi Penukaran Poin. Isi kode pelanggan, isi jumlah poin yang ditukar, lalu klik Simpan. Klik Koreksi untuk memperbaiki jumlah poin pelanggan." },
    ],
  },
  {
    id: "laporan", judul: "Laporan",
    isi: [
      { p: "Buka menu Laporan, pilih kelompoknya (penjualan, pembelian, inventori, atau laba rugi), lalu pilih laporan." },
      { p: "Jendela filter terbuka. Pilih tanggal dan isian lain yang ingin Anda batasi. Klik Tampilkan untuk melihat laporannya." },
      { p: "Klik Cetak di atas laporan untuk mencetak. Kertas yang dipakai adalah A4. Laporan stok detil dicetak mendatar. Kolom judul tabel diulang di setiap halaman, dan nomor halaman ada di bawah." },
      { p: "Kasir hanya bisa membuka laporan penjualan dan stok." },
    ],
  },
  {
    id: "kas", judul: "Kas",
    isi: [
      { p: "Buka Keuangan untuk melihat Transaksi Kas. Di sini Anda mencatat uang masuk dan uang keluar di luar penjualan dan pembelian, misalnya biaya listrik." },
      { ul: [
        "Klik Baru, lalu isi tanggal, jenis (Masuk atau Keluar), kategori, jumlah, dan keterangan. Klik Simpan.",
        "Pilih data kas lalu klik Hapus. Program bertanya dulu sebelum menghapus. Filter, Refresh, Export, dan Cetak bekerja seperti di daftar Master Data.",
      ] },
      { p: "Kalau Hubungkan Semua Transaksi dengan Transaksi Kas menyala di Pengaturan Program, penjualan dan pembelian juga masuk ke kas. Laporan Laba Rugi Kas membaca data ini." },
    ],
  },
  {
    id: "atur", judul: "Pengaturan program",
    isi: [
      { p: "Buka Pengaturan, lalu Pengaturan Program. Ada tiga tab." },
      { ul: [
        "Info Usaha: nama usaha, alamat, kontak, logo, dan background. Isinya muncul di struk dan laporan.",
        "Transaksi: aturan penjualan dan pembelian, seperti izin stok minus, izin ubah harga dan diskon, poin, promo, jatuh tempo piutang, mode scan, Pilihan Home Screen, dan Aktifkan User Login. Tombol Jenis Non Tunai mengatur jenis pembayaran non tunai.",
        "Peralatan: header dan footer faktur, jenis printer, ukuran kertas struk, cash drawer, dan format angka.",
      ] },
      { p: "Klik Simpan setelah selesai. Sebagian pengaturan hanya berlaku di komputer yang Anda pakai, misalnya printer, ukuran kertas, cash drawer, format angka, mode scan, dan Home Screen. Pengaturan lainnya berlaku untuk semua komputer yang memakai data yang sama." },
      { p: "Akun Kasir bisa membuka pengaturan, tetapi hanya pengaturan per komputer yang tersimpan." },
    ],
  },
  {
    id: "pengguna", judul: "Pengguna dan hak akses",
    isi: [
      { p: "Buka Pengaturan, lalu Pengaturan Pengguna. Daftar pengguna ada di sebelah kiri, isian di sebelah kanan." },
      { ol: [
        "Pilih pengguna di daftar, atau klik Baru untuk menambah pengguna.",
        "Isi Nama Pengguna, Level, dan pilih karyawannya lewat tombol Pilih Karyawan. Kata sandi boleh dikosongkan untuk akun baru, dan pengguna itu masuk dengan kata sandi sementara.",
        "Di bagian Hak Akses, centang menu yang boleh dibuka pengguna itu. Centang Buka semua item menu untuk membuka semua cabangnya. Klik tanda panah di depan nama menu untuk membuka atau menutup satu cabang.",
        "Klik Simpan.",
      ] },
      { p: "Level ada tiga: Manager, Supervisor, dan Kasir. Hanya Manager yang bisa memberi, mengubah, atau menghapus akun Manager. Hak akses Manager tidak bisa dibatasi." },
      { p: "Pengguna baru mendapat centang menu sesuai levelnya. Anda bisa mengubahnya sebelum menyimpan." },
    ],
  },
  {
    id: "backup", judul: "Backup dan restore data",
    isi: [
      { p: "Backup membuat salinan semua data toko. Lakukan backup secara rutin, dan simpan salinannya di flash disk atau komputer lain." },
      { ol: [
        "Buka Pengaturan, lalu Alat Bantu Program.",
        "Pilih tab Backup Data.",
        "Cek folder tujuannya, lalu klik Backup.",
      ] },
      { p: "Di Pengaturan Database, centang Auto Backup saat keluar aplikasi supaya program membuat salinan setiap Anda menutupnya. Klik Simpan setelah mencentang." },
      { p: "Restore mengembalikan data dari salinan. Buka Alat Bantu Program, pilih tab Restore Data, pilih file backup, lalu klik Restore. Data Anda saat ini diganti dengan isi file itu, jadi program membuat salinan dari data sekarang lebih dulu." },
      { p: "Tab Hapus Data, SQL Editor, dan Hapus Transaksi di Alat Bantu Program tertulis merah dan ada di ujung kanan, karena ketiganya mengubah atau menghapus data secara langsung. Tab Perbaiki Data dan Import Data juga mengubah data. Pakai hanya kalau Anda paham akibatnya, dan lakukan backup dulu. Impor dari Excel ada di Impor Data Excel dan juga sebaiknya didahului backup." },
    ],
  },
];

function Isi({ b }: { b: Blok }): ReactNode {
  if ("p" in b) return <p className="my-2 max-w-3xl leading-relaxed text-foreground/90">{b.p}</p>;
  if ("ul" in b) return <ul className="my-2 max-w-3xl list-disc space-y-1 pl-5 text-foreground/90">{b.ul.map((x, i) => <li key={i}>{x}</li>)}</ul>;
  if ("ol" in b) return <ol className="my-2 max-w-3xl list-decimal space-y-1 pl-5 text-foreground/90">{b.ol.map((x, i) => <li key={i}>{x}</li>)}</ol>;
  return (
    <div className="my-2.5 max-w-3xl overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border bg-muted text-left font-semibold text-foreground">
            <th className="px-3 py-1.5">{b.kepala[0]}</th>
            <th className="px-3 py-1.5">{b.kepala[1]}</th>
          </tr>
        </thead>
        <tbody>
          {b.tabel.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-b-0">
              <td className="px-3 py-1.5 align-top font-semibold whitespace-nowrap text-foreground">{r[0]}</td>
              <td className="px-3 py-1.5 align-top text-foreground/90">{r[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Panduan Penggunaan: daftar isi di kiri, uraian di kanan. */
export function Panduan() {
  const [aktif, setAktif] = useState(BAGIAN[0].id);
  const area = useRef<HTMLDivElement>(null);
  const buka = (id: string) => {
    setAktif(id);
    area.current?.querySelector(`#pnd-${id}`)?.scrollIntoView({ block: "start" });
  };
  return (
    <div className="pnd flex h-full gap-2 bg-muted/40 p-2 font-sans text-xs text-foreground">
      <nav className="pnd-isi flex w-64 flex-none flex-col overflow-hidden rounded-md border border-border bg-card" aria-label="Daftar isi">
        <div className="pnd-isi-judul border-b border-border bg-muted/70 px-3 py-2 text-xs font-semibold text-foreground">Daftar Isi</div>
        <ul className="m-0 list-none divide-y divide-border/50 overflow-auto p-1">
          {BAGIAN.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                data-slot="pnd-nav-item"
                className={`block w-full rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors ${
                  aktif === b.id
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
                onClick={() => buka(b.id)}
              >
                {i + 1}. {b.judul}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="pnd-area min-w-0 flex-1 overflow-auto rounded-md border border-border bg-card px-6 pt-4 pb-12 text-[13px] leading-relaxed" ref={area}>
        <h1 className="text-lg font-bold text-foreground">Panduan Penggunaan</h1>
        <p className="pnd-awal mt-1 text-xs text-muted-foreground">Panduan ini untuk pemilik toko dan kasir. Klik judul di daftar isi untuk membuka bagian yang Anda perlukan.</p>
        {BAGIAN.map((b, i) => (
          <section key={b.id} id={`pnd-${b.id}`}>
            <h2 className="mt-6 mb-2 border-b border-border pb-1 text-sm font-semibold text-foreground">{i + 1}. {b.judul}</h2>
            {b.isi.map((x, k) => <Isi key={k} b={x} />)}
          </section>
        ))}
      </div>
    </div>
  );
}
