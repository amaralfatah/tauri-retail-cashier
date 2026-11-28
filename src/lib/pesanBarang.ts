/** Pesan saat kode atau barcode yang di-scan tidak cocok dengan barang yang bisa dipakai. */
export function pesanKodeTidakAda(kode: string, opsi: { stokHabis?: boolean; nonaktif?: boolean } = {}): string {
  const k = kode.trim();
  const barang = k ? `Barang dengan kode "${k}"` : "Barang ini";
  const sebab = opsi.stokHabis ? "tidak ada, tidak aktif, atau stoknya habis" : opsi.nonaktif === false ? "tidak ada" : "tidak ada atau tidak aktif";
  return `${barang} ${sebab}. Periksa kodenya, atau tekan F10 untuk mencari barang.`;
}
