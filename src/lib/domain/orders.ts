import { addDays, diffDays } from "@/lib/domain/dates";
import type { EyeValues, ISODate, Order, OrderStage, Prescription } from "@/lib/domain/types";

/**
 * Pedidos com prazo e receita de óculos: regras puras. O banco tem as mesmas em 20261114000022_orders.sql.
 */

export const ORDER_STAGES: { id: OrderStage; label: string }[] = [
  { id: "recebido", label: "Recebido" },
  { id: "producao", label: "Em produção" },
  { id: "terceiro", label: "No laboratório ou fornecedor" },
  { id: "pronto", label: "Pronto para retirar" },
  { id: "entregue", label: "Entregue" },
  { id: "cancelado", label: "Cancelado" },
];
export const ORDER_STAGE_LABEL = Object.fromEntries(ORDER_STAGES.map((s) => [s.id, s.label])) as Record<
  OrderStage,
  string
>;
/** Colunas do quadro de pedidos. */
export const BOARD_STAGES = ["recebido", "producao", "terceiro", "pronto"] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];

export const isOpenOrder = (o: Pick<Order, "stage">) => o.stage !== "entregue" && o.stage !== "cancelado";

/** O técnico move entre em produção, no laboratório e pronto (igual a move_order no banco). */
export function technicianCanMove(from: OrderStage, to: OrderStage) {
  return (
    ["recebido", "producao", "terceiro", "pronto"].includes(from) && ["producao", "terceiro", "pronto"].includes(to)
  );
}

export const orderRest = (o: Pick<Order, "totalCents" | "downCents">) => o.totalCents - o.downCents;

export const isLateOrder = (o: Pick<Order, "promisedOn" | "stage">, today: ISODate) =>
  isOpenOrder(o) && o.stage !== "pronto" && o.promisedOn < today;

/** "hoje", "amanhã", "em 3 dias", "atrasado 2 dias" */
export function dueLabel(promisedOn: ISODate, today: ISODate): string {
  const d = diffDays(today, promisedOn);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d > 1) return `em ${d} dias`;
  return `atrasado ${-d} ${d === -1 ? "dia" : "dias"}`;
}

export function orderReadyMessage(p: { clientName: string; companyName: string; title: string; number: number }) {
  const first = p.clientName.trim().split(/\s+/)[0] ?? p.clientName;
  return `Olá, ${first}! Seu pedido nº ${p.number} (${p.title}) está pronto para retirar na ${p.companyName}. Qualquer dúvida, é só responder.`;
}

// ---------------------------------------------------------------- Receita de óculos

/** +1,25 / −0,50 / 0,00 (dioptrias, de 0,25 em 0,25). */
export function formatDiopter(n: number | null): string {
  if (n === null) return "—";
  const s = Math.abs(n).toFixed(2).replace(".", ",");
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/** "+1,25", "-0.5", "−0,75" → número; "" → null; inválido → NaN. */
export function parseDiopter(input: string): number | null {
  const s = input.trim().replace("−", "-").replace(",", ".").replace(/^\+/, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const quarter = (n: number) => Math.abs(Math.round(n * 100) % 25) === 0;

/** Confere um olho: de 0,25 em 0,25, eixo de 0 a 180 e eixo junto com o cilíndrico (igual ao banco). */
export function eyeError(e: EyeValues, name: string): string | null {
  if (e.sph !== null && (Number.isNaN(e.sph) || e.sph < -30 || e.sph > 30 || !quarter(e.sph)))
    return `${name}: esférico de −30 a +30, de 0,25 em 0,25.`;
  if (e.cyl !== null && (Number.isNaN(e.cyl) || e.cyl < -15 || e.cyl > 15 || !quarter(e.cyl)))
    return `${name}: cilíndrico de −15 a +15, de 0,25 em 0,25.`;
  if (e.axis !== null && (!Number.isInteger(e.axis) || e.axis < 0 || e.axis > 180)) return `${name}: eixo de 0 a 180.`;
  if (e.add !== null && (Number.isNaN(e.add) || e.add < 0 || e.add > 5 || !quarter(e.add)))
    return `${name}: adição de 0 a 5, de 0,25 em 0,25.`;
  if (e.cyl !== null && e.cyl !== 0 && e.axis === null) return `${name}: informe o eixo do cilíndrico.`;
  if (e.axis !== null && e.cyl === null) return `${name}: eixo sem cilíndrico.`;
  return null;
}

export function prescriptionError(
  p: Pick<Prescription, "examinedOn" | "validUntil" | "od" | "oe" | "dnpOd" | "dnpOe">,
): string | null {
  if (p.validUntil < p.examinedOn) return "A validade precisa ser depois da data do exame.";
  const od = eyeError(p.od, "Olho direito");
  if (od) return od;
  const oe = eyeError(p.oe, "Olho esquerdo");
  if (oe) return oe;
  for (const [v, n] of [
    [p.dnpOd, "DNP do olho direito"],
    [p.dnpOe, "DNP do olho esquerdo"],
  ] as const)
    if (v !== null && (Number.isNaN(v) || v < 20 || v > 45)) return `${n}: de 20 a 45 mm.`;
  return null;
}

/** Validade padrão: um ano depois do exame. */
export const defaultValidity = (examinedOn: ISODate) => addDays(examinedOn, 365);

export type PrescriptionStatus = "valida" | "vencendo" | "vencida";
export function prescriptionStatus(p: Pick<Prescription, "validUntil">, today: ISODate): PrescriptionStatus {
  const d = diffDays(today, p.validUntil);
  return d < 0 ? "vencida" : d <= 30 ? "vencendo" : "valida";
}

/** A receita mais recente de cada cliente, quando vence nos próximos 30 dias ou venceu há até 90. */
export function examsDue(prescriptions: readonly Prescription[], today: ISODate) {
  const latest = new Map<string, Prescription>();
  for (const p of prescriptions) {
    const prev = latest.get(p.clientId);
    if (!prev || prev.examinedOn < p.examinedOn) latest.set(p.clientId, p);
  }
  return [...latest.values()]
    .map((p) => ({ prescription: p, days: diffDays(today, p.validUntil) }))
    .filter((x) => x.days <= 30 && x.days >= -90)
    .sort((a, b) => a.days - b.days);
}

export function examMessage(p: { clientName: string; companyName: string; expired: boolean }) {
  const first = p.clientName.trim().split(/\s+/)[0] ?? p.clientName;
  return `Olá, ${first}! Aqui é da ${p.companyName}. ${p.expired ? "Sua receita de óculos venceu" : "Sua receita de óculos está vencendo"}. Que tal agendar o exame de vista? Depois é só trazer a receita nova que a gente cuida dos óculos.`;
}
