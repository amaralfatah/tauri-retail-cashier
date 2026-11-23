import { ReactNode } from "react";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useTopEscape } from "../vb/VbGrid";

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  // Escape hanya menutup jendela paling atas, termasuk dialog VB yang sedang terbuka di bawahnya.
  useTopEscape(props.onClose);

  return (
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(ev) => ev.target === ev.currentTarget && props.onClose()}>
      <div role="dialog" aria-modal="true" aria-label={props.title}
        className={cn("vb-modern flex max-h-[92vh] w-full flex-col overflow-hidden rounded-lg border bg-background text-foreground shadow-2xl",
          props.wide ? "max-w-3xl" : "max-w-md")}>
        <header className="flex h-10 flex-none items-center gap-2 border-b bg-muted/40 pr-1.5 pl-4 select-none">
          <h2 className="flex-1 truncate text-sm font-medium">{props.title}</h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Tutup" onClick={props.onClose}><XIcon /></Button>
        </header>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4 text-sm">{props.children}</div>
        {props.footer && <footer className="flex flex-none justify-end gap-2 border-t bg-muted/30 px-4 py-3">{props.footer}</footer>}
      </div>
    </div>
  );
}

const ALERT_MODERN = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  ok: "border-success/30 bg-success/10 text-success",
  info: "border-border bg-muted text-foreground",
} as const;

export function Alert(props: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  if (!props.children) return null;
  const kind = props.kind ?? "error";
  return <div role="alert" className={cn("rounded-md border px-3 py-2 text-sm whitespace-pre-line", ALERT_MODERN[kind])}>{props.children}</div>;
}
