/** Utilitários de estilo sem estado: podem ser usados no servidor e no navegador. */
export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/**
 * Para usar como `ref` da aba ou filtro selecionado: numa linha que rola de lado (celular),
 * garante que o item escolhido esteja visível.
 */
export function keepInView(el: HTMLElement | null) {
  const row = el?.parentElement;
  if (!el || !row) return;
  // rola só a linha, de lado; a página não sai do lugar
  const item = el.getBoundingClientRect();
  const view = row.getBoundingClientRect();
  if (item.left < view.left) row.scrollLeft -= view.left - item.left + 16;
  else if (item.right > view.right) row.scrollLeft += item.right - view.right + 16;
}

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "money";
const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-700 shadow-sm",
  money: "bg-money-700 text-white hover:bg-[#0b6448] shadow-sm",
  secondary: "bg-white text-ink border border-line hover:bg-canvas",
  ghost: "text-primary-700 hover:bg-primary-50",
  danger: "bg-danger text-white hover:bg-[#8f1b12]",
};
// no celular o botão pequeno também tem 44px de altura, o mínimo confortável para o dedo
export const SIZE = {
  sm: "min-h-11 px-3.5 text-sm sm:min-h-9 sm:px-3",
  md: "min-h-11 px-4 text-[15px]",
  lg: "min-h-12 px-5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: keyof typeof SIZE = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100",
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}
