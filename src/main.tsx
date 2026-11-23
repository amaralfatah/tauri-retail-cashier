// index.css (Tailwind + tema shadcn) dimuat paling awal supaya urutan CSS selalu sama.
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProviders } from "@/components/app/providers";
import { initTheme } from "@/lib/theme";
import { terapkanUkuran } from "@/lib/ukuranTampilan";
import { mulaiPantauPusat } from "@/lib/statusPusat";

initTheme();

// Dibuka di browser biasa saat pengembangan: tiru backend Tauri supaya tampilan bisa dilihat.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./dev/tauriMock");

// Ukuran tampilan yang dipilih di Pengaturan berlaku untuk seluruh jendela sejak aplikasi dibuka.
void terapkanUkuran();

// Tanggal transaksi memakai jam Pusat. Diperbarui setiap status sambungan berubah (Pusat menjawab `/halo` berkala).
mulaiPantauPusat();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
