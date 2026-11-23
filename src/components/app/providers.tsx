import { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

/** Penyedia global untuk komponen shadcn. Dipasang sekali di src/main.tsx. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={400}>
      {children}
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  );
}
