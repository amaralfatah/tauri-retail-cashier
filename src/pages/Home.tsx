import { useState } from "react";
import { VbForm } from "../vb/VbForm";
import { getLocal } from "./localSettings";
import { Dashboard } from "./Dashboard";

/**
 * FrmZHome asli hanya berisi gambar latar, pesan "DEMO VERSION", info registrasi SMS dan
 * gambar iklan. Semuanya tidak dipakai di versi ini, jadi yang tampil hanya latar kosongnya.
 * Kalau di Pengaturan Program pilihan Home = Dashboard, yang tampil Analytic Dashboard.
 */
export function Home() {
  const [tutup, setTutup] = useState(false);
  if (getLocal("home") === "Dashboard" && !tutup) return <Dashboard onTutup={() => setTutup(true)} />;
  return <VbForm form="FrmZHome" fill hide={["picImg1", "picImg2", "picImg3"]} />;
}
