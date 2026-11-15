import type { CashSession, Movement, PaymentMethod } from "@/lib/domain/types";

/**
 * Caixa do dia. O esperado na gaveta é o troco inicial mais o que entrou em dinheiro na sessão
 * (igual a close_cash no banco). Cartão, Pix e outros entram nos totais, mas não na gaveta.
 */

export function sessionMovements(session: Pick<CashSession, "id">, movements: readonly Movement[]): Movement[] {
  return movements.filter((m) => m.cashSessionId === session.id && !m.undoneAt);
}

export function expectedCash(session: CashSession, movements: readonly Movement[]): number {
  return (
    session.openingCents +
    sessionMovements(session, movements)
      .filter((m) => m.method === "dinheiro")
      .reduce((s, m) => s + (m.direction === "entrada" ? m.amountCents : -m.amountCents), 0)
  );
}

/** Total recebido na sessão, por forma de pagamento. */
export function totalsByMethod(
  session: Pick<CashSession, "id">,
  movements: readonly Movement[],
): Partial<Record<PaymentMethod, number>> {
  const out: Partial<Record<PaymentMethod, number>> = {};
  for (const m of sessionMovements(session, movements)) {
    out[m.method] = (out[m.method] ?? 0) + (m.direction === "entrada" ? m.amountCents : -m.amountCents);
  }
  return out;
}

export const openSession = (sessions: readonly CashSession[]) => sessions.find((s) => !s.closedAt);

export const MAX_SALE_ITEMS = 30;

/** Contas que o balcão costuma cobrar: atendimentos, pacotes, mensalidades e vendas do próprio caixa (igual ao banco). */
export const COUNTER_ORIGINS = ["atendimento", "pacote", "mensalidade", "caixa", "crediario", "pedido"] as const;
