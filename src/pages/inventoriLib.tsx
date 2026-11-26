import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errText, Row } from "../api";
import { Modal } from "../components/Modal";
import { FilterVal, FilterWindow, matchFilter } from "./MasterFilter";
import { loadAll } from "./masterLib";

/** 2026-11-22 menjadi 22/11/2026; teks yang bukan tanggal dikembalikan apa adanya. */
export function tglIso2Id(iso: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? "");
}

/** 22/11/2026 (atau 22-11-2026, 22.11.2026) menjadi 2026-11-22; kosong kalau bukan tanggal yang sah. */
export function tglId2Iso(txt: string): string {
  const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\s*$/.exec(txt);
  if (!m) return "";
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
  if (d.getFullYear() !== y || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${y}-${p(Number(m[2]))}-${p(Number(m[1]))}`;
}

/**
 * Filter Barang seperti aslinya (FrmFilterBarang): kode, barcode, nama, jenis, kelompok, kategori, satuan, pemasok, status, dan rentang stok.
 * Tanpa isian apa pun, semua barang masuk, termasuk yang nonaktif dan jasa.
 */
export function FilterBarang(props: { onClose: () => void; onAdd: (rows: Row[]) => void }) {
  const [err, setErr] = useState("");
  const terapkan = async (f: FilterVal) => {
    try {
      const semua = await loadAll("mdbarang", { sort: "kodebarang" });
      props.onAdd(semua.filter((r) => matchFilter("mdbarang", f, r)));
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <>
      <FilterWindow table="mdbarang" rows={[]} value={{}} onApply={(f) => void terapkan(f)} onClose={props.onClose} />
      {err && <Modal title="Informasi" onClose={() => setErr("")} footer={<Button autoFocus onClick={() => setErr("")}>Tutup</Button>}><p>{err}</p></Modal>}
    </>
  );
}
