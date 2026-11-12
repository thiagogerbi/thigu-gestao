import type { ProposalItem } from "@/lib/domain/types";

/** Quantidade pode ter até 2 casas decimais (ex.: 1,5 hora). Cálculo em centavos, arredondado por item. */
export function itemTotalCents(item: ProposalItem): number {
  // quantidade em centésimos (inteiro) × preço em centavos, dividido por 100 com arredondamento comercial
  const qtyHundredths = Math.round(item.quantity * 100);
  return Math.round((qtyHundredths * item.unitCents) / 100);
}

export function proposalSubtotalCents(items: ProposalItem[]): number {
  return items.reduce((s, it) => s + itemTotalCents(it), 0);
}

export function proposalTotalCents(items: ProposalItem[], discountCents: number): number {
  return Math.max(0, proposalSubtotalCents(items) - discountCents);
}

export interface ProposalErrors {
  items?: string;
  rows: Record<number, { description?: string; quantity?: string; unit?: string }>;
  discount?: string;
  validUntil?: string;
}

export function validateProposal(items: ProposalItem[], discountCents: number, validUntil: string): ProposalErrors {
  const errs: ProposalErrors = { rows: {} };
  if (items.length === 0) errs.items = "Adicione pelo menos um serviço ou item.";
  items.forEach((it, i) => {
    const row: ProposalErrors["rows"][number] = {};
    if (!it.description.trim()) row.description = "Descreva o serviço ou item.";
    if (!(it.quantity > 0) || Math.round(it.quantity * 100) !== it.quantity * 100)
      row.quantity = "Use uma quantidade maior que zero (até 2 casas decimais).";
    if (!Number.isInteger(it.unitCents) || it.unitCents < 0) row.unit = "Informe o preço, por exemplo 150,00.";
    if (Object.keys(row).length) errs.rows[i] = row;
  });
  const subtotal = proposalSubtotalCents(items);
  if (!Number.isInteger(discountCents) || discountCents < 0) errs.discount = "O desconto não pode ser negativo.";
  else if (discountCents > subtotal) errs.discount = "O desconto não pode ser maior que o subtotal.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) errs.validUntil = "Informe até quando a proposta vale.";
  return errs;
}

export function hasProposalErrors(e: ProposalErrors): boolean {
  return Boolean(e.items || e.discount || e.validUntil || Object.keys(e.rows).length);
}
