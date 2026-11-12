import { accountStatus, balanceCents } from "@/lib/domain/accounts";
import { addDays, diffDays, toISODate } from "@/lib/domain/dates";
import { isOpenStage, staleReason } from "@/lib/domain/deals";
import type { CompanyData, ISODate } from "@/lib/domain/types";

export interface Overview {
  /** Vendas fechadas (inclui as que aguardam conferência). Não é dinheiro recebido. */
  soldCents: number;
  salesCount: number;
  /** Parte das vendas fechadas que ainda não virou conta a receber. */
  awaitingReviewCents: number;
  awaitingReviewCount: number;
  /** Dinheiro que efetivamente entrou (recebimentos registrados e não desfeitos). */
  receivedCents: number;
  /** Dinheiro que efetivamente saiu. */
  paidOutCents: number;
  /** Caixa realizado = entradas registradas − saídas registradas. */
  cashCents: number;
  /** Saldo em aberto de contas a receber confirmadas. */
  toReceiveCents: number;
  overdueReceivablesCents: number;
  overdueReceivablesCount: number;
  toPayCents: number;
  overduePayablesCount: number;
  dueSoonPayablesCount: number;
  /** Negociações abertas (incertas) — nunca somadas a recebíveis. */
  pipelineCents: number;
  openDealsCount: number;
  staleDealsCount: number;
  proposalsToFollow: { proposalId: string; clientId: string; daysSinceSent: number }[];
  tasksToday: number;
  tasksOverdue: number;
  forecast: { days: number; inCents: number; outCents: number; netCents: number }[];
  onboarding: { client: boolean; deal: boolean; proposal: boolean; receipt: boolean };
}

export function computeOverview(data: CompanyData, today: ISODate): Overview {
  const activeSales = data.sales.filter((s) => s.status !== "cancelada");
  const awaiting = activeSales.filter((s) => s.status === "aguardando_conferencia");
  const activeMovs = data.movements.filter((m) => !m.undoneAt);
  const receivedCents = activeMovs.filter((m) => m.direction === "entrada").reduce((s, m) => s + m.amountCents, 0);
  const paidOutCents = activeMovs.filter((m) => m.direction === "saida").reduce((s, m) => s + m.amountCents, 0);

  let toReceiveCents = 0;
  let overdueReceivablesCents = 0;
  let overdueReceivablesCount = 0;
  let toPayCents = 0;
  let overduePayablesCount = 0;
  let dueSoonPayablesCount = 0;
  const horizons = [7, 30, 90];
  const forecast = horizons.map((days) => ({ days, inCents: 0, outCents: 0, netCents: 0 }));

  for (const acc of data.accounts) {
    const bal = balanceCents(acc, data.movements);
    if (bal <= 0) continue;
    const st = accountStatus(acc, data.movements, today);
    if (acc.kind === "receber") {
      toReceiveCents += bal;
      if (st === "atrasada") {
        overdueReceivablesCents += bal;
        overdueReceivablesCount++;
      }
    } else {
      toPayCents += bal;
      if (st === "atrasada") overduePayablesCount++;
      else if (diffDays(today, acc.dueDate) <= 7) dueSoonPayablesCount++;
    }
    forecast.forEach((f) => {
      if (acc.dueDate <= addDays(today, f.days)) {
        if (acc.kind === "receber") f.inCents += bal;
        else f.outCents += bal;
      }
    });
  }
  forecast.forEach((f) => (f.netCents = cashOf(receivedCents, paidOutCents) + f.inCents - f.outCents));

  const openDeals = data.deals.filter((d) => isOpenStage(d.stage));
  const proposalsToFollow = data.proposals
    .filter((p) => p.status === "enviada" && p.sentAt)
    .map((p) => ({
      proposalId: p.id,
      clientId: p.clientId,
      daysSinceSent: diffDays(toISODate(new Date(p.sentAt!)), today),
    }))
    .sort((a, b) => b.daysSinceSent - a.daysSinceSent);

  const openTasks = data.tasks.filter((t) => t.status === "aberta");

  return {
    soldCents: activeSales.reduce((s, x) => s + x.totalCents, 0),
    salesCount: activeSales.length,
    awaitingReviewCents: awaiting.reduce((s, x) => s + x.totalCents, 0),
    awaitingReviewCount: awaiting.length,
    receivedCents,
    paidOutCents,
    cashCents: cashOf(receivedCents, paidOutCents),
    toReceiveCents,
    overdueReceivablesCents,
    overdueReceivablesCount,
    toPayCents,
    overduePayablesCount,
    dueSoonPayablesCount,
    pipelineCents: openDeals.reduce((s, d) => s + d.valueCents, 0),
    openDealsCount: openDeals.length,
    staleDealsCount: openDeals.filter((d) => staleReason(d, today)).length,
    proposalsToFollow,
    tasksToday: openTasks.filter((t) => t.dueDate === today).length,
    tasksOverdue: openTasks.filter((t) => t.dueDate < today).length,
    forecast,
    onboarding: {
      client: data.clients.length > 0,
      deal: data.deals.length > 0,
      proposal: data.proposals.length > 0,
      receipt: data.movements.some((m) => m.direction === "entrada"),
    },
  };
}

function cashOf(inc: number, out: number) {
  return inc - out;
}
