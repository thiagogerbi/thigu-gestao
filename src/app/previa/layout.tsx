import { AppShell } from "@/components/layout/app-shell";
import { PreviewBackend } from "@/state/preview-backend";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prévia",
  robots: { index: false },
};

/** Prévia navegável: sem login, sem banco, sem Supabase. Dados fictícios em memória. */
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreviewBackend>
      <AppShell>{children}</AppShell>
    </PreviewBackend>
  );
}
