import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { VbForm } from "../vb/VbForm";
import "./splash.css";

/**
 * FrmZSplash: layar pembuka beberapa saat sebelum halaman masuk. Teks "Demo Version",
 * "supported by" dan logo pihak lain dari aslinya tidak dipakai. Tempat tulisan "Demo Version"
 * dipakai untuk nama toko.
 */
export function Splash(props: { namaUsaha?: string }) {
  const [versi, setVersi] = useState("");
  useEffect(() => { getVersion().then(setVersi).catch(() => undefined); }, []);
  return (
    <div className="splash-latar">
      <div className="splash-kotak">
        <VbForm
          form="FrmZSplash"
          hide={["lblSupport", "imgLogo", "Image2"]}
          bind={{
            lblVer: { text: "Pro" },
            lblBuild: { text: versi ? `Unlimited   v${versi}` : "Unlimited" },
            lblDemo: () => <div className="vb-label splash-toko">{props.namaUsaha ?? ""}</div>,
          }}
        />
      </div>
    </div>
  );
}
