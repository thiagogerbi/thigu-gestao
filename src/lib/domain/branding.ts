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

/** Escurece a cor até o texto branco atingir o contraste pedido. */
function darkenForWhiteText(hex: string, min: number): string {
  const base = hex.toLowerCase();
  let out = base;
  for (let t = 0.04; contrastRatio(out, "#ffffff") < min && t <= 1; t += 0.04) out = mix(base, "#000000", t);
  return out;
}

/** Tons derivados da cor da marca, sempre com texto branco legível sobre o tom principal. */
export function brandPalette(hex: string): BrandPalette {
  const base = hex.toLowerCase();
  const primary = darkenForWhiteText(base, MIN_CONTRAST);
  return {
    primary,
    primary700: mix(primary, "#000000", 0.2),
    primary50: mix(primary, "#ffffff", 0.92),
    adjusted: primary !== base,
  };
}

// ---------------------------------------------------------------- Menu lateral

export const THIGU_NAVY = "#142d4e";
/** O menu tem textos menores e em branco translúcido, por isso pede contraste maior (AAA, 7:1). */
export const MENU_MIN_CONTRAST = 7;

/** Sugestões para o menu. "Automático" (null) usa um tom escuro da cor da marca. */
export const MENU_PRESETS: { hex: string; label: string }[] = [
  { hex: THIGU_NAVY, label: "Azul-escuro" },
  { hex: "#1f2937", label: "Grafite" },
  { hex: "#111111", label: "Preto" },
  { hex: "#14532d", label: "Verde-escuro" },
  { hex: "#3b0764", label: "Roxo-escuro" },
  { hex: "#4c0519", label: "Vinho-escuro" },
];

export interface MenuPalette {
  navy: string;
  navy700: string;
  navy600: string;
  /** true quando a cor escolhida foi escurecida para ficar legível. */
  adjusted: boolean;
}

/**
 * Cor do menu lateral (e de tudo que usa o tom escuro: avisos, dicas, títulos da proposta).
 * menuColor null = automático: tom escuro da cor da marca; sem cor da marca, o azul-escuro original.
 */
export function menuPalette(brandColor: string | null, menuColor: string | null): MenuPalette {
  const brand = brandColor && isHexColor(brandColor) ? brandColor.toLowerCase() : THIGU_BLUE;
  const chosen = menuColor && isHexColor(menuColor) ? menuColor.toLowerCase() : null;
  const base = chosen ?? (brand === THIGU_BLUE ? THIGU_NAVY : mix(brandPalette(brand).primary, "#000000", 0.55));
  const navy = darkenForWhiteText(base, MENU_MIN_CONTRAST);
  return {
    navy,
    navy700: mix(navy, "#ffffff", 0.1),
    navy600: mix(navy, "#ffffff", 0.22),
    adjusted: chosen !== null && navy !== chosen,
  };
}

/** CSS que troca os tons do tema pela identidade da empresa. Só gera hex calculado, nunca texto livre. */
export function brandCss(brandColor: string | null | undefined, menuColor: string | null = null): string | null {
  const brand = brandColor && isHexColor(brandColor) ? brandColor.toLowerCase() : null;
  const vars: string[] = [];
  if (brand && brand !== THIGU_BLUE) {
    const p = brandPalette(brand);
    vars.push(
      `--color-primary:${p.primary}`,
      `--color-primary-700:${p.primary700}`,
      `--color-primary-50:${p.primary50}`,
    );
  }
  const m = menuPalette(brand, menuColor);
  if (m.navy !== THIGU_NAVY) {
    vars.push(`--color-navy:${m.navy}`, `--color-navy-700:${m.navy700}`, `--color-navy-600:${m.navy600}`);
  }
  return vars.length ? `:root{${vars.join(";")};}` : null;
}

/** Iniciais para quando a empresa ainda não tem logotipo ("Aurora Estúdio" → "AE"). */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
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
