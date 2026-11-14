import { addDays, diffDays, formatShortDateBR, isISODate, toISODate } from "@/lib/domain/dates";
import type { Appointment, AppointmentStatus, ISODate, ISODateTime, Segment } from "@/lib/domain/types";

/**
 * Regras puras da agenda. Horários são guardados como instantes (ISO completo, UTC) e mostrados
 * no horário local de quem está usando — no Brasil, o do navegador.
 */

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  compareceu: "Atendido",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

export const STATUS_TONE: Record<AppointmentStatus, "blue" | "green" | "amber" | "red" | "gray" | "navy"> = {
  agendado: "blue",
  confirmado: "navy",
  compareceu: "green",
  faltou: "red",
  cancelado: "gray",
};

/** Ainda pode ser remarcado, confirmado ou encerrado. */
export const isOpenStatus = (s: AppointmentStatus) => s === "agendado" || s === "confirmado";

/** Para onde cada situação pode ir. Atendido e falta só voltam para "agendado" (desfazer). */
export function allowedStatuses(from: AppointmentStatus): AppointmentStatus[] {
  if (isOpenStatus(from))
    return ["agendado", "confirmado", "compareceu", "faltou", "cancelado"].filter(
      (s) => s !== from,
    ) as AppointmentStatus[];
  return ["agendado"];
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** Instante → data local ("2026-11-14") e hora local ("09:30"). */
export function localParts(iso: ISODateTime): { date: ISODate; time: string } {
  const d = new Date(iso);
  return { date: toISODate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Data e hora locais → instante. */
export function fromLocal(date: ISODate, time: string): ISODateTime {
  if (!isISODate(date) || !isTime(time)) throw new Error("data ou hora inválida");
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0).toISOString();
}

export function addMinutes(iso: ISODateTime, minutes: number): ISODateTime {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function durationMinutes(a: Pick<Appointment, "startsAt" | "endsAt">): number {
  return Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000);
}

/** "09:30 – 10:20" */
export function timeRange(a: Pick<Appointment, "startsAt" | "endsAt">): string {
  return `${localParts(a.startsAt).time} – ${localParts(a.endsAt).time}`;
}

export function dayOf(a: Pick<Appointment, "startsAt">): ISODate {
  return localParts(a.startsAt).date;
}

/** Dois horários se sobrepõem (encostar um no outro não conta). */
export function overlaps(
  a: Pick<Appointment, "startsAt" | "endsAt">,
  b: Pick<Appointment, "startsAt" | "endsAt">,
): boolean {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
}

/** Horários da mesma agenda que batem com o novo (cancelados não contam). */
export function conflictsFor<T extends Pick<Appointment, "id" | "resourceId" | "startsAt" | "endsAt" | "status">>(
  all: readonly T[],
  slot: { resourceId: string; startsAt: ISODateTime; endsAt: ISODateTime; ignoreId?: string },
): T[] {
  return all.filter(
    (x) => x.resourceId === slot.resourceId && x.id !== slot.ignoreId && x.status !== "cancelado" && overlaps(x, slot),
  );
}

export type Repeat = "nao" | "semanal" | "quinzenal";
export const MAX_REPEAT = 12;

/** Início de cada ocorrência de um atendimento que se repete (a primeira é o próprio horário). */
export function seriesStarts(startsAt: ISODateTime, repeat: Repeat, times: number): ISODateTime[] {
  const n = repeat === "nao" ? 1 : Math.min(Math.max(times, 1), MAX_REPEAT);
  const step = repeat === "quinzenal" ? 14 : 7;
  const { date, time } = localParts(startsAt);
  // soma dias no calendário local, para que um horário das 9h continue às 9h
  return Array.from({ length: n }, (_, i) => fromLocal(addDays(date, i * step), time));
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

/** "hoje", "amanhã" ou "no dia 20/11". */
function whenLabel(date: ISODate, today: ISODate) {
  const n = diffDays(today, date);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  return `no dia ${formatShortDateBR(date)}`;
}

/** Mensagem do lembrete pelo WhatsApp, no jeito de falar de cada ramo. */
export function reminderText(p: {
  segment: Segment;
  companyName: string;
  clientName: string;
  startsAt: ISODateTime;
  resourceName: string;
  serviceName: string | null;
  itemName: string | null;
  today: ISODate;
}): string {
  const { date, time } = localParts(p.startsAt);
  const when = `${whenLabel(date, p.today)} às ${time}`;
  const hello = `Olá, ${firstName(p.clientName)}!`;
  const confirm = "Pode confirmar respondendo esta mensagem?";
  switch (p.segment) {
    case "clinica":
      return `${hello} Lembrete da sua consulta na ${p.companyName} ${when}, com ${p.resourceName}. ${confirm}`;
    case "pet":
      return `${hello} Lembrete: ${p.itemName ?? "seu pet"} tem ${p.serviceName?.toLowerCase() ?? "horário"} na ${p.companyName} ${when}. ${confirm}`;
    case "turmas":
      return `${hello} Lembrete da sua aula na ${p.companyName} ${when}. ${confirm}`;
    default:
      return `${hello} Lembrete do seu horário na ${p.companyName} ${when}${p.serviceName ? ` (${p.serviceName})` : ""}, com ${p.resourceName}. ${confirm}`;
  }
}

/** Confere início e fim de um horário. Devolve a mensagem de erro, ou null quando está tudo certo. */
export function slotError(startsAt: ISODateTime, endsAt: ISODateTime): string | null {
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!(ms > 0)) return "O horário de término precisa ser depois do início.";
  if (ms > 12 * 60 * 60_000) return "Um atendimento pode durar no máximo 12 horas.";
  return null;
}

/** Mensagem do aviso de horário ocupado (o formulário oferece "marcar mesmo assim"). */
export function overlapMessage(count: number, resourceName: string): string {
  return count === 1
    ? `${resourceName} já tem um horário marcado nesse período.`
    : `${resourceName} já tem horários marcados em ${count} das datas escolhidas.`;
}

/** Mensagem depois de mudar a situação (igual na prévia e na versão real). */
export function statusMessage(status: AppointmentStatus, accountCreated: boolean): string {
  const toFinance = accountCreated ? " A conta a receber foi para o financeiro." : "";
  switch (status) {
    case "confirmado":
      return "Horário confirmado.";
    case "compareceu":
      return `Atendimento registrado.${toFinance}`;
    case "faltou":
      return accountCreated ? `Falta registrada e cobrada.${toFinance}` : "Falta registrada.";
    case "cancelado":
      return "Horário cancelado.";
    case "agendado":
      return "O atendimento voltou para agendado.";
  }
}

export const MODULE_OFF = "Este recurso não está disponível para o ramo ou o plano da empresa.";
