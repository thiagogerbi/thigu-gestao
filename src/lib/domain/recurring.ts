import { accountStatus } from "@/lib/domain/accounts";
import { formatDateBR, isISODate } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import type { Account, Appointment, ISODate, Movement, Package, Subscription } from "@/lib/domain/types";

/**
 * Pacotes de sessões e mensalidades: regras puras, usadas pela prévia e pelo servidor.
 * O banco tem as mesmas regras em 20261114000010_packages_subscriptions.sql.
 */

export const MAX_SESSIONS = 200;

/** Sessões já usadas: atendimentos (ou faltas cobradas) que consumiram o pacote. */
export function sessionsUsed(pkg: Pick<Package, "id">, appointments: readonly Appointment[]): number {
  return appointments.filter((a) => a.packageId === pkg.id && a.consumesPackage).length;
}

/** Horários em aberto (agendado ou confirmado) que vão usar o pacote. */
export function sessionsBooked(
  pkg: Pick<Package, "id">,
  appointments: readonly Appointment[],
  ignoreAppointmentId?: string,
): number {
  return appointments.filter(
    (a) =>
      a.packageId === pkg.id && a.id !== ignoreAppointmentId && (a.status === "agendado" || a.status === "confirmado"),
  ).length;
}

export interface PackageView {
  pkg: Package;
  used: number;
  booked: number;
  /** Sessões que ainda não foram usadas. */
  remaining: number;
  /** Sessões livres para marcar (descontando as já marcadas). */
  free: number;
  expired: boolean;
  closed: boolean;
  /** Em uso: não encerrado, não vencido e com sessão livre. */
  usable: boolean;
  /** Acabando: até 1 sessão livre, ou vence em até 7 dias. */
  endingSoon: boolean;
}

export function packageView(
  pkg: Package,
  appointments: readonly Appointment[],
  today: ISODate,
  ignoreAppointmentId?: string,
): PackageView {
  const used = sessionsUsed(pkg, appointments);
  const booked = sessionsBooked(pkg, appointments, ignoreAppointmentId);
  const remaining = Math.max(pkg.sessionsTotal - used, 0);
  const free = Math.max(remaining - booked, 0);
  const expired = pkg.validUntil !== null && pkg.validUntil < today;
  const closed = pkg.closedAt !== null;
  const soon = pkg.validUntil !== null && !expired && pkg.validUntil <= addDaysLocal(today, 7);
  return {
    pkg,
    used,
    booked,
    remaining,
    free,
    expired,
    closed,
    usable: !closed && !expired && free > 0,
    endingSoon: !closed && !expired && (free <= 1 || soon),
  };
}

function addDaysLocal(iso: ISODate, days: number): ISODate {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** "3 de 10 sessões usadas · restam 7" */
export function packageSummary(v: PackageView): string {
  const base = `${v.used} de ${v.pkg.sessionsTotal} ${v.pkg.sessionsTotal === 1 ? "sessão usada" : "sessões usadas"}`;
  if (v.closed) return `${base} · encerrado`;
  if (v.expired) return `${base} · venceu em ${formatDateBR(v.pkg.validUntil)}`;
  const parts = [base, `${v.remaining === 1 ? "resta 1" : `restam ${v.remaining}`}`];
  if (v.booked > 0) parts.push(`${v.booked} já ${v.booked === 1 ? "marcada" : "marcadas"}`);
  if (v.pkg.validUntil) parts.push(`vale até ${formatDateBR(v.pkg.validUntil)}`);
  return parts.join(" · ");
}

/** Confere um pacote para usar num horário. Devolve a mensagem de erro, ou null. */
export function packageError(v: PackageView | undefined, slots = 1): string | null {
  if (!v) return "Pacote não encontrado para este cliente.";
  if (v.closed) return "Este pacote foi encerrado.";
  if (v.expired) return `Este pacote venceu em ${formatDateBR(v.pkg.validUntil)}.`;
  if (v.free < slots)
    return v.free === 0
      ? "Este pacote não tem mais sessões livres para marcar."
      : `Este pacote só tem ${v.free} ${v.free === 1 ? "sessão livre" : "sessões livres"} para marcar.`;
  return null;
}

// ---------------------------------------------------------------- Mensalidades

/** Meses (primeiro dia) e vencimentos que a mensalidade deve ter cobrados até o mês de hoje. */
export function subscriptionPeriods(
  sub: Pick<Subscription, "dayOfMonth" | "startsOn" | "endsOn" | "canceledAt">,
  today: ISODate,
): { period: ISODate; dueDate: ISODate }[] {
  if (sub.canceledAt || sub.startsOn > today) return [];
  const out: { period: ISODate; dueDate: ISODate }[] = [];
  let [y, m] = sub.startsOn.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const pad = (n: number) => n.toString().padStart(2, "0");
  while (y < ty || (y === ty && m <= tm)) {
    const due = `${y}-${pad(m)}-${pad(sub.dayOfMonth)}`;
    if (due >= sub.startsOn && (!sub.endsOn || due <= sub.endsOn))
      out.push({ period: `${y}-${pad(m)}-01`, dueDate: due });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "Mensalidade: Pilates 2x (11/2026)" — igual ao texto que o banco grava. */
export function subscriptionChargeDescription(name: string, period: ISODate): string {
  const [y, m] = period.split("-");
  return `Mensalidade: ${name} (${m}/${y})`;
}

/** Início permitido: até um ano para trás (para lançar quem já é cliente) e um ano para frente. */
export function startsOnError(startsOn: string, today: ISODate): string | null {
  if (!isISODate(startsOn)) return "Escolha a data de início.";
  const [y, m, d] = today.split("-").map(Number);
  const min = `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const max = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (startsOn < min || startsOn > max) return "Use uma data de início de até um ano antes ou depois de hoje.";
  return null;
}

export type SubscriptionState = "em_dia" | "atrasada" | "cancelada" | "encerrada";

/** Situação da mensalidade a partir das cobranças. Sem acesso ao financeiro, só "cancelada"/"encerrada"/"em_dia". */
export function subscriptionState(
  sub: Subscription,
  accounts: readonly Account[],
  movements: Movement[],
  today: ISODate,
): { state: SubscriptionState; overdue: Account[] } {
  const overdue = accounts.filter(
    (a) => a.subscriptionId === sub.id && accountStatus(a, movements, today) === "atrasada",
  );
  if (overdue.length) return { state: "atrasada", overdue };
  if (sub.canceledAt) return { state: "cancelada", overdue };
  if (sub.endsOn && sub.endsOn < today) return { state: "encerrada", overdue };
  return { state: "em_dia", overdue };
}

/** Mensagem de cobrança gentil pelo WhatsApp. */
export function chargeText(p: {
  clientName: string;
  companyName: string;
  description: string;
  amountCents: number;
  dueDate: ISODate;
}) {
  const first = p.clientName.split(" ")[0] ?? p.clientName;
  return `Olá, ${first}! Tudo bem? Passando para lembrar da ${p.description.replace(/^Mensalidade: /, "mensalidade ")} na ${p.companyName}, de ${formatBRL(p.amountCents)}, que venceu em ${formatDateBR(p.dueDate)}. Se já pagou, desconsidere. Obrigado!`;
}
