import { brParts } from "@/lib/domain/hours";
import type { Appointment, CommissionRule, ISODate, Package } from "@/lib/domain/types";

/**
 * Comissões. Igual a _commission_of e close_commissions no banco (20261114000014_commissions.sql):
 * vale a regra mais específica (profissional + serviço > serviço > profissional > geral); a base é o
 * valor do atendimento "atendido" no mês (horário de Brasília), ou o valor de uma sessão quando foi pelo pacote.
 */

export function ruleFor(
  rules: readonly CommissionRule[],
  resourceId: string,
  serviceId: string | null,
): CommissionRule | undefined {
  const score = (r: CommissionRule) =>
    (r.resourceId && r.serviceId ? 4 : 0) + (r.serviceId ? 2 : 0) + (r.resourceId ? 1 : 0);
  return rules
    .filter(
      (r) =>
        (r.resourceId === resourceId || r.resourceId === null) && (r.serviceId === serviceId || r.serviceId === null),
    )
    .sort((a, b) => score(b) - score(a))[0];
}

export function commissionOf(rule: CommissionRule | undefined, baseCents: number): number {
  if (!rule) return 0;
  // mesmo arredondamento do banco (round de numeric: metade para longe do zero)
  return rule.percentBp !== null ? Math.round((baseCents * rule.percentBp) / 10000) : (rule.fixedCents ?? 0);
}

/** Valor que conta para a comissão: o do atendimento, ou o de uma sessão do pacote. */
export function commissionBase(ap: Appointment, packages: readonly Package[]): number {
  if (ap.consumesPackage && ap.packageId) {
    const pkg = packages.find((p) => p.id === ap.packageId);
    if (pkg && pkg.sessionsTotal > 0) return Math.round(pkg.priceCents / pkg.sessionsTotal);
  }
  return ap.priceCents;
}

/** "2026-11-01" do mês do atendimento, no horário de Brasília. */
export function monthOf(iso: string): ISODate {
  return `${brParts(iso).date.slice(0, 7)}-01`;
}

export interface CommissionLine {
  appointment: Appointment;
  baseCents: number;
  amountCents: number;
}

export interface CommissionSummary {
  resourceId: string;
  month: ISODate;
  lines: CommissionLine[];
  baseCents: number;
  amountCents: number;
}

export function commissionSummary(p: {
  resourceId: string;
  month: ISODate;
  appointments: readonly Appointment[];
  packages: readonly Package[];
  rules: readonly CommissionRule[];
}): CommissionSummary {
  const lines = p.appointments
    .filter((a) => a.resourceId === p.resourceId && a.status === "compareceu" && monthOf(a.startsAt) === p.month)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((a) => {
      const base = commissionBase(a, p.packages);
      return {
        appointment: a,
        baseCents: base,
        amountCents: commissionOf(ruleFor(p.rules, p.resourceId, a.serviceId), base),
      };
    });
  return {
    resourceId: p.resourceId,
    month: p.month,
    lines,
    baseCents: lines.reduce((s, l) => s + l.baseCents, 0),
    amountCents: lines.reduce((s, l) => s + l.amountCents, 0),
  };
}

/** "40%" ou "R$ 10,00 por atendimento" */
export function ruleLabel(rule: CommissionRule, formatBRL: (c: number) => string): string {
  return rule.percentBp !== null
    ? `${(rule.percentBp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
    : `${formatBRL(rule.fixedCents ?? 0)} por atendimento`;
}

/** Mês que já terminou (só esses podem ser fechados). */
export function isPastMonth(month: ISODate, today: ISODate): boolean {
  return month < `${today.slice(0, 7)}-01`;
}
