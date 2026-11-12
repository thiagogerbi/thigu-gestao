import { diffDays, toISODate } from "@/lib/domain/dates";
import type { Deal, ISODate } from "@/lib/domain/types";

export const STALE_AFTER_DAYS = 7;

export function isOpenStage(stage: Deal["stage"]): boolean {
  return stage !== "ganha" && stage !== "perdida";
}

export function daysInStage(deal: Deal, today: ISODate): number {
  return Math.max(0, diffDays(toISODate(new Date(deal.stageChangedAt)), today));
}

/** Negociação parada: aberta e sem atualização há 7 dias ou mais, ou com a próxima ação atrasada. */
export function staleReason(deal: Deal, today: ISODate): string | null {
  if (!isOpenStage(deal.stage)) return null;
  if (deal.nextActionDate && deal.nextActionDate < today) return "Próxima ação atrasada";
  const lastTouch = toISODate(new Date(deal.updatedAt > deal.stageChangedAt ? deal.updatedAt : deal.stageChangedAt));
  const idle = diffDays(lastTouch, today);
  if (idle >= STALE_AFTER_DAYS) return `Sem atualização há ${idle} dias`;
  if (!deal.nextAction) return "Sem próxima ação definida";
  return null;
}
