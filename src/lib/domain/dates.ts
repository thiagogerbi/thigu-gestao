import type { ISODate, ISODateTime } from "@/lib/domain/types";

const pad = (n: number) => n.toString().padStart(2, "0");

export function isISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Data local (fuso do navegador/servidor) no formato AAAA-MM-DD. */
export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

function parts(iso: ISODate) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function addDays(iso: ISODate, days: number): ISODate {
  const { y, m, d } = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Soma meses mantendo o dia; se o mês não tiver o dia (ex.: 31), usa o último dia do mês. */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { y, m, d } = parts(iso);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
}

/** Diferença em dias de calendário: b - a. */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parts(a);
  const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** "2026-11-06" → "06/11/2026" */
/**
 * "2026-11-06" → "06/11/2026". Também aceita data com horário (ISO completo, em UTC):
 * nesse caso usa a data local, para que algo feito às 22h não apareça como "amanhã".
 */
export function formatDateBR(iso: ISODate | ISODateTime | null | undefined): string {
  if (!iso) return "—";
  const day = iso.length > 10 ? toISODate(new Date(iso)) : iso;
  const { y, m, d } = parts(day);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** "2026-11-06" → "06/11" */
export function formatShortDateBR(iso: ISODate): string {
  const { m, d } = parts(iso.slice(0, 10));
  return `${pad(d)}/${pad(m)}`;
}

export function formatDateTimeBR(isoDateTime: string): string {
  const dt = new Date(isoDateTime);
  return `${toISODate(dt).split("-").reverse().join("/")} às ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Texto amigável relativo a hoje: "hoje", "amanhã", "há 3 dias", "em 5 dias". */
export function relativeDayLabel(iso: ISODate, today: ISODate): string {
  const n = diffDays(today, iso);
  if (n === 0) return "hoje";
  if (n === 1) return "amanhã";
  if (n === -1) return "ontem";
  if (n < 0) return `há ${-n} dias`;
  return `em ${n} dias`;
}
