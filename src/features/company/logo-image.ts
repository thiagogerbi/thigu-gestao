import { fitLogo, LOGO_MAX_CHARS } from "@/lib/domain/branding";

const ACCEPTED = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não conseguimos abrir esta imagem. Tente outro arquivo."));
    img.src = src;
  });
}

/**
 * Prepara o logotipo no navegador: reduz para no máximo 600 × 240 px e regrava a imagem
 * (WebP, ou PNG se o navegador não gerar WebP). Regravar no canvas também descarta qualquer
 * conteúdo ativo de um SVG: o que vai para o banco é sempre uma imagem simples.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!ACCEPTED.test(file.type)) throw new Error("Use uma imagem PNG, JPG, WebP ou SVG.");
  if (file.size > MAX_FILE_BYTES) throw new Error("A imagem passa de 5 MB. Escolha um arquivo menor.");

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || 600;
    const h = img.naturalHeight || 240;
    const size = fitLogo(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a imagem.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, size.width, size.height);

    for (const quality of [0.92, 0.8, 0.65]) {
      const out = canvas.toDataURL("image/webp", quality);
      if (out.length <= LOGO_MAX_CHARS) return out;
      if (!out.startsWith("data:image/webp")) break; // navegador devolveu PNG; qualidade não muda nada
    }
    throw new Error("A imagem ficou grande demais mesmo depois de reduzida. Tente um logotipo mais simples.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
