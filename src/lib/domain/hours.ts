import { addDays } from "@/lib/domain/dates";
import type { ISODate, ISODateTime, ResourceBlock, WorkHours } from "@/lib/domain/types";

/**
 * Horário de trabalho, bloqueios e horários livres para o agendamento online.
 * Tudo no horário de Brasília (UTC−3, sem horário de verão desde 2019), igual ao banco
 * (_within_hours e public_book em 20261114000017_online_booking.sql), para não depender do fuso do servidor.
 */

export const BR_OFFSET_MIN = -180;
const OFFSET_MS = BR_OFFSET_MIN * 60_000;
const pad = (n: number) => n.toString().padStart(2, "0");

export const WEEKDAY_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Instante → data, hora e dia da semana no horário de Brasília. */
export function brParts(iso: ISODateTime): { date: ISODate; time: string; weekday: number } {
  const d = new Date(new Date(iso).getTime() + OFFSET_MS);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: d.getUTCDay(),
  };
}

/** Data e hora no horário de Brasília → instante. */
export function fromBr(date: ISODate, time: string): ISODateTime {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - OFFSET_MS).toISOString();
}

export const hasHours = (h: WorkHours) => Object.values(h).some((list) => (list?.length ?? 0) > 0);

/** Confere o formato: horas válidas, início antes do fim, períodos sem sobreposição, até 4 por dia. */
export function workHoursError(h: unknown): string | null {
  if (!h || typeof h !== "object" || Array.isArray(h)) return "Horário inválido.";
  for (const [key, list] of Object.entries(h as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(list)) return "Horário inválido.";
    if (list.length > 4) return "Use até 4 períodos por dia.";
    const sorted = [...list].sort((a, b) => String(a?.[0]).localeCompare(String(b?.[0])));
    for (let i = 0; i < sorted.length; i++) {
      const iv = sorted[i];
      if (!Array.isArray(iv) || iv.length !== 2 || !TIME_RE.test(iv[0]) || !TIME_RE.test(iv[1]))
        return `${WEEKDAY_LABEL[Number(key)]}: use horas como 09:00.`;
      if (iv[0] >= iv[1]) return `${WEEKDAY_LABEL[Number(key)]}: o fim precisa ser depois do início.`;
      if (i > 0 && sorted[i - 1][1] > iv[0]) return `${WEEKDAY_LABEL[Number(key)]}: os períodos se sobrepõem.`;
    }
  }
  return null;
}

/** O horário cabe inteiro num período de trabalho daquele dia? Sem horário definido, tudo cabe. */
export function withinHours(h: WorkHours, startsAt: ISODateTime, endsAt: ISODateTime): boolean {
  if (!hasHours(h)) return true;
  const s = brParts(startsAt);
  const e = brParts(endsAt);
  const endTime = e.date !== s.date && e.time === "00:00" ? "24:00" : e.time;
  if (e.date !== s.date && endTime !== "24:00") return false;
  const day = h[String(s.weekday) as keyof WorkHours] ?? [];
  return day.some(([from, to]) => from <= s.time && endTime <= to);
}

/** Bloqueios que pegam o período. */
export function blocksFor(
  blocks: readonly ResourceBlock[],
  slot: { resourceId: string; startsAt: ISODateTime; endsAt: ISODateTime },
): ResourceBlock[] {
  return blocks.filter(
    (b) =>
      b.resourceId === slot.resourceId &&
      new Date(b.startsAt) < new Date(slot.endsAt) &&
      new Date(slot.startsAt) < new Date(b.endsAt),
  );
}

/** "seg a sex, 09:00–12:00 e 13:00–18:00 · sáb, 09:00–13:00" */
export function hoursSummary(h: WorkHours): string {
  if (!hasHours(h)) return "Sem horário definido";
  const groups: { days: number[]; text: string }[] = [];
  for (let d = 0; d < 7; d++) {
    const list = h[String(d) as keyof WorkHours] ?? [];
    if (!list.length) continue;
    const text = list.map(([a, b]) => `${a}–${b}`).join(" e ");
    const last = groups.at(-1);
    if (last && last.text === text && last.days.at(-1) === d - 1) last.days.push(d);
    else groups.push({ days: [d], text });
  }
  return groups
    .map(
      (g) =>
        `${g.days.length > 2 ? `${WEEKDAY_SHORT[g.days[0]]} a ${WEEKDAY_SHORT[g.days.at(-1)!]}` : g.days.map((d) => WEEKDAY_SHORT[d]).join(" e ")}, ${g.text}`,
    )
    .join(" · ");
}

// ---------------------------------------------------------------- Horários livres (agendamento online)

export interface BusyPeriod {
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}

/** Mesmas regras do banco: a partir de 30 minutos daqui e em até 60 dias. */
export const MIN_LEAD_MIN = 30;
export const MAX_AHEAD_DAYS = 60;

/**
 * Inícios possíveis num dia (horário de Brasília) para um serviço de `durationMin` minutos, a cada `stepMin`
 * minutos dentro dos períodos de trabalho, sem bater em horários ocupados nem bloqueios.
 */
export function availableSlots(p: {
  workHours: WorkHours;
  busy: readonly BusyPeriod[];
  date: ISODate;
  durationMin: number;
  now: Date;
  stepMin?: number;
}): ISODateTime[] {
  const step = p.stepMin ?? Math.min(Math.max(p.durationMin, 15), 30);
  const weekday = brParts(fromBr(p.date, "12:00")).weekday;
  const periods = p.workHours[String(weekday) as keyof WorkHours] ?? [];
  const earliest = p.now.getTime() + MIN_LEAD_MIN * 60_000;
  const latest = p.now.getTime() + MAX_AHEAD_DAYS * 86_400_000;
  const out: ISODateTime[] = [];
  for (const [from, to] of periods) {
    let t = new Date(fromBr(p.date, from)).getTime();
    const end = new Date(fromBr(p.date, to)).getTime();
    for (; t + p.durationMin * 60_000 <= end; t += step * 60_000) {
      const s = t;
      const e = t + p.durationMin * 60_000;
      if (s < earliest || s > latest) continue;
      if (p.busy.some((b) => new Date(b.startsAt).getTime() < e && s < new Date(b.endsAt).getTime())) continue;
      out.push(new Date(s).toISOString());
    }
  }
  return out;
}

/** Próximos dias (horário de Brasília) para escolher no agendamento online. */
export function nextDays(now: Date, count: number): ISODate[] {
  const today = brParts(now.toISOString()).date;
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}
