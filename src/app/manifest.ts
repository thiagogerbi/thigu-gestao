import type { MetadataRoute } from "next";

/**
 * Permite "Adicionar à tela inicial" no celular: o Thigu abre em tela cheia, como um aplicativo,
 * sem passar por loja. Não há funcionamento sem internet (os dados vêm sempre do servidor).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Thigu Gestão",
    short_name: "Thigu",
    description: "Clientes, negociações, propostas e o dinheiro recebido no mesmo lugar.",
    lang: "pt-BR",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F8FC",
    theme_color: "#142D4E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // "maskable": fundo inteiro, para o Android recortar no formato do aparelho sem cortar o símbolo
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
