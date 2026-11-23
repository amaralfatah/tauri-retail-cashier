import { useSyncExternalStore } from "react";

/**
 * Tema tampilan: terang, gelap, atau ikut pengaturan sistem operasi.
 * Mode gelap aktif lewat kelas `dark` di <html> (lihat `@custom-variant dark` di src/index.css).
 * Pengganti `next-themes`, yang dibuat untuk Next.js.
 */
export type Theme = "light" | "dark" | "system";

const KEY = "tokopro.tema";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* penyimpanan tidak tersedia */ }
  return "light";
}

let current: Theme = stored();

function apply() {
  const dark = current === "dark" || (current === "system" && media().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Panggil sekali sebelum render pertama supaya tidak ada kedipan warna. */
export function initTheme() {
  apply();
  media().addEventListener("change", () => {
    if (current !== "system") return;
    apply();
    listeners.forEach((l) => l());
  });
}

export function setTheme(t: Theme) {
  current = t;
  try { localStorage.setItem(KEY, t); } catch { /* penyimpanan tidak tersedia */ }
  apply();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** `theme` = pilihan pengguna, `resolvedTheme` = yang sedang tampil. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current);
  const resolvedTheme = useSyncExternalStore(subscribe, () =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  return { theme, resolvedTheme, setTheme } as const;
}
