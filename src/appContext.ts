import { createContext, useContext } from "react";
import type { Row, User } from "./api";
import type { Page } from "./vb/shell";

export interface AppCtxValue {
  user: User;
  setting: Row;
  reloadSetting: () => Promise<void>;
  go: (p: Page) => void;
}
export const AppCtx = createContext<AppCtxValue | null>(null);
export const useApp = () => useContext(AppCtx)!;
