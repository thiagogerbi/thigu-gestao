/**
 * Identidade visual da empresa: cor da marca e logotipo.
 * A empresa escolhe UMA cor; daqui saem os tons usados nos botões, links e destaques.
 * Se a cor for clara demais para texto branco, ela é escurecida até ficar legível (WCAG AA, 4,5:1).
 * O verde do dinheiro, os alertas e o menu escuro não mudam: eles carregam significado.
 */

export const THIGU_BLUE = "#3563e9";

/** Sugestões prontas, todas com contraste suficiente para texto branco. */
export const BRAND_PRESETS: { hex: string; label: string }[] = [
  { hex: THIGU_BLUE, label: "Azul Thigu (padrão)" },
  { hex: "#1e40af", label: "Azul-marinho" },
  { hex: "#0f766e", label: "Verde-petróleo" },
  { hex: "#6d28d9", label: "Roxo" },
  { hex: "#be185d", label: "Rosa" },
  { hex: "#9f1239", label: "Vinho" },
  { hex: "#c2410c", label: "Laranja" },
  { hex: "#334155", label: "Grafite" },
];

export const MIN_CONTRAST = 4.5;
const HEX_RE = /^#[0-9a-f]{6}$/i;

type RGB = [number, number, number];

export function isHexColor(v: string): boolean {
  return HEX_RE.test(v);
}

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.round(Math.min(255, Math.max(0, c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Luminância relativa (WCAG 2.x). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mistura a cor com outra (t = 0 mantém, t = 1 vira a outra). */
function mix(hex: string, other: string, t: number): string {
  const a = toRgb(hex);
  const b = toRgb(other);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB);
}

export interface BrandPalette {
  primary: string;
  primary700: string;
  primary50: string;
  /** true quando a cor escolhida foi escurecida para ficar legível. */
  adjusted: boolean;
}

/** Tons derivados da cor da marca, sempre com texto branco legível sobre o tom principal. */
export function brandPalette(hex: string): BrandPalette {
  const base = hex.toLowerCase();
  let primary = base;
  for (let t = 0.04; contrastRatio(primary, "#ffffff") < MIN_CONTRAST && t <= 1; t += 0.04) {
    primary = mix(base, "#000000", t);
  }
  return {
    primary,
    primary700: mix(primary, "#000000", 0.2),
    primary50: mix(primary, "#ffffff", 0.92),
    adjusted: primary !== base,
  };
}

/** CSS que troca os tons de ação do tema. Só gera hex validado, nunca texto livre. */
export function brandCss(hex: string | null | undefined): string | null {
  if (!hex || !isHexColor(hex) || hex.toLowerCase() === THIGU_BLUE) return null;
  const p = brandPalette(hex);
  return `:root{--color-primary:${p.primary};--color-primary-700:${p.primary700};--color-primary-50:${p.primary50};}`;
}

// ---------------------------------------------------------------- Logotipo

export const LOGO_MAX_WIDTH = 600;
export const LOGO_MAX_HEIGHT = 240;
/** Tamanho máximo do data URL (≈ 300 KB de imagem). O banco aceita até 400.000 caracteres. */
export const LOGO_MAX_CHARS = 400_000;
export const LOGO_DATA_URL_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/** Dimensões finais do logotipo, mantendo a proporção e sem ampliar imagens pequenas. */
export function fitLogo(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LOGO_MAX_WIDTH / width, LOGO_MAX_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
