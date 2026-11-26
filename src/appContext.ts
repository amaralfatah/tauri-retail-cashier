import { createContext, useContext } from "react";
import type { Row, User } from "./api";
import type { Page } from "./vb/shell";

export interface KontakAwal {
  kode: string;
  nama: string;
}

export interface AppCtxValue {
  user: User;
  setting: Row;
  reloadSetting: () => Promise<void>;
  go: (p: Page, kontak?: KontakAwal) => void;
}
export const AppCtx = createContext<AppCtxValue | null>(null);
export const useApp = () => useContext(AppCtx)!;
