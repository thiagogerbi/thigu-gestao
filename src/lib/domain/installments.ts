import { addMonths, isISODate } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import type { ISODate, PlannedInstallment } from "@/lib/domain/types";

export const MAX_INSTALLMENTS = 36;

/**
 * Divide o total em N parcelas inteiras em centavos.
 * Os centavos que sobram da divisão vão para as primeiras parcelas,
 * garantindo soma exata (ex.: R$ 100,00 / 3 = 33,34 + 33,33 + 33,33).
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) throw new Error("Total deve ser inteiro positivo");
  if (!Number.isInteger(count) || count < 1) throw new Error("Quantidade de parcelas inválida");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function buildPlan(
  totalCents: number,
  count: number,
  firstDue: ISODate,
  intervalMonths = 1,
): PlannedInstallment[] {
  return splitEvenly(totalCents, count).map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    dueDate: addMonths(firstDue, i * intervalMonths),
  }));
}

export interface PlanCheck {
  ok: boolean;
  sumCents: number;
  differenceCents: number;
  errors: string[];
  /** Erros por parcela (índice) para mostrar perto do campo. */
  rowErrors: Record<number, string>;
}

export function checkPlan(plan: PlannedInstallment[], totalCents: number): PlanCheck {
  const errors: string[] = [];
  const rowErrors: Record<number, string> = {};
  if (plan.length === 0) errors.push("Informe pelo menos uma parcela.");
  if (plan.length > MAX_INSTALLMENTS) errors.push(`Use no máximo ${MAX_INSTALLMENTS} parcelas.`);
  plan.forEach((p, i) => {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) rowErrors[i] = "Informe um valor maior que zero.";
    else if (!isISODate(p.dueDate)) rowErrors[i] = "Informe uma data de vencimento válida.";
    if (p.number !== i + 1) errors.push("A numeração das parcelas está fora de ordem.");
  });
  const sumCents = plan.reduce((s, p) => s + (Number.isInteger(p.amountCents) ? p.amountCents : 0), 0);
  const differenceCents = totalCents - sumCents;
  if (differenceCents > 0)
    errors.push(`A soma das parcelas está ${formatBRL(differenceCents)} abaixo do valor da venda.`);
  if (differenceCents < 0) errors.push(`A soma das parcelas passa ${formatBRL(-differenceCents)} do valor da venda.`);
  return {
    ok: errors.length === 0 && Object.keys(rowErrors).length === 0,
    sumCents,
    differenceCents,
    errors: [...new Set(errors)],
    rowErrors,
  };
}
