/** Utilitários de estilo sem estado: podem ser usados no servidor e no navegador. */
export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "money";
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-700 shadow-sm",
  money: "bg-money-700 text-white hover:bg-[#0b6448] shadow-sm",
  secondary: "bg-white text-ink border border-line hover:bg-canvas",
  ghost: "text-primary-700 hover:bg-primary-50",
  danger: "bg-danger text-white hover:bg-[#8f1b12]",
};
export const SIZE = { sm: "min-h-9 px-3 text-sm", md: "min-h-11 px-4 text-[15px]", lg: "min-h-12 px-5 text-base" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof SIZE = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}
