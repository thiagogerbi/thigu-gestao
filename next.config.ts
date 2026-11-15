import path from "node:path";
import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/** Origem do projeto Supabase (o navegador fala com ele só na tela de login). */
function supabaseOrigins(): string[] {
  try {
    const { origin } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "");
    return [origin, origin.replace(/^http/, "ws")];
  } catch {
    return [];
  }
}

/**
 * Content-Security-Policy: o navegador só carrega e só envia dados para o próprio site e o Supabase.
 * Limite conhecido: scripts e estilos embutidos na página continuam liberados ('unsafe-inline'), porque
 * o Next os usa e bloqueá-los exige um código por requisição (nonce), o que impediria gerar a prévia
 * como página estática. Ainda assim, a política barra scripts de outros sites, envio de dados para
 * fora, objetos embutidos e o site dentro de molduras.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  // em desenvolvimento o Next recarrega o código com eval e WebSocket
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // data: e blob: cobrem o logotipo da empresa, que é guardado como data URL
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  ["connect-src 'self'", ...supabaseOrigins(), ...(dev ? ["ws:", "wss:"] : [])].join(" "),
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname) },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
