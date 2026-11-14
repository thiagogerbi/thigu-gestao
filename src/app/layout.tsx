import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Thigu Gestão", template: "%s · Thigu Gestão" },
  description: "Gestão simples. Negócios em movimento. CRM e Financeiro integrados para pequenas empresas.",
  // no iPhone, "Adicionar à Tela de Início" abre em tela cheia com este nome (o ícone é src/app/apple-icon.png)
  appleWebApp: { capable: true, title: "Thigu", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#142D4E",
  width: "device-width",
  initialScale: 1,
  // deixa o app ocupar a tela toda; as barras fixas respeitam as áreas seguras (env(safe-area-inset-*))
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
