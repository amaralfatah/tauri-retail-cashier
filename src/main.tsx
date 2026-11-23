// index.css (Tailwind + tema shadcn) dimuat paling awal supaya urutan CSS selalu sama.
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProviders } from "@/components/app/providers";
import { initTheme } from "@/lib/theme";
import { terapkanUkuran } from "@/lib/ukuranTampilan";

initTheme();

// Dibuka di browser biasa saat pengembangan: tiru backend Tauri supaya tampilan bisa dilihat.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./dev/tauriMock");

// Ukuran tampilan yang dipilih di Pengaturan berlaku untuk seluruh jendela sejak aplikasi dibuka.
void terapkanUkuran();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);
