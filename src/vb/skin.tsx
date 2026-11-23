import { createContext, useContext } from "react";

/**
 * Skin tampilan form VB. Semua layar memakai "modern": komponen shadcn dengan tema src/index.css.
 * Tata letak (posisi dan ukuran kontrol) tetap sama dengan form VB asli.
 * Konteks ini masih ada supaya kode yang memanggil useModern() tetap jalan.
 */
export type VbSkin = "modern";

const SkinContext = createContext<VbSkin>("modern");

export const VbSkinProvider = SkinContext.Provider;

export function useVbSkin(): VbSkin {
  return useContext(SkinContext);
}

export function useModern(): boolean {
  return useContext(SkinContext) === "modern";
}
