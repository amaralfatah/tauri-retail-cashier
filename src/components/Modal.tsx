import { ReactNode } from "react";
import { useTopEscape } from "../vb/VbGrid";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  // Escape hanya menutup jendela paling atas, termasuk dialog VB yang sedang terbuka di bawahnya.
  useTopEscape(props.onClose);

  return (
    <div className="modal-backdrop no-print" onMouseDown={(ev) => ev.target === ev.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <header className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label="Tutup">×</button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Alert(props: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  if (!props.children) return null;
  return <div className={`alert alert-${props.kind ?? "error"}`} role="alert">{props.children}</div>;
}
