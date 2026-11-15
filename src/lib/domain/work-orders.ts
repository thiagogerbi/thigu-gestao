import { addDays, diffDays } from "@/lib/domain/dates";
import { brParts } from "@/lib/domain/hours";
import type { ISODate, ISODateTime, Plan, WorkOrder, WorkOrderItem, WorkOrderStage } from "@/lib/domain/types";

/**
 * Ordem de serviço da oficina: regras puras. O banco tem as mesmas em 20261114000019_work_orders.sql.
 */

export const WO_STAGES: { id: WorkOrderStage; label: string; short: string }[] = [
  { id: "orcamento", label: "Aguardando orçamento", short: "Orçamento" },
  { id: "aprovacao", label: "Aguardando aprovação", short: "Aprovação" },
  { id: "peca", label: "Aguardando peça", short: "Peça" },
  { id: "servico", label: "Em serviço", short: "Em serviço" },
  { id: "pronto", label: "Pronto para retirar", short: "Pronto" },
  { id: "entregue", label: "Entregue", short: "Entregue" },
  { id: "cancelada", label: "Cancelada", short: "Cancelada" },
];
export const WO_STAGE_LABEL = Object.fromEntries(WO_STAGES.map((s) => [s.id, s.label])) as Record<
  WorkOrderStage,
  string
>;
/** Colunas do quadro do pátio (entregues e canceladas ficam no histórico). */
export const YARD_STAGES = ["orcamento", "aprovacao", "peca", "servico", "pronto"] as const;
export type YardStage = (typeof YARD_STAGES)[number];
/** Etapas em que o mecânico pode mover a OS. */
export const MECHANIC_STAGES: WorkOrderStage[] = ["peca", "servico", "pronto"];

export const isOpenStage = (s: WorkOrderStage) => s !== "entregue" && s !== "cancelada";

/** O mecânico só move entre aguardando peça, em serviço e pronto. */
export function mechanicCanMove(from: WorkOrderStage, to: WorkOrderStage) {
  return MECHANIC_STAGES.includes(from) && MECHANIC_STAGES.includes(to);
}

export const FUEL_LEVELS = ["reserva", "1/4", "1/2", "3/4", "cheio"] as const;
export const FUEL_LABEL: Record<(typeof FUEL_LEVELS)[number], string> = {
  reserva: "Reserva",
  "1/4": "1/4",
  "1/2": "Meio tanque",
  "3/4": "3/4",
  cheio: "Cheio",
};

/** Sugestões para a conferência de entrada (a atendente pode escrever outras). */
export const CHECKLIST_SUGGESTIONS = [
  "Estepe",
  "Macaco e chave de roda",
  "Triângulo",
  "Documento do veículo",
  "Som / multimídia",
  "Tapetes",
  "Calotas",
  "Chave reserva",
];

// ---------------------------------------------------------------- Placa

/** "abc-1d23" → "ABC1D23" */
export const normalizePlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Placa antiga (ABC1234) ou Mercosul (ABC1D23). */
export const isPlate = (s: string) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(s);
/** "ABC1234" → "ABC-1234"; Mercosul fica como está. */
export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return "";
  return /^[A-Z]{3}[0-9]{4}$/.test(plate) ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}

// ---------------------------------------------------------------- Valores

export const lineTotal = (i: Pick<WorkOrderItem, "quantity" | "unitCents">) => i.quantity * i.unitCents;

/** Orçamento: todos os itens menos os recusados (igual a _wo_quote_total). */
export function quoteTotal(items: readonly WorkOrderItem[]): number {
  return items.filter((i) => i.status !== "recusado").reduce((s, i) => s + lineTotal(i), 0);
}

export function itemsOf(items: readonly WorkOrderItem[], workOrderId: string) {
  return items.filter((i) => i.workOrderId === workOrderId);
}

export interface WorkOrderTotals {
  parts: number;
  labor: number;
  quote: number;
  approved: number;
  pending: number;
  refused: number;
  discount: number;
  /** Quanto o cliente paga: orçamento (sem os recusados) menos o desconto. */
  total: number;
}

export function totals(wo: Pick<WorkOrder, "discountCents">, items: readonly WorkOrderItem[]): WorkOrderTotals {
  const sum = (f: (i: WorkOrderItem) => boolean) => items.filter(f).reduce((s, i) => s + lineTotal(i), 0);
  const quote = quoteTotal(items);
  return {
    parts: sum((i) => i.kind === "peca" && i.status !== "recusado"),
    labor: sum((i) => i.kind === "servico" && i.status !== "recusado"),
    quote,
    approved: sum((i) => i.status === "aprovado"),
    pending: sum((i) => i.status === "pendente"),
    refused: sum((i) => i.status === "recusado"),
    discount: wo.discountCents,
    total: Math.max(0, quote - wo.discountCents),
  };
}

/** A recepção dá até 10% do orçamento; admin e gestor, à vontade. */
export const MAX_DESK_DISCOUNT = 0.1;
export function discountError(discountCents: number, quoteCents: number, unlimited: boolean): string | null {
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > quoteCents)
    return "O desconto precisa ficar entre zero e o valor do orçamento.";
  if (!unlimited && discountCents * 10 > quoteCents)
    return "O atendimento dá até 10% de desconto. Acima disso, peça ao dono.";
  return null;
}

/** Tamanho máximo da foto já reduzida no navegador (data URL), cerca de 300 KB. */
export const PHOTO_MAX_CHARS = 420_000;

/** Fotos por OS conforme o plano (igual a _photo_limit no banco). */
export const PHOTO_LIMIT: Record<Plan, number> = { essencial: 4, equipe: 8, empresa: 12 };

// ---------------------------------------------------------------- Prazos, garantia e revisão

export const isLate = (wo: Pick<WorkOrder, "promisedOn" | "stage">, today: ISODate) =>
  isOpenStage(wo.stage) && wo.stage !== "pronto" && wo.promisedOn !== null && wo.promisedOn < today;

/** Fim da garantia de um item (data da entrega + dias), ou null. */
export function warrantyUntil(item: Pick<WorkOrderItem, "warrantyDays" | "status">, deliveredAt: ISODateTime | null) {
  if (!item.warrantyDays || item.status !== "aprovado" || !deliveredAt) return null;
  return addDays(brParts(deliveredAt).date, item.warrantyDays);
}

export interface RevisionDue {
  workOrder: WorkOrder;
  days: number;
}

/**
 * Revisões a lembrar: a última OS entregue de cada veículo com próxima revisão marcada, vencendo nos próximos
 * `ahead` dias ou atrasada há até 60 dias.
 */
export function revisionsDue(workOrders: readonly WorkOrder[], today: ISODate, ahead = 30): RevisionDue[] {
  const latest = new Map<string, WorkOrder>();
  for (const w of workOrders) {
    if (w.stage !== "entregue" || !w.deliveredAt) continue;
    const prev = latest.get(w.itemId);
    if (!prev || (prev.deliveredAt ?? "") < w.deliveredAt) latest.set(w.itemId, w);
  }
  return [...latest.values()]
    .filter((w) => w.nextServiceOn)
    .map((w) => ({ workOrder: w, days: diffDays(today, w.nextServiceOn!) }))
    .filter((r) => r.days <= ahead && r.days >= -60)
    .sort((a, b) => a.days - b.days);
}

// ---------------------------------------------------------------- Mensagens (WhatsApp com 1 clique)

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const vehicleText = (model: string, plate: string | null | undefined) =>
  plate ? `${model} (placa ${formatPlate(plate)})` : model;

export function quoteMessage(p: {
  clientName: string;
  companyName: string;
  model: string;
  plate?: string | null;
  link: string;
}) {
  return `Olá, ${first(p.clientName)}! Aqui é da ${p.companyName}. O orçamento do seu ${vehicleText(p.model, p.plate)} está pronto: ${p.link}\nÉ só abrir, marcar o que quer fazer e confirmar.`;
}

export function readyMessage(p: { clientName: string; companyName: string; model: string; plate?: string | null }) {
  return `Olá, ${first(p.clientName)}! Seu ${vehicleText(p.model, p.plate)} está pronto para retirar na ${p.companyName}. Qualquer dúvida, é só responder.`;
}

export function revisionMessage(p: {
  clientName: string;
  companyName: string;
  model: string;
  plate?: string | null;
  note: string;
}) {
  const what = p.note.trim() ? p.note.trim().replace(/\.$/, "").toLowerCase() : "a revisão";
  return `Olá, ${first(p.clientName)}! Aqui é da ${p.companyName}. Está chegando a hora de ${what} do seu ${vehicleText(p.model, p.plate)}. Quer agendar um horário?`;
}
