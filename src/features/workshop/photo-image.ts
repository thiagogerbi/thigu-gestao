import { PHOTO_MAX_CHARS } from "@/lib/domain/work-orders";

const MAX_SIDE = 1280;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não conseguimos abrir esta foto. Tente outra."));
    img.src = src;
  });
}

/**
 * Prepara a foto no celular antes de enviar: reduz o lado maior para 1280 px e regrava em WebP
 * (ou JPEG), baixando a qualidade até caber no limite. A foto original nunca sai do aparelho.
 */
export async function prepareWorkOrderPhoto(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Escolha uma foto.");
  if (file.size > MAX_FILE_BYTES) throw new Error("A foto passa de 15 MB. Escolha outra.");
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || MAX_SIDE;
    const h = img.naturalHeight || MAX_SIDE;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Seu navegador não conseguiu preparar a foto.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const type of ["image/webp", "image/jpeg"]) {
      for (const quality of [0.82, 0.7, 0.55, 0.4]) {
        const out = canvas.toDataURL(type, quality);
        if (!out.startsWith(`data:${type}`)) break; // o navegador não gera este formato
        if (out.length <= PHOTO_MAX_CHARS) return out;
      }
    }
    throw new Error("A foto ficou grande demais mesmo depois de reduzida. Tente outra.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
