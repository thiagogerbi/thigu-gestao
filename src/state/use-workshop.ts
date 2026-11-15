"use client";

import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import type { WorkOrder } from "@/lib/domain/types";
import { formatPlate, itemsOf, mechanicCanMove, totals } from "@/lib/domain/work-orders";
import { useBackend } from "@/state/backend-context";

/** O que as telas da oficina precisam saber: quem pode o quê, nomes e valores de cada OS. */
export function useWorkshop() {
  const { data, me, mode } = useBackend();
  const myResources = new Set(data.resources.filter((r) => r.userId === me.userId).map((r) => r.id));
  const seesAll = can(me.roles, "os.ver_todas");
  const enabled = moduleAvailable(data.company, "ordem_servico") && (seesAll || myResources.size > 0);
  const canEdit = can(me.roles, "os.editar");
  const canDeliver = can(me.roles, "os.entregar");
  const isMine = (w: WorkOrder) => w.resourceId !== null && myResources.has(w.resourceId);
  /** Pode mexer nos itens, fotos e diagnóstico. */
  const canWork = (w: WorkOrder) => canEdit || isMine(w);
  const canMoveTo = (w: WorkOrder, to: WorkOrder["stage"]) => canEdit || (isMine(w) && mechanicCanMove(w.stage, to));

  const vehicle = (w: Pick<WorkOrder, "itemId">) => data.items.find((i) => i.id === w.itemId);
  const vehicleName = (w: Pick<WorkOrder, "itemId">) => vehicle(w)?.name ?? "Veículo";
  const plate = (w: Pick<WorkOrder, "itemId">) => formatPlate(vehicle(w)?.plate);
  const client = (w: Pick<WorkOrder, "clientId">) => data.clients.find((c) => c.id === w.clientId);
  const mechanicName = (w: Pick<WorkOrder, "resourceId">) =>
    w.resourceId ? (data.resources.find((r) => r.id === w.resourceId)?.name ?? "—") : "Sem mecânico";
  const itemsFor = (w: Pick<WorkOrder, "id">) => itemsOf(data.workOrderItems, w.id);
  const totalsFor = (w: WorkOrder) => totals(w, itemsFor(w));
  /** Link público do orçamento. Na prévia, abre o exemplo (que não grava nada). */
  const quoteLink = (w: Pick<WorkOrder, "shareToken">, origin: string) =>
    mode === "previa" ? `${origin}/orcamento/exemplo` : w.shareToken ? `${origin}/orcamento/${w.shareToken}` : null;

  return {
    enabled,
    seesAll,
    canEdit,
    canDeliver,
    isMine,
    canWork,
    canMoveTo,
    vehicle,
    vehicleName,
    plate,
    client,
    mechanicName,
    itemsFor,
    totalsFor,
    quoteLink,
  };
}
