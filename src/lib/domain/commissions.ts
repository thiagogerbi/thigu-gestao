import { brParts } from "@/lib/domain/hours";
import type { Appointment, CommissionRule, ISODate, Package, WorkOrder, WorkOrderItem } from "@/lib/domain/types";

/**
 * Comissões. Igual a _commission_of e close_commissions no banco (20261114000015_commissions.sql):
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
  key: string;
  /** Quando aconteceu: o atendimento ou a entrega da OS. */
  at: string;
  serviceId: string | null;
  /** Atendimento da agenda (ou null, quando é mão de obra de uma OS). */
  appointment: Appointment | null;
  /** Mão de obra de uma OS entregue (oficina). */
  workOrder: WorkOrder | null;
  item: WorkOrderItem | null;
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
  /** Oficina: mão de obra aprovada das OS entregues no mês (igual a close_commissions no banco). */
  workOrders?: readonly WorkOrder[];
  workOrderItems?: readonly WorkOrderItem[];
}): CommissionSummary {
  const fromAppointments: CommissionLine[] = p.appointments
    .filter((a) => a.resourceId === p.resourceId && a.status === "compareceu" && monthOf(a.startsAt) === p.month)
    .map((a) => {
      const base = commissionBase(a, p.packages);
      return {
        key: a.id,
        at: a.startsAt,
        serviceId: a.serviceId,
        appointment: a,
        workOrder: null,
        item: null,
        baseCents: base,
        amountCents: commissionOf(ruleFor(p.rules, p.resourceId, a.serviceId), base),
      };
    });
  const delivered = (p.workOrders ?? []).filter(
    (w) =>
      w.resourceId === p.resourceId && w.stage === "entregue" && w.deliveredAt && monthOf(w.deliveredAt) === p.month,
  );
  const fromWorkOrders: CommissionLine[] = delivered.flatMap((w) =>
    (p.workOrderItems ?? [])
      .filter((i) => i.workOrderId === w.id && i.kind === "servico" && i.status === "aprovado")
      .map((i) => {
        const base = i.quantity * i.unitCents;
        return {
          key: i.id,
          at: w.deliveredAt!,
          serviceId: i.serviceId,
          appointment: null,
          workOrder: w,
          item: i,
          baseCents: base,
          amountCents: commissionOf(ruleFor(p.rules, p.resourceId, i.serviceId), base),
        };
      }),
  );
  const lines = [...fromAppointments, ...fromWorkOrders].sort((a, b) => a.at.localeCompare(b.at));
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
