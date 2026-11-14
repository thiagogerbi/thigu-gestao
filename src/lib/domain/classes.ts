import { addDays, diffDays } from "@/lib/domain/dates";
import type { Attendance, ClassGroup, Enrollment, ISODate } from "@/lib/domain/types";

/** Turmas e presença: regras puras. O banco tem as mesmas em 20261114000015_classes.sql. */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function classError(c: Pick<ClassGroup, "weekdays" | "startTime" | "durationMin" | "capacity">): string | null {
  if (!c.weekdays.length || c.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return "Escolha os dias da semana.";
  if (!TIME_RE.test(c.startTime)) return "Digite o horário, por exemplo 18:00.";
  if (!Number.isInteger(c.durationMin) || c.durationMin < 5 || c.durationMin > 720) return "Use de 5 a 720 minutos.";
  if (!Number.isInteger(c.capacity) || c.capacity < 1 || c.capacity > 200) return "Use de 1 a 200 vagas.";
  return null;
}

function weekdayOf(date: ISODate) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const hasClassOn = (c: Pick<ClassGroup, "weekdays">, date: ISODate) => c.weekdays.includes(weekdayOf(date));

/** Matrícula ativa na data. */
export function activeOn(e: Pick<Enrollment, "startedOn" | "endedOn">, date: ISODate) {
  return e.startedOn <= date && (!e.endedOn || e.endedOn >= date);
}

export function activeEnrollments(enrollments: readonly Enrollment[], classId: string, date: ISODate) {
  return enrollments.filter((e) => e.classId === classId && activeOn(e, date));
}

/** Vagas ocupadas hoje (matrículas sem data de fim). */
export const seatsTaken = (enrollments: readonly Enrollment[], classId: string) =>
  enrollments.filter((e) => e.classId === classId && !e.endedOn).length;

/** Datas com aula entre dois dias (inclusive). */
export function classDates(c: Pick<ClassGroup, "weekdays">, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (hasClassOn(c, d)) out.push(d);
  return out;
}

/**
 * Alunos que pararam de vir: matrícula ativa, matriculados há pelo menos `days` dias e sem presença
 * (nem reposição) nos últimos `days` dias.
 */
export function stoppedComing(p: {
  enrollments: readonly Enrollment[];
  attendance: readonly Attendance[];
  today: ISODate;
  days?: number;
}): Enrollment[] {
  const days = p.days ?? 21;
  const since = addDays(p.today, -days);
  return p.enrollments.filter(
    (e) =>
      !e.endedOn &&
      diffDays(e.startedOn, p.today) >= days &&
      !p.attendance.some(
        (a) => a.clientId === e.clientId && a.status !== "falta" && a.classDate > since && a.classDate <= p.today,
      ),
  );
}
