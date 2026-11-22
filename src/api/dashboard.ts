import { invoke } from "@tauri-apps/api/core";
import type { Row } from "../api";

export const dashApi = {
  data: (tgl: string) => invoke<Row>("dashboard_data", { tgl }),
  notifikasi: (tgl: string) => invoke<Row>("notifikasi", { tgl }),
};
