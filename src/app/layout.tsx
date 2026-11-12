import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Thigu Gestão", template: "%s · Thigu Gestão" },
  description: "Gestão simples. Negócios em movimento. CRM e Financeiro integrados para pequenas empresas.",
};

export const viewport: Viewport = { themeColor: "#142D4E", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
