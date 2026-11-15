import type { KeyboardEvent } from "react";

/**
 * Teclado para grupos de abas (role="tablist"): setas esquerda/direita, Home e End trocam de aba,
 * como em qualquer aplicativo. Use no elemento com role="tablist" e dê tabIndex 0 só à aba
 * selecionada (as outras ficam com -1), para que Tab entre no grupo uma vez e siga para o conteúdo.
 */
export function onTabListKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (current + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
}
